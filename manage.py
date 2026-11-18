"""Dependency-free Antigrative Dashboard installer, switch, uninstaller and packager."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from functools import wraps

SOURCE = Path(__file__).resolve().parent
_path_spec = importlib.util.spec_from_file_location('pulse_paths', SOURCE / 'compat' / 'platform_paths.py')
_paths_module = importlib.util.module_from_spec(_path_spec)
_path_spec.loader.exec_module(_paths_module)
_paths = _paths_module.platform_paths()
HOME = _paths['home']
LOCAL = _paths['local']
PLUGIN = HOME / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse'
CONFIG = HOME / '.gemini' / 'config' / 'config.json'
SETTINGS = _paths['settings']
APP = _paths['app']
PROFILE = _paths['profile']
BACKUPS = _paths['backups']
RUNTIME_FILES = ('assets', 'compat', 'sidecars', 'hooks', 'hooks.json', 'rules', 'plugin.json')
DIST_FILES = ('plugin.json', 'assets', 'sidecars', 'compat', 'hooks', 'hooks.json', 'rules', 'cli', 'ide', 'manage.py', 'install.ps1',
              'uninstall.ps1', 'install.sh', 'uninstall.sh', 'README.md', 'LICENSE', 'CHANGELOG.md', 'COMPATIBILITY.md', 'docs', 'package.json',
              '.gitignore', '.gitattributes', 'tests', 'tools', 'GITHUB_RELEASE.md', 'README.zh-CN.md')
IGNORED = {'__pycache__', '.data', 'node_modules', '.git', 'dist', 'data', 'history-v1', 'usage-v1', 'sdk'}

def lifecycle_operation(function):
    @wraps(function)
    def locked(*args, **kwargs):
        spec = importlib.util.spec_from_file_location('pulse_update_lock', SOURCE / 'compat/update-lock.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with module.lifecycle_lock(PLUGIN):
            transaction = PLUGIN.parent / '.antigravity-pulse-update-transaction'
            if (transaction / 'journal.json').exists():
                raise RuntimeError('An interrupted update requires recovery. Run the saved recover.py helper before installing or uninstalling.')
            return function(*args, **kwargs)
    return locked

def json_read(file, default=None):
    if not file.exists():
        return {} if default is None else default
    return json.loads(file.read_text(encoding='utf-8-sig'))

def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, file)

def own_plugin():
    if PLUGIN.is_symlink() or (PLUGIN.exists() and PLUGIN.resolve().parent != (HOME / '.gemini' / 'config' / 'plugins').resolve()):
        raise RuntimeError('Plugin destination must be a regular directory inside the customization root.')
    if PLUGIN.exists() and json_read(PLUGIN / 'plugin.json').get('name') != 'antigravity-pulse':
        raise RuntimeError('Destination is not an Antigrative Dashboard installation; refusing to overwrite it.')

def adapter():
    spec = importlib.util.spec_from_file_location('pulse_adapter', SOURCE / 'compat' / 'patch-loader.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.APP = APP
    module.BACKUPS = BACKUPS
    return module

def original_for_current(current):
    digest = hashlib.sha256(current).hexdigest()
    if not BACKUPS.exists():
        return None
    for directory in sorted(BACKUPS.iterdir(), reverse=True):
        note = json_read(directory / 'patch.json')
        if note.get('patchedSha256') == digest:
            original = (directory / 'app.asar').read_bytes()
            if hashlib.sha256(original).hexdigest() != note.get('originalSha256'):
                raise RuntimeError('Original application backup failed its integrity check.')
            return original
    return None

def set_enabled(enabled):
    own_plugin()
    if not (PLUGIN / 'plugin.json').exists():
        raise RuntimeError('Install Antigrative Dashboard before changing its state.')
    config = json_read(CONFIG)
    entry = config.setdefault('plugins', {}).setdefault('antigravity-pulse', {})
    entry['enabled'] = bool(enabled)
    atomic_json(CONFIG, config)
    settings = json_read(SETTINGS)
    settings['enabled'] = bool(enabled)
    atomic_json(SETTINGS, settings)
    print('Antigrative Dashboard enabled.' if enabled else 'Antigrative Dashboard disabled; the toolbar hides on its next poll.')

def remove_verified_legacy_adapter():
    if not APP.is_file():
        return
    current = APP.read_bytes()
    original = original_for_current(current)
    if original is not None:
        APP.write_bytes(original)
        if APP.read_bytes() != original:
            raise RuntimeError('Legacy adapter restoration verification failed.')
        print('Restored the exact verified legacy archive; future updates need no archive patches.')
    elif b'// AG_PULSE_INLINE_V1' in current:
        raise RuntimeError('The legacy adapter has unknown app changes; refusing to overwrite them. Inspect its backup first.')


def install_auto_update_schedule():
    """Register OS-level background auto-update task on real user installations."""
    try:
        if HOME.resolve() != Path.home().resolve():
            return
    except OSError:
        return
    updater_script = PLUGIN / 'compat' / 'auto-updater.py'
    if not updater_script.is_file():
        return
    if sys.platform == 'darwin':
        plist_dir = HOME / 'Library' / 'LaunchAgents'
        plist_path = plist_dir / 'com.antigravity.pulse.autoupdate.plist'
        plist_dir.mkdir(parents=True, exist_ok=True)
        plist_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0">\n'
            '<dict>\n'
            '  <key>Label</key>\n'
            '  <string>com.antigravity.pulse.autoupdate</string>\n'
            '  <key>ProgramArguments</key>\n'
            '  <array>\n'
            f'    <string>{sys.executable}</string>\n'
            f'    <string>{updater_script}</string>\n'
            '  </array>\n'
            '  <key>RunAtLoad</key>\n'
            '  <true/>\n'
            '  <key>StartInterval</key>\n'
            '  <integer>3600</integer>\n'
            '  <key>StandardOutPath</key>\n'
            '  <string>/dev/null</string>\n'
            '  <key>StandardErrorPath</key>\n'
            '  <string>/dev/null</string>\n'
            '</dict>\n'
            '</plist>\n'
        )
        plist_path.write_text(plist_xml, encoding='utf-8')
        uid = os.getuid()
        subprocess.run(['launchctl', 'bootout', f'gui/{uid}', str(plist_path)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        subprocess.run(['launchctl', 'bootstrap', f'gui/{uid}', str(plist_path)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    elif sys.platform == 'win32':
        pyw = Path(sys.executable).with_name('pythonw.exe')
        runner = pyw if pyw.is_file() else Path(sys.executable)
        subprocess.run(
            ['schtasks', '/Create', '/F', '/SC', 'HOURLY', '/TN', 'AntigravityPulseAutoUpdate',
             '/TR', f'"{runner}" "{updater_script}"'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
        )


def remove_auto_update_schedule():
    try:
        real_home = HOME.resolve() == Path.home().resolve()
    except OSError:
        real_home = False
    if sys.platform == 'darwin':
        plist_path = HOME / 'Library' / 'LaunchAgents' / 'com.antigravity.pulse.autoupdate.plist'
        if real_home and plist_path.is_file():
            subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}', str(plist_path)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if plist_path.is_file():
            try:
                plist_path.unlink()
            except OSError:
                pass
    elif sys.platform == 'win32' and real_home:
        subprocess.run(
            ['schtasks', '/Delete', '/F', '/TN', 'AntigravityPulseAutoUpdate'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
        )


@lifecycle_operation
def install(panel_only=False, legacy_loader=False, auto_update=None):
    own_plugin()
    config = json_read(CONFIG)
    if not isinstance(config, dict) or not isinstance(config.get('plugins', {}), dict):
        raise RuntimeError('Existing customization configuration has an incompatible shape.')
    if not panel_only:
        if not APP.is_file():
            raise RuntimeError('Antigravity desktop app not found. Use --app-path /path/to/resources/app.asar for a custom installation. See COMPATIBILITY.md.')
    if legacy_loader:
        if sys.platform != 'win32':
            raise RuntimeError('The historical app.asar loader is Windows-only. Use the default runtime adapter.')
        module = adapter()
        module.build(module.unpatched_original(APP.read_bytes()))
    elif not panel_only:
        remove_verified_legacy_adapter()
    PLUGIN.mkdir(parents=True, exist_ok=True)
    for name in RUNTIME_FILES:
        source, target = SOURCE / name, PLUGIN / name
        if source.resolve() == target.resolve():
            continue
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.log', '.data', 'node_modules', 'data', 'history-v1', 'sdk'))
        else:
            shutil.copy2(source, target)
    if legacy_loader:
        subprocess.run([sys.executable, str(SOURCE / 'compat' / 'patch-loader.py'), '--apply'], check=True,
                       env={**os.environ, 'AG_PULSE_APP_ASAR': str(APP)})
    settings = json_read(SETTINGS)
    settings.update({'inline': not panel_only, 'mode': 'legacy' if legacy_loader else 'runtime'})
    if auto_update is None:
        settings.setdefault('autoUpdate', True)
    else:
        settings['autoUpdate'] = bool(auto_update)
    if APP.is_file():
        settings['appResources'] = str(APP.parent)
    if os.environ.get('AG_PULSE_PROFILE'):
        settings['profile'] = str(_paths['profile'])
    atomic_json(SETTINGS, settings)
    set_enabled(True)
    if settings.get('autoUpdate', True):
        install_auto_update_schedule()
    else:
        remove_auto_update_schedule()
    print('Installed:', PLUGIN)
    print('Fully quit and reopen Antigravity to start the plugin runtime. App updates no longer overwrite the inline adapter.')

@lifecycle_operation
def uninstall():
    own_plugin()
    # Restore before deleting the runtime. An unknown archive is never overwritten.
    if APP.exists():
        module = adapter()
        current = APP.read_bytes()
        original = original_for_current(current)
        if original is not None:
            APP.write_bytes(original)
            if APP.read_bytes() != original:
                raise RuntimeError('Restored application verification failed.')
            print('Original Antigravity archive restored.')
        elif b'// AG_PULSE_INLINE_V1' in current:
            header, base = module.archive(current)
            entry = header['files']['dist']['files']['preload.js']
            preload = current[base + int(entry['offset']):base + int(entry['offset']) + entry['size']]
            if module.MARKER.encode() in preload:
                raise RuntimeError('Application changed since patching. Inspect the backup before uninstalling.')
    remove_auto_update_schedule()
    if PLUGIN.exists():
        set_enabled(False)
        resolved = PLUGIN.resolve()
        expected_parent = (HOME / '.gemini' / 'config' / 'plugins').resolve()
        if PLUGIN.is_symlink() or resolved.parent != expected_parent or resolved.name != 'antigravity-pulse':
            raise RuntimeError('Plugin target is outside the expected directory; refusing to delete it.')
        shutil.rmtree(resolved)
    else:
        atomic_json(SETTINGS, {'enabled': False})
    print('Antigrative Dashboard removed. Backups and diagnostic logs are retained for recovery.')
    print('Fully quit and reopen Antigravity to unload the UI adapter.')

def _active_debug_port(active_port_file):
    try:
        lines = active_port_file.read_text(encoding='utf-8').splitlines()
    except OSError:
        return None
    if not lines or not lines[0].strip().isdigit():
        return None
    port = int(lines[0].strip())
    if port < 1 or port > 65535:
        return None
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.3):
            return port
    except OSError:
        return None


def status():
    installed = (PLUGIN / 'plugin.json').is_file()
    enabled = installed and json_read(CONFIG).get('plugins', {}).get('antigravity-pulse', {}).get('enabled', True)
    settings = json_read(SETTINGS)
    health_file = HOME / '.gemini' / 'antigravity' / 'sidecar_data' / 'antigravity-pulse' / 'panel' / 'data' / 'integration-state.json'
    print(json.dumps({'installed': installed, 'enabled': bool(enabled), 'autoUpdate': settings.get('autoUpdate', True) is not False,
                      'pluginDirectory': str(PLUGIN),
                      'integrationMode': settings.get('mode', 'legacy'),
                      'debugPortActive': _active_debug_port(PROFILE / 'DevToolsActivePort') is not None,
                      'inlineIntegration': json_read(health_file, None),
                      'toolbarAdapterRecoverable': APP.exists() and original_for_current(APP.read_bytes()) is not None}, indent=2))


def resolve_desktop_entry():
    if sys.platform == 'darwin':
        if APP.is_file() and len(APP.parents) >= 3 and APP.parents[2].suffix == '.app':
            return APP.parents[2]
        for candidate in (Path('/Applications/Antigravity.app'), HOME / 'Applications' / 'Antigravity.app'):
            if candidate.exists():
                return candidate
        raise RuntimeError('Antigravity.app not found in /Applications or ~/Applications.')
    if sys.platform == 'win32':
        exe = APP.parents[1] / 'Antigravity.exe' if len(APP.parents) >= 2 else None
        if exe and exe.is_file():
            return exe
        raise RuntimeError('Antigravity.exe not found next to app.asar.')
    if APP.is_file() and len(APP.parents) >= 2:
        exe = APP.parents[1] / 'antigravity'
        if exe.is_file():
            return exe
    found = shutil.which('antigravity')
    if found:
        return Path(found)
    raise RuntimeError('Antigravity executable not found.')


def _is_desktop_running():
    if sys.platform == 'darwin':
        return subprocess.run(['pgrep', '-x', 'Antigravity'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0
    if sys.platform == 'win32':
        res = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq Antigravity.exe', '/NH'],
                             capture_output=True, text=True, check=False,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000))
        return 'Antigravity.exe' in (res.stdout or '')
    return subprocess.run(['pgrep', '-x', 'antigravity'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0


def launch(restart=False, wait_timeout=8.0):
    entry = resolve_desktop_entry()
    active_port_file = PROFILE / 'DevToolsActivePort'
    if _is_desktop_running():
        if not restart:
            if _active_debug_port(active_port_file) is not None:
                print('Antigravity is already running with DevToolsActivePort enabled.')
                return
            raise RuntimeError('Antigravity is currently running without a debug port. Quit Antigravity first or run: python3 manage.py launch --restart')
        if sys.platform == 'darwin':
            subprocess.run(['osascript', '-e', 'tell application "Antigravity" to quit'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        elif sys.platform == 'win32':
            subprocess.run(['taskkill', '/IM', 'Antigravity.exe'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000))
        else:
            subprocess.run(['pkill', '-TERM', '-x', 'antigravity'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline and _is_desktop_running():
            time.sleep(0.25)
        if _is_desktop_running():
            raise RuntimeError('Timed out waiting for Antigravity to quit. Please close it manually and retry.')
    if active_port_file.exists():
        try:
            active_port_file.unlink()
        except OSError:
            pass
    debug_flags = ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']
    if sys.platform == 'darwin':
        subprocess.run(['open', '-a', str(entry), '--args', *debug_flags], check=True)
    elif sys.platform == 'win32':
        subprocess.Popen([str(entry), *debug_flags],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0x00000008))
    else:
        subprocess.Popen([str(entry), *debug_flags], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    deadline = time.monotonic() + wait_timeout
    port = None
    while time.monotonic() < deadline:
        port = _active_debug_port(active_port_file)
        if port is not None:
            break
        time.sleep(0.2)
    if port is not None:
        print(f'Launched {entry} with CDP debug port {port}.')
    else:
        print(f'Launched {entry} with {" ".join(debug_flags)}.')


def install_launcher():
    entry = resolve_desktop_entry()
    if sys.platform == 'darwin':
        app_dir = HOME / 'Applications' / 'Antigravity (Pulse).app'
        macos_dir = app_dir / 'Contents' / 'MacOS'
        res_dir = app_dir / 'Contents' / 'Resources'
        macos_dir.mkdir(parents=True, exist_ok=True)
        res_dir.mkdir(parents=True, exist_ok=True)
        plist = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0">\n'
            '<dict>\n'
            '  <key>CFBundleName</key>\n'
            '  <string>Antigravity (Pulse)</string>\n'
            '  <key>CFBundleDisplayName</key>\n'
            '  <string>Antigravity (Pulse)</string>\n'
            '  <key>CFBundleIdentifier</key>\n'
            '  <string>com.antigravity.pulse.launcher</string>\n'
            '  <key>CFBundleVersion</key>\n'
            '  <string>1.0</string>\n'
            '  <key>CFBundleExecutable</key>\n'
            '  <string>launch</string>\n'
            '  <key>CFBundleIconFile</key>\n'
            '  <string>icon.icns</string>\n'
            '  <key>LSUIElement</key>\n'
            '  <true/>\n'
            '</dict>\n'
            '</plist>\n'
        )
        (app_dir / 'Contents' / 'Info.plist').write_text(plist, encoding='utf-8')
        icon_src = Path(entry) / 'Contents' / 'Resources' / 'icon.icns'
        if icon_src.is_file():
            shutil.copy2(icon_src, res_dir / 'icon.icns')
        script = macos_dir / 'launch'
        quoted_entry = shlex.quote(str(entry))
        script.write_text(
            '#!/bin/sh\n'
            f'exec open -a {quoted_entry} --args --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 "$@"\n',
            encoding='utf-8',
        )
        os.chmod(script, 0o755)
        print('Created macOS launcher:', app_dir)
        return app_dir
    if sys.platform.startswith('linux'):
        desktop_dir = HOME / '.local' / 'share' / 'applications'
        desktop_dir.mkdir(parents=True, exist_ok=True)
        desktop_file = desktop_dir / 'antigravity-pulse.desktop'
        desktop_file.write_text(
            '[Desktop Entry]\n'
            'Type=Application\n'
            'Name=Antigravity (Pulse)\n'
            f'Exec="{entry}" --remote-debugging-port=0 --remote-debugging-address=127.0.0.1 %F\n'
            'Terminal=false\n'
            'Categories=Development;IDE;\n',
            encoding='utf-8',
        )
        os.chmod(desktop_file, 0o755)
        print('Created Linux desktop entry:', desktop_file)
        return desktop_file
    print(f'Launch {entry} with: --remote-debugging-port=0 --remote-debugging-address=127.0.0.1')
    return entry

def package(output=None):
    version = json_read(SOURCE / 'plugin.json')['version']
    output = Path(output) if output else SOURCE / 'dist' / f'antigrative-dashboard-{version}.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name in DIST_FILES:
            path = SOURCE / name
            if not path.exists():
                raise RuntimeError(f'Required release file missing: {name}')
            files = sorted(path.rglob('*')) if path.is_dir() else [path]
            for file in files:
                if not file.is_file() or any(p in IGNORED for p in file.relative_to(SOURCE).parts):
                    continue
                if file.suffix in {'.log', '.pyc'}:
                    continue
                bundle.write(file, Path('antigrative-dashboard') / file.relative_to(SOURCE))
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n', encoding='utf-8')
    print('Package:', output)
    print('SHA256:', digest)

def main():
    global APP
    parser = argparse.ArgumentParser(description='Antigrative Dashboard lifecycle manager')
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('install'); group = p.add_mutually_exclusive_group()
    group.add_argument('--panel-only', action='store_true')
    group.add_argument('--legacy-loader', action='store_true', help='Opt in to the old, version-specific app.asar adapter')
    p.add_argument('--app-path', type=Path, help='Path to the desktop app resources/app.asar for a custom installation')
    p.add_argument('--no-auto-update', action='store_true', help='Disable background automatic updates on install')
    for action in ('enable', 'disable', 'status', 'uninstall', 'install-launcher'): sub.add_parser(action)
    p = sub.add_parser('launch', help='Launch Antigravity desktop with CDP debug port enabled (required for 2.33.0+)')
    p.add_argument('--restart', action='store_true', help='Quit currently running Antigravity and relaunch with debug port')
    p = sub.add_parser('auto-update', help='Check GitHub Releases and apply updates automatically')
    p.add_argument('--force', action='store_true', help='Bypass interval throttle and check immediately')
    p = sub.add_parser('install-cli', help='Install the official CLI statusLine adapter independently of desktop')
    p.add_argument('--node', help='Node.js 20+ executable (defaults to PATH)')
    p.add_argument('--language', choices=('en', 'zh-CN', 'zh-TW'), help='Override shared desktop language choice')
    for action in ('uninstall-cli', 'status-cli'): sub.add_parser(action)
    p = sub.add_parser('package'); p.add_argument('--output')
    args = parser.parse_args()
    if args.action == 'install' and args.app_path:
        APP = args.app_path.expanduser().resolve()
    try:
        if args.action in ('install-cli', 'uninstall-cli', 'status-cli'):
            spec = importlib.util.spec_from_file_location('pulse_cli_lifecycle', SOURCE / 'cli' / 'lifecycle.py')
            cli = importlib.util.module_from_spec(spec)
            cli.install(SOURCE, HOME, args.node, args.language) if (spec.loader.exec_module(cli) or args.action == 'install-cli') else (cli.uninstall(HOME) if args.action == 'uninstall-cli' else cli.status(HOME))
            return 0
        if args.action == 'auto-update':
            updater_path = (PLUGIN / 'compat' / 'auto-updater.py') if (PLUGIN / 'compat' / 'auto-updater.py').is_file() else (SOURCE / 'compat' / 'auto-updater.py')
            spec = importlib.util.spec_from_file_location('pulse_auto_updater', updater_path)
            auto_mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(auto_mod)
            result = auto_mod.run_auto_update(home=HOME, target=PLUGIN, force=args.force)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result.get('status') != 'error' else 1
        if args.action == 'install': install(args.panel_only, args.legacy_loader, auto_update=False if args.no_auto_update else None)
        elif args.action == 'enable': set_enabled(True)
        elif args.action == 'disable': set_enabled(False)
        elif args.action == 'uninstall': uninstall()
        elif args.action == 'status': status()
        elif args.action == 'launch': launch(args.restart)
        elif args.action == 'install-launcher': install_launcher()
        elif args.action == 'package': package(args.output)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Antigrative Dashboard: {error}', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
