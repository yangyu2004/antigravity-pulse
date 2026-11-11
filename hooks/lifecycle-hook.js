#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const eventName = process.argv[2] || 'Unknown';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(val);
    };
    const timer = setTimeout(() => {
      try {
        done(data ? JSON.parse(data) : {});
      } catch {
        done({});
      }
    }, 150);
    if (typeof timer.unref === 'function') timer.unref();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        done(data ? JSON.parse(data) : {});
      } catch {
        done({});
      }
    });
    process.stdin.on('error', () => done({}));
  });
}

async function main() {
  const payload = await readStdin();
  const conversationId = payload.conversationId;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (conversationId) {
    try {
      const brainRoot = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
      const scratchDir = path.join(brainRoot, String(conversationId).toLowerCase(), 'scratch');
      fs.mkdirSync(scratchDir, { recursive: true });

      const stateFile = path.join(scratchDir, 'lifecycle_state.json');
      const tmpFile = `${stateFile}.tmp.${process.pid}`;
      const state = {
        event: eventName,
        timestamp: nowIso,
        timestampMs: nowMs,
        conversationId: String(conversationId).toLowerCase(),
        stepIdx: typeof payload.stepIdx === 'number' ? payload.stepIdx : null,
        invocationNum: typeof payload.invocationNum === 'number' ? payload.invocationNum : null,
        fullyIdle: typeof payload.fullyIdle === 'boolean' ? payload.fullyIdle : null,
        toolCall: payload.toolCall || null,
        error: payload.error || null,
        terminationReason: payload.terminationReason || null,
        transcriptPath: payload.transcriptPath || null,
        lastUserInput: typeof payload.lastUserInput === 'string' ? payload.lastUserInput.slice(0, 200) : null
      };

      fs.writeFileSync(tmpFile, JSON.stringify(state), 'utf8');
      fs.renameSync(tmpFile, stateFile);
    } catch {}
  }

  if (eventName === 'PreToolUse' || eventName === 'Stop') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } else {
    process.stdout.write(JSON.stringify({}));
  }
}

main().catch(() => {
  if (eventName === 'PreToolUse' || eventName === 'Stop') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } else {
    process.stdout.write(JSON.stringify({}));
  }
});
