#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const eventName = process.argv[2] || 'Unknown';
const AUTO_UPDATE_INTERVAL_MS = 30 * 60 * 1000;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STDIN_BYTES = 512 * 1024;
const IDLE_STDIN_TIMEOUT_MS = 250;
const MAX_STDIN_TIMEOUT_MS = 1500;
const SENSITIVE_VALUE_RE = /\b((?:Bearer|Basic)\s+[^\s'"]+|sk-[A-Za-z0-9_-]{8,}|gh[pous]_[A-Za-z0-9_]{16,}|AIza[0-9A-Za-z_-]{20,}|(?:api[_-]?key|token|secret|password|passwd|authorization|cookie)\s*[=:]\s*(?:(?:Bearer|Basic|Token)\s+)?[^\s'";&]+)/gi;

function cleanChildEnv(env = process.env) {
  const cleaned = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^ANTIGRAVITY_(?:CSRF_TOKEN|LS_ADDRESS|SIDECAR_)/i.test(k)) continue;
    cleaned[k] = v;
  }
  return cleaned;
}

function resolveStampFile() {
  const dataRoot = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
    ? process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
    : path.join(os.homedir(), '.gemini', 'antigravity', 'sidecar_data', 'antigravity-pulse', 'panel', 'data');
  return path.join(dataRoot, 'updates', 'auto-check-stamp.json');
}

function maybeSpawnBackgroundAutoUpdate() {
  try {
    const stampFile = resolveStampFile();
    try {
      const st = fs.statSync(stampFile);
      if (Date.now() - st.mtimeMs < AUTO_UPDATE_INTERVAL_MS) return;
    } catch {}
    const updaterScript = path.join(__dirname, '..', 'compat', 'auto-updater.py');
    if (!fs.existsSync(updaterScript)) return;
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pyBin, [updaterScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: cleanChildEnv(),
    });
    child.on('error', () => {});
    if (typeof child.unref === 'function') child.unref();
  } catch {}
}

function sanitizeShortText(value, maxLen = 160) {
  if (typeof value !== 'string') return undefined;
  const firstLine = value.replace(/\r?\n[\s\S]*/, '').trim();
  if (!firstLine) return undefined;
  return firstLine.replace(SENSITIVE_VALUE_RE, '[REDACTED]').slice(0, maxLen);
}

function sanitizeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) return null;
  const name = typeof toolCall.name === 'string' ? toolCall.name.slice(0, 80) : null;
  if (!name) return null;
  const rawArgs = toolCall.args || toolCall.arguments || toolCall.parameters;
  const safeArgs = {};
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    const allowStrings = ['toolSummary', 'Path', 'path', 'Role', 'TypeName', 'Name', 'action', 'query', 'CronExpression', 'TimerCondition', 'TaskId', 'Action'];
    for (const key of allowStrings) {
      const cleaned = sanitizeShortText(rawArgs[key], 160);
      if (cleaned !== undefined) safeArgs[key] = cleaned;
    }
    if (typeof rawArgs.CommandLine === 'string') {
      const cmd = sanitizeShortText(rawArgs.CommandLine, 120);
      if (cmd !== undefined) safeArgs.CommandLine = cmd;
    }
    if (typeof rawArgs.DurationSeconds === 'number' && Number.isFinite(rawArgs.DurationSeconds)) {
      safeArgs.DurationSeconds = rawArgs.DurationSeconds;
    }
  }
  return Object.keys(safeArgs).length ? { name, args: safeArgs } : { name };
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let byteCount = 0;
    let truncated = false;
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(val);
    };
    const finish = () => {
      if (truncated || !data) {
        done({});
        return;
      }
      try {
        done(JSON.parse(data));
      } catch {
        done({});
      }
    };
    let idleTimer = setTimeout(finish, IDLE_STDIN_TIMEOUT_MS);
    const maxTimer = setTimeout(finish, MAX_STDIN_TIMEOUT_MS);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
    if (typeof maxTimer.unref === 'function') maxTimer.unref();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, IDLE_STDIN_TIMEOUT_MS);
      if (typeof idleTimer.unref === 'function') idleTimer.unref();
      byteCount += Buffer.byteLength(chunk, 'utf8');
      if (byteCount > MAX_STDIN_BYTES) {
        truncated = true;
        return;
      }
      data += chunk;
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', () => done({}));
  });
}

async function main() {
  const payload = await readStdin();
  const rawConversationId = payload && typeof payload === 'object' ? payload.conversationId : null;
  const conversationId = typeof rawConversationId === 'string' && GUID_RE.test(rawConversationId)
    ? rawConversationId.toLowerCase()
    : null;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (conversationId) {
    let tmpFile = null;
    try {
      const brainRoot = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
      const scratchDir = path.join(brainRoot, conversationId, 'scratch');
      fs.mkdirSync(scratchDir, { recursive: true });

      const stateFile = path.join(scratchDir, 'lifecycle_state.json');
      tmpFile = `${stateFile}.tmp.${process.pid}.${nowMs}`;
      const state = {
        event: eventName,
        timestamp: nowIso,
        timestampMs: nowMs,
        conversationId,
        stepIdx: typeof payload.stepIdx === 'number' ? payload.stepIdx : null,
        invocationNum: typeof payload.invocationNum === 'number' ? payload.invocationNum : null,
        fullyIdle: typeof payload.fullyIdle === 'boolean' ? payload.fullyIdle : null,
        toolCall: sanitizeToolCall(payload.toolCall),
        error: sanitizeShortText(typeof payload.error === 'string' ? payload.error : payload.error?.message, 240) || null,
        terminationReason: sanitizeShortText(payload.terminationReason, 120) || null,
        transcriptPath: typeof payload.transcriptPath === 'string' ? payload.transcriptPath.slice(0, 512) : null,
        lastUserInput: sanitizeShortText(payload.lastUserInput, 200) || null,
      };

      fs.writeFileSync(tmpFile, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpFile, stateFile);
      tmpFile = null;
    } catch {
      if (tmpFile) {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    }
  }

  if (eventName === 'Stop' && payload && payload.fullyIdle !== false) {
    maybeSpawnBackgroundAutoUpdate();
  }

  if (eventName === 'PreToolUse' || eventName === 'Stop') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } else {
    process.stdout.write(JSON.stringify({}));
  }
}

if (require.main === module) {
  main().catch(() => {
    if (eventName === 'PreToolUse' || eventName === 'Stop') {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
    } else {
      process.stdout.write(JSON.stringify({}));
    }
  });
}

module.exports = { GUID_RE, sanitizeToolCall, sanitizeShortText, cleanChildEnv };
