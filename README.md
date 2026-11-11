# Antigravity Pulse (Claude-Style Inline Step Card & Quota Monitor)

适用于 **Google Antigravity**（macOS / Windows / Linux）的增强状态栏与对话流进度监控插件，基于 MIT 协议开源。

## 核心特性

1. **对话气泡内嵌 Claude 风格步骤面板卡片**
   - 在多步任务回复气泡内（工具调用折叠栏下方、最终总结上方）自动挂载实时步骤卡片。
   - 支持**旋转圆弧**（进行中）、**虚线圆**（等待中）、**绿勾**（已完成）三种状态动画及手动点击切换。
   - 内置 [`rules/AGENTS.md`](rules/AGENTS.md) 规范，引导模型按「一句话开场 + 静默连续执行 + 收尾总结」节奏推进并同步 `scratch/task_steps.json`。
2. **右下角紧凑胶囊与生命周期防卡死监控**
   - 融合 [`hooks.json`](hooks.json)（`SessionStart` / `PreToolUse` / `PostToolUse` / `Stop` 生命周期钩子）、`transcript.jsonl` 增量日志与 `task_steps.json` 三源状态。
   - 右下角常驻紧凑进度胶囊，悬停/点击可展开分阶段进度面板；长时间无响应时自动高亮预警并支持一键重新调起。
3. **Token 吞吐率、缓存命中率与配额监控**
   - 在输入框模型选择栏旁实时显示生成速率（tok/s）、缓存命中率、上下文窗口占用，以及 5 小时 / 周配额详情，支持中英文一键切换。

---

## 快速安装 (Quick Install)

### macOS / Linux

```bash
git clone https://github.com/yangyu2004/antigravity-pulse.git
cd antigravity-pulse
./install.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/yangyu2004/antigravity-pulse.git
cd antigravity-pulse
.\install.ps1
```

安装完成后，**完全退出并重新打开 Antigravity** 即可生效（后续客户端升级无需重复打补丁）。

---

## 常用管理命令

```bash
python3 manage.py status      # 查看插件与内联注入运行状态
python3 manage.py disable     # 临时停用插件
python3 manage.py enable      # 重新启用插件
./uninstall.sh                # 完整卸载插件（Windows 执行 .\uninstall.ps1）
```

---

## 目录结构

- `compat/`：CDP 运行时注入器（`runtime-ui.mjs`）、对话内嵌步骤卡片与右下角胶囊渲染器（`inline-widget.cjs`）、多语言字典（`i18n.cjs`）
- `sidecars/panel/`：后台常驻 Sidecar 服务（`main.mjs`）与多源任务进度监控引擎（`task-monitor.mjs`）
- `hooks/` & `hooks.json`：Agent 生命周期瞬时状态捕获钩子（`lifecycle-hook.js`）
- `rules/AGENTS.md`：多步任务 Claude 风格三段式对话流规则
- `manage.py` / `install.sh` / `install.ps1`：零依赖跨平台安装、启停与卸载脚本

## License

MIT License（基于 [antigrative-dashboard](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard) 扩展定制）。详见 [LICENSE](LICENSE)。
