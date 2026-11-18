import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskMonitor } from '../task-monitor.mjs';
import { MetricsStore } from '../store.mjs';
import { validatedInput } from '../../../compat/runtime-ui.mjs';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';
const GRANDCHILD = '44444444-4444-4444-8444-444444444444';

async function setupBrainConv(brainRoot, id, { transcriptLines = [], lifecycle = null, taskSteps = null, taskStepsMtimeMs = null, transcriptMtimeMs = null } = {}) {
  const convDir = join(brainRoot, id);
  const logsDir = join(convDir, '.system_generated', 'logs');
  const scratchDir = join(convDir, 'scratch');
  await mkdir(logsDir, { recursive: true });
  await mkdir(scratchDir, { recursive: true });

  const transcriptPath = join(logsDir, 'transcript.jsonl');
  if (transcriptLines.length) {
    await writeFile(transcriptPath, transcriptLines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
    if (transcriptMtimeMs != null) {
      const d = new Date(transcriptMtimeMs);
      await utimes(transcriptPath, d, d);
    }
  }
  if (lifecycle) {
    await writeFile(join(scratchDir, 'lifecycle_state.json'), JSON.stringify(lifecycle), 'utf8');
  }
  if (taskSteps) {
    const stepsPath = join(scratchDir, 'task_steps.json');
    await writeFile(stepsPath, JSON.stringify(taskSteps), 'utf8');
    if (taskStepsMtimeMs != null) {
      const d = new Date(taskStepsMtimeMs);
      await utimes(stepsPath, d, d);
    }
  }
}

test('Bug 1: parent waiting on 2 running subagents with no composer cancel button stays running and does not false-stall', async () => {
  const brainRoot = await mkdtemp(join(tmpdir(), 'pulse-tm-'));
  try {
    const now = Date.now();
    const tenMinAgo = now - 600_000;
    await setupBrainConv(brainRoot, ROOT_ID, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(tenMinAgo).toISOString(), content: '<USER_REQUEST>\n使用子代理全面审查项目\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(tenMinAgo + 5000).toISOString(), tool_calls: [{ name: 'swarm', args: { action: 'add', name: 'reviewer' } }] },
        { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(tenMinAgo + 10_000).toISOString(), content: '已派发两个子代理并行审查，等待回报。', tool_calls: [] },
      ],
      transcriptMtimeMs: tenMinAgo + 10_000,
      lifecycle: { event: 'Stop', timestampMs: tenMinAgo + 10_500, fullyIdle: true, conversationId: ROOT_ID },
      taskSteps: {
        objective: '使用子代理全面审查项目',
        steps: [
          { id: 1, title: '扫描仓库结构', status: 'completed' },
          { id: 2, title: '派发子代理执行审查', status: 'completed' },
          { id: 3, title: '并行完成各模块代码审查', status: 'running' },
          { id: 4, title: '汇总审查报告', status: 'pending' },
        ],
      },
      taskStepsMtimeMs: tenMinAgo + 5000,
    });

    // Active child subagent updated 3 seconds ago
    await setupBrainConv(brainRoot, CHILD_A, {
      transcriptLines: [
        { step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: new Date(tenMinAgo + 6000).toISOString(), content: '<SYSTEM_MESSAGE>\n审查网络层代码\n</SYSTEM_MESSAGE>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 3000).toISOString(), tool_calls: [{ name: 'read_file', args: { Path: '/repo/src/ApiClient.kt' } }] },
      ],
      transcriptMtimeMs: now - 3000,
    });

    const monitor = new TaskMonitor({ brainRoot });
    const snap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: false, // Main composer has NO cancel button while waiting for subagents!
      domRunningSubagents: 2,
      cascadeState: {
        selfStatus: 'CASCADE_RUN_STATUS_RUNNING',
        selfRunning: true,
        selfSettled: false,
        selfHasActiveChildren: true,
        selfModifiedMs: tenMinAgo + 10_000,
        totalSubagents: 2,
        runningSubagents: 2,
        runningSubagentIds: [CHILD_A, CHILD_B],
        latestSubagentModifiedMs: now - 3000,
        latestRunningSubagentModifiedMs: now - 3000,
      },
    });

    assert.equal(snap.status, 'running');
    assert.equal(snap.isStalled, false, 'Active subagent heartbeat must prevent false stall when parent waited 10m');
    assert.equal(snap.runningSubagents, 2);
    assert.ok(snap.progressPercent < 100, `Expected < 100% while subagents run, got ${snap.progressPercent}`);
    assert.match(snap.headline, /2 个子代理运行中/);
    assert.equal(snap.steps[2].status, 'running');
    assert.equal(snap.steps[3].status, 'pending');

    // Even DOM-only fallback (before LS summary refreshes) keeps status running
    const domOnlySnap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: false,
      domRunningSubagents: 2,
      cascadeState: null,
    });
    assert.equal(domOnlySnap.status, 'running');
    assert.ok(domOnlySnap.progressPercent < 100);
    assert.equal(domOnlySnap.steps[2].status, 'running');

    // Once all subagents settle and parent is IDLE, task completes cleanly at 100%
    const doneSnap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: false,
      domRunningSubagents: 0,
      cascadeState: {
        selfStatus: 'CASCADE_RUN_STATUS_IDLE',
        selfRunning: false,
        selfSettled: true,
        selfHasActiveChildren: false,
        selfModifiedMs: now,
        totalSubagents: 2,
        runningSubagents: 0,
        runningSubagentIds: [],
        latestSubagentModifiedMs: now - 1000,
        latestRunningSubagentModifiedMs: 0,
      },
    });
    assert.equal(doneSnap.status, 'completed');
    assert.equal(doneSnap.progressPercent, 100);
    assert.equal(doneSnap.headline, '✓ 当前任务已完成');
    assert.ok(doneSnap.steps.every(s => s.status === 'completed'));
  } finally {
    await rm(brainRoot, { recursive: true, force: true });
  }
});

