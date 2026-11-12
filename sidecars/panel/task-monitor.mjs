import { readdir, stat, open, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THINK_STALL_SEC = 180; // 高推理模型正常思考可达 60~120s，超过 180s 无任何响应才判疑似卡死
const TOOL_STALL_SEC = 90;
const MAX_INITIAL_READ_BYTES = 262144;
// swarm_wait / wait_for_message 会阻塞到子代理在看板发消息，正常可等几十分钟；只有超过 30 分钟仍无回复才提示
const BOARD_WAIT_STALL_SEC = 1800;
const BOARD_WAIT_TOOLS = new Set(['swarm_wait', 'wait_for_message']);

export class TaskMonitor {
  constructor(options = {}) {
    this.brainRoot = options.brainRoot || join(homedir(), '.gemini', 'antigravity', 'brain');
    this.transcriptCache = new Map();
  }

  async snapshot(conversationId, { hostGenerating = null, domRunningSubagents = 0, cascadeState = null } = {}) {
    if (!conversationId || !GUID.test(conversationId)) {
      return this.defaultSnapshot('idle', '等待对话启动');
    }

    const id = conversationId.toLowerCase();
    const convDir = join(this.brainRoot, id);
    const sysGenDir = join(convDir, '.system_generated');
    const scratchDir = join(convDir, 'scratch');
    const logsDir = join(sysGenDir, 'logs');
    const tasksDir = join(sysGenDir, 'tasks');
    const transcriptPath = join(logsDir, 'transcript.jsonl');
    const lifecyclePath = join(scratchDir, 'lifecycle_state.json');
    const agentStepsPath = join(scratchDir, 'task_steps.json');

    const now = Date.now();

    // 1. 读取 hooks.json 捕获的生命周期瞬时状态
    let lifecycle = null;
    try {
      lifecycle = JSON.parse(await readFile(lifecyclePath, 'utf8'));
    } catch {}

    const lifecycleEvent = lifecycle?.event || null;
    const lifecycleMs = Number.isFinite(lifecycle?.timestampMs) ? lifecycle.timestampMs : 0;
    const hookToolName = lifecycle?.toolCall?.name || null;
    const hookToolArgs = lifecycle?.toolCall?.args || null;

    // 2. 增量读取 transcript.jsonl
    const tState = await this.readTranscriptIncremental(id, transcriptPath, now);

    // 检测“新一轮刚触发 PreInvocation，但 transcript.jsonl 尚未刷入新 USER_INPUT”的瞬态窗口，防止把上一轮已完成的看板闪出来
    const hookInputGoal = this.extractUserRequest(lifecycle?.lastUserInput || '');
    const pendingNewUserTurn = Boolean(
      tState.lastStepFinished &&
      tState.turnEndMs > 0 &&
      lifecycleEvent === 'PreInvocation' &&
      lifecycleMs > tState.turnEndMs + 150 &&
      ((hookInputGoal && hookInputGoal !== tState.lastUserInputGoal) ||
       (lifecycle?.invocationNum === 0 && lifecycleMs > (tState.turnStartMs || 0) + 1500))
    );
    const effectiveTurnStartMs = pendingNewUserTurn ? lifecycleMs : tState.turnStartMs;
    const effectivePrevTurnEndMs = pendingNewUserTurn
      ? Math.max(tState.turnEndMs || 0, tState.prevTurnEndMs || 0)
      : (tState.prevTurnEndMs || 0);
    const activeTranscriptSteps = pendingNewUserTurn ? [] : tState.steps;
    const activeTurnToolSteps = pendingNewUserTurn ? [] : tState.turnToolSteps;

    // 3. 读取可选的 scratch/task_steps.json（模型显式写入的精确步骤；严格隔离上一轮已完成旧文件）
    let filePlan = null;
    try {
      const st = await stat(agentStepsPath);
      const minValidMtime = effectiveTurnStartMs > 0
        ? effectiveTurnStartMs - 250
        : (tState.firstSeenStepMs > 0 ? tState.firstSeenStepMs - 2000 : 0);
      const fromPreviousTurn = effectivePrevTurnEndMs > 0 && st.mtimeMs <= effectivePrevTurnEndMs + 500;
      if (!fromPreviousTurn && (!minValidMtime || st.mtimeMs >= minValidMtime)) {
        const parsed = JSON.parse(await readFile(agentStepsPath, 'utf8'));
        if (Array.isArray(parsed?.steps) && parsed.steps.length >= 2) {
          filePlan = parsed;
        }
      }
    } catch {}

    // 4. 融合语言服务权威轨迹状态 + 子代理（Subagent / Swarm）活跃状态 + 宿主输入框状态
    const lsSubagentCount = Number.isSafeInteger(cascadeState?.runningSubagents) && cascadeState.runningSubagents > 0
      ? cascadeState.runningSubagents
      : 0;
    const domSubagentCount = Number.isSafeInteger(domRunningSubagents) && domRunningSubagents > 0
      ? domRunningSubagents
      : 0;
    const runningSubagentCount = Math.max(lsSubagentCount, domSubagentCount, cascadeState?.selfHasActiveChildren ? 1 : 0);
    const hasRunningSubagents = runningSubagentCount > 0;
    const subagentProbe = hasRunningSubagents
      ? await this.probeSubagentsActivity(cascadeState?.runningSubagentIds || [])
      : { latestMtimeMs: 0, latestAction: '' };

    const lsRunning = cascadeState?.selfRunning === true;
    const lsSettled = cascadeState?.selfSettled === true;
    const activeHookEvent = ['PreInvocation', 'PreToolUse', 'PostToolUse', 'PostInvocation'].includes(lifecycleEvent) ||
      (lifecycleEvent === 'Stop' && lifecycle?.fullyIdle === false);
    const transcriptCompletedAfterHook = !pendingNewUserTurn &&
      tState.lastStepFinished &&
      tState.turnEndMs > 0 &&
      tState.turnEndMs >= lifecycleMs - 1000;
    const abortedByError = !pendingNewUserTurn &&
      tState.lastErrorMs > 0 &&
      tState.lastErrorMs >= Math.max(effectiveTurnStartMs || 0, lifecycleMs - 1000) &&
      !lsRunning &&
      !hasRunningSubagents &&
      hostGenerating !== true;
    const staleIdleHook = activeHookEvent &&
      !pendingNewUserTurn &&
      !lsRunning &&
      !hasRunningSubagents &&
      hostGenerating === false && (
        (lsSettled && (now - Math.max(lifecycleMs, tState.lastGrowthMs || 0)) > 2500) ||
        (!cascadeState && tState.lastStepFinished && (now - Math.max(lifecycleMs, tState.lastGrowthMs || 0)) > 4000)
      );
    const unfinishedTranscriptActive = !pendingNewUserTurn &&
      !tState.lastStepFinished &&
      !lsSettled &&
      !abortedByError &&
      !(!cascadeState && hostGenerating === false && (now - (tState.lastGrowthMs || 0)) > 4000);

    const inActiveTurn = Boolean(
      hasRunningSubagents ||
      lsRunning ||
      hostGenerating === true ||
      pendingNewUserTurn ||
      (activeHookEvent && !transcriptCompletedAfterHook && !abortedByError && !staleIdleHook) ||
      unfinishedTranscriptActive
    );
    const turnFinished = !inActiveTurn;

    // 5. 仅扫描属于本轮对话（mtime >= effectiveTurnStartMs）的后台任务日志，彻底屏蔽历史旧日志
    let latestTask = null;
    if (effectiveTurnStartMs > 0) {
      try {
        const files = await readdir(tasksDir);
        const logFiles = files.filter(f => f.endsWith('.log'));
        let newestMtime = 0;
        for (const file of logFiles) {
          const filePath = join(tasksDir, file);
          const st = await stat(filePath);
          if (st.mtimeMs >= effectiveTurnStartMs - 1000 && st.mtimeMs > newestMtime) {
            newestMtime = st.mtimeMs;
            const tail = await this.readTailText(filePath, 2048);
            const lines = tail.trim().split('\n').filter(Boolean);
            latestTask = {
              name: file,
              mtimeMs: st.mtimeMs,
              lastLine: (lines[lines.length - 1] || '').trim(),
              elapsed: Math.max(0, Math.round((now - st.mtimeMs) / 1000))
            };
          }
        }
      } catch {}
    }

    // 6. 判定当前活跃动向与卡死状态（合并运行中子代理的最新心跳，避免主会话等待子代理时误报卡死）
    const hasBgTaskRunning = !turnFinished && lifecycleEvent === 'Stop' && lifecycle?.fullyIdle === false;
    const subagentActivityMs = hasRunningSubagents
      ? Math.max(cascadeState?.latestRunningSubagentModifiedMs || 0, subagentProbe.latestMtimeMs || 0)
      : 0;
    const lastActivityMs = Math.max(
      lifecycleMs,
      tState.lastGrowthMs || 0,
      latestTask ? latestTask.mtimeMs : 0,
      lsRunning ? (cascadeState?.selfModifiedMs || 0) : 0,
      subagentActivityMs
    );
    const silenceSec = lastActivityMs > 0 ? Math.max(0, Math.round((now - lastActivityMs) / 1000)) : 0;
    const mainWaitingOnSubagents = hasRunningSubagents && (!lsRunning || lifecycleEvent === 'Stop' || tState.lastStepFinished);
    const waitingOnBoard = !pendingNewUserTurn && tState.waitingOnBoard === true;

    let status = 'idle';
    let isStalled = false;
    let stalledReason = null;
    let headline = '待命';

    if (inActiveTurn) {
      const threshold = waitingOnBoard
        ? BOARD_WAIT_STALL_SEC
        : (lifecycleEvent === 'PreToolUse' && !mainWaitingOnSubagents) ? TOOL_STALL_SEC : THINK_STALL_SEC;
      const hasSubagentTelemetry = subagentActivityMs > 0 || (cascadeState?.runningSubagentIds?.length || 0) > 0;
      const canMeasureStall = !mainWaitingOnSubagents || hasSubagentTelemetry;
      if (canMeasureStall && silenceSec >= threshold) {
        isStalled = true;
        status = 'stalled';
        stalledReason = waitingOnBoard
          ? `等待子代理看板消息已连续 ${silenceSec} 秒无回复`
          : mainWaitingOnSubagents
          ? `运行中的 ${runningSubagentCount} 个子代理已连续 ${silenceSec} 秒无新响应`
          : lifecycleEvent === 'PreToolUse'
            ? `工具 [${hookToolName || 'tool'}] 已连续 ${silenceSec} 秒无响应`
            : hasBgTaskRunning
              ? `后台任务 [${latestTask?.name || 'task'}] 已连续 ${silenceSec} 秒无输出`
              : `模型思考已连续 ${silenceSec} 秒无新响应`;
        headline = (mainWaitingOnSubagents || waitingOnBoard) ? `⚠️ 子代理疑似卡住 (${silenceSec}s)` : `⚠️ 疑似卡住 (${silenceSec}s)`;
      } else if (waitingOnBoard && !hasRunningSubagents) {
        status = 'running';
        headline = `⏳ 等待子代理看板消息 (${silenceSec}s)`;
      } else if (mainWaitingOnSubagents) {
        status = 'running';
        headline = subagentProbe.latestAction
          ? `🔄 ${runningSubagentCount} 个子代理运行中 · ${subagentProbe.latestAction}`
          : `🔄 ${runningSubagentCount} 个子代理运行中`;
      } else if (lifecycleEvent === 'PreToolUse') {
        status = 'running';
        const act = this.formatToolAction(hookToolName, hookToolArgs);
        const subSuffix = hasRunningSubagents ? ` · ${runningSubagentCount} 子代理` : '';
        headline = act ? `⚙️ ${act}${subSuffix}` : `🤔 思考推进中 (${silenceSec}s)`;
      } else if (hasBgTaskRunning && latestTask) {
        status = 'running';
        headline = `⚙️ 后台任务: ${latestTask.name}`;
      } else if (hasRunningSubagents) {
        status = 'running';
        headline = `🔄 ${runningSubagentCount} 个子代理协同推进中`;
      } else {
        status = 'running';
        headline = `🤔 思考规划中 (${silenceSec}s)`;
      }
    } else if (turnFinished && (activeTranscriptSteps.length > 0 || activeTurnToolSteps.length > 0 || filePlan || effectiveTurnStartMs > 0)) {
      if ((lifecycle?.terminationReason === 'ERROR' && lifecycleMs >= (effectiveTurnStartMs || 0)) || abortedByError) {
        status = 'idle';
        headline = '⚠️ 上轮执行异常中断';
      } else if (lifecycle?.terminationReason === 'USER_CANCELED' && lifecycleMs >= (effectiveTurnStartMs || 0)) {
        status = 'idle';
        headline = '⏹ 已手动中止';
      } else {
        const hadMultiStep = Boolean(
          filePlan ||
          activeTranscriptSteps.length >= 2 ||
          activeTurnToolSteps.length >= 2 ||
          (cascadeState?.totalSubagents || 0) > 0
        );
        status = hadMultiStep ? 'completed' : 'idle';
        headline = hadMultiStep ? '✓ 当前任务已完成' : '📋 待命';
      }
    }

    // 7. 组装步骤清单（只读，100% 由 AI 实时运行驱动：scratch/task_steps.json > 模型计划列表 > 真实工具执行时间线）
    let baseSteps = [];
    let hasRealSteps = false;

    if (filePlan?.steps?.length >= 2) {
      baseSteps = filePlan.steps.slice(0, 8).map((s, i) => ({
        id: s.id || i + 1,
        title: this.cleanStepTitle(s.title) || `步骤 ${i + 1}`,
        status: turnFinished ? 'completed' : (s.status || 'pending'),
        percent: turnFinished || s.status === 'completed' ? 100 : (s.status === 'running' ? 50 : 0),
        explicit: true
      }));
      hasRealSteps = true;
    } else if (activeTranscriptSteps.length >= 2) {
      hasRealSteps = true;
      const allExplicit = activeTranscriptSteps.every(s => s.explicit);
      if (turnFinished && !['ERROR', 'USER_CANCELED'].includes(lifecycle?.terminationReason || '') && !abortedByError) {
        baseSteps = activeTranscriptSteps.map(s => ({ ...s, status: 'completed', percent: 100 }));
      } else if (!allExplicit) {
        const advanced = Math.min(activeTranscriptSteps.length - 1, Math.max(0, Math.floor(tState.modelStepsAfterPlan / 2)));
        let foundActive = false;
        baseSteps = activeTranscriptSteps.map((s, idx) => {
          if (s.status === 'completed' || idx < advanced) {
            return { ...s, status: 'completed', percent: 100 };
          }
          if (!foundActive && (status === 'running' || status === 'stalled')) {
            foundActive = true;
            return { ...s, status: isStalled ? 'stalled' : 'running', percent: 50 };
          }
          return { ...s, status: 'pending', percent: 0 };
        });
      } else {
        baseSteps = activeTranscriptSteps.map(s => ({ ...s }));
      }
    } else if (activeTurnToolSteps.length > 0 || (inActiveTurn && (lifecycleEvent === 'PreToolUse' || hasRunningSubagents))) {
      // 自动使用本轮真实调用过的工具生成 Claude 风格步骤轨
      const toolItems = activeTurnToolSteps.slice(-6).map((title, idx) => ({
        id: idx + 1,
        title,
        status: 'completed',
        percent: 100
      }));
      if (inActiveTurn && mainWaitingOnSubagents) {
        const subTitle = subagentProbe.latestAction
          ? `子代理协同中（${runningSubagentCount}）：${subagentProbe.latestAction}`
          : `等待 ${runningSubagentCount} 个子代理完成协同任务`;
        toolItems.push({ id: toolItems.length + 1, title: subTitle, status: isStalled ? 'stalled' : 'running', percent: 50 });
      } else if (inActiveTurn && lifecycleEvent === 'PreToolUse') {
        const curAction = this.formatToolAction(hookToolName, hookToolArgs);
        if (curAction) {
          if (!toolItems.length || toolItems[toolItems.length - 1].title !== curAction) {
            toolItems.push({ id: toolItems.length + 1, title: curAction, status: isStalled ? 'stalled' : 'running', percent: 50 });
          } else {
            toolItems[toolItems.length - 1].status = isStalled ? 'stalled' : 'running';
            toolItems[toolItems.length - 1].percent = 50;
          }
        }
      } else if (inActiveTurn) {
        toolItems.push({ id: toolItems.length + 1, title: '汇总分析与生成回复', status: isStalled ? 'stalled' : 'running', percent: 50 });
      }
      if (!turnFinished) {
        toolItems.push({ id: toolItems.length + 1, title: '完成验证并输出结果', status: 'pending', percent: 0 });
      }
      baseSteps = toolItems.slice(0, 8).map((s, idx) => ({ ...s, id: idx + 1 }));
      hasRealSteps = activeTurnToolSteps.length >= 2 || (activeTurnToolSteps.length >= 1 && inActiveTurn) || hasRunningSubagents;
    }

    // 关键不变量：只要本轮仍在运行（含子代理运行中），步骤列表绝不能全部渲染为 completed
    if (inActiveTurn && baseSteps.length > 0) {
      const hasActiveStep = baseSteps.some(s => s.status === 'running' || s.status === 'stalled');
      if (!hasActiveStep) {
        const firstPendingIdx = baseSteps.findIndex(s => s.status !== 'completed');
        if (firstPendingIdx >= 0) {
          baseSteps[firstPendingIdx] = {
            ...baseSteps[firstPendingIdx],
            status: isStalled ? 'stalled' : 'running',
            percent: 50
          };
        } else if (hasRunningSubagents && baseSteps.length < 8) {
          baseSteps.push({
            id: baseSteps.length + 1,
            title: `等待 ${runningSubagentCount} 个子代理完成协同任务`,
            status: isStalled ? 'stalled' : 'running',
            percent: 50
          });
        } else {
          const lastIdx = baseSteps.length - 1;
          baseSteps[lastIdx] = {
            ...baseSteps[lastIdx],
            status: isStalled ? 'stalled' : 'running',
            percent: 50
          };
        }
      }
    }

    let steps = baseSteps;
    if (!steps || steps.length === 0) {
      if (status === 'running' || status === 'stalled') {
        steps = [
          { id: 1, title: '接收指令与上下文准备', status: 'completed', percent: 100 },
          { id: 2, title: headline.replace(/^(?:🤔|⚙️|⚠️|✓|📋|⏹|🔄)\s*/u, ''), status: isStalled ? 'stalled' : 'running', percent: 50 },
          { id: 3, title: '整理结果并完成交付', status: 'pending', percent: 0 }
        ];
      } else {
        steps = [
          { id: 1, title: '监控探针与工作区就绪', status: 'completed', percent: 100 },
          { id: 2, title: '等待新指令或阶段计划', status: 'pending', percent: 0 }
        ];
      }
    } else if (isStalled) {
      steps = steps.map(s => (s.status === 'running' ? { ...s, status: 'stalled' } : s));
    }

    // 8. 计算总进度百分比（运行中严禁提前显示 100%）
    const completedCount = steps.filter(s => s.status === 'completed').length;
    const activeCount = steps.filter(s => s.status === 'running' || s.status === 'stalled').length;
    let progressPercent = 0;
    if (status === 'idle' && !hasRealSteps) {
      progressPercent = 0;
    } else if (steps.length > 0) {
      progressPercent = Math.round(((completedCount + activeCount * 0.5) / steps.length) * 100);
      if (completedCount === steps.length) progressPercent = 100;
      if (!turnFinished && progressPercent >= 100) progressPercent = 95;
    }

    // 9. 本轮真实耗时（结束即冻结；若子代理仍在运行则持续计时）
    let elapsedSeconds = 0;
    if (effectiveTurnStartMs > 0) {
      const endRef = turnFinished
        ? Math.max(
            tState.turnEndMs >= effectiveTurnStartMs ? tState.turnEndMs : 0,
            lifecycleMs >= effectiveTurnStartMs ? lifecycleMs : 0,
            cascadeState?.latestSubagentModifiedMs >= effectiveTurnStartMs ? cascadeState.latestSubagentModifiedMs : 0,
            effectiveTurnStartMs
          )
        : now;
      elapsedSeconds = Math.max(0, Math.round((endRef - effectiveTurnStartMs) / 1000));
    }

    const effectiveEvent = turnFinished && ['PreInvocation', 'PreToolUse'].includes(lifecycleEvent)
      ? 'Idle'
      : lifecycleEvent;
    const dataSource = hasRunningSubagents
      ? `subagents (${runningSubagentCount}) · transcript`
      : effectiveEvent
        ? `hooks (${effectiveEvent}) · transcript`
        : 'transcript.jsonl';

    const effectiveLatestTask = !turnFinished
      ? (latestTask
        ? {
            name: latestTask.name,
            isDone: false,
            lastLine: latestTask.lastLine.slice(0, 140),
            elapsed: latestTask.elapsed
          }
        : hasRunningSubagents
          ? {
              name: `${runningSubagentCount} 个子代理运行中`,
              isDone: false,
              lastLine: subagentProbe.latestAction
                ? `${runningSubagentCount} 个子代理正在协同 · ${subagentProbe.latestAction}`
                : `${runningSubagentCount} 个子代理正在后台并行推进`,
              elapsed: silenceSec
            }
          : null)
      : null;

    return {
      status,
      progressPercent,
      headline,
      objective: filePlan?.objective || (pendingNewUserTurn ? hookInputGoal : '') || tState.objective || '实时监控当前窗口项目进度，防止执行卡死',
      isStalled,
      stalledDuration: isStalled ? silenceSec : 0,
      stalledReason,
      elapsedSeconds,
      dataSource,
      runningSubagents: runningSubagentCount,
      turnStepIdx: pendingNewUserTurn ? (tState.turnStepIdx + 1) : tState.turnStepIdx,
      showInlineCard: Boolean(hasRealSteps && steps.length >= 2),
      steps,
      latestTask: effectiveLatestTask
    };
  }

  async probeSubagentsActivity(runningIds) {
    let latestMtimeMs = 0;
    let latestAction = '';
    if (!Array.isArray(runningIds) || !runningIds.length) return { latestMtimeMs, latestAction };
    for (const rawId of runningIds.slice(0, 6)) {
      const cid = String(rawId || '').toLowerCase();
      if (!GUID.test(cid)) continue;
      const childTranscript = join(this.brainRoot, cid, '.system_generated', 'logs', 'transcript.jsonl');
      const childLifecycle = join(this.brainRoot, cid, 'scratch', 'lifecycle_state.json');
      try {
        const st = await stat(childTranscript);
        if (st.mtimeMs > latestMtimeMs) {
          latestMtimeMs = st.mtimeMs;
          const tail = await this.readTailText(childTranscript, 4096);
          const lines = tail.split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const step = JSON.parse(lines[i]);
              const tcs = Array.isArray(step?.tool_calls) ? step.tool_calls : [];
              for (let j = tcs.length - 1; j >= 0; j--) {
                const label = this.formatToolAction(tcs[j]?.name, tcs[j]?.args);
                if (label) { latestAction = label; break; }
              }
              if (latestAction) break;
            } catch {}
          }
        }
      } catch {}
      try {
        const lst = await stat(childLifecycle);
        if (lst.mtimeMs > latestMtimeMs) latestMtimeMs = lst.mtimeMs;
      } catch {}
    }
    return { latestMtimeMs, latestAction };
  }

  unwrapArg(val) {
    if (val == null) return '';
    if (typeof val !== 'string') return String(val);
    let s = val.trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
      try { s = JSON.parse(s); } catch { s = s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
    }
    return String(s ?? '').replace(/^["']+|["']+$/g, '').trim();
  }

  truncateClean(str, maxLen = 34) {
    const s = String(str || '').replace(/\s+/g, ' ').trim();
    if (s.length <= maxLen) return s;
    const cut = s.slice(0, maxLen);
    const spaceIdx = cut.lastIndexOf(' ');
    if (spaceIdx >= maxLen - 10 && /[a-zA-Z]$/.test(cut)) {
      return `${cut.slice(0, spaceIdx).trim()}…`;
    }
    return `${cut.trim()}…`;
  }

  describeCommand(rawSummary, rawCmd) {
    const summary = this.unwrapArg(rawSummary).replace(/^(?:命令|执行命令|终端)[:：]\s*/i, '').trim();
    const cmd = this.unwrapArg(rawCmd);
    if (summary && /\p{Script=Han}/u.test(summary)) {
      return this.truncateClean(summary, 34);
    }
    const lowerCmd = cmd.toLowerCase();
    const lowerSum = summary.toLowerCase();
    if (/pkill|killall/.test(lowerCmd) && /cdpconnection|runtime\.evaluate|pgrep/.test(lowerCmd)) return '重启后台服务并验证实时状态';
    if (/pkill|killall/.test(lowerCmd)) return '重启后台服务进程';
    if (/cdpconnection|runtime\.evaluate|devtoolsactiveport/.test(lowerCmd)) return '验证页面实时渲染与节点状态';
    if (/new function\(|--check|tsc\b.*--noemit/.test(lowerCmd)) return '校验脚本语法与数据快照';
    const dbMatch = cmd.match(/([a-zA-Z0-9_.-]+\.(?:db|sqlite3?))\b/i);
    if (/sqlite3\b/.test(lowerCmd) && dbMatch) return `查询数据库 ${dbMatch[1]} 内容`;
    if (/sqlite3\b/.test(lowerCmd)) return '查询本地 SQLite 数据库';
    if (/\bgit\s+(status|diff|log|branch|show)\b/.test(lowerCmd) || /git status|git diff/.test(lowerSum)) return '检查 Git 仓库变更状态';
    if (/\bgit\s+(commit|push|merge|rebase)\b/.test(lowerCmd)) return '提交并同步 Git 代码变更';
    if (/\b(pytest|vitest|jest|mocha)\b|\b(npm|pnpm|yarn|cargo|go|node)\s+(run\s+)?test\b/.test(lowerCmd) || /unit test|run test/.test(lowerSum)) return '运行自动化测试验证';
    if (/\b(npm|pnpm|yarn|cargo|vite|tsc)\s+(run\s+)?build\b/.test(lowerCmd) || /package build|build project/.test(lowerSum)) return '编译构建项目产物';
    if (/\b(npm|pnpm|yarn|pip|uv|brew)\s+(install|add|i)\b/.test(lowerCmd)) return '安装项目依赖包';
    if (/\bstrings\b/.test(lowerCmd) || /language_server/.test(lowerCmd)) return '分析宿主底层接口定义';
    if (/\b(ps\s+aux|pgrep|lsof)\b/.test(lowerCmd)) return '检查后台运行进程状态';
    if (/\b(curl|wget)\b/.test(lowerCmd)) return '请求接口并检查响应结果';
    if (/\b(rg|grep)\b/.test(lowerCmd) && !/ps\s+aux/.test(lowerCmd)) return '检索代码关键字匹配';
    if (/^\s*(ls|find|stat|du)\b/.test(lowerCmd)) return '查看本地目录与配置结构';
    if (summary) {
      const target = (summary.match(/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+|\b(?:DOM|CDP|SDK|API|Git|SQL|DB|UI|CSS|JSON|MCP)\b/) || [])[0] || '';
      if (/^(inspect|check|verify|validate)\b/i.test(summary)) return target ? `检查验证 ${target} 状态` : '检查系统配置与运行状态';
      if (/^(read|view|list|show|get)\b/i.test(summary)) return target ? `查看 ${target} 详情` : '查看配置与状态信息';
      if (/^(reload|restart|start)\b/i.test(summary)) return target ? `重启并加载 ${target}` : '启动或重载本地服务';
      if (/^(fix|update|patch|sync)\b/i.test(summary)) return target ? `更新同步 ${target}` : '执行配置更新修复';
      return this.truncateClean(summary, 32);
    }
    const firstBin = cmd.trim().split(/\s+/)[0]?.split('/').pop() || '';
    return firstBin ? `执行 ${this.truncateClean(firstBin, 18)} 脚本任务` : '执行终端验证操作';
  }

  formatToolAction(name, args) {
    if (!name) return '执行操作中';
    if (name === 'run_command') {
      return this.describeCommand(args?.toolSummary, args?.CommandLine);
    }
    if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
      const cleanPath = this.unwrapArg(args?.Path);
      if (!cleanPath) return name === 'read_file' ? '查阅文件内容' : '更新项目文件';
      const base = cleanPath.split(/[\\/]/).pop().replace(/^["']+|["']+$/g, '');
      if (base === 'task_steps.json' || base === 'lifecycle_state.json') return null;
      if (name === 'read_file') {
        if (/\.(png|jpe?g|webp|gif|svg)$/i.test(base)) return `查看截图 ${base}`;
        if (/\/skills\/|\.md$/i.test(cleanPath)) return `查阅文档 ${base}`;
        return `读取 ${base} 代码`;
      }
      if (name === 'edit_file') return `修改 ${base} 代码`;
      return `写入文件 ${base}`;
    }
    if (name === 'invoke_subagent') {
      const role = this.unwrapArg(args?.Role) || this.unwrapArg(args?.TypeName);
      return role ? `调用子代理：${this.truncateClean(role, 24)}` : '调用子代理协同处理';
    }
    if (name === 'define_subagent') {
      const subName = this.unwrapArg(args?.Name);
      return subName ? `定义子代理：${this.truncateClean(subName, 24)}` : '定义专用子代理';
    }
    if (name === 'manage_subagents') return '管理子代理运行状态';
    if (name === 'swarm') {
      const act = this.unwrapArg(args?.action);
      const worker = this.unwrapArg(args?.name);
      if (act === 'add') return worker ? `派发子代理：${this.truncateClean(worker, 22)}` : '派发子代理协同执行';
      if (act === 'status') return '检查子代理团队运行进度';
      if (act === 'kill') return worker ? `回收子代理：${this.truncateClean(worker, 22)}` : '回收已完成子代理';
      if (act === 'title') return '初始化多子代理协作看板';
      return '协同调度子代理团队';
    }
    if (name === 'send_message') return '向子代理发送协作消息';
    if (name === 'read_board') return '读取子代理协作看板消息';
    if (name === 'post_message') return '同步结论至子代理协作看板';
    if (name === 'wait_for_message' || name === 'swarm_wait') return '等待子代理看板消息回调';
    if (name === 'manage_task') return '检查后台任务执行状态';
    if (name === 'schedule') return '配置定时监控任务';
    if (name === 'search_web') {
      const q = this.unwrapArg(args?.query);
      return q ? `联网检索：${this.truncateClean(q, 24)}` : '联网检索资料';
    }
    if (name === 'search_marketplace') return '检索插件市场扩展';
    return `调用工具 ${name}`;
  }

  async readTailText(filePath, maxBytes) {
    let fh;
    try {
      const st = await stat(filePath);
      if (st.size === 0) return '';
      const readLen = Math.min(st.size, maxBytes);
      const start = st.size - readLen;
      fh = await open(filePath, 'r');
      const buf = Buffer.alloc(readLen);
      await fh.read(buf, 0, readLen, start);
      return buf.toString('utf8');
    } catch {
      return '';
    } finally {
      await fh?.close().catch(() => {});
    }
  }

  async readTranscriptIncremental(conversationId, transcriptPath, now) {
    let cache = this.transcriptCache.get(conversationId);
    if (!cache) {
      cache = {
        offset: 0,
        lastSize: 0,
        lastGrowthMs: 0,
        firstSeenStepMs: 0,
        remainder: '',
        steps: [],
        turnToolSteps: [],
        planStepIdx: -1,
        modelStepsAfterPlan: 0,
        objective: '',
        lastUserInputGoal: '',
        turnStepIdx: -1,
        turnStartMs: 0,
        turnEndMs: 0,
        prevTurnEndMs: 0,
        lastErrorMs: 0,
        lastStepFinished: true,
        waitingOnBoard: false
      };
    }

    try {
      const st = await stat(transcriptPath);
      if (st.size < cache.offset) {
        cache.offset = 0;
        cache.remainder = '';
        cache.steps = [];
        cache.turnToolSteps = [];
        cache.planStepIdx = -1;
        cache.modelStepsAfterPlan = 0;
        cache.waitingOnBoard = false;
      }

      if (st.size > cache.lastSize) {
        cache.lastGrowthMs = cache.lastSize === 0 ? st.mtimeMs : now;
        cache.lastSize = st.size;
      }

      if (st.size === cache.offset) {
        this.transcriptCache.set(conversationId, cache);
        return cache;
      }

      let skipFirstLine = false;
      if (cache.offset === 0 && st.size > MAX_INITIAL_READ_BYTES) {
        cache.offset = st.size - MAX_INITIAL_READ_BYTES;
        skipFirstLine = true;
      }

      const readLength = st.size - cache.offset;
      const fh = await open(transcriptPath, 'r');
      const buffer = Buffer.alloc(readLength);
      try {
        await fh.read(buffer, 0, readLength, cache.offset);
      } finally {
        await fh.close();
      }
      cache.offset = st.size;

      const chunk = cache.remainder + buffer.toString('utf8');
      const parts = chunk.split('\n');
      cache.remainder = parts.pop() || '';
      if (skipFirstLine && parts.length > 0) parts.shift();

      for (const line of parts) {
        if (!line.trim()) continue;
        let step;
        try {
          step = JSON.parse(line);
        } catch {
          continue;
        }

        const stepTs = step.created_at ? Date.parse(step.created_at) : 0;
        const stepIdx = typeof step.step_index === 'number' ? step.step_index : -1;
        if (stepTs > 0 && (!cache.firstSeenStepMs || stepTs < cache.firstSeenStepMs)) {
          cache.firstSeenStepMs = stepTs;
        }

        if (step.type === 'ERROR_MESSAGE') {
          cache.lastErrorMs = stepTs || now;
          continue;
        }

        if (step.type === 'USER_INPUT' && step.source === 'USER_EXPLICIT') {
          if (stepIdx !== cache.turnStepIdx) {
            if (cache.turnEndMs > 0) cache.prevTurnEndMs = cache.turnEndMs;
            else if (stepTs > 0 && cache.turnStartMs > 0) cache.prevTurnEndMs = Math.max(cache.prevTurnEndMs || 0, stepTs - 200);
            cache.turnStepIdx = stepIdx;
            cache.turnStartMs = stepTs || now;
            cache.turnEndMs = 0;
            cache.lastErrorMs = 0;
            cache.lastStepFinished = false;
            cache.waitingOnBoard = false;
            cache.steps = [];
            cache.turnToolSteps = [];
            cache.planStepIdx = -1;
            cache.modelStepsAfterPlan = 0;
            const userGoal = this.extractUserRequest(step.content);
            if (userGoal) {
              cache.lastUserInputGoal = userGoal;
              if (!cache.objective || !/^(继续|继续吧|好的|好|开始|做|做吧|重试|ok|continue)/i.test(userGoal)) {
                cache.objective = userGoal;
              }
            }
          }
          continue;
        }

        // 子代理（Subagent / Swarm Worker）的首条输入往往是 SYSTEM_MESSAGE 或非 USER_EXPLICIT 的 USER_INPUT；同时主会话收到子代理回调 SYSTEM_MESSAGE 时代表本轮重新唤醒继续推进
        if (step.type === 'SYSTEM_MESSAGE' || (step.type === 'USER_INPUT' && step.source !== 'USER_EXPLICIT')) {
          cache.waitingOnBoard = false;
          if (cache.turnStepIdx === -1 && stepIdx >= 0) {
            cache.turnStepIdx = stepIdx;
            cache.turnStartMs = stepTs || now;
            cache.turnEndMs = 0;
            cache.lastStepFinished = false;
            if (!cache.objective) {
              const subGoal = this.extractSubagentPrompt(step.content);
              if (subGoal) cache.objective = subGoal;
            }
          } else if (cache.turnStepIdx >= 0 && stepIdx > cache.turnStepIdx) {
            cache.lastStepFinished = false;
            cache.turnEndMs = 0;
          }
          continue;
        }

        if (step.source === 'MODEL' && step.type === 'PLANNER_RESPONSE') {
          const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
          const hasTools = toolCalls.length > 0;
          cache.waitingOnBoard = toolCalls.some(tc => BOARD_WAIT_TOOLS.has(tc?.name));

          if (!hasTools && step.status === 'DONE') {
            cache.lastStepFinished = true;
            cache.turnEndMs = stepTs || now;
          } else {
            cache.lastStepFinished = false;
            cache.turnEndMs = 0;
            for (const tc of toolCalls) {
              const label = this.formatToolAction(tc.name, tc.args);
              if (!label) continue;
              const prev = cache.turnToolSteps[cache.turnToolSteps.length - 1] || '';
              // 连续查阅多个文档或代码文件时合并为一行，避免刷屏
              const readDocMatch = label.match(/^(查阅文档|读取)\s+([^\s、]+)(?:\s+代码)?$/);
              const prevDocMatch = prev.match(/^(查阅文档|读取)\s+(.+?)(?:\s+代码)?$/);
              if (readDocMatch && prevDocMatch && readDocMatch[1] === prevDocMatch[1]) {
                const items = prevDocMatch[2].split('、');
                if (!items.includes(readDocMatch[2]) && items.length < 3) {
                  const joined = [...items, readDocMatch[2]].join('、');
                  cache.turnToolSteps[cache.turnToolSteps.length - 1] = readDocMatch[1] === '读取' ? `读取 ${joined} 代码` : `查阅文档 ${joined}`;
                  continue;
                }
              }
              if (prev !== label) {
                cache.turnToolSteps.push(label);
              }
            }
          }

          if (cache.planStepIdx >= 0 && stepIdx > cache.planStepIdx) {
            cache.modelStepsAfterPlan++;
          }

          // 仅在执行中途提取计划（收尾总结陈词有工具数为 0，避免把总结列表覆盖成待办计划）
          if (hasTools || cache.steps.length === 0) {
            const contentExtracted = this.extractPlanSteps(step.content || '');
            if (contentExtracted.steps.length >= 2) {
              cache.steps = contentExtracted.steps;
              cache.planStepIdx = stepIdx;
              cache.modelStepsAfterPlan = 0;
            } else if (cache.steps.length === 0 && step.thinking) {
              const thinkExtracted = this.extractPlanSteps(step.thinking);
              if (thinkExtracted.steps.length >= 2) {
                cache.steps = thinkExtracted.steps;
                cache.planStepIdx = stepIdx;
                cache.modelStepsAfterPlan = 0;
              }
            }
          }
        }
      }

      this.transcriptCache.set(conversationId, cache);
    } catch {}

    return cache;
  }

  extractSubagentPrompt(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const msgMatch = raw.match(/<SYSTEM_MESSAGE>([\s\S]*?)<\/SYSTEM_MESSAGE>/i);
    const body = (msgMatch ? msgMatch[1] : raw).trim();
    const lines = body
      .split('\n')
      .map(l => l.replace(/^\[Message\][^\n]*$/i, '').trim())
      .filter(l => l.length >= 4 && !l.startsWith('[board]') && !l.startsWith('The following is'));
    const first = lines[0] || '';
    if (!first) return '';
    return first.length > 68 ? `${first.slice(0, 68)}…` : first;
  }

  extractUserRequest(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    const body = (match ? match[1] : raw).trim();
    const firstLine = body.split('\n').map(l => l.trim()).find(l => l.length >= 2 && !l.startsWith('[Attachment:'));
    if (!firstLine) return '';
    return firstLine.length > 68 ? `${firstLine.slice(0, 68)}…` : firstLine;
  }

  extractPlanSteps(text) {
    if (!text || typeof text !== 'string') return { steps: [], objective: '' };
    const cleaned = text.replace(/```[\s\S]*?```/g, '');
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    const steps = [];
    let objective = '';

    for (const l of lines.slice(0, 4)) {
      const plain = l.replace(/[*`_#]/g, '').trim();
      if (plain.length >= 6 && plain.length <= 68 && !plain.match(/^(\d+[\.\、\)]|[-*]\s+\[)/)) {
        objective = plain;
        break;
      }
    }

    let id = 1;
    for (const line of lines) {
      const todoMatch = line.match(/^[-*]\s+\[([ xX✓✔])\]\s+(.+)$/);
      const numMatch = !todoMatch ? line.match(/^(\d+)[\.\、\)]\s+(.+)$/) : null;

      if (todoMatch) {
        const done = todoMatch[1].trim().length > 0;
        const title = this.cleanStepTitle(todoMatch[2]);
        if (title) {
          steps.push({ id: id++, title, status: done ? 'completed' : 'pending', percent: done ? 100 : 0, explicit: true });
        }
      } else if (numMatch) {
        const parsed = this.parseItemStatus(numMatch[2]);
        const title = this.cleanStepTitle(parsed.text);
        if (title) {
          steps.push({ id: id++, title, status: parsed.status, percent: parsed.percent, explicit: parsed.explicit });
        }
      }
    }

    return { steps: steps.slice(0, 8), objective };
  }

  parseItemStatus(raw) {
    const s = raw.replace(/^\*+|\*+$/g, '').trim();
    if (/^(\[已完成\]|【已完成】|✅|✓|✔|\[x\]|\[X\])\s*/.test(s)) {
      return { status: 'completed', percent: 100, explicit: true, text: s.replace(/^(\[已完成\]|【已完成】|✅|✓|✔|\[x\]|\[X\])\s*/, '') };
    }
    if (/^(\[进行中\]|【进行中】|🔄|⚙️)\s*/.test(s)) {
      return { status: 'running', percent: 50, explicit: true, text: s.replace(/^(\[进行中\]|【进行中】|🔄|⚙️)\s*/, '') };
    }
    if (/^(\[待进行\]|【待进行】|\[等待中\]|⏳|\[\s\])\s*/.test(s)) {
      return { status: 'pending', percent: 0, explicit: true, text: s.replace(/^(\[待进行\]|【待进行】|\[等待中\]|⏳|\[\s\])\s*/, '') };
    }
    return { status: 'pending', percent: 0, explicit: false, text: raw };
  }

  cleanStepTitle(raw) {
    const cleaned = String(raw || '')
      .replace(/\[([^\]]+)\]\(file:\/\/[^)]+\)/g, '$1')
      .replace(/[*`_]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 2 || cleaned.length > 96) return '';
    return cleaned;
  }

  defaultSnapshot(status = 'idle', headline = '待命') {
    return {
      status,
      progressPercent: 0,
      headline,
      objective: '实时监控当前窗口项目进度，防止执行卡死',
      isStalled: false,
      stalledDuration: 0,
      stalledReason: null,
      elapsedSeconds: 0,
      dataSource: 'hooks.json 监听就绪',
      turnStepIdx: -1,
      showInlineCard: false,
      steps: [
        { id: 1, title: '环境与监控探针就绪', status: 'completed', percent: 100 },
        { id: 2, title: '等待用户指令或计划生成', status: 'pending', percent: 0 }
      ],
      latestTask: null
    };
  }

  async reinvoke(conversationId) {
    if (!conversationId) return { ok: false, error: 'No conversation ID' };
    try {
      const id = conversationId.toLowerCase();
      const scratch = join(this.brainRoot, id, 'scratch');
      await mkdir(scratch, { recursive: true });
      const stateFile = join(scratch, 'lifecycle_state.json');
      const nowMs = Date.now();
      const state = {
        event: 'PreInvocation',
        timestamp: new Date(nowMs).toISOString(),
        timestampMs: nowMs,
        conversationId: id,
        reinvoked: true
      };
      await writeFile(stateFile, JSON.stringify(state), 'utf8');
      return { ok: true, reinvokedAt: state.timestamp };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}
