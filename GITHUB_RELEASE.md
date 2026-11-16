# Antigravity Pulse v0.9.4

全功能增强状态栏、配额监控与 Claude 风格对话流进度面板插件，适配 **Google Antigravity**（macOS / Windows / Linux，已实测兼容 `2.32.1`）。

## 核心修复 (Highlights)

- **修复已完成对话误报卡死与显示「距上次完成距今耗时」的 Bug**：
  - 解决打开数小时/数天前已结束的对话或在其上发起新追问时，将上一轮结束时间当作卡死静默时间（例如显示「模型思考已连续数十万秒无新响应」并锁死旧步骤卡片）的问题。
  - 新发起回合即时归零计时并清空旧步骤引用，同时修正 `cascadeState.selfStatus` 为空、`[Notice]` 系统通知与残留 Hook 场景下的完成态判定。

## 安装与升级 (Install / Update)

- **Antigravity 桌面端**：已安装 `v0.9.2+` 的用户将自动后台静默升级到 `v0.9.4`；全新安装请克隆仓库执行 `./install.sh`（Windows 执行 `.\install.ps1`），或解压 `antigrative-dashboard-0.9.4.zip` 后运行 `python3 manage.py install`。
- **独立版 Antigravity IDE**：通过 **Install from VSIX…** 安装 `antigrative-dashboard-ide-0.9.4.vsix`。