test('Bug 2: clicking into a running conversation before cancel button mounts or starting Turn 2 never flashes all-completed', async () => {
  const brainRoot = await mkdtemp(join(tmpdir(), 'pulse-tm2-'));
  try {
    const now = Date.now();
    const t1Start = now - 30_000;
    const t1End = now - 15_000;

    // 1. Conversation is actively running, user switches to it and composer transiently sends hostGenerating: false
    await setupBrainConv(brainRoot, ROOT_ID, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(now - 8000).toISOString(), content: '<USER_REQUEST>\n重构数据库迁移模块\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 4000).toISOString(), tool_calls: [{ name: 'read_file', args: { Path: '/src/migrate.ts' } }] },
      ],
      transcriptMtimeMs: now - 4000,
      lifecycle: { event: 'PreToolUse', timestampMs: now - 1000, toolCall: { name: 'edit_file', args: { Path: '/src/migrate.ts' } }, conversationId: ROOT_ID },
      taskSteps: {
        objective: '重构数据库迁移模块',
        steps: [
          { id: 1, title: '读取现有迁移逻辑', status: 'completed' },
          { id: 2, title: '重写迁移事务执行器', status: 'running' },
          { id: 3, title: '运行回归测试', status: 'pending' },
        ],
      },
      taskStepsMtimeMs: now - 5000,
    });

    const monitor = new TaskMonitor({ brainRoot });
    const switchSnap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: false, // Transient false on route switch before stop button renders
      cascadeState: {
        selfStatus: 'CASCADE_RUN_STATUS_RUNNING',
        selfRunning: true,
        selfSettled: false,
        selfHasActiveChildren: false,
        selfModifiedMs: now - 1000,
        totalSubagents: 0,
        runningSubagents: 0,
        runningSubagentIds: [],
        latestSubagentModifiedMs: 0,
        latestRunningSubagentModifiedMs: 0,
      },
    });
    assert.equal(switchSnap.status, 'running');
    assert.ok(switchSnap.progressPercent < 100);
    assert.equal(switchSnap.steps[1].status, 'running');
    assert.equal(switchSnap.steps[2].status, 'pending');
    assert.ok(!switchSnap.steps.every(s => s.status === 'completed'), 'Must never flash all steps completed on switch');

    // 2. Turn 1 finished with all steps completed in task_steps.json; Turn 2 starts (PreInvocation fires before transcript flush)
    const conv2 = CHILD_B;
    await setupBrainConv(brainRoot, conv2, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(t1Start).toISOString(), content: '<USER_REQUEST>\n第一轮需求\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t1End).toISOString(), content: '第一轮已完成。', tool_calls: [] },
      ],
      transcriptMtimeMs: t1End,
      lifecycle: { event: 'PreInvocation', timestampMs: now - 200, invocationNum: 0, lastUserInput: '第二轮全新需求', conversationId: conv2 },
      taskSteps: {
        objective: '第一轮需求',
        steps: [
          { id: 1, title: '步骤一', status: 'completed' },
          { id: 2, title: '步骤二', status: 'completed' },
          { id: 3, title: '步骤三', status: 'completed' },
        ],
      },
      taskStepsMtimeMs: t1End - 500,
    });

    const turn2Snap = await monitor.snapshot(conv2, { hostGenerating: true });
    assert.equal(turn2Snap.status, 'running');
    assert.ok(turn2Snap.progressPercent < 100);
    assert.equal(turn2Snap.objective, '第二轮全新需求');
    assert.ok(!turn2Snap.steps.every(s => s.status === 'completed'), 'Turn 1 all-completed task_steps.json must not leak into Turn 2');
  } finally {
    await rm(brainRoot, { recursive: true, force: true });
  }
});

