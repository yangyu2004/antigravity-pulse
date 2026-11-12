import { readFile, writeFile, mkdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAN_RE = /\p{Script=Han}/u;
const HEAD_READ_BYTES = 49152;
const MAX_TITLE_CHARS = 18;
// 宿主有时把首条提问原样塞进标题，超过这个长度且与提问开头一致时视为原文堆砌
const RAW_TITLE_MIN_CHARS = 24;

export class TitleRenamer {
  constructor({ client, dataDir, brainRoot = join(homedir(), '.gemini', 'antigravity', 'brain') }) {
    this.client = client;
    this.brainRoot = brainRoot;
    this.stateFile = join(dataDir, 'auto_renamed_titles.json');
    this.state = null;
    this.inFlight = false;
    this.lastProbeAt = 0;
    this.lastSweepAt = 0;
  }

  async loadState() {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (raw && typeof raw === 'object' && Number.isFinite(raw.installedAtMs)) {
        this.state = { installedAtMs: raw.installedAtMs, renamed: raw.renamed || {} };
        return this.state;
      }
    } catch {}
    this.state = { installedAtMs: Date.now() - 10000, renamed: {} };
    await this.saveState();
    return this.state;
  }

  async saveState() {
    if (!this.state) return;
    try {
      await mkdir(join(this.stateFile, '..'), { recursive: true });
      await writeFile(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {}
  }

  maybeSync(conversationId) {
    if (!this.client || this.inFlight) return;
    const now = Date.now();
    const id = GUID.test(conversationId || '') ? conversationId.toLowerCase() : null;
    const needActiveCheck = id && !this.state?.renamed?.[id]?.locked && (now - this.lastProbeAt >= 5000);
    const needRecentSweep = now - this.lastSweepAt >= 30000;
    if (!needActiveCheck && !needRecentSweep) return;

    this.inFlight = true;
    if (needActiveCheck) this.lastProbeAt = now;
    if (needRecentSweep) this.lastSweepAt = now;

    void this.runSync(id, needRecentSweep).catch(() => {}).finally(() => {
      this.inFlight = false;
    });
  }

  async runSync(activeId, sweepRecent) {
    const state = await this.loadState();
    const now = Date.now();

    // 快速排除历史旧会话，零 RPC 开销
    if (activeId && !state.renamed[activeId]) {
      const info = await this.readFirstPrompts(join(this.brainRoot, activeId, '.system_generated', 'logs', 'transcript.jsonl'));
      if (info && info.firstCreatedAtMs > 0 && info.firstCreatedAtMs < state.installedAtMs) {
        state.renamed[activeId] = { locked: true, skippedHistorical: true };
        await this.saveState();
        if (!sweepRecent) return;
      }
    }

    const res = await this.client.call('GetAllCascadeTrajectories', { excludeSubtrajectories: true });
    const map = res?.trajectorySummaries || {};
    const entries = Object.entries(map)
      .sort((a, b) => Date.parse(b[1]?.lastModifiedTime || 0) - Date.parse(a[1]?.lastModifiedTime || 0))
      .slice(0, 6);

    if (activeId && map[activeId] && !entries.some(([k]) => k.toLowerCase() === activeId)) {
      entries.unshift([activeId, map[activeId]]);
    }

    let dirty = false;
    for (const [rawId, meta] of entries) {
      if (!GUID.test(rawId)) continue;
      const id = rawId.toLowerCase();
      const record = state.renamed[id];
      const currentTitle = String(meta?.summary || '').trim();
      if (record?.locked) {
        // 旧版本把宿主写入的整段提问原样锁定了；只修这种原文堆砌标题，用户手动起的短标题不动
        if (!record.skippedHistorical && !record.compacted && record.title && await this.isRawPromptTitle(id, currentTitle || record.title)) {
          if (await this.compactRawTitle(id, currentTitle || record.title, state, now)) dirty = true;
        }
        continue;
      }
      if (!currentTitle || currentTitle === '未命名会话' || /^new conversation$/i.test(currentTitle)) continue;

      if (HAN_RE.test(currentTitle) && !record?.provisional) {
        if (await this.isRawPromptTitle(id, currentTitle)) {
          if (await this.compactRawTitle(id, currentTitle, state, now)) dirty = true;
          continue;
        }
        state.renamed[id] = { title: currentTitle, locked: true, updatedAt: now };
        dirty = true;
        continue;
      }

      const modMs = meta?.lastModifiedTime ? Date.parse(meta.lastModifiedTime) : 0;
      if (modMs > 0 && modMs < state.installedAtMs) {
        state.renamed[id] = { locked: true, skippedHistorical: true };
        dirty = true;
        continue;
      }

      const changed = await this.renameIfChineseConversation(id, Boolean(record?.provisional), state, now);
      if (changed) dirty = true;
    }

    if (dirty) await this.saveState();
  }

  async isRawPromptTitle(id, title) {
    const chars = Array.from(String(title || '').trim());
    if (chars.length < RAW_TITLE_MIN_CHARS) return false;
    const info = await this.readFirstPrompts(join(this.brainRoot, id, '.system_generated', 'logs', 'transcript.jsonl'));
    const first = info?.userPrompts?.[0];
    if (!first) return false;
    const norm = v => String(v).replace(/[\s，,]+/g, '');
    const head = norm(chars.slice(0, RAW_TITLE_MIN_CHARS).join(''));
    return norm(first).startsWith(head.slice(0, Math.min(head.length, 16)));
  }

  async compactRawTitle(id, rawTitle, state, now) {
    const derived = this.summarizeToTitle(rawTitle);
    if (!derived || derived === rawTitle) {
      state.renamed[id] = { ...(state.renamed[id] || {}), title: rawTitle, locked: true, compacted: true, updatedAt: now };
      return true;
    }
    await this.client.call('UpdateConversationAnnotations', {
      cascadeId: id,
      annotations: { title: derived },
      mergeAnnotations: true
    });
    state.renamed[id] = { title: derived, locked: true, compacted: true, updatedAt: now };
    return true;
  }

  async renameIfChineseConversation(id, provisional, state, now) {
    const convDir = join(this.brainRoot, id);
    const transcriptPath = join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
    const stepsFile = join(convDir, 'scratch', 'task_steps.json');

    const info = await this.readFirstPrompts(transcriptPath);
    if (!info) return false;

    if (info.firstCreatedAtMs > 0 && info.firstCreatedAtMs < state.installedAtMs) {
      state.renamed[id] = { locked: true, skippedHistorical: true };
      return true;
    }

    const combinedUser = info.userPrompts.join('\n');
    if (!HAN_RE.test(combinedUser)) return false;

    let derived = '';
    try {
      const parsed = JSON.parse(await readFile(stepsFile, 'utf8'));
      const rawGoal = String(parsed?.title || parsed?.objective || '').trim();
      if (HAN_RE.test(rawGoal)) {
        derived = this.summarizeToTitle(rawGoal);
      }
    } catch {}

    const substantivePrompt = info.userPrompts.find(p => p.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '').length >= 5);
    if (!derived && substantivePrompt) {
      derived = this.summarizeToTitle(substantivePrompt);
    }

    let isProvisional = false;
    if (!derived) {
      if (provisional) return false;
      derived = '新建中文对话';
      isProvisional = true;
    }

    await this.client.call('UpdateConversationAnnotations', {
      cascadeId: id,
      annotations: { title: derived },
      mergeAnnotations: true
    });

    state.renamed[id] = {
      title: derived,
      provisional: isProvisional,
      locked: !isProvisional,
      updatedAt: now
    };
    return true;
  }

  async readFirstPrompts(transcriptPath) {
    let fh;
    try {
      const st = await stat(transcriptPath);
      if (st.size === 0) return null;
      const len = Math.min(st.size, HEAD_READ_BYTES);
      fh = await open(transcriptPath, 'r');
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      const lines = buf.toString('utf8').split('\n');
      if (st.size > len) lines.pop();

      let firstCreatedAtMs = 0;
      const userPrompts = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        let step;
        try { step = JSON.parse(line); } catch { continue; }
        if (!firstCreatedAtMs && step.created_at) {
          firstCreatedAtMs = Date.parse(step.created_at) || 0;
        }
        if (step.type === 'USER_INPUT' && step.source === 'USER_EXPLICIT' && typeof step.content === 'string') {
          const m = step.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
          const raw = (m ? m[1] : step.content).trim();
          const cleaned = raw
            .replace(/```[\s\S]*?```/g, ' ')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('[Attachment:') && !/^https?:\/\/\S+$/i.test(l))
            .join('，');
          if (cleaned) userPrompts.push(cleaned);
          if (userPrompts.length >= 3) break;
        }
      }
      return { firstCreatedAtMs, userPrompts };
    } catch {
      return null;
    } finally {
      await fh?.close().catch(() => {});
    }
  }

  summarizeToTitle(rawText) {
    const text = String(rawText || '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/(?:\/[\w.-]+){2,}\/([\w.-]+)/g, '$1')
      .replace(/[*`#_~<>[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const clauses = text
      .split(/[，,。！？!?；;：:❯\n]+/)
      .map(c => this.cleanClause(c))
      .filter(c => c.length >= 4 && HAN_RE.test(c));

    if (!clauses.length) {
      const single = this.cleanClause(text);
      return single.length >= 3 ? this.capTitle(single, MAX_TITLE_CHARS) : '';
    }

    const intentRe = /(实现|修复|优化|排查|解决|配置|添加|新增|支持|重命名|自动|同步|部署|生成|搭建|重构|分析|设计|改|写)/;
    const chosen = (clauses.length >= 2 && !intentRe.test(clauses[0]) && intentRe.test(clauses[1]))
      ? clauses[1]
      : clauses[0];

    return this.capTitle(chosen, MAX_TITLE_CHARS);
  }

  cleanClause(clause) {
    let s = String(clause || '').trim();
    const prefixRe = /^(?:你来看看|你看看|看看|你来|请问一下|请问|你好|嗨|麻烦你|麻烦|请帮我|帮我看一下|帮我看看|帮我把|帮我|我想问一下|想问下|有个问题|还有一个问题是|然后还有一个问题是|顺便问一下|另外|就是说|我现在想|我想知道|我该如何让它|该如何让它|如何让它|怎么让它|我该如何|该如何|如何才能|怎么才能|能够|能不能帮我|能不能|可不可以|是否可以|你在这个|在这个|这篇|这个|把)\s*/u;
    for (let i = 0; i < 4; i++) {
      const next = s.replace(prefixRe, '').trim();
      if (next === s) break;
      s = next;
    }
    return s
      .replace(/\s*(?:吗|呢|呀|啊|吧|喔|哦|好吗|可以吗|行吗|对不对|是吧|之类的|这样子|怎么弄|怎么做|怎么办)+$/u, '')
      .replace(/^[，,：:、\s]+|[，,：:、？?!！。\s]+$/g, '')
      .trim();
  }

  capTitle(str, maxChars = MAX_TITLE_CHARS) {
    const chars = Array.from(str.trim());
    if (chars.length <= maxChars) return chars.join('');
    let cut = chars.slice(0, maxChars).join('');
    // 截断点落在英文单词中间时，退回到单词开头，避免出现 "clau" 这类残词
    if (/[A-Za-z0-9]/.test(chars[maxChars - 1] || '') && /[A-Za-z0-9]/.test(chars[maxChars] || '')) {
      const trimmed = cut.replace(/[A-Za-z0-9._-]+$/, '');
      if (Array.from(trimmed.trim()).length >= 4) cut = trimmed;
    }
    return cut.replace(/[的与和及并或、\s]+$/u, '').trim();
  }
}
