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
