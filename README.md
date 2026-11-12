# Antigravity Pulse (Claude-Style Inline Step Card & Quota Monitor)

适用于 **Google Antigravity**（macOS / Windows / Linux）的全功能增强状态栏、配额监控与对话流进度监控插件，基于 MIT 协议开源。

## 核心特性

1. **对话气泡内嵌 Claude 风格步骤面板卡片**
   - 在多步任务回复气泡内（工具调用折叠栏下方、最终总结上方）自动挂载实时步骤卡片。
   - 支持**旋转圆弧**（进行中）、**虚线圆**（等待中）、**绿勾**（已完成）三种状态动画，**严格只读锁定、100% 由 AI 实时运行驱动**（禁止手动篡改状态）。
   - 自动将底层工具调用与终端命令转化为**简明中文目的描述**（合并连续文件读取、剔除冗余 `命令:` 前缀与转义引号），并内置 [`rules/AGENTS.md`](rules/AGENTS.md) 规范引导三段式节奏。
2. **Token 吞吐率、缓存命中率与配额监控**
   - 在输入框模型选择栏旁实时显示**生成速率（`tok/s`）**、**缓存命中率**、**上下文窗口占用**，以及 **5 小时 / 周配额详情**与本机 Token 用量热力图，支持**简/繁中文与英文一键切换**。
3. **右下角紧凑进度胶囊与防卡死一键唤醒**
   - 融合 [`hooks.json`](hooks.json) 生命周期钩子、`transcript.jsonl`、`task_steps.json` 与输入框真实生成状态；长时间无响应时自动高亮预警并支持 `⚡ 重新调起`，回合结束立即归位不误报。
4. **新建中文对话标题自动重命名**
   - 针对 Antigravity 默认将新建对话命名为英文的问题，后台自动检测中文提问并通过宿主本地接口根据对话意图重命名为精炼中文标题（不覆盖历史与手动修改标题）。
5. **默认开启的后台静默自动更新**
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
