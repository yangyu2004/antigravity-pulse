import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pulse_manager', ROOT / 'manage.py')
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)

class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.local = self.home / 'AppData' / 'Local'
        self.plugin = self.home / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse'
        self.config = self.home / '.gemini' / 'config' / 'config.json'
        self.settings = self.local / 'AntigravityPulse' / 'settings.json'
        self.app = self.local / 'Programs' / 'antigravity' / 'resources' / 'app.asar'
        self.backups = self.local / 'AntigravityPulseBackups'
        self.context = patch.multiple(manager, HOME=self.home, LOCAL=self.local, PLUGIN=self.plugin,
                                      CONFIG=self.config, SETTINGS=self.settings, APP=self.app, BACKUPS=self.backups)
        self.context.start()
        self.addCleanup(self.context.stop)

    def test_panel_install_disable_enable_remove_preserves_other_settings(self):
        manager.atomic_json(self.config, {'other': {'keep': 1}, 'plugins': {'other-plugin': {'enabled': True}}})
        manager.install(panel_only=True)
        self.assertTrue((self.plugin / 'sidecars' / 'panel' / 'main.mjs').exists())
        manager.set_enabled(False)
        self.assertFalse(manager.json_read(self.settings)['enabled'])
        manager.set_enabled(True)
        self.assertTrue(manager.json_read(self.settings)['enabled'])
        manager.uninstall()
        self.assertFalse(self.plugin.exists())
        self.assertFalse(manager.json_read(self.settings)['enabled'])
        config = manager.json_read(self.config)
        self.assertEqual(config['other'], {'keep': 1})
        self.assertTrue(config['plugins']['other-plugin']['enabled'])

    def test_app_lifecycle_respects_active_update_and_recovery_journal(self):
        lock_spec=importlib.util.spec_from_file_location('test_update_lock', ROOT/'compat/update-lock.py')
        locks=importlib.util.module_from_spec(lock_spec);lock_spec.loader.exec_module(locks)
        with locks.lifecycle_lock(self.plugin):
            with self.assertRaises(FileExistsError):manager.install(panel_only=True)
            with self.assertRaises(FileExistsError):manager.uninstall()
        journal=self.plugin.parent/'.antigravity-pulse-update-transaction/journal.json'
        journal.parent.mkdir();journal.write_text('{}')
        with self.assertRaisesRegex(RuntimeError,'recovery'):manager.install(panel_only=True)
        with self.assertRaisesRegex(RuntimeError,'recovery'):manager.uninstall()

    def test_other_plugin_is_not_overwritten_or_removed(self):
        self.plugin.mkdir(parents=True)
        manager.atomic_json(self.plugin / 'plugin.json', {'name': 'different'})
        with self.assertRaises(RuntimeError): manager.install(panel_only=True)
        with self.assertRaises(RuntimeError): manager.uninstall()
        self.assertEqual(manager.json_read(self.plugin / 'plugin.json')['name'], 'different')

    def test_uninstall_restores_only_the_exact_verified_archive(self):
        self.plugin.mkdir(parents=True)
        manager.atomic_json(self.plugin / 'plugin.json', {'name': 'antigravity-pulse'})
        self.app.parent.mkdir(parents=True)
        self.app.write_bytes(b'patched-fixture')
        backup = self.backups / 'test-backup'
        backup.mkdir(parents=True)
        (backup / 'app.asar').write_bytes(b'original-fixture')
        manager.atomic_json(backup / 'patch.json', {'patchedSha256': hashlib.sha256(b'patched-fixture').hexdigest(),
                                                  'originalSha256': hashlib.sha256(b'original-fixture').hexdigest()})
        manager.uninstall()
        self.assertEqual(self.app.read_bytes(), b'original-fixture')
        self.assertTrue(backup.exists())

    def test_unknown_app_changes_block_uninstall_before_deleting_plugin(self):
        self.plugin.mkdir(parents=True)
        manager.atomic_json(self.plugin / 'plugin.json', {'name': 'antigravity-pulse'})
        self.app.parent.mkdir(parents=True)
        changed = b'changed-by-another-application // AG_PULSE_INLINE_V1'
        self.app.write_bytes(changed)
        with self.assertRaises(Exception): manager.uninstall()
        self.assertTrue(self.plugin.exists())
        self.assertEqual(self.app.read_bytes(), changed)

    def test_default_install_and_upgrade_do_not_modify_the_application(self):
        self.app.parent.mkdir(parents=True)
        for archive in [b'future-host-build-without-legacy-patch', b'newer-host-build-after-auto-update']:
            self.app.write_bytes(archive)
            manager.install()
            self.assertEqual(self.app.read_bytes(), archive)
            self.assertEqual(manager.json_read(self.settings)['mode'], 'runtime')
            self.assertTrue(manager.json_read(self.settings)['inline'])
        self.assertTrue((self.plugin / 'compat' / 'runtime-ui.mjs').is_file())

    def test_switches_preserve_runtime_settings(self):
        manager.install(panel_only=True)
        manager.atomic_json(self.settings, {'enabled': True, 'inline': False, 'mode': 'runtime', 'custom': 123})
        manager.set_enabled(False)
        manager.set_enabled(True)
        self.assertEqual(manager.json_read(self.settings), {'enabled': True, 'inline': False, 'mode': 'runtime', 'custom': 123})

    def test_default_migration_refuses_unknown_legacy_edits_before_copying(self):
        self.app.parent.mkdir(parents=True)
        self.app.write_bytes(b'unknown-modifications // AG_PULSE_INLINE_V1')
        with self.assertRaises(RuntimeError): manager.install()
        self.assertFalse(self.plugin.exists())
        self.assertEqual(self.app.read_bytes(), b'unknown-modifications // AG_PULSE_INLINE_V1')

    def test_release_uses_allowlist_and_excludes_private_runtime_files(self):
        output = self.home / 'release.zip'
        manager.package(output)
        with zipfile.ZipFile(output) as bundle:
            names = bundle.namelist()
            self.assertIn('antigrative-dashboard/manage.py', names)
            self.assertIn('antigrative-dashboard/LICENSE', names)
            self.assertFalse(any(name.endswith(('.log', '.asar', '.pyc')) for name in names))
            self.assertFalse(any('/.git/' in name or '/__pycache__/' in name for name in names))
        self.assertTrue(output.with_suffix('.zip.sha256').exists())

    def test_history_and_sdk_records_are_excluded_even_if_inside_source(self):
        source = self.home / 'fixture-source'
        manager.atomic_json(source / 'plugin.json', {'version': 'test'})
        panel = source / 'sidecars' / 'panel'
        panel.mkdir(parents=True)
        (panel / 'main.mjs').write_text('// public runtime')
        manager.atomic_json(panel / 'data' / 'history-v1' / 'account' / 'conversation.json', {'private': 'statistics'})
        manager.atomic_json(panel / 'sdk' / 'private.json', {'private': 'host SDK'})
        output = self.home / 'private-exclusion.zip'
        with patch.multiple(manager, SOURCE=source, DIST_FILES=('plugin.json', 'sidecars')):
            manager.package(output)
        with zipfile.ZipFile(output) as bundle:
            self.assertEqual(set(bundle.namelist()), {'antigrative-dashboard/plugin.json', 'antigrative-dashboard/sidecars/panel/main.mjs'})

    def test_auto_updater_respects_throttle_and_applies_available_release(self):
        auto_spec = importlib.util.spec_from_file_location('pulse_auto_updater', ROOT / 'compat' / 'auto-updater.py')
        auto_mod = importlib.util.module_from_spec(auto_spec)
        auto_spec.loader.exec_module(auto_mod)
        manager.install(panel_only=True)
        self.assertTrue(manager.json_read(self.settings).get('autoUpdate'))
        calls = []
        def fake_worker(_worker, args, _cwd, _timeout):
            calls.append(args[0])
            if args[0] == 'check':
                return {'host': 'app', 'currentVersion': '0.9.2', 'latestVersion': '0.9.3', 'hasUpdate': True, 'url': 'https://example.test/a.zip'}
            return {'version': '0.9.3', 'verified': True}
        with patch.object(auto_mod, 'load_paths', return_value={'home': self.home, 'settings': self.settings}), \
             patch.object(auto_mod, 'reload_idle_sidecar', return_value=True):
            res1 = auto_mod.run_auto_update(home=self.home, target=self.plugin, worker_runner=fake_worker)
            self.assertEqual(res1['status'], 'updated')
            self.assertEqual(res1['version'], '0.9.3')
            self.assertEqual(calls, ['check', 'apply'])
            res2 = auto_mod.run_auto_update(home=self.home, target=self.plugin, worker_runner=fake_worker)
            self.assertEqual(res2['status'], 'throttled')
            self.assertEqual(calls, ['check', 'apply'])

    def test_launch_and_install_launcher_respect_debug_flags(self):
        profile = self.home / 'profile'
        profile.mkdir(parents=True)
        app_bundle = self.home / 'Antigravity.app'
        asar = app_bundle / 'Contents' / 'Resources' / 'app.asar'
        asar.parent.mkdir(parents=True)
        asar.write_bytes(b'asar')
        with patch.multiple(manager, HOME=self.home, APP=asar, PROFILE=profile):
            stale = profile / 'DevToolsActivePort'
            stale.write_text('9\n', encoding='utf-8')
            with patch('sys.platform', 'darwin'), patch.object(manager, '_is_desktop_running', return_value=True):
                with self.assertRaisesRegex(RuntimeError, '--restart'):
                    manager.launch(restart=False, wait_timeout=0)
            with patch('sys.platform', 'darwin'), \
                 patch.object(manager, '_is_desktop_running', return_value=False), \
                 patch('subprocess.run') as mock_run:
                manager.launch(restart=False, wait_timeout=0)
                self.assertFalse(stale.exists())
                mock_run.assert_called_once_with(
                    ['open', '-a', str(app_bundle), '--args', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
                    check=True,
                )
            with patch('sys.platform', 'darwin'):
                launcher = manager.install_launcher()
                self.assertTrue((launcher / 'Contents' / 'MacOS' / 'launch').is_file())
                script_text = (launcher / 'Contents' / 'MacOS' / 'launch').read_text(encoding='utf-8')
                self.assertIn('--remote-debugging-port=0 --remote-debugging-address=127.0.0.1', script_text)
                manager.remove_launcher()
                self.assertFalse(launcher.exists())
            win_exe = self.home / 'WinApp' / 'Antigravity.exe'
            win_asar = self.home / 'WinApp' / 'resources' / 'app.asar'
            win_asar.parent.mkdir(parents=True)
            win_exe.write_bytes(b'exe')
            win_asar.write_bytes(b'asar')
            (self.home / 'Desktop').mkdir(exist_ok=True)
            start_menu = self.home / 'AppData' / 'Roaming' / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs'
            start_menu.mkdir(parents=True, exist_ok=True)
            created_lnks = []
            def fake_win_lnk(lnk_path, target, arguments):
                created_lnks.append((lnk_path, target, arguments))
                lnk_path.write_text(f'{target} {arguments}', encoding='utf-8')
            with patch.multiple(manager, HOME=self.home, APP=win_asar), \
                 patch('sys.platform', 'win32'), \
                 patch.object(manager, '_create_windows_shortcut', side_effect=fake_win_lnk):
                win_launcher = manager.install_launcher()
                self.assertEqual(win_launcher, self.home / 'Desktop' / 'Antigravity (Pulse).lnk')
                self.assertEqual(len(created_lnks), 2)
                for _, target, arguments in created_lnks:
                    self.assertEqual(target, win_exe)
                    self.assertEqual(arguments, '--remote-debugging-port=0 --remote-debugging-address=127.0.0.1')
                manager.remove_launcher()
                self.assertFalse((self.home / 'Desktop' / 'Antigravity (Pulse).lnk').exists())
                self.assertFalse((start_menu / 'Antigravity (Pulse).lnk').exists())

            # Verify _create_windows_shortcut passes values via env vars (safe against curly quotes/special chars)
            with patch('subprocess.run') as mock_ps:
                manager._create_windows_shortcut(self.home / "O’Brien" / 'Antigravity (Pulse).lnk', win_exe, '--remote-debugging-port=0')
                mock_ps.assert_called_once()
                _, ps_kwargs = mock_ps.call_args
                self.assertEqual(ps_kwargs['timeout'], 30)
                self.assertEqual(ps_kwargs['env']['AGP_LNK_TARGET'], str(win_exe))
                self.assertIn("O’Brien", ps_kwargs['env']['AGP_LNK_PATH'])
                self.assertNotIn("O’Brien", mock_ps.call_args[0][0][-1])

            # Windows with missing Desktop & Start Menu dirs returns None (never returns raw Antigravity.exe)
            empty_home = self.home / 'empty_win_home'
            empty_home.mkdir()
            with patch.multiple(manager, HOME=empty_home, APP=win_asar), patch('sys.platform', 'win32'):
                self.assertIsNone(manager.install_launcher(quiet=True))

    def test_install_auto_launcher_and_failure_warning(self):
        import io, subprocess
        from contextlib import redirect_stderr, redirect_stdout

        app_bundle = self.home / 'Antigravity.app'
        asar = app_bundle / 'Contents' / 'Resources' / 'app.asar'
        asar.parent.mkdir(parents=True)
        asar.write_bytes(b'asar')
        with patch.multiple(manager, HOME=self.home, APP=asar, PLUGIN=self.plugin, CONFIG=self.config, SETTINGS=self.settings, BACKUPS=self.backups):
            out = io.StringIO()
            with patch('sys.platform', 'darwin'), redirect_stdout(out):
                manager.install(auto_update=False)
            launcher = self.home / 'Applications' / 'Antigravity (Pulse).app'
            self.assertTrue(launcher.is_dir())
            self.assertIn('Launcher (2.33.0+ CDP debug port):', out.getvalue())
            with patch('sys.platform', 'darwin'):
                manager.uninstall()
            self.assertFalse(launcher.exists())

        # Windows shortcut failure / timeout warns cleanly without aborting install
        win_home = self.home / 'win_fail_home'
        (win_home / 'Desktop').mkdir(parents=True)
        win_exe = win_home / 'WinApp' / 'Antigravity.exe'
        win_asar = win_home / 'WinApp' / 'resources' / 'app.asar'
        win_asar.parent.mkdir(parents=True)
        win_exe.write_bytes(b'exe')
        win_asar.write_bytes(b'asar')
        win_plugin = win_home / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse'
        win_config = win_home / '.gemini' / 'config' / 'customizations.json'
        win_settings = win_home / 'settings.json'
        win_backups = win_home / 'backups'
        out2, err2 = io.StringIO(), io.StringIO()
        with patch.multiple(manager, HOME=win_home, APP=win_asar, PLUGIN=win_plugin, CONFIG=win_config, SETTINGS=win_settings, BACKUPS=win_backups), \
             patch('sys.platform', 'win32'), \
             patch.object(manager, '_create_windows_shortcut', side_effect=subprocess.TimeoutExpired('powershell.exe', 30)), \
             redirect_stdout(out2), redirect_stderr(err2):
            manager.install(auto_update=False)
        self.assertTrue((win_plugin / 'plugin.json').is_file())
        self.assertNotIn('Antigravity.exe', out2.getvalue())
        self.assertIn('Warning: could not auto-create CDP launcher', err2.getvalue())

        # Windows missing Desktop/Start Menu does not print Antigravity.exe as Launcher
        bare_home = self.home / 'win_bare_home'
        bare_home.mkdir()
        bare_plugin = bare_home / '.gemini' / 'config' / 'plugins' / 'antigravity-pulse'
        bare_config = bare_home / '.gemini' / 'config' / 'customizations.json'
        bare_settings = bare_home / 'settings.json'
        bare_backups = bare_home / 'backups'
        out3, err3 = io.StringIO(), io.StringIO()
        with patch.multiple(manager, HOME=bare_home, APP=win_asar, PLUGIN=bare_plugin, CONFIG=bare_config, SETTINGS=bare_settings, BACKUPS=bare_backups), \
             patch('sys.platform', 'win32'), redirect_stdout(out3), redirect_stderr(err3):
            manager.install(auto_update=False)
        self.assertTrue((bare_plugin / 'plugin.json').is_file())
        self.assertNotIn('Launcher (2.33.0+ CDP debug port):', out3.getvalue())
        self.assertEqual(err3.getvalue(), '')

    def test_set_enabled_respects_lock_and_launcher_escaping_and_symlinks(self):
        lock_spec = importlib.util.spec_from_file_location('test_update_lock2', ROOT / 'compat/update-lock.py')
        locks = importlib.util.module_from_spec(lock_spec)
        lock_spec.loader.exec_module(locks)
        manager.install(panel_only=True)
        with locks.lifecycle_lock(self.plugin):
            with self.assertRaises(FileExistsError):
                manager.set_enabled(False)

        # Linux .desktop escaping (% -> %%)
        linux_dir = self.home / 'opt' / '100%app'
        linux_exe = linux_dir / 'antigravity'
        linux_asar = linux_dir / 'resources' / 'app.asar'
        linux_asar.parent.mkdir(parents=True)
        linux_exe.write_bytes(b'bin')
        linux_asar.write_bytes(b'asar')
        with patch.multiple(manager, HOME=self.home, APP=linux_asar), patch('sys.platform', 'linux'):
            desktop = manager.install_launcher(quiet=True)
            text = desktop.read_text(encoding='utf-8')
            self.assertIn('100%%app/antigravity', text)

        # macOS symlinked launcher must be rejected
        if os.name != 'nt':
            apps = self.home / 'Applications'
            apps.mkdir(parents=True, exist_ok=True)
            bad_link = apps / 'Antigravity (Pulse).app'
            bad_link.symlink_to(self.home)
            mac_asar = self.home / 'Antigravity.app' / 'Contents' / 'Resources' / 'app.asar'
            mac_asar.parent.mkdir(parents=True)
            mac_asar.write_bytes(b'asar')
            with patch.multiple(manager, HOME=self.home, APP=mac_asar), patch('sys.platform', 'darwin'):
                with self.assertRaisesRegex(RuntimeError, 'symlink'):
                    manager.install_launcher(quiet=True)

if __name__ == '__main__': unittest.main()
