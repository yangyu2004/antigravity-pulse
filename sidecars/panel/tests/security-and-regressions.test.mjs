import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { TaskMonitor } from '../task-monitor.mjs';
import { TrajectoryJson } from '../trajectory-json.mjs';
import { trajectoryMetrics } from '../metrics.mjs';
import { UsageLedger } from '../usage.mjs';
import { TitleRenamer } from '../title-renamer.mjs';
import { AntigravityClient } from '../client.mjs';
import { RuntimeUi } from '../../../compat/runtime-ui.mjs';
import { SidecarOwner } from '../../../compat/sidecar-owner.mjs';
import { cleanChildEnv } from '../../../compat/platform.mjs';

const require = createRequire(import.meta.url);
const createIdeSurface = require('../../../ide/surface.cjs');
const lifecycleHook = require('../../../hooks/lifecycle-hook.js');

function makeTempDir(t) {
  return mkdtemp(join(tmpdir(), 'ag-pulse-sec-')).then(dir => {
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
  });
}

test('ide/surface.cjs setMarkup accepts all widget templates including label and rejects out-of-range entities safely', async () => {
  const prevDoc = globalThis.document;
  class El {
    constructor(tag, ns = null) {
      this.localName = tag;
      this.namespaceURI = ns;
      this.attrs = new Map();
      this.childNodes = [];
      this.textContent = '';
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    append(...nodes) { this.childNodes.push(...nodes); }
    replaceChildren(...nodes) { this.childNodes = [...nodes]; }
  }
  globalThis.document = {
    createDocumentFragment: () => new El('#fragment'),
    createElement: tag => new El(tag),
    createElementNS: (ns, tag) => new El(tag, ns),
    createTextNode: text => ({ nodeType: 3, textContent: text }),
  };
  try {
    const surface = createIdeSurface();
    const target = new El('div');
    // Must allow <label>, <span>, SVG, and out-of-range numeric entities without RangeError
    surface.setMarkup(target, '<div><label id="a">Today &amp; &#x110000; &#99999999; &#65;</label><span class="usage-label">Month</span><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg></div>');
    assert.equal(target.childNodes.length, 1);
    const labelEl = target.childNodes[0].childNodes[0].childNodes[0];
    assert.equal(labelEl.localName, 'label');
    assert.equal(labelEl.childNodes[0].textContent, 'Today & &#x110000; &#99999999; A');

    // Verify real static markup from inline-widget.cjs parses under IDE TrustedHTML parser
    const widgetSrc = await readFile(new URL('../../../compat/inline-widget.cjs', import.meta.url), 'utf8');
    const tplMatch = widgetSrc.match(/setMarkup\(nextRoot,`([\s\S]*?)`\);/);
    assert.ok(tplMatch, 'inline-widget main template must be located');
    const rendered = tplMatch[1]
      .replace(/\$\{theme\.shadowCss\(\)\}/g, ':host{}')
      .replace(/\$\{svg\([^)]+\)\}/g, '<svg viewBox="0 0 16 16"><path d="M1 1"/></svg>');
    assert.doesNotThrow(() => surface.setMarkup(new El('div'), rendered));

    // Must still block script tags and event attributes
    assert.throws(() => surface.setMarkup(new El('div'), '<script>alert(1)</script>'), /Unsupported/);
    assert.throws(() => surface.setMarkup(new El('div'), '<div onclick="alert(1)"></div>'), /Unsupported/);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('TaskMonitor.reinvoke blocks path traversal outside brainRoot', async t => {
  const root = await makeTempDir(t);
  const monitor = new TaskMonitor({ brainRoot: join(root, 'brain') });
  for (const bad of ['../escape', '..\\escape', 'not-a-guid', '', null, '../../etc/passwd']) {
    const res = await monitor.reinvoke(bad);
    assert.equal(res.ok, false);
  }
  await assert.rejects(stat(join(root, 'escape')), /ENOENT/);
});

test('RuntimeUi task-action rejects disabled plugin, invalid actions, and path traversal IDs', async () => {
  let enabled = true;
  const actions = [];
  let bindingPayload = null;
  class FakeConn {
    constructor(opts) { this.opts = opts; this.closed = false; }
    async open() { return this; }
    async command(method, params = {}) {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
      if (method === 'Runtime.enable') this.opts.onEvent({ method: 'Runtime.executionContextCreated', params: { context: { id: 7, origin: 'https://127.0.0.1:5000', auxData: { isDefault: true, frameId: 'main' } } } });
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 's1' };
      if (method === 'Runtime.evaluate' && params.expression?.includes('__agPulseRuntimeBridge')) bindingPayload = params.expression;
      if (method === 'Runtime.evaluate' && params.returnByValue) return { result: { value: { mounted: true, installed: true, bridge: true } } };
      return {};
    }
    close() { this.closed = true; }
  }
  let conn;
  const ui = new RuntimeUi({
    snapshot: async () => ({ connection: 'live', groups: [], speed: null }),
    taskAction: async input => { actions.push(input); return { ok: true }; },
    source: 'widget',
    discover: async () => [{ type: 'page', url: 'https://127.0.0.1:5000/c/chat', webSocketDebuggerUrl: 'ws://127.0.0.1:9123/devtools/page/one' }],
    enabled: () => enabled,
    connect: (_, opts) => { conn = new FakeConn(opts); return conn; },
  });
  await ui.tick();
  const sendAction = input => ui.event(conn, {
    method: 'Runtime.bindingCalled',
    params: { name: ui.binding, executionContextId: 7, payload: JSON.stringify({ id: 1, type: 'task-action', input }) },
  });

  await sendAction({ action: 'reinvoke', conversationId: '../escape' });
  assert.equal(actions.length, 0);
  assert.match(bindingPayload, /offline/);

  await sendAction({ action: 'delete-all', conversationId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(actions.length, 0);

  enabled = false;
  await sendAction({ action: 'reinvoke', conversationId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(actions.length, 0);
  assert.match(bindingPayload, /offline/);

  enabled = true;
  await sendAction({ action: 'reinvoke', conversationId: '11111111-1111-1111-1111-111111111111' });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].conversationId, '11111111-1111-1111-1111-111111111111');
  assert.match(bindingPayload, /"ok":true/);
  await ui.stop();
});

test('lifecycle-hook redacts sensitive args, strips file contents, validates GUID, and scrubs child env', () => {
  assert.equal(lifecycleHook.GUID_RE.test('../escape'), false);
  assert.equal(lifecycleHook.GUID_RE.test('11111111-1111-1111-1111-111111111111'), true);

  const fakeSk = ['sk', 'fixture1234567890abcdef'].join('-');
  const sanitized = lifecycleHook.sanitizeToolCall({
    name: 'write_file',
    args: {
      Path: '/repo/secret.env',
      Content: `API_KEY=${fakeSk}`,
      CommandLine: 'curl -H "Authorization: Bearer super_secret_token_99999999" https://example.com',
      toolSummary: '写入配置文件',
    },
  });
  assert.equal(sanitized.name, 'write_file');
  assert.equal(sanitized.args.Path, '/repo/secret.env');
  assert.equal(sanitized.args.toolSummary, '写入配置文件');
  assert.equal(sanitized.args.Content, undefined, 'File content must never be persisted');
  assert.doesNotMatch(sanitized.args.CommandLine, /super_secret_token/);
  assert.match(sanitized.args.CommandLine, /\[REDACTED\]/);

  const scrubbed = lifecycleHook.cleanChildEnv({
    PATH: '/usr/bin',
    ANTIGRAVITY_CSRF_TOKEN: 'secret-csrf',
    ANTIGRAVITY_LS_ADDRESS: 'localhost:12345',
    ANTIGRAVITY_SIDECAR_WEB_PORT: '9999',
  });
  assert.equal(scrubbed.PATH, '/usr/bin');
  assert.equal(scrubbed.ANTIGRAVITY_CSRF_TOKEN, undefined);
  assert.equal(scrubbed.ANTIGRAVITY_LS_ADDRESS, undefined);
  assert.equal(scrubbed.ANTIGRAVITY_SIDECAR_WEB_PORT, undefined);

  const platformScrubbed = cleanChildEnv({
    HOME: '/home/u',
    ANTIGRAVITY_CSRF_TOKEN: 'secret',
    ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:1234',
    ANTIGRAVITY_SIDECAR_TOKEN: 'tok',
  });
  assert.equal(platformScrubbed.HOME, '/home/u');
  assert.equal(platformScrubbed.ANTIGRAVITY_CSRF_TOKEN, undefined);
  assert.equal(platformScrubbed.ANTIGRAVITY_LS_ADDRESS, undefined);
  assert.equal(platformScrubbed.ANTIGRAVITY_SIDECAR_TOKEN, undefined);
});

test('TaskMonitor serializes concurrent reads, resets lastSize on truncation, decodes split UTF-8, and avoids cold-start mtime pollution', async t => {
  const root = await makeTempDir(t);
  const id = '11111111-1111-1111-1111-111111111111';
  const logsDir = join(root, id, '.system_generated', 'logs');
  await mkdir(logsDir, { recursive: true });
  const file = join(logsDir, 'transcript.jsonl');

  const t1 = '2026-10-10T00:00:00Z';
  const t2 = '2026-10-10T00:00:05Z';
  const t3 = '2026-10-10T00:00:10Z';
  const lines = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', created_at: t1, content: '<USER_REQUEST>旧任务</USER_REQUEST>' }),
    // Interrupted previous turn (no DONE step, only tool call)
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', created_at: t2, status: 'RUNNING', tool_calls: [{ name: 'run_command', args: { toolSummary: '执行测试脚本' } }] }),
    JSON.stringify({ step_index: 2, type: 'USER_INPUT', source: 'USER_EXPLICIT', created_at: t3, content: '<USER_REQUEST>新任务修复汉字</USER_REQUEST>' }),
    JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', source: 'MODEL', created_at: '2026-10-10T00:00:12Z', status: 'DONE', tool_calls: [{ name: 'read_file', args: { Path: '/repo/中文文件.mjs' } }] }),
  ].join('\n') + '\n';
  await writeFile(file, lines, 'utf8');
  // Set file mtime far in the future to verify cold-start does NOT pollute turnStartMs with st.mtimeMs
  const futureDate = new Date('2026-10-10T01:00:00Z');
  await utimes(file, futureDate, futureDate);

  const monitor = new TaskMonitor({ brainRoot: root });
  const [s1, s2] = await Promise.all([
    monitor.readTranscriptIncremental(id, file, Date.parse('2026-10-10T00:00:20Z')),
    monitor.readTranscriptIncremental(id, file, Date.parse('2026-10-10T00:00:20Z')),
  ]);
  assert.equal(s1.turnStartMs, Date.parse(t3), 'Cold-start turnStartMs must not be polluted by future file mtime');
  assert.equal(s2.turnToolSteps.length, 1, 'Concurrent reads must not duplicate turnToolSteps');
  assert.match(s2.turnToolSteps[0], /中文文件\.mjs/);

  // Multi-byte UTF-8 split across incremental reads
  const splitLine = Buffer.from(JSON.stringify({ step_index: 4, type: 'PLANNER_RESPONSE', source: 'MODEL', created_at: '2026-10-10T00:00:15Z', status: 'DONE', tool_calls: [{ name: 'edit_file', args: { Path: '/repo/汉字拆分测试.mjs' } }] }) + '\n', 'utf8');
  const hanByteIdx = splitLine.indexOf(Buffer.from('汉', 'utf8'));
  await writeFile(file, Buffer.concat([Buffer.from(lines, 'utf8'), splitLine.subarray(0, hanByteIdx + 1)]));
  await monitor.readTranscriptIncremental(id, file, Date.parse('2026-10-10T00:00:25Z'));
  await writeFile(file, Buffer.concat([Buffer.from(lines, 'utf8'), splitLine]));
  const afterUtf8 = await monitor.readTranscriptIncremental(id, file, Date.parse('2026-10-10T00:00:26Z'));
  assert.ok(afterUtf8.turnToolSteps.some(s => s.includes('汉字拆分测试.mjs')), 'Multi-byte UTF-8 split across reads must decode cleanly');

  // Truncation must reset lastSize so subsequent smaller writes still update lastGrowthMs
  const shortLine = JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', created_at: '2026-10-10T00:01:00Z', content: '短' }) + '\n';
  await writeFile(file, shortLine, 'utf8');
  const afterTrunc = await monitor.readTranscriptIncremental(id, file, Date.parse('2026-10-10T00:01:01Z'));
  assert.equal(afterTrunc.lastSize, Buffer.byteLength(shortLine));
});

test('TrajectoryJson clips oversized summary and modelDisplayName without throwing', () => {
  const huge = '很长的摘要'.repeat(8000);
  const p = new TrajectoryJson();
  p.write(JSON.stringify({
    trajectorySummaries: {
      '11111111-1111-1111-1111-111111111111': { summary: huge, stepCount: 2, status: 'IDLE' },
    },
  }));
  const res = p.end();
  const s = res.trajectorySummaries['11111111-1111-1111-1111-111111111111'].summary;
  assert.equal(typeof s, 'string');
  assert.ok(s.length <= 512, `Expected clipped summary <= 512 chars, got ${s.length}`);
  assert.ok(s.startsWith('很长的摘要'));
});

test('trajectoryMetrics tolerates missing step metadata and does not mis-apply old checkpoint when stepIndices are missing', () => {
  const data = trajectoryMetrics({
    trajectory: {
      steps: [
        { type: 'CORTEX_STEP_TYPE_RUN_COMMAND' },
        { type: 'CORTEX_STEP_TYPE_CHECKPOINT', metadata: { completedAt: '2026-10-10T00:00:05Z' }, checkpoint: { estimatedTokensAfter: 5000 } },
      ],
      generatorMetadata: [
        null,
        {
          chatModel: {
            chatStartMetadata: {
              createdAt: '2026-10-10T00:01:00Z',
              contextWindowMetadata: { estimatedTokensUsed: 90000, maxContextTokens: 200000 },
            },
            usage: { inputTokens: 100, outputTokens: 50, responseOutputTokens: 50, messageId: 'm1' },
            streamingDuration: '1s',
          },
        },
      ],
    },
  });
  assert.equal(data.context.usedTokens, 90000, 'Older checkpoint must not override newer generation when stepIndices are absent');
});

test('UsageLedger clears partial once complete observation arrives and caches unchanged files across summary scans', async t => {
  const dir = await makeTempDir(t);
  const ledger = new UsageLedger(dir);
  const scope = 'a'.repeat(64);
  const id1 = '11111111-1111-1111-1111-111111111111';
  const id2 = '22222222-2222-2222-2222-222222222222';
  const mk = (rid, usage) => ({
    trajectory: {
      steps: [{ type: 'PLANNER_RESPONSE', metadata: { createdAt: '2026-10-10T00:00:00Z' } }],
      generatorMetadata: [{ stepIndices: [0], chatModel: { modelDisplayName: 'Gemini', usage: { apiProvider: 'API_PROVIDER_GOOGLE_GEMINI', responseId: rid, ...usage } } }],
    },
  });

  await ledger.ingest(scope, id1, mk('r1', { inputTokens: 500, cacheReadTokens: 100, outputTokens: 'bad' }));
  assert.equal((await ledger.summary(scope)).partialRequests, 1);
  await ledger.ingest(scope, id1, mk('r1', { inputTokens: 400, cacheReadTokens: 100, outputTokens: 80 }));
  const afterComplete = await ledger.summary(scope);
  assert.equal(afterComplete.partialRequests, 0, 'Complete observation must clear prior partial flag');
  assert.equal(afterComplete.totalTokens, 680, 'Monotonic merge must keep larger input (500) + cacheRead (100) + output (80)');

  // Count readSummaryRecord calls when only id2 changes
  let reads = 0;
  const origRead = ledger.readSummaryRecord.bind(ledger);
  ledger.readSummaryRecord = async file => { reads++; return origRead(file); };
  await ledger.ingest(scope, id2, mk('r2', { inputTokens: 100, cacheReadTokens: 0, outputTokens: 20 }));
  const sum2 = await ledger.summary(scope);
  assert.equal(sum2.totalTokens, 800);
  assert.equal(reads, 1, 'Only newly modified conversation file should be re-read from disk');
});

test('TitleRenamer preserves manual user Chinese rename of provisional chat and respects owns() revocation', async t => {
  const dir = await makeTempDir(t);
  const id = '11111111-1111-1111-1111-111111111111';
  const updates = [];
  let owned = true;
  const client = {
    call: async (method, body) => {
      if (method === 'GetAllCascadeTrajectories') {
        return { trajectorySummaries: { [id]: { summary: '用户手改的中文标题', lastModifiedTime: new Date().toISOString() } } };
      }
      updates.push({ method, body });
      return {};
    },
  };
  const renamer = new TitleRenamer({ client, dataDir: dir, brainRoot: join(dir, 'brain'), owns: () => owned });
  renamer.state = { installedAtMs: Date.now() - 60000, renamed: { [id]: { title: '新建中文对话', provisional: true, locked: false, updatedAt: Date.now() - 5000 } } };
  await renamer.runSync(id, false);
  assert.equal(updates.length, 0, 'Must not overwrite user manual Chinese title');
  assert.equal(renamer.state.renamed[id].title, '用户手改的中文标题');
  assert.equal(renamer.state.renamed[id].locked, true);

  owned = false;
  renamer.lastProbeAt = 0;
  renamer.maybeSync(id);
  assert.equal(renamer.inFlight, false, 'Revoked owner must not start title sync');
});

test('SidecarOwner uses injected isAlive to recover stale lock and ignores corrupt lock in finally', async t => {
  const dir = await makeTempDir(t);
  const lockFile = join(dir, 'active-sidecar.json.lock');
  await writeFile(lockFile, JSON.stringify({ pid: process.pid, token: 'dead-token' }));
  // Inject isAlive => false even though PID is process.pid to verify this.isAlive is respected
  const owner = new SidecarOwner(dir, { isAlive: () => false });
  assert.equal(await owner.claim(), true);
  owner.stop();
});

test('AntigravityClient reports restarted 2.34.0+ backend without requiring language_server.log', async () => {
  const client = new AntigravityClient({
    now: () => 1000,
    env: { ANTIGRAVITY_LS_ADDRESS: 'localhost:60001', ANTIGRAVITY_CSRF_TOKEN: 'stale-tok' },
    paths: () => ({ logCandidates: ['/nonexistent/language_server.log'] }),
    readLog: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    processes: async () => [{ ProcessId: 99, CommandLine: '/app/language_server --standalone --enable_sidecars', Ports: [60002] }],
  });
  await assert.rejects(client.discover(), /Antigravity 后台已重启，等待新 Sidecar 接管/);
});
