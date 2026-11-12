#!/usr/bin/env python3
"""Silent background auto-updater for Antigravity Pulse.

Checks GitHub Releases on a throttled schedule (default every 30 minutes),
downloads and verifies SHA-256 via update-worker.py, atomically upgrades the
installed plugin, and triggers a clean sidecar reload when idle.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
DEFAULT_INTERVAL_SEC = 1800  # 30 minutes


def load_paths(home=None):
    spec = importlib.util.spec_from_file_location('pulse_paths', HERE / 'platform_paths.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.platform_paths(home=home)


def read_json(path: Path, default=None):
    try:
        if not path.is_file():
            return {} if default is None else default
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except Exception:
        return {} if default is None else default


def write_json_atomic(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp')
    try:
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def is_ai_turn_active(home: Path) -> bool:
    """Avoid restarting sidecar while an AI turn updated lifecycle_state within 12s."""
    brain = home / '.gemini' / 'antigravity' / 'brain'
    if not brain.is_dir():
        return False
    now = time.time()
    try:
        for conv in brain.iterdir():
            lf = conv / 'scratch' / 'lifecycle_state.json'
            if not lf.is_file():
                continue
            if now - lf.stat().st_mtime > 12:
                continue
            data = read_json(lf, {})
            ev = data.get('event')
            if ev in ('PreInvocation', 'PreToolUse', 'PostToolUse', 'PostInvocation'):
                return True
            if ev == 'Stop' and data.get('fullyIdle') is False:
                return True
    except OSError:
        pass
    return False


def reload_idle_sidecar(home: Path):
    """Gracefully stop idle Antigravity Pulse sidecar so host respawns new version."""
    if is_ai_turn_active(home):
        return False
    if os.name == 'nt':
        return False  # Sidecar's own AppUpdater handles Windows reload safely
    try:
        proc = subprocess.run(
            ['pgrep', '-u', str(os.getuid()), '-f', 'antigravity-pulse/sidecars/panel/main.mjs'],
            capture_output=True, text=True, timeout=5
        )
        if proc.returncode != 0:
            return False
        reloaded = False
        for line in proc.stdout.splitlines():
            pid_str = line.strip()
            if pid_str.isdigit():
                pid = int(pid_str)
                if pid != os.getpid():
                    try:
                        os.kill(pid, signal.SIGTERM)
                        reloaded = True
                    except OSError:
                        pass
        return reloaded
    except Exception:
        return False


def run_worker(worker_path: Path, worker_args: list[str], cwd: Path, timeout: int = 90) -> dict:
    kwargs = {
        'capture_output': True,
        'text': True,
        'cwd': str(cwd),
        'timeout': timeout,
    }
    if os.name == 'nt':
        kwargs['creationflags'] = getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
    proc = subprocess.run([sys.executable, str(worker_path), *worker_args], **kwargs)
    raw = (proc.stdout or '').strip()
    parsed = json.loads(raw) if raw else {'ok': False, 'code': 'install'}
    if proc.returncode != 0 or parsed.get('ok') is not True:
        raise RuntimeError(parsed.get('code') or 'install')
    return parsed.get('result') or {}


def run_auto_update(home: Path | None = None, target: Path | None = None,
                    force: bool = False, interval_sec: int = DEFAULT_INTERVAL_SEC,
                    worker_runner=run_worker) -> dict:
    paths = load_paths(home=home)
    home_dir: Path = paths['home']
    plugin_dir = Path(target) if target else (home_dir / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse')
    settings = read_json(paths['settings'], {})
    plugin_cfg = read_json(home_dir / '.gemini' / 'config' / 'config.json', {})
    plugin_enabled = plugin_cfg.get('plugins', {}).get('antigravity-pulse', {}).get('enabled', True)

    if not force:
        if settings.get('enabled') is False or plugin_enabled is False:
            return {'status': 'disabled'}
        if settings.get('autoUpdate') is False:
            return {'status': 'auto-update-disabled'}

    if not (plugin_dir / 'plugin.json').is_file():
        return {'status': 'not-installed'}

    updates_dir = home_dir / '.gemini' / 'antigravity' / 'sidecar_data' / 'antigravity-pulse' / 'panel' / 'data' / 'updates'
    stamp_file = updates_dir / 'auto-check-stamp.json'
    now = time.time()

    if not force:
        stamp = read_json(stamp_file, {})
        last_checked = stamp.get('lastCheckedAt', 0)
        if isinstance(last_checked, (int, float)) and 0 < (now - last_checked) < interval_sec:
            return {'status': 'throttled', 'lastCheckedAt': last_checked}

    # Pre-write timestamp so concurrent hook invocations do not stampede GitHub
    write_json_atomic(stamp_file, {'lastCheckedAt': now, 'status': 'checking'})

    worker_path = plugin_dir / 'compat' / 'update-worker.py'
    if not worker_path.is_file():
        worker_path = HERE / 'update-worker.py'

    try:
        plan = worker_runner(worker_path, ['check', '--target', str(plugin_dir)], plugin_dir.parent, 75)
    except Exception as error:
        write_json_atomic(stamp_file, {'lastCheckedAt': now, 'status': 'check-error', 'error': str(error)})
        return {'status': 'error', 'phase': 'check', 'error': str(error)}

    if not plan.get('hasUpdate'):
        write_json_atomic(stamp_file, {
            'lastCheckedAt': now,
            'status': 'current',
            'currentVersion': plan.get('currentVersion'),
            'latestVersion': plan.get('latestVersion'),
        })
        return {'status': 'current', 'version': plan.get('currentVersion')}

    updates_dir.mkdir(parents=True, exist_ok=True)
    plan_file = updates_dir / f'plan-auto-{uuid.uuid4().hex}.json'
    try:
        write_json_atomic(plan_file, plan)
        applied = worker_runner(
            worker_path,
            ['apply', '--target', str(plugin_dir), '--plan', str(plan_file), '--updates', str(updates_dir)],
            plugin_dir.parent,
            180,
        )
        reloaded = reload_idle_sidecar(home_dir)
        write_json_atomic(stamp_file, {
            'lastCheckedAt': time.time(),
            'status': 'updated',
            'fromVersion': plan.get('currentVersion'),
            'version': applied.get('version'),
            'reloaded': reloaded,
        })
        return {'status': 'updated', 'version': applied.get('version'), 'reloaded': reloaded}
    except Exception as error:
        write_json_atomic(stamp_file, {'lastCheckedAt': time.time(), 'status': 'apply-error', 'error': str(error)})
        return {'status': 'error', 'phase': 'apply', 'error': str(error)}
    finally:
        if plan_file.exists():
            try:
                plan_file.unlink()
            except OSError:
                pass


def main():
    parser = argparse.ArgumentParser(description='Antigravity Pulse automatic background updater')
    parser.add_argument('--target', type=Path, help='Installed plugin directory')
    parser.add_argument('--force', action='store_true', help='Bypass interval throttle and check immediately')
    parser.add_argument('--interval', type=int, default=DEFAULT_INTERVAL_SEC, help='Minimum seconds between checks')
    args = parser.parse_args()
    result = run_auto_update(target=args.target, force=args.force, interval_sec=args.interval)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('status') != 'error' else 1


if __name__ == '__main__':
    raise SystemExit(main())