test('MetricsStore.cascadeRunState resolves nested subagent trees and validatedInput bounds domRunningSubagents', async () => {
  const baseIso = ms => new Date(ms).toISOString();
  const fakeClient = {
    now: () => 10_000,
    reader: {
      summaryAt: 9_800,
      summaries: {
        [ROOT_ID]: { status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: baseIso(1_000) },
        [CHILD_A]: { status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: baseIso(5_000), trajectoryMetadata: { parentConversationId: ROOT_ID, rootConversationId: ROOT_ID } },
        [GRANDCHILD]: { status: 'CASCADE_RUN_STATUS_RUNNING', lastModifiedTime: baseIso(9_000), trajectoryMetadata: { parentConversationId: CHILD_A, rootConversationId: ROOT_ID } },
      },
      summary: async () => null,
    },
  };
  const store = new MetricsStore(fakeClient);
  const state = await store.cascadeRunState(ROOT_ID);
  assert.equal(state.totalSubagents, 2);
  assert.equal(state.runningSubagents, 1);
  assert.deepEqual(state.runningSubagentIds, [GRANDCHILD]);
  assert.equal(state.selfSettled, false);
  store.dispose();

  assert.deepEqual(
    validatedInput({ conversationId: ROOT_ID, force: true, hostGenerating: false, domRunningSubagents: 3 }),
    { conversationId: ROOT_ID, force: true, hostGenerating: false, domRunningSubagents: 3 }
  );
  assert.deepEqual(
    validatedInput({ conversationId: ROOT_ID, domRunningSubagents: 0 }),
    { conversationId: ROOT_ID, force: false }
  );
  assert.deepEqual(
    validatedInput({ conversationId: ROOT_ID, domRunningSubagents: 999 }),
    { conversationId: ROOT_ID, force: false }
  );
});

