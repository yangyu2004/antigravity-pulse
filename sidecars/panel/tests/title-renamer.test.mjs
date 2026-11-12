import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TitleRenamer } from '../title-renamer.mjs';

const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RAW = '你看看 MacMini 上的claude号池啥情况：❯ ⚫ 号池出口隧道断开：经 socks5h://127.0.0.1:10808 访问 https://api.anthropic.com/ 失败（curl rc=7 http=000），号池请求会超时';

async function setup(t, { firstPrompt, summary, renamed = {} }) {
  const root = await mkdtemp(join(tmpdir(), 'ag-title-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const brainRoot = join(root, 'brain'), dataDir = join(root, 'data');
  const logs = join(brainRoot, ID, '.system_generated', 'logs');
  await mkdir(logs, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const now = Date.now();
  await writeFile(join(logs, 'transcript.jsonl'), JSON.stringify({
    step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: new Date(now).toISOString(),
    content: `<USER_REQUEST>\n${firstPrompt}\n</USER_REQUEST>`
  }) + '\n');
  await writeFile(join(dataDir, 'auto_renamed_titles.json'), JSON.stringify({ installedAtMs: now - 60000, renamed }));
  const calls = [];
  const client = {
    async call(method, body) {
      calls.push({ method, body });
      if (method === 'GetAllCascadeTrajectories') {
        return { trajectorySummaries: { [ID]: { summary, lastModifiedTime: new Date(now).toISOString() } } };
      }
      return {};
    }
  };
  return { renamer: new TitleRenamer({ client, dataDir, brainRoot }), calls };
}

const renames = calls => calls.filter(c => c.method === 'UpdateConversationAnnotations').map(c => c.body.annotations.title);

test('a host title that is the raw first prompt gets compacted to a short title', async t => {
  const { renamer, calls } = await setup(t, { firstPrompt: RAW, summary: RAW });
  await renamer.runSync(ID, true);
  const [title] = renames(calls);
  assert.ok(title, 'expected one rename');
  assert.ok(Array.from(title).length <= 18, `title too long: ${title}`);
  assert.doesNotMatch(title, /clau$/);
  assert.equal(renamer.state.renamed[ID].compacted, true);
});

test('a raw title locked by an older version is compacted once, then left alone', async t => {
  const { renamer, calls } = await setup(t, {
    firstPrompt: RAW, summary: RAW,
    renamed: { [ID]: { title: RAW, locked: true, updatedAt: 1 } }
  });
  await renamer.runSync(ID, true);
  assert.equal(renames(calls).length, 1);
  calls.length = 0;
  await renamer.runSync(ID, true);
  assert.equal(renames(calls).length, 0);
});

test('a short Chinese title set by the user is never touched', async t => {
  const { renamer, calls } = await setup(t, { firstPrompt: RAW, summary: '号池排查' });
  await renamer.runSync(ID, true);
  assert.deepEqual(renames(calls), []);
  assert.equal(renamer.state.renamed[ID].title, '号池排查');
});

test('a long title that does not match the first prompt is kept as the user wrote it', async t => {
  const custom = '这是我自己手动起的一个很长很长的会话标题用于测试不应该被改';
  const { renamer, calls } = await setup(t, { firstPrompt: RAW, summary: custom });
  await renamer.runSync(ID, true);
  assert.deepEqual(renames(calls), []);
});

test('summarizeToTitle never cuts an English word in half', () => {
  const r = new TitleRenamer({ client: null, dataDir: tmpdir() });
  assert.equal(r.summarizeToTitle(RAW), 'MacMini 上的claude号池');
  assert.equal(r.summarizeToTitle('本机磁盘剩余空间'), '本机磁盘剩余空间');
});
