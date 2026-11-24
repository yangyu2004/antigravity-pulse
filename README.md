# Antigravity Pulse (Quota Monitor, Anti-Stall & Host UI Localization)

适用于 **Google Antigravity**（macOS / Windows / Linux，已实机适配 `2.34.0+` 官方原生 `update_steps` 卡片）的全功能增强状态栏、配额监控、防卡死监控与原生界面汉化插件，基于 MIT 协议开源。

## 核心特性

1. **原生联动官方 `update_steps` 步骤卡片（自动避让防重影）**
   - 直接从 `transcript.jsonl` 解析 Antigravity `2.34.0+` 原生 `update_steps` 与 `update_focus`，同步驱动底部进度百分比胶囊、实时状态提示与卡死监控，并自动过滤 `update_steps`/`update_focus` 元工具噪音。
   - 当回复气泡内已渲染官方 `[data-testid="step-plan"]` / `[data-testid="step-plan-chip"]` 卡片时，自动隐藏插件自绘卡片杜绝双卡重影；仅在发生卡死预警时弹出精简 `⚡ 重新调起` 唤醒横幅，或在旧版宿主 / 未调用 `update_steps` 的多步工具流中按需兜底渲染。
   - 内置 [`rules/AGENTS.md`](rules/AGENTS.md) 引导优先使用原生 `update_steps` 与简明中文工具摘要（无需再额外写入 `task_steps.json`）。
2. **Token 吞吐率、缓存命中率与配额监控**
   - 在输入框模型选择栏旁实时显示**生成速率（`tok/s`）**、**缓存命中率**、**上下文窗口占用**，以及 **5 小时 / 周配额详情**与本机 Token 用量热力图，支持**简/繁中文与英文一键切换**。
3. **右下角紧凑进度胶囊与防卡死一键唤醒**
   - 融合 [`hooks.json`](hooks.json) 生命周期钩子、`transcript.jsonl`、`task_steps.json` 与输入框真实生成状态；长时间无响应时自动高亮预警并支持 `⚡ 重新调起`，回合结束立即归位不误报。
4. **新建中文对话标题自动重命名**
   - 针对 Antigravity 默认将新建对话命名为英文的问题，后台自动检测中文提问并通过宿主本地接口根据对话意图重命名为精炼中文标题（不覆盖历史与手动修改标题）。
5. **非侵入式宿主界面实时汉化**
   - 通过现有 CDP 运行时注入通道安全实现 Antigravity 宿主英文界面、设置项与动态状态的实时中文化（支持 `zh-CN` / `zh-TW` / `en` 随时切换还原），不修改 `app.asar`，自动避开代码块、对话正文及模型标识。
6. **默认开启的后台静默自动更新**
   - 内置常驻 Sidecar 自动更新巡检与独立后台更新守护程序（`compat/auto-updater.py`），自动校验 SHA-256 下载并原子替换新版本，等待 AI 空闲后热重载生效。

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

> **Antigravity 2.33.0 / 2.34.0+ 重要说明**：新版 Antigravity 默认关闭了远程调试端口（启动时会清理 `DevToolsActivePort`），直接点击原版图标启动将只能看到右侧原生插件面板。安装脚本（`./install.sh` / `.\install.ps1`）现已**自动生成快捷启动器**：
> - **macOS**：`~/Applications/Antigravity (Pulse).app`（拖入程序坞替换原图标即可一键启动）
> - **Windows**：桌面与开始菜单 `Antigravity (Pulse).lnk`（固定到任务栏即可）
> - **Linux**：`~/.local/share/applications/antigravity-pulse.desktop`
> - 或直接运行一键重启：`python3 manage.py launch --restart`（也可手动重新生成启动器：`python3 manage.py install-launcher`；注意若客户端已在后台/菜单栏运行，需先完整退出 `Cmd+Q` / 托盘退出再用启动器打开，否则单实例锁会忽略新参数；全程不修改任何应用包或签名；开启本地 `--remote-debugging-port=0` 期间本机同用户进程可访问 Chromium 调试通道）

---

## 常用管理命令

```bash
python3 manage.py status      # 查看插件与内联注入运行状态
python3 manage.py auto-update --force  # 立即手动触发一次自动更新检查与升级
python3 manage.py disable     # 临时停用插件
python3 manage.py enable      # 重新启用插件
./uninstall.sh                # 完整卸载插件（Windows 执行 .\uninstall.ps1）
```

---

## 目录结构

- `compat/`：CDP 运行时注入器（`runtime-ui.mjs`）、全指标状态栏 + 对话内嵌步骤卡片渲染器（`inline-widget.cjs`）、用量热力图面板（`usage-ui.cjs`）、多语言字典（`i18n.cjs`）
- `sidecars/panel/`：后台常驻 Sidecar 服务（`main.mjs`）、配额与会话速率采集（`store.mjs` / `metrics.mjs`）、任务进度引擎（`task-monitor.mjs`）与新建中文对话自动重命名（`title-renamer.mjs`）
- `hooks/` & `hooks.json`：Agent 生命周期瞬时状态捕获钩子（`lifecycle-hook.js`）
- `rules/AGENTS.md`：多步任务 Claude 风格三段式对话流与中文工具摘要规范
- `manage.py` / `install.sh` / `install.ps1`：零依赖跨平台安装、启停与卸载脚本

## License

MIT License（基于 [antigrative-dashboard](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard) 扩展定制）。详见 [LICENSE](LICENSE)。