test('swarm_wait on the board is not reported as stalled until the board-wait threshold', async () => {
  const brainRoot = await mkdtemp(join(tmpdir(), 'pulse-tm-'));
  try {
    const now = Date.now();
    const start = now - 400_000; // 远超 180s 思考阈值，但低于 30 分钟看板等待阈值
    const lines = (t0) => [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(t0).toISOString(), content: '<USER_REQUEST>\n派子代理修复问题\n</USER_REQUEST>' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t0 + 2000).toISOString(), tool_calls: [{ name: 'swarm_wait', args: { since: '43' } }] },
      { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: new Date(t0 + 3000).toISOString(), content: 'Waiting for any message posted after #43.' },
    ];
    await setupBrainConv(brainRoot, ROOT_ID, { transcriptLines: lines(start), transcriptMtimeMs: start + 3000 });
    const r = await new TaskMonitor({ brainRoot }).snapshot(ROOT_ID, { hostGenerating: true, cascadeState: null });
    assert.equal(r.isStalled, false);
    assert.equal(r.status, 'running');
    assert.match(r.headline, /等待子代理看板消息/);

    const old = now - 2_000_000; // 超过 30 分钟仍无回复才提示
    await setupBrainConv(brainRoot, CHILD_A, { transcriptLines: lines(old), transcriptMtimeMs: old + 3000 });
    const r2 = await new TaskMonitor({ brainRoot }).snapshot(CHILD_A, { hostGenerating: true, cascadeState: null });
    assert.equal(r2.isStalled, true);
    assert.match(r2.stalledReason, /看板消息/);

    // 子代理回消息后（SYSTEM_MESSAGE）等待标记清除，回到普通思考阈值
    const woke = [...lines(start), { step_index: 3, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: new Date(start + 5000).toISOString(), content: '<SYSTEM_MESSAGE>reviewer done</SYSTEM_MESSAGE>' }];
    await setupBrainConv(brainRoot, CHILD_B, { transcriptLines: woke, transcriptMtimeMs: start + 5000 });
    const r3 = await new TaskMonitor({ brainRoot }).snapshot(CHILD_B, { hostGenerating: true, cascadeState: null });
    assert.equal(r3.isStalled, true);
    assert.doesNotMatch(r3.stalledReason, /看板消息/);
  } finally {
    await rm(brainRoot, { recursive: true, force: true });
  }
});

test('task board steps are strictly read-only and driven solely by real-time AI execution', async () => {
  const monitor = new TaskMonitor();
  assert.equal(typeof monitor.toggleStep, 'undefined', 'Manual toggleStep must not exist');
  assert.equal(typeof monitor.setSteps, 'undefined', 'Manual setSteps must not exist');
  assert.equal('customSteps' in monitor, false, 'Manual customSteps override map must not exist');
});

test('completed conversation from days ago never shows elapsed silence as stalled on open or new turn start', async () => {
  const brainRoot = await mkdtemp(join(tmpdir(), 'pulse-tm-old-'));
  try {
    const now = Date.now();
    const threeDaysAgo = now - 247_226_000;

    // 1. 3 天前已完成对话（带总结列表），且宿主又附加了 [Notice] 系统消息、language server summaries 中无此旧会话记录
    await setupBrainConv(brainRoot, ROOT_ID, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(threeDaysAgo - 20_000).toISOString(), content: '<USER_REQUEST>\n检查待办事项\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(threeDaysAgo).toISOString(), content: '1. 已测通（第 13、12 项）\n2. 功能已过（第 9、10 项）\n3. 核心已过（第 6、11 项）', tool_calls: [] },
        { step_index: 2, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: new Date(now - 600_000).toISOString(), content: '[Notice] All your subagents and background tasks have been stopped due to server restart.' },
      ],
      transcriptMtimeMs: threeDaysAgo,
      lifecycle: { event: 'Stop', timestampMs: threeDaysAgo + 500, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', conversationId: ROOT_ID },
    });

    const monitor = new TaskMonitor({ brainRoot });
    // 打开旧会话（包含刚切入会话 hostGenerating=null 的 2.5s 防抖窗口、以及 hostGenerating=false）
    for (const hostGenerating of [null, false]) {
      const idleSnap = await monitor.snapshot(ROOT_ID, {
        hostGenerating,
        cascadeState: { selfStatus: null, selfRunning: false, selfSettled: false, selfHasActiveChildren: false, selfModifiedMs: 0, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
      });
      assert.equal(idleSnap.status, 'completed');
      assert.equal(idleSnap.isStalled, false);
      assert.equal(idleSnap.stalledDuration, 0);
      assert.ok(idleSnap.steps.every(s => s.status === 'completed'));
    }

    // 2. 用户在 3 天后的现在输入追问并点击发送（hostGenerating=true 在 PreInvocation 写入前先行到达）
    const startSnap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: true,
      cascadeState: { selfStatus: null, selfRunning: false, selfSettled: false, selfHasActiveChildren: false, selfModifiedMs: 0, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
    });
    assert.equal(startSnap.status, 'running');
    assert.equal(startSnap.isStalled, false, 'New turn must never inherit 247226s silence from previous finished turn');
    assert.equal(startSnap.stalledDuration, 0);
    assert.equal(startSnap.showInlineCard, false, 'Old turn summary steps must not mount into new turn Working bubble');
    assert.ok(startSnap.elapsedSeconds <= 2, `Expected fresh elapsedSeconds <= 2, got ${startSnap.elapsedSeconds}`);

    // 3. 遗留异常中断的旧会话（PreToolUse 停在 3 天前，无 Stop 钩子）在未生成时也不能误报 247226s 卡死
    await setupBrainConv(brainRoot, CHILD_A, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(threeDaysAgo - 10_000).toISOString(), content: '<USER_REQUEST>\n旧中断任务\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(threeDaysAgo).toISOString(), tool_calls: [{ name: 'run_command', args: { CommandLine: 'ls' } }] },
      ],
      transcriptMtimeMs: threeDaysAgo,
      lifecycle: { event: 'PreToolUse', timestampMs: threeDaysAgo, toolCall: { name: 'run_command' }, conversationId: CHILD_A },
    });
    const staleHookSnap = await monitor.snapshot(CHILD_A, {
      hostGenerating: false,
      cascadeState: { selfStatus: null, selfRunning: false, selfSettled: false, selfHasActiveChildren: false, selfModifiedMs: 0, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
    });
    assert.notEqual(staleHookSnap.status, 'stalled');
    assert.equal(staleHookSnap.isStalled, false);
  } finally {
    await rm(brainRoot, { recursive: true, force: true });
  }
});

