import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('auto_updater', ROOT / 'compat/auto-updater.py')
auto_updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auto_updater)


class AutoUpdaterProcessFilterTests(unittest.TestCase):
    def setUp(self):
        self.current_uid = os.getuid()
        self.test_pid = 99999

    def test_basic_pid_rejections(self):
        """Reject non-positive PIDs, self PID, and dead PIDs."""
        self.assertFalse(auto_updater._is_panel_sidecar_proc(0, self.current_uid))
        self.assertFalse(auto_updater._is_panel_sidecar_proc(-1, self.current_uid))
        self.assertFalse(auto_updater._is_panel_sidecar_proc(os.getpid(), self.current_uid))

        with patch('os.kill', side_effect=OSError(3, 'No such process')):
            self.assertFalse(auto_updater._is_panel_sidecar_proc(self.test_pid, self.current_uid))

    @patch('os.kill', return_value=None)
    def test_proc_uid_mismatch_rejected(self, mock_kill):
        """Process belonging to a different user is rejected."""
        mock_ps = subprocess.CompletedProcess(
            args=['ps'],
            returncode=0,
            stdout=f"0 /usr/local/bin/node /path/to/antigravity-pulse/sidecars/panel/main.mjs\n",
            stderr=""
        )
        with patch('subprocess.run', return_value=mock_ps):
            self.assertFalse(auto_updater._is_panel_sidecar_proc(self.test_pid, self.current_uid))

    @patch('os.kill', return_value=None)
    def test_unrelated_process_in_repo_cwd_rejected(self, mock_kill):
        """Non-node process (python, bash, git) running inside repo cwd is rejected."""
        mock_ps = subprocess.CompletedProcess(
            args=['ps'],
            returncode=0,
            stdout=f"{self.current_uid} python3 manage.py test\n",
            stderr=""
        )
        # Even if lsof reports repo directory, without main.mjs it must never be probed or accepted
        mock_lsof = subprocess.CompletedProcess(
            args=['lsof'],
            returncode=0,
            stdout="p99999\nn/Users/jiangyou/.gemini/antigravity/scratch/antigravity-pulse\n",
            stderr=""
        )
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = [mock_ps, mock_lsof]
            self.assertFalse(auto_updater._is_panel_sidecar_proc(self.test_pid, self.current_uid))
            # Verify lsof was not even called because main.mjs was not in arguments
            self.assertEqual(mock_run.call_count, 1)

    @patch('os.kill', return_value=None)
    def test_other_plugin_sidecar_rejected(self, mock_kill):
        """Sidecar from another plugin (e.g. swarm_board) is rejected."""
        mock_ps = subprocess.CompletedProcess(
            args=['ps'],
            returncode=0,
            stdout=(
                f"{self.current_uid} /path/to/node --import=file:///path/to/sidecar_sdk/register_loader.js main.mjs\n"
            ),
            stderr=""
        )
        mock_lsof = subprocess.CompletedProcess(
            args=['lsof'],
            returncode=0,
            stdout="p99999\nn/Users/jiangyou/.gemini/antigravity/builtin/plugins/swarm/sidecars/swarm_board\n",
            stderr=""
        )
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = [mock_ps, mock_lsof]
            self.assertFalse(auto_updater._is_panel_sidecar_proc(self.test_pid, self.current_uid))
            self.assertEqual(mock_run.call_count, 2)

    @patch('os.kill', return_value=None)
    def test_pulse_sidecar_with_args_accepted(self, mock_kill):
        """Sidecar with antigravity-pulse explicitly in arguments is accepted."""
        mock_ps = subprocess.CompletedProcess(
            args=['ps'],
            returncode=0,
            stdout=(
                f"{self.current_uid} /path/to/node /Users/jiangyou/.gemini/config/plugins/antigravity-pulse/sidecars/panel/main.mjs\n"
            ),
            stderr=""
        )
        with patch('subprocess.run', return_value=mock_ps):
            self.assertTrue(auto_updater._is_panel_sidecar_proc(self.test_pid, self.current_uid))

    @patch('os.kill', return_value=None)
    def test_pulse_sidecar_with_repo_cwd_accepted(self, mock_kill):
        """Sidecar with generic main.mjs args but pulse cwd in lsof is accepted."""
        mock_ps = subprocess.CompletedProcess(
            args=['ps'],
            returncode=0,
            stdout=f"{self.current_uid} node --import=sidecar_sdk/register_loader.js main.mjs\n",
            stderr=""
        )
        mock_lsof = subprocess.CompletedProcess(
            args=['lsof'],
            returncode=0,
            stdout="p99999\nn/Users/jiangyou/.gemini/config/plugins/antigravity-pulse/sidecars/panel\n",
            stderr=""
        )
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = [mock_ps, mock_lsof]
            self.assertTrue(auto_updater._is_panel_sidecar_proc(self.test_pid, self.current_uid))


class ReloadIdleSidecarTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.home = Path(self.temp_dir.name).resolve()
        self.sidecar_dir = self.home / '.gemini' / 'antigravity' / 'sidecar_data' / 'antigravity-pulse' / 'panel' / 'data'
        self.sidecar_dir.mkdir(parents=True, exist_ok=True)
        self.active_file = self.sidecar_dir / 'active-sidecar.json'

    @patch.object(auto_updater, 'is_ai_turn_active', return_value=False)
    @patch('os.name', 'posix')
    def test_reload_from_active_file_matching_pulse(self, mock_ai):
        """When active-sidecar.json has a valid pulse PID, it sends SIGTERM and returns True."""
        self.active_file.write_text(json.dumps({'pid': 12345, 'startedAt': 1700000000}))

        with patch.object(auto_updater, '_is_panel_sidecar_proc', return_value=True) as mock_filter, \
             patch('os.kill') as mock_kill:
            reloaded = auto_updater.reload_idle_sidecar(self.home)
            self.assertTrue(reloaded)
            mock_filter.assert_called_once_with(12345, os.getuid())
            mock_kill.assert_called_once_with(12345, signal.SIGTERM)

    @patch.object(auto_updater, 'is_ai_turn_active', return_value=False)
    @patch('os.name', 'posix')
    def test_reload_from_active_file_stale_falls_back(self, mock_ai):
        """When active-sidecar.json PID is not a pulse process, fallback scan is used."""
        self.active_file.write_text(json.dumps({'pid': 12345, 'startedAt': 1700000000}))

        def filter_sidecar(pid, uid):
            # 12345 is stale or non-pulse; 55555 is the actual pulse sidecar
            return pid == 55555

        mock_pgrep = subprocess.CompletedProcess(
            args=['pgrep'],
            returncode=0,
            stdout="12345\n55555\n",
            stderr=""
        )

        with patch.object(auto_updater, '_is_panel_sidecar_proc', side_effect=filter_sidecar), \
             patch('subprocess.run', return_value=mock_pgrep), \
             patch('os.kill') as mock_kill:
            reloaded = auto_updater.reload_idle_sidecar(self.home)
            self.assertTrue(reloaded)
            # SIGTERM should only be sent to 55555, NOT 12345
            mock_kill.assert_called_once_with(55555, signal.SIGTERM)

    @patch.object(auto_updater, 'is_ai_turn_active', return_value=False)
    @patch('os.name', 'posix')
    def test_fallback_deduplicates_and_filters_other_plugins(self, mock_ai):
        """Fallback scanner filters out non-pulse processes and deduplicates PIDs."""
        # Simulated scenario matching Challenger 1:
        # PIDs: 42167, 61160, 85326 (swarm_board), 96751 (antigravity-pulse), and duplicate 96751
        def filter_sidecar(pid, uid):
            return pid == 96751

        mock_pgrep_1 = subprocess.CompletedProcess(
            args=['pgrep'],
            returncode=0,
            stdout="96751\n",
            stderr=""
        )
        mock_pgrep_2 = subprocess.CompletedProcess(
            args=['pgrep'],
            returncode=0,
            stdout="42167\n61160\n85326\n96751\n",
            stderr=""
        )

        killed_pids = []

        def fake_kill(pid, sig):
            killed_pids.append((pid, sig))

        with patch.object(auto_updater, '_is_panel_sidecar_proc', side_effect=filter_sidecar), \
             patch('subprocess.run') as mock_run, \
             patch('os.kill', side_effect=fake_kill):
            mock_run.side_effect = [mock_pgrep_1, mock_pgrep_2]

            reloaded = auto_updater.reload_idle_sidecar(self.home)
            self.assertTrue(reloaded)
            # Must ONLY kill 96751 once! No swarm_board sidecars killed.
            self.assertEqual(killed_pids, [(96751, signal.SIGTERM)])

    @patch.object(auto_updater, 'is_ai_turn_active', return_value=False)
    @patch('os.name', 'posix')
    def test_fallback_returns_false_when_no_pulse_sidecars(self, mock_ai):
        """If fallback finds only unrelated processes, returns False and kills nothing."""
        mock_pgrep = subprocess.CompletedProcess(
            args=['pgrep'],
            returncode=0,
            stdout="42167\n61160\n85326\n",
            stderr=""
        )
        killed_pids = []

        with patch.object(auto_updater, '_is_panel_sidecar_proc', return_value=False), \
             patch('subprocess.run', return_value=mock_pgrep), \
             patch('os.kill', side_effect=lambda pid, sig: killed_pids.append(pid)):
            reloaded = auto_updater.reload_idle_sidecar(self.home)
            self.assertFalse(reloaded)
            self.assertEqual(killed_pids, [])


if __name__ == '__main__':
    unittest.main()