test('running background task (1 task running) keeps board running below 100% until task finishes', async () => {
  const brainRoot = await mkdtemp(join(tmpdir(), 'pulse-tm-bgtask-'));
  try {
    const now = Date.now();
    const t0 = now - 240_000; // 4 分钟前启动的后台任务（预计跑 5~15 分钟）
    const taskId = `${ROOT_ID}/task-73`;
    const initialLines = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(t0 - 10_000).toISOString(), content: '<USER_REQUEST>\n启动全套检测\n</USER_REQUEST>' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t0 - 5000).toISOString(), tool_calls: [{ name: 'read_file', args: { Path: '/repo/claude_probe.py' } }] },
      { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t0 - 2000).toISOString(), tool_calls: [{ name: 'run_command', args: { toolSummary: '启动快速档位黑盒探针全量检测', CommandLine: 'python3 run.py' } }] },
      { step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'RUNNING', created_at: new Date(t0).toISOString(), content: `Created At: 2026-11-16T14:42:03+08:00\nTool is running as a background task with task id: ${taskId}\nTask Description: python3 run.py` },
      { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t0 + 15_000).toISOString(), content: '检测正在后台运行，完成后我会自动为你汇总结果。', tool_calls: [] },
    ];
    await setupBrainConv(brainRoot, ROOT_ID, {
      transcriptLines: initialLines,
      transcriptMtimeMs: t0 + 15_000,
      lifecycle: { event: 'Stop', timestampMs: t0 + 15_200, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', conversationId: ROOT_ID },
    });

    const monitor = new TaskMonitor({ brainRoot });
    // 1. 即使主回复已完成（tool_calls: [] 且 Stop），后台 task-73 仍在运行，绝不能显示全部完成或 4 分钟误报卡死
    const runningSnap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: false,
      domRunningTasks: 1,
      cascadeState: { selfStatus: 'CASCADE_RUN_STATUS_IDLE', selfRunning: false, selfSettled: true, selfHasActiveChildren: false, selfModifiedMs: t0 + 15_000, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
    });
    assert.equal(runningSnap.status, 'running');
    assert.equal(runningSnap.isStalled, false, '4-minute background task must not false-stall at 180s');
    assert.ok(runningSnap.progressPercent < 100, `Expected < 100% while background task runs, got ${runningSnap.progressPercent}`);
    assert.ok(runningSnap.steps.some(s => s.status === 'running'), 'Must keep an active running step');
    assert.ok(!runningSnap.steps.every(s => s.status === 'completed'), 'Must never mark all steps completed while task is running');
    assert.match(runningSnap.headline, /后台任务运行中/);

    // 2. 即使仅凭 DOM 的 "1 task running"（无 transcript 后台记录）也必须维持运行态
    await setupBrainConv(brainRoot, CHILD_A, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(t0).toISOString(), content: '<USER_REQUEST>\n运行检测\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t0 + 2000).toISOString(), tool_calls: [{ name: 'run_command', args: { toolSummary: '启动测试脚本', CommandLine: 'python3 test.py' } }] },
        { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(t0 + 4000).toISOString(), content: '已在后台运行。', tool_calls: [] },
      ],
      transcriptMtimeMs: t0 + 4000,
    });
    const domOnlySnap = await monitor.snapshot(CHILD_A, { hostGenerating: false, domRunningTasks: 1, cascadeState: null });
    assert.equal(domOnlySnap.status, 'running');
    assert.ok(domOnlySnap.progressPercent < 100);
    assert.ok(domOnlySnap.steps.some(s => s.status === 'running'));

    // 3. 后台任务完成后（SYSTEM_MESSAGE 到达 + 最终总结完毕 + domRunningTasks=0），干净切回 completed 100%
    await setupBrainConv(brainRoot, ROOT_ID, {
      transcriptLines: [
        ...initialLines,
        { step_index: 5, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: new Date(now - 2000).toISOString(), content: `<SYSTEM_MESSAGE>\n[Message] sender=${taskId} content=Task id "${taskId}" finished with result:\nDONE\n</SYSTEM_MESSAGE>` },
        { step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 1000).toISOString(), content: '全部检测已完成！', tool_calls: [] },
      ],
      transcriptMtimeMs: now - 1000,
      lifecycle: { event: 'Stop', timestampMs: now - 900, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', conversationId: ROOT_ID },
    });
    const doneSnap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: false,
      domRunningTasks: 0,
      cascadeState: { selfStatus: 'CASCADE_RUN_STATUS_IDLE', selfRunning: false, selfSettled: true, selfHasActiveChildren: false, selfModifiedMs: now - 1000, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
    });
    assert.equal(doneSnap.status, 'completed');
    assert.equal(doneSnap.progressPercent, 100);
    assert.ok(doneSnap.steps.every(s => s.status === 'completed'));

    assert.deepEqual(
      validatedInput({ conversationId: ROOT_ID, domRunningTasks: 2 }),
      { conversationId: ROOT_ID, force: false, domRunningTasks: 2 }
    );

    // 4. schedule 定时器在绑定任务结束后被静默取消 / manage_task(list) 返回 "No background tasks are currently running." 时，绝不能残留假运行态
    const timerTaskId = `${CHILD_B}/task-176`;
    const mainTaskId = `${CHILD_B}/task-174`;
    await setupBrainConv(brainRoot, CHILD_B, {
      transcriptLines: [
        { step_index: 173, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 60_000).toISOString(), tool_calls: [{ name: 'run_command', args: { CommandLine: 'echo ok' } }] },
        { step_index: 174, source: 'MODEL', type: 'GENERIC', status: 'RUNNING', created_at: new Date(now - 59_000).toISOString(), content: `Tool is running as a background task with task id: ${mainTaskId}\nTask Description: echo ok` },
        { step_index: 175, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 58_000).toISOString(), tool_calls: [{ name: 'schedule', args: { DurationSeconds: '50', TimerCondition: mainTaskId } }] },
        { step_index: 176, source: 'MODEL', type: 'GENERIC', status: 'RUNNING', created_at: new Date(now - 57_000).toISOString(), content: `Tool is running as a background task with task id: ${timerTaskId}\nTask Description: Timer: 50s, Prompt: check` },
        { step_index: 178, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: new Date(now - 40_000).toISOString(), content: `<SYSTEM_MESSAGE>\n[Message] sender=${mainTaskId} content=Task id "${mainTaskId}" finished with result:\nOK\n</SYSTEM_MESSAGE>` },
        { step_index: 185, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 5000).toISOString(), tool_calls: [{ name: 'manage_task', args: { Action: 'list' } }] },
        { step_index: 187, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: new Date(now - 4000).toISOString(), content: 'No background tasks are currently running.' },
        { step_index: 188, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(now - 2000).toISOString(), content: '已全部验证通过。', tool_calls: [] },
      ],
      transcriptMtimeMs: now - 2000,
      lifecycle: { event: 'Stop', timestampMs: now - 1500, fullyIdle: true, terminationReason: 'NO_TOOL_CALL', conversationId: CHILD_B },
      taskSteps: {
        objective: '配置代理并新增槽位',
        steps: [
          { id: 1, title: '配置代理', status: 'completed' },
          { id: 2, title: '验证槽位', status: 'completed' },
        ],
      },
      taskStepsMtimeMs: now - 5000,
    });
    const timerClearedSnap = await monitor.snapshot(CHILD_B, {
      hostGenerating: false,
      domRunningTasks: 0,
      cascadeState: { selfStatus: 'CASCADE_RUN_STATUS_IDLE', selfRunning: false, selfSettled: true, selfHasActiveChildren: false, selfModifiedMs: now - 2000, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
    });
    assert.equal(timerClearedSnap.status, 'completed');
    assert.equal(timerClearedSnap.progressPercent, 100);
    assert.ok(timerClearedSnap.steps.every(s => s.status === 'completed'));
  } finally {
    await rm(brainRoot, { recursive: true, force: true });
  }
});

test('queued USER_INPUT with earlier timestamp clamps turnStartMs to prevTurnEndMs and ignores old task_steps', async () => {
  const brainRoot = await mkdtemp(join(tmpdir(), 'pulse-tm-queued-'));
  try {
    const now = Date.now();
    const prevStart = now - 35_000;
    const queuedAt = prevStart + 1_000; // 用户在上一轮刚开始 1s 时就排队发了下一条
    const prevEnd = now - 3_000;        // 上一轮在 3s 前才完成
    await setupBrainConv(brainRoot, ROOT_ID, {
      transcriptLines: [
        { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(prevStart).toISOString(), content: '<USER_REQUEST>\n检查导出压缩包\n</USER_REQUEST>' },
        { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(prevStart + 2_000).toISOString(), tool_calls: [{ name: 'write_file', args: { Path: '/tmp/task_steps.json' } }] },
        { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: new Date(prevEnd).toISOString(), content: '检查完成。', tool_calls: [] },
        { step_index: 3, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: new Date(queuedAt).toISOString(), content: '<USER_REQUEST>\n导出已完成，开始抽取\n</USER_REQUEST>' },
      ],
      transcriptMtimeMs: now - 1_000,
      taskSteps: {
        objective: '旧轮次步骤',
        steps: [
          { id: 1, title: '探测微信导出', status: 'running' },
          { id: 2, title: '生成词库', status: 'pending' },
        ],
      },
      // task_steps.json 是在上一轮中期写入的，比 queuedAt 晚，但早于 prevEnd
      taskStepsMtimeMs: prevStart + 5_000,
    });

    const monitor = new TaskMonitor({ brainRoot });
    const snap = await monitor.snapshot(ROOT_ID, {
      hostGenerating: true,
      cascadeState: { selfStatus: 'CASCADE_RUN_STATUS_RUNNING', selfRunning: true, selfSettled: false, selfHasActiveChildren: false, selfModifiedMs: now - 1_000, totalSubagents: 0, runningSubagents: 0, runningSubagentIds: [] },
    });
    assert.equal(snap.status, 'running');
    assert.equal(snap.turnStepIdx, 3);
    assert.equal(snap.showInlineCard, false, 'Old turn task_steps.json must not leak into queued new turn');
    assert.ok(snap.elapsedSeconds <= 6, `Expected elapsedSeconds clamped near prevEnd (<=6s), got ${snap.elapsedSeconds}`);
  } finally {
    await rm(brainRoot, { recursive: true, force: true });
  }
});
