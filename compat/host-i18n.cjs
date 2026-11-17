// Non-invasive runtime DOM localization for Antigravity host UI (no app.asar edits).
module.exports = function createHostTranslator(initialConfig = {}) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return { setConfig() {}, scan() {}, dispose() {} };
  }

  const EXACT = {"Choose a predefined security preset for the agent. This controls terminal auto-execution policy, and file access policy.":"为智能体选择预设安全策略。它会控制终端自动执行策略和文件访问策略。","Custom path for the browser user profile directory. Leave empty for default (~/.gemini/antigravity-browser-profile).":"浏览器用户资料目录的自定义路径。留空则使用默认路径（~/.gemini/antigravity-browser-profile）。","The app will be accessible from the menu bar and will keep running in the background when all windows are closed.":"应用可从菜单栏访问，并会在所有窗口关闭后继续在后台运行。","Reliable automation, in-depth debugging, and performance analysis in Chrome using Chrome DevTools and Puppeteer":"使用 Chrome DevTools 和 Puppeteer 在 Chrome 中进行可靠的自动化、深度调试和性能分析","We recommend attaching logs. Attaching logs will help the Antigravity team act on and prioritize your feedback.":"我们建议附上日志。附上日志将有助于 Antigravity 团队处理并优先解决您的反馈。","When enabled, the Changes Overview toolbar will automatically expand when Agent finishes generating a response.":"启用后，Changes Overview 工具栏将在智能体完成回复生成时自动展开。","Projects serve as your workspace where your agents work. Each project has its own file scope and permissions. ":"项目是智能体工作的工作区。每个项目都有自己的文件范围和权限。","Agents run in a secure sandbox that restricts access to external resources outside of your trusted folders.":"智能体会在安全沙盒中运行，限制其访问受信任文件夹之外的外部资源。","Terminal commands always require review and the agent cannot access files outside of its given workspaces.":"终端命令始终需要审核，且智能体无法访问其给定工作区之外的文件。","Developer-only tools. These settings are stored locally in this browser and do not affect other users.":"仅限开发者工具。这些设置保存在当前浏览器本地，不会影响其他用户。","to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.":"安装 Google Chrome。您可以在对话输入框中输入 /browser 来调用浏览器子智能体。","When enabled, Agent will show browser notifications when user action is needed or execution finishes.":"启用后，当需要用户操作或执行完成时，智能体将显示浏览器通知。","When toggled on, Antigravity IDE collects usage data to help Google enhance performance and features.":"开启后，Antigravity IDE 将收集使用数据，以帮助 Google 提升性能和功能。","Keep the app accessible from the menu bar and running in the background when all windows are closed.":"在所有窗口关闭后，保持应用可从菜单栏访问并在后台继续运行。","Modify scoped permissions, folders, and agent settings like Sandbox and Terminal Command Execution.":"修改作用域权限、文件夹，以及沙盒和终端命令执行等智能体设置。","Requires manual review for all terminal commands and file accesses outside of the working folders.":"对于所有工作文件夹之外的终端命令和文件访问，都需要手动审核。","When toggled on, Antigravity collects usage data to help Google enhance performance and features.":"开启后，Antigravity 会收集使用数据，帮助 Google 改进性能和功能。","Select one of the three options. Agent settings and permissions can be further customized below.":"选择以下三个选项之一。智能体设置和权限可在下方进一步自定义。","All terminal commands require review. The agent can read or write to any file in the machine.":"所有终端命令均需要审核。智能体可以读取或写入电脑上的任何文件。","Confirm the command is safe to run outside of the sandbox with full network and disk access.":"确认该命令可在沙盒外 safe 运行，并拥有完整网络和磁盘访问权限。","Port number for Chrome DevTools Protocol remote debugging. Leave empty for default (9222).":"Chrome DevTools Protocol 远程调试端口号。留空则使用默认值（9222）。","Try out early-stage features before they ship. These may change or be removed at any time.":"在正式发布前试用早期功能。这些功能可能随时更改或移除。","When enabled, the agent will be able to access past conversations to inform its responses.":"启用后，智能体将能够访问历史对话以辅助其生成回复。","Controls whether the agent can run custom JavaScript to automate complex browser actions.":"控制智能体是否可以运行自定义 JavaScript 来自动化复杂浏览器操作。","When enabled, Antigravity will play a sound when Agent finishes generating a response.":"启用后，Antigravity 会在智能体完成回复生成时播放提示音。","The browser subagent can be invoked by typing /browser in the conversation input box.":"你可以在对话输入框中输入 /browser 来调用浏览器子智能体。","Receive product updates, tips, and promotions from Google Antigravity IDE via email.":"通过电子邮件接收来自 Google Antigravity IDE 的产品更新、技巧和促销活动。","Predict the location of your next edit and navigates you there with a tab keypress.":"预测您下一次编辑的位置，并在按下 Tab 键时导航至该处。","Receive product updates, tips, and promotions from Google Antigravity via email.":"通过电子邮件接收 Google Antigravity 的产品更新、技巧和促销信息。","Configures how the agent tries to access files outside of its working folders.":"配置智能体如何访问工作文件夹之外的文件。","You can upgrade to a Google AI Ultra plan to receive the highest rate limits.":"你可以升级到 Google AI Ultra 套餐以获得最高速率限制。","Use Add MCP to browse the store, or add a custom server via the MCP config.":"使用“添加 MCP”浏览商店，或通过 MCP 配置文件添加自定义服务器。","Google3 chats will be regrouped into their workspaces in the sidebar. See":"Google3 聊天将在侧边栏中重新按其工作区分组。请参阅","Controls whether terminal commands require your approval before running.":"控制终端命令运行前是否需要你的批准。","Model must be available on the Gemini API and use the gemini-api scheme.":"模型必须可在 Gemini API 中使用，并使用 gemini-api 模式。","options. Agent settings and permissions can be further customized below.":"项之一。智能体设置和权限可在下方进一步自定义。","You can upgrade to a Google AI Ultra plan to receive higher rate limits.":"您可以升级到 Google AI Ultra 套餐以获得更高的速率限制。","Path to the Chrome/Chromium executable. Leave empty for auto-detection.":"Chrome/Chromium 可执行文件路径。留空则自动检测。","VCS used when generating a new workspace based off your initial prompt.":"根据您的初始提示词生成新工作区时使用的 VCS。","Inherits from global settings. Local permissions have higher priority.":"继承全局设置。本地权限优先级更高。","Jetski Chat configuration is not available in the current environment.":"当前环境中无法使用 Jetski Chat 配置。","Open in current window, Continue conversation in the current workspace":"在当前窗口打开，并在当前工作区继续对话","Agent settings and permissions for conversations outside of projects.":"为项目外对话配置智能体设置和权限。","Configure a chat bot so you can use Jetski directly from Google Chat.":"配置聊天机器人，以便直接从 Google Chat 使用 Jetski。","Google3 chats will be regrouped into their workspaces in the sidebar.":"Google3 聊天将在侧边栏中重新按其工作区分组。","Keep your coding agent up to date with the latest web best practices.":"让您的编码智能体始终与最新的 Web 最佳实践保持同步。","Configure agent execution, queued message delivery, and permissions.":"配置智能体执行、排队消息发送以及权限。","Allows the agent to access files outside of your current workspace.":"允许智能体访问当前工作区之外的文件。","External tools the agent can invoke via the Model Context Protocol.":"智能体可通过模型上下文协议 (MCP) 调用的外部工具。","To modify editor settings, open Settings within the editor window.":"要修改编辑器设置，请在编辑器窗口中打开设置。","Show \"Edit\" and \"Chat\" buttons when selecting text in the editor.":"在编辑器中选择文本时显示“编辑”和“聊天”按钮。","Add an MCP server above or add a custom one via the MCP Config.":"在上方添加 MCP 服务器，或通过 MCP 配置添加自定义服务器。","Agent settings and permissions can be further customized below.":"智能体设置和权限可在下方进一步自定义。","Agents have full access to your machine and external resources.":"智能体可完整访问你的电脑和外部资源。","Allow/deny agent write access to specific files or directories.":"允许或拒绝智能体写入指定文件或目录。","Configure allowed and denied URLs for browser action execution.":"配置允许和拒绝浏览器执行操作的 URL。","Configure tab completion, suggestions, and navigation behavior.":"配置 Tab 补全、建议和导航行为。","Highlight newly inserted text after accepting a Tab completion.":"在接受 Tab 补全后高亮显示新插入的文本。","Manage settings specific to Google CitC workspaces development.":"管理特定于 Google CitC 工作区开发的设置。","Allow/deny agent read access to specific files or directories.":"允许或拒绝智能体读取指定文件或目录。","Browse and enable plugins from the Build With Google catalog.":"从 Build With Google 目录中浏览并启用插件。","Configure allowed and denied paths for file reads and writes.":"配置允许和拒绝读写的文件路径。","External tools the agent can call via Model Context Protocol.":"智能体可通过 Model Context Protocol 调用的外部工具。","The agent will wait for you to install the browser extension.":"智能体会等待你安装浏览器扩展。","This migration may mess up your settings, chats, and sidebar.":"此迁移可能会影响您的设置、聊天记录和侧边栏。","Disables all safety barriers for maximal iteration velocity.":"禁用所有安全屏障，以获得最大的迭代速度。","Prevent the computer from sleeping while the app is running.":"应用运行时防止电脑进入睡眠。","Allow/deny agent browser actuation access to specific URLs.":"允许或拒绝智能体对指定 URL 执行浏览器操作。","Manage how Best of N sets up the workspace its arms run in.":"管理 Best of N 如何配置其各分支运行所在的工作区。","Open files in the background if Agent creates or edits them":"当智能体创建或编辑文件时，在后台打开这些文件","Restricts agent tools to a secure, isolated local sandbox.":"将智能体工具限制在安全隔离的本地沙盒中。","Allow/deny agent read access to specific URLs or domains.":"允许或拒绝智能体读取指定 URL 或域名。","Configure global allowed and denied resource permissions.":"配置全局允许和拒绝的资源权限。","Configure allowed and denied URLs for browser actuation.":"配置允许和拒绝浏览器执行操作的 URL。","Core tools and knowledge required to develop for Android":"开发 Android 应用所需的核心工具与知识","Allow/deny agent command execution outside the sandbox.":"允许或拒绝智能体在沙盒外执行命令。","Manage your plan, credentials, and general preferences.":"管理你的套餐、凭据和通用偏好设置。","Allow full browser script execution without prompting.":"允许完整的浏览器脚本执行而无需提示。","Configure the maximum width of the conversation panel.":"配置对话面板的最大宽度。","for more information (this migration is experimental).":"了解更多信息（此迁移为实验性功能）。","Sidebar after conversations are regrouped by workspace":"按工作区分组后的对话侧边栏","URLs the agent can perform actions on via the browser.":"智能体可以通过浏览器执行操作的 URL。","Configure default behaviors, skills, and MCP servers.":"配置默认行为、技能和 MCP 服务器。","Configure external tools via Model Context Protocol.":"配置通过 Model Context Protocol 使用的外部工具。","Keyboard shortcuts for quick navigation and control.":"用于快速导航和控制的键盘快捷键。","Prompt for approval before running browser scripts.":"运行浏览器脚本前请求批准。","Quickly add and update imports with a tab keypress.":"按下 Tab 键快速添加和更新导入。","Search for MCP servers to add to your configuration":"搜索要添加到配置中的 MCP 服务器","Using the Antigravity Python SDK to build AI agents":"使用 Antigravity Python SDK 构建 AI 智能体","Configure editor-specific behaviors and shortcuts.":"配置编辑器特有的行为和快捷键。","New standalone conversation, outside of projects.":"新建独立对话，不属于任何项目。","Display and preserve intermediate thinking steps":"显示并保留中间思考步骤","Import feature is not available in this context.":"当前上下文中无法使用导入功能。","Require review for all browser script execution.":"所有浏览器脚本执行都需要审核。","URLs the agent can actuate on using the browser.":"智能体可通过浏览器执行操作的 URL。","Commands the agent can run outside the sandbox.":"智能体可在沙盒外运行的命令。","Configure allowed commands outside the sandbox.":"配置允许在沙盒外运行的命令。","Curated collection of agent skills for science.":"为科学领域精心挑选的智能体技能集合。","Select light, dark, or inherit system settings.":"选择浅色、深色或继承系统设置。","URLs the agent can read or open in the browser.":"智能体可以在浏览器中读取或打开的 URL。","Configure allowed and denied URLs for reading.":"配置允许和拒绝读取的 URL。","Continue conversation in the current workspace":"在当前工作区继续对话","Agent needs permission to execute JavaScript":"智能体需要权限才能执行 JavaScript","Conversation copied as Markdown to clipboard":"对话已作为 Markdown 复制到剪贴板","Please list the steps to reproduce the issue":"请列出复现此问题的步骤","Quickly add and update imports with Tab key.":"按下 Tab 键快速添加和更新导入。","Search conversations (by name or Cascade ID)":"搜索对话（按名称或 Cascade ID）","% of the customization budget is available.":"% 的自定义预算可用。","broadcast Go Live, Click to run live server":"广播 Go Live，点击运行实时服务器","Configure the browser subagent. It requires":"配置浏览器子智能体。它需要","Configure when follow-up messages are sent.":"配置何时发送后续消息。","No customizations found for this workspace.":"此工作区没有找到自定义内容。","to back up your data and run the migration.":"备份数据并运行迁移。","Work with local agents from another device.":"从其他设备连接并使用本地智能体。","Antigravity would like to use the browser.":"Antigravity 想要使用浏览器。","Confirmation required to execute this step":"执行此步骤需要确认","Folder no longer exists or is unavailable.":"文件夹不再存在或不可用。","Show suggestions when typing in the editor":"在编辑器中输入时显示建议","Allow Tab to access .gitignore exclusions":"Tab 键访问 .gitignore 排除文件","Ask anything, @ to mention, / for actions":"想问什么都可以，@ 引用，/ 执行动作","Interrupt the agent and send immediately.":"打断智能体并立即发送。","Configure AI models and view your quota.":"配置 AI 模型并查看额度。","Terminal commands the agent can execute.":"智能体可执行的终端命令。","Block all browser JavaScript execution.":"阻止所有浏览器 JavaScript 执行。","Explain and Fix in Current Conversation":"在当前对话中解释并修复","GCP Project ID for enterprise features.":"适用于企业级功能的 GCP 项目 ID。","Local permissions have higher priority.":"本地权限优先级更高。","Manually customize individual settings.":"手动自定义各项设置。","Allow/deny specific terminal commands.":"允许或拒绝指定终端命令。","Google Drive integration not available":"Google 云端硬盘集成不可用","No (tell the agent what to do instead)":"否（告诉智能体改做什么）","Manage your notification preferences.":"管理您的通知偏好设置。","Outside of folders file access policy":"文件夹外访问策略","Select where to open the conversation":"选择在哪里打开对话","Configure allowed terminal commands.":"配置允许的终端命令。","Manage your model quota and credits.":"管理您的模型额度与积分。","(tell the agent what to do instead)":"（告诉智能体改做什么）","Browser Javascript Execution Policy":"浏览器 JavaScript 执行策略","Browser JavaScript Execution Policy":"浏览器 JavaScript 执行策略","By using this app, you agree to its":"使用本应用即表示你同意其","Describe the bug you encountered...":"描述您遇到的错误...","Enter command (e.g., git, blaze)...":"输入命令（例如 git、blaze）...","Loading workspace customizations...":"正在加载工作区自定义项...","Queue until after the current turn.":"排队直到当前轮次结束后发送。","Set how fast Tab suggestions appear":"设置 Tab 建议的显示速度","Build with Antigravity IDE Plugins":"使用 Antigravity IDE 插件构建","Search for files in the project...":"在项目中搜索文件...","Initializing virtual environments":"正在初始化虚拟环境","Open Agent panel on window reload":"窗口重新加载时打开智能体面板","Manage Antigravity app settings.":"管理 Antigravity 应用设置。","Select one of the three options.":"选择以下三个选项之一。","Set the speed of tab suggestions":"设置 Tab 建议的显示速度","Agent Non-Workspace File Access":"智能体非工作区文件访问","Enter file or directory path...":"输入文件或目录路径...","Search by name or Cascade ID...":"按名称或 Cascade ID 搜索...","Terminal Command Auto Execution":"终端命令自动执行","Welcome to the new Antigravity!":"欢迎使用新版 Antigravity！","Attach a screenshot (optional)":"附上截图（可选）","Attach Antigravity server logs":"附上 Antigravity 服务端日志","Attach Antigravity Server Logs":"附上 Antigravity 服务端日志","Enable notifications for Agent":"为智能体启用通知","Getting started with a Project":"开始使用项目","Refresh quota and credits data":"刷新额度和积分数据","Terminal & Tooling Permissions":"终端与工具权限","Enable Sandbox Mode (Preview)":"启用沙盒模式（预览）","New Conversation in Workspace":"在工作区中新建对话","Undo changes up to this point":"撤销到此处的更改","Allow List Terminal Commands":"终端命令允许列表","Auto-Expand Changes Overview":"自动展开更改概览","Download the Antigravity IDE":"下载 Antigravity IDE","Enter tool name or server...":"输入工具名称或服务器...","Manage application settings.":"管理应用设置。","Select Model to Send Message":"选择用于发送消息的模型","Steps to reproduce the issue":"重现此问题的步骤","Allow running this command?":"允许运行此命令？","Confirm Browser Interaction":"确认浏览器交互","Deny List Terminal Commands":"终端命令拒绝列表","Enter avatar URL (optional)":"输入头像 URL（可选）","Explore the new Antigravity":"探索新版 Antigravity","Generate CitC Workspace VCS":"生成 CitC 工作区 VCS","New Conversation in Project":"在项目中新建对话","Paths the agent can modify.":"智能体可修改的路径。","Agent Auto-Fix Lint Errors":"智能体自动修复 Lint 错误","Click to copy full command":"点击复制完整命令","Copy conversation markdown":"复制对话 Markdown","Copy full URL to clipboard":"复制完整 URL 到剪贴板","Search MCP servers by name":"按名称搜索 MCP 服务器","Archive this conversation":"归档此对话","Browser User Profile Path":"浏览器用户资料路径","Build With Google Plugins":"使用 Google 插件构建","Built with Google Plugins":"使用 Google 插件构建","Enable AI Credit Overages":"启用 AI 积分超额使用","Enter bot name (optional)":"输入机器人名称（可选）","Five Hour Limit Remaining":"剩余 5 小时限额","Open Conversation History":"打开对话历史","Paths the agent can read.":"智能体可读取的路径。","Project validation failed":"项目验证失败","Project-Specific Settings":"项目专属设置","Select Python Interpreter":"选择 Python 解释器","Toggle Agent (Ctrl+Alt+B)":"切换智能体 (Ctrl+Alt+B)","Any relevant information":"任何相关信息","Commands Outside Sandbox":"沙盒外命令","Current sidebar grouping":"当前侧边栏分组方式","Editor-Specific Settings":"编辑器专属设置","Enable Shell Integration":"启用 Shell 集成","Import AI Studio Project":"导入 AI Studio 项目","Launching the browser...":"正在启动浏览器...","No MCP servers installed":"未安装 MCP 服务器","Open Conversation Picker":"打开对话选择器","Project name. E.g. Tasks":"项目名称，例如 Tasks","Workspace Command Access":"工作区命令访问","Your Plan: Google AI Pro":"你的套餐：Google AI Pro","Advanced Command Access":"高级命令访问","Automatic update checks":"自动检查更新","Back to Scheduled Tasks":"返回定时任务","Browser Actuation Rules":"浏览器操作规则","Deny setting up browser":"拒绝设置浏览器","Edit Conversation Title":"编辑对话标题","Enable Sounds for Agent":"启用智能体提示音","Marketplace Gallery URL":"插件市场列表 URL","Open Keyboard Shortcuts":"打开键盘快捷键","Open System Preferences":"打开系统设置","Open Workspace Selector":"打开工作区选择器","Queued Message Delivery":"排队消息发送","Search conversations...":"搜索对话...","Standalone Conversation":"独立对话","Artifact Review Policy":"产物审核策略","Auto-Open Edited Files":"自动打开已编辑文件","Background Task Output":"后台任务输出","Copy the trajectory ID":"复制轨迹 ID","Edit permission target":"编辑权限目标","Highlight After Accept":"接受后高亮","Loading MCP servers...":"正在加载 MCP 服务器...","Loading token usage...":"正在加载 Token 用量...","Marketplace Search URL":"插件市场列表 URL","Model Context Protocol":"模型上下文协议 (MCP)","My Custom Gemini Model":"我的自定义 Gemini 模型","No more older messages":"没有更多历史消息","Open Browser (Preview)":"打开浏览器 (预览)","Opening URL in Browser":"正在浏览器中打开 URL","quota and credits data":"额度和积分数据","Search across files...":"跨文件搜索...","Show Selection Actions":"显示选择操作","Toggle Developer Tools":"切换开发者工具","Toggle Voice Recording":"切换语音录制","Weekly Limit Remaining":"剩余周额度","Actuation Permissions":"操作权限","Allow in Conversation":"在本次对话中允许","Auto-Execution Policy":"自动执行策略","Claude and GPT models":"Claude 和 GPT 模型","Claude and GPT Models":"Claude 和 GPT 模型","Enable Remote Control":"启用远程控制","Experimental features":"实验性功能","Experimental Features":"实验性功能","Installed MCP Servers":"已安装的 MCP 服务器","Model quota exhausted":"模型额度已耗尽","Notification Settings":"通知设置","Open project settings":"打开项目设置","Opened URL in Browser":"已在浏览器中打开 URL","Regroup Google3 Chats":"重新对 Google3 聊天分组","Start Voice Recording":"开始语音录制","Suggestions in Editor":"编辑器内联建议","Toggle Auxiliary Pane":"切换辅助面板","Toggle Model Selector":"切换模型选择器","Workspace File Access":"工作区文件访问","[Dev] GCP Project ID":"[开发] GCP 项目 ID","Advanced File Access":"高级文件访问","Agent Auto-Fix Lints":"智能体自动修复 Lint 错误","Archive Conversation":"归档对话","Conversation History":"对话历史","Enable Browser Tools":"启用浏览器工具","Enter URL pattern...":"输入 URL 匹配模式...","Go Explorer: Refresh":"Go 资源管理器: 刷新","Marketplace Item URL":"插件市场单项 URL","Network Access Rules":"网络访问规则","No conversations yet":"暂无对话","Open Agent on Reload":"重新加载时打开智能体","Open Command Palette":"打开命令面板","Pinned Conversations":"置顶对话","Restore Conversation":"恢复对话","Search all convos...":"搜索全部对话...","Stop Voice Recording":"停止语音录制","Tab Gitignore Access":"Tab 键访问 .gitignore 排除文件","Yes, allow this time":"是，仅允许本次","Advanced Web Access":"高级网页访问","Agent security mode":"智能体安全模式","Conversation picker":"对话选择器","Delete Conversation":"删除对话","Follow the guide at":"请按照以下指南","Loading Antigravity":"正在加载 Antigravity","Model quota reached":"模型额度已达上限","Modern Web Guidance":"现代 Web 开发指南","Network Permissions":"网络权限","Open Project Picker":"打开项目选择器","Open System Browser":"在系统浏览器中打开","Other Conversations":"其他对话","Parent Conversation":"父对话","Pinned Conversation":"已固定对话","Add Scheduled Task":"添加定时任务","Alphabetical (A-Z)":"按字母顺序 (A-Z)","Analyzing Task Log":"正在分析任务日志","Any error messages":"任何错误信息","Autocomplete Speed":"补全速度","Best of N Settings":"Best of N 设置","Chrome Binary Path":"Chrome 可执行文件路径","Conversation Width":"对话宽度","Copy trajectory ID":"复制轨迹 ID","Create New Project":"创建新项目","Creating a Project":"正在创建项目","Delete Permanently":"永久删除","Keyboard shortcuts":"键盘快捷键","Keyboard Shortcuts":"键盘快捷键","New Scheduled Task":"新建定时任务","Outside of Project":"项目外","Previous Worktrees":"以前的工作树","Proceed in Sandbox":"在沙盒中继续","Search projects...":"搜索项目...","Sort Conversations":"排序对话","Steps to Reproduce":"重现步骤","Unpin Conversation":"取消固定对话","Verbose agent chat":"详细智能体聊天","Verbose Agent Chat":"详细智能体聊天","Workspace Settings":"工作区设置","Add to Chat/Quote":"添加到聊天/引用","Advanced Settings":"高级设置","Analyzed Task Log":"已分析任务日志","Archive / Restore":"归档 / 恢复","Automatic updates":"自动检查更新","Automatic Updates":"自动检查更新","Build With Google":"使用 Google 构建","Check for Updates":"检查更新","Copy Project Name":"复制项目名称","Copy sign-in link":"复制登录链接","Copy to clipboard":"复制到剪贴板","Edit Custom Model":"编辑自定义模型","Expected behavior":"预期行为","File Access Rules":"文件访问规则","No agents running":"没有正在运行的代理","No Model Selected":"未选择模型","No projects found":"未找到项目","Open Conversation":"打开对话","Previous Pane Tab":"上一个面板标签页","Record voice memo":"录制语音备忘","Select one of the":"选择以下","Setup Jetski Chat":"配置 Jetski 聊天","Sort Conversation":"排序对话","Terminal Commands":"终端命令","Add Custom Model":"添加自定义模型","Auth and Billing":"身份验证与账单","Background Tasks":"后台任务","Best of N Models":"Best of N 模型","Browser CDP Port":"浏览器 CDP 端口","Cancel All Tasks":"取消全部任务","Create a Project":"创建项目","Enable Demo Mode":"启用演示模式","Enable Telemetry":"启用遥测","File Permissions":"文件权限","General Feedback":"一般反馈","Keep In Menu Bar":"保留在菜单栏","Marketing Emails":"营销邮件","New conversation":"新建对话","New Conversation":"新建对话","No conversations":"暂无对话","Open Preferences":"打开偏好设置","Pin Conversation":"固定对话","Project Detected":"检测到项目","Project Settings":"项目设置","Provide Feedback":"提供反馈","Send Immediately":"立即发送","Terms of Service":"服务条款","1 agent running":"1 个代理正在运行","Actual behavior":"实际行为","Actuation Rules":"操作规则","Background Task":"后台任务","Code with Agent":"与智能体协作编码","Command Palette":"命令面板","Copy debug info":"复制调试信息","Display Options":"显示选项","Editor Settings":"编辑器设置","Feature Request":"功能请求","Five Hour Limit":"5 小时限额","For help, visit":"如需帮助，请访问","global settings":"全局设置","Import success:":"导入成功：","Layout Controls":"布局控制","Message history":"消息历史","Missing Folders":"缺失文件夹","Open MCP Config":"打开 MCP 配置","Package Outline":"包大纲","Project Folders":"项目文件夹","Project General":"项目常规","Queued Messages":"排队消息","Scheduled Tasks":"定时任务","Search files...":"搜索文件...","Search tasks...":"搜索任务...","Security Preset":"安全预设","Toggle Terminal":"切换终端","Agent Behavior":"智能体行为","Agent response":"智能体回复","Always Proceed":"始终继续","Auto Execution":"自动执行","Copy File Name":"复制文件名","Copy File Path":"复制文件路径","Create Project":"创建项目","Delete Project":"删除项目","Go to Projects":"前往项目","Import failed:":"导入失败：","Inline Actions":"内联操作","Mark as Unread":"标记为未读","Mark As Unread":"标记为未读","Missing Folder":"缺失文件夹","Models & Usage":"模型与用量","No MCP Servers":"没有 MCP 服务器","Not in Project":"未在项目中","Open window...":"打开窗口...","Open Workspace":"打开工作区","Opened browser":"已打开浏览器","Proceeded with":"已执行","Project picker":"项目选择器","Remote Control":"远程控制","Request Review":"请求审核","Require Review":"需要审核","Review Changes":"审核更改","Select Project":"选择项目","Toggle Sidebar":"切换侧边栏","Typeahead menu":"智能联想菜单","View Changelog":"查看更新日志","Agent Decides":"由智能体决定","Allow options":"允许选项","Chat Settings":"聊天设置","CitC Settings":"CitC 设置","Default Light":"默认浅色","Feedback Type":"反馈类型","Gemini Models":"Gemini 模型","Good response":"好评","Inherits from":"继承自","Message input":"消息输入框","Model Credits":"模型积分","New Workspace":"新建工作区","Next Pane Tab":"下一个面板标签页","Open in Cider":"在 Cider 中打开","Open Settings":"打开设置","Prevent Sleep":"防止睡眠","Project Agent":"项目智能体","Reload Window":"重新加载窗口","Review Policy":"审核策略","Send Feedback":"发送反馈","Tab to Import":"按下 Tab 导入","Toggle Editor":"切换编辑器","Always Allow":"始终允许","App Settings":"应用设置","Bad response":"差评","Browser Task":"浏览器任务","Close Folder":"关闭文件夹","Confirm Quit":"确认退出","Copy Command":"复制命令","Copy Content":"复制内容","Default Dark":"默认深色","Disable Task":"禁用任务","Execute URLs":"执行 URL","Find in Pane":"在面板中查找","Full machine":"整机访问","Last Updated":"最近更新","Mark as Read":"标记为已读","Mark As Read":"标记为已读","More actions":"更多操作","New Worktree":"新建工作树","Record Audio":"录制音频","Restart Task":"重启任务","Select Model":"选择模型","Send message":"发送消息","Toggle Agent":"切换智能体","User message":"用户消息","Weekly Limit":"周额度","Add context":"添加上下文","Cancel Task":"取消任务","Copy prompt":"复制提示词","Delete Task":"删除任务","Enable Task":"启用任务","File Access":"文件访问","File Writes":"文件写入","Focus Input":"聚焦输入框","Full access":"完全访问","Get Started":"开始使用","Jetski Chat":"Jetski 聊天","Last Prompt":"上次提示词","Light Theme":"浅色主题","Model Quota":"模型额度","New Project":"新建项目","No Subtitle":"无副标题","Open Folder":"打开文件夹","Quick Start":"快速开始","Tab to Jump":"按下 Tab 跳转","Token Usage":"Token 使用量","Write Files":"写入文件","Add Folder":"添加文件夹","Allow once":"允许一次","Allow Once":"允许一次","Always Ask":"始终询问","Avatar URL":"头像 URL","Bug Report":"错误报告","Dark Theme":"深色主题","Date Added":"添加日期","Edit Model":"编辑模型","File Reads":"文件读取","Go Forward":"前进","Learn more":"了解更多","No Project":"无项目","Quick Open":"快速打开","Read Files":"读取文件","Reset Zoom":"重置缩放","Tab Import":"按下 Tab 导入","Turbo mode":"极速模式","View Debug":"查看调试信息","Working...":"正在处理...","Add Model":"添加模型","Copy path":"复制路径","Copy Path":"复制路径","MCP Tools":"MCP 工具","Read URLs":"读取 URL","Tab Speed":"Tab 补全速度","Bot Name":"机器人名称","Group By":"分组方式","Open App":"打开应用","Open URL":"打开 URL","See less":"收起","Show all":"显示全部","Sign Out":"退出登录","Zoom Out":"缩小","Add MCP":"添加 MCP","Go Back":"后退","Go Live":"实时预览 (Go Live)","Zoom In":"放大","Log in":"登录","Settings":"设置","Sidebar":"侧边栏","Automations":"自动化","Customizations":"自定义配置","Conversations":"对话列表","Projects":"项目","Permissions":"权限","Plugins":"插件","Skills":"技能","Rules":"规则","Workflows":"工作流","Notifications":"通知","Appearance":"外观","Shortcuts":"快捷键","Marketplace":"插件市场","Knowledge":"知识库","Feedback":"反馈","Account":"账户","Working":"正在处理","Working…":"正在处理…","Running":"运行中","Completed":"已完成","Cancelled":"已取消","Canceled":"已取消","Archived":"已归档","Proceed":"继续","Confirm":"确认","Cancel":"取消","Dismiss":"忽略","Copy":"复制","Rename":"重命名","Archive":"归档","Unarchive":"取消归档","Delete":"删除","Refresh":"刷新","Submit":"提交","Save":"保存","Reset":"重置","Search":"搜索","Filter":"筛选","Download":"下载","Export":"导出","Import":"导入","Maximize":"最大化","Minimize":"最小化","Upgrade":"升级","Loading...":"加载中...","Loading…":"加载中…","Project options":"项目选项","More options":"更多选项","Pinned Actions":"固定操作","Archive conversation":"归档对话","Pin conversation":"置顶对话","Unpin conversation":"取消置顶对话","Stop execution":"停止执行","Toggle Side Panel":"切换侧边面板","Toggle Overview Panel":"切换概览面板","Search Conversations":"搜索对话","Conversation Log":"对话日志","Conversation turns":"对话轮次","Agent said":"智能体回复","Agent working":"智能体正在工作","Load older messages":"加载更多历史消息","Undo to this point":"撤销到此处","Scroll to Bottom":"滚动到底部","Queued messages":"排队消息","Collapse queued messages":"折叠排队消息","Start Voice mode":"开启语音模式","Cancel (⌃C)":"取消 (⌃C)","New tab":"新标签页","Side Panel":"侧边面板","Side Question":"侧边提问","Side Question header":"侧边提问标题栏","Stop side question":"停止侧边提问","Promote to conversation":"提升为主对话","Delete side question":"删除侧边提问","Maximize Pane":"最大化面板","just now":"刚刚","Planning":"规划模式","Fast":"快速模式","Task running":"任务运行中","Subagent running":"子代理运行中","No background tasks running":"当前无后台任务运行","Copied":"已复制","Copied!":"已复制！","Copy code":"复制代码","Accept":"接受","Reject":"拒绝","Accept all":"全部接受","Reject all":"全部拒绝","Allow":"允许","Deny":"拒绝","Allow Always":"始终允许","Review changes":"查看更改","View diff":"查看差异","Apply":"应用","Stop":"停止","Sending...":"发送中..."};

  const PATTERNS = [
    [/^Worked for (\d+)\s*s$/i, (_, s) => `已执行 ${s} 秒`],
    [/^Worked for (\d+)\s*m(?:\s*(\d+)\s*s)?$/i, (_, m, s) => s ? `已执行 ${m} 分 ${s} 秒` : `已执行 ${m} 分钟`],
    [/^Worked for (\d+)\s*h(?:\s*(\d+)\s*m)?$/i, (_, h, m) => m ? `已执行 ${h} 小时 ${m} 分` : `已执行 ${h} 小时`],
    [/^Thought for (\d+)\s*s$/i, (_, s) => `已思考 ${s} 秒`],
    [/^Thought for (\d+)\s*m(?:\s*(\d+)\s*s)?$/i, (_, m, s) => s ? `已思考 ${m} 分 ${s} 秒` : `已思考 ${m} 分钟`],
    [/^(\d+)\s+(?:background\s+)?tasks?\s+running$/i, (_, n) => `${n} 个任务运行中`],
    [/^(\d+)\s+subagents?\s+running$/i, (_, n) => `${n} 个子代理运行中`],
    [/^Turn (\d+) of (\d+)$/i, (_, a, b) => `第 ${a} / ${b} 轮`],
    [/^(\d+)\s*m\s+ago$/i, (_, n) => `${n} 分钟前`],
    [/^(\d+)\s*h\s+ago$/i, (_, n) => `${n} 小时前`],
    [/^(\d+)\s*d\s+ago$/i, (_, n) => `${n} 天前`],
    [/^(\d+)\s+minutes?\s+ago$/i, (_, n) => `${n} 分钟前`],
    [/^(\d+)\s+hours?\s+ago$/i, (_, n) => `${n} 小时前`],
    [/^(\d+)\s+days?\s+ago$/i, (_, n) => `${n} 天前`],
    [/^Load older messages,\s*showing (\d+) of (\d+)$/i, (_, a, b) => `加载更多历史消息（已显示 ${a} / ${b} 条）`],
    [/^No more older messages,\s*showing (\d+) of (\d+)$/i, (_, a, b) => `没有更多历史消息（共显示 ${a} / ${b} 条）`],
    [/^Select model,\s*current:\s*(.+)$/i, (_, m) => `选择模型，当前：${m}`],
    [/^Agent permissions preset selector,\s*current:\s*(.+)$/i, (_, p) => `智能体权限预设，当前：${p}`],
    [/^Side Question:\s*(.+)$/i, (_, q) => `侧边提问：${q}`],
    [/^Edit side question title:\s*(.+)$/i, (_, q) => `编辑侧边提问标题：${q}`],
    [/^Opens external link:\s*(.+)$/i, (_, u) => `打开外部链接：${u}`],
    [/^Running\s+(.+)$/, (_, task) => `正在运行 ${task}`],
    [/^Started from\s*[“"](.+)[”"]$/, (_, src) => `从 “${src}” 启动`],
    [/^Close\s+(.+)$/, (_, name) => `关闭 ${name}`],
  ];

  const S2T = {
    '设':'設','对':'對','话':'話','项':'項','权':'權','限':'限','终':'終','确':'確','认':'認','执':'執',
    '运':'運','开':'開','启':'啟','动':'動','关':'關','闭':'閉','删':'刪','编':'編','辑':'輯','归':'歸',
    '档':'檔','搜':'搜','显':'顯','选':'選','择':'擇','请':'請','响':'響','应':'應','输':'輸','复':'複',
    '制':'製','销':'銷','滚':'滾','队':'隊','叠':'疊','录':'錄','语':'語','备':'備','侧':'側','边':'邊',
    '栏':'欄','标':'標','签':'籤','页':'頁','为':'為','观':'觀','捷':'捷','键':'鍵','规':'規','则':'則',
    '历':'歷','记':'記','评':'評','馈':'饋','账':'帳','户':'戶','额':'額','积':'積','钟':'鐘','时':'時',
    '条':'條','当':'當','总':'總','轮':'輪','链':'鏈','杂':'雜','体':'體','处':'處','组':'組','区':'區',
    '树':'樹','夹':'夾','网':'網','络':'絡','错':'錯','误':'誤','问':'問','题':'題','览':'覽','调':'調',
    '试':'試','级':'級','载':'載','导':'導','换':'換','点':'點','击':'擊','图':'圖','简':'簡','读':'讀',
    '写':'寫','许':'許','绝':'絕','断':'斷','继':'繼','续':'續','过':'過','败':'敗','连':'連','线':'線',
    '发':'發','隐':'隱','顶':'頂','务':'務','个':'個','与':'與','仅':'僅','单':'單','参':'參','号':'號',
    '台':'臺','实':'實','审':'審','将':'將','属':'屬','帮':'幫','广':'廣','库':'庫','异':'異','态':'態',
    '扩':'擴','扫':'掃','报':'報','据':'據','数':'數','无':'無','来':'來','构':'構','极':'極','检':'檢',
    '欢':'歡','汉':'漢','测':'測','浏':'瀏','浅':'淺','满':'滿','滤':'濾','独':'獨','环':'環','现':'現',
    '电':'電','盘':'盤','离':'離','类':'類','纠':'糾','约':'約','经':'經','结':'結','给':'給','统':'統',
    '维':'維','缓':'緩','联':'聯','补':'補','装':'裝','视':'視','觉':'覺','计':'計','议':'議','访':'訪',
    '证':'證','词':'詞','详':'詳','询':'詢','该':'該','说':'說','资':'資','贴':'貼','费':'費','转':'轉',
    '软':'軟','轻':'輕','较':'較','辅':'輔','达':'達','还':'還','这':'這','进':'進','远':'遠','适':'適',
    '遗':'遺','邻':'鄰','针':'針','钮':'鈕','锁':'鎖','长':'長','门':'門','闲':'閒','间':'間','阅':'閱',
    '随':'隨','难':'難','顺':'順','须':'須','顾':'顧','预':'預','领':'領','风':'風','飞':'飛','验':'驗',
    '齐':'齊','码':'碼','节':'節','范':'範','获':'獲','创':'創','协':'協','双':'雙','变':'變','听':'聽',
    '机':'機','暂':'暫','旧':'舊','统':'統','护':'護','举':'舉','挡':'擋','挥':'揮','损':'損','携':'攜',
    '摄':'攝','摆':'擺','热':'熱','产':'產','画':'畫','稳':'穩','竞':'競','笔':'筆','纸':'紙','细':'細',
    '织':'織','绕':'繞','绘':'繪','绩':'績','绿':'綠','缩':'縮','见':'見','触':'觸','订':'訂','讨':'討',
    '让':'讓','讲':'講','论':'論','识':'識','译':'譯','课':'課','谈':'談','谢':'謝','负':'負','财':'財',
    '责':'責','贵':'貴','赞':'讚','车':'車','运':'運'
  };

  function toTW(str) {
    let out = '';
    for (const ch of str) out += S2T[ch] || ch;
    return out;
  }

  let enabled = Boolean(initialConfig.enabled);
  let language = initialConfig.language === 'zh-TW' ? 'zh-TW' : (initialConfig.language === 'en' ? 'en' : 'zh-CN');
  let disposed = false;
  let mutating = false;
  let scheduled = false;
  const pendingRoots = new Set();
  const textOriginals = new WeakMap();
  const attrOriginals = new WeakMap();
  const textLastTr = new WeakMap();
  const attrLastTr = new WeakMap();
  const trackedTexts = new Set();
  const trackedAttrs = new Set();

  function translateText(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 180 || !/[A-Za-z]/.test(trimmed)) return null;
    let zh = EXACT[trimmed] || null;
    if (!zh) {
      for (const [re, fn] of PATTERNS) {
        const m = trimmed.match(re);
        if (m) {
          zh = fn(...m);
          break;
        }
      }
    }
    if (!zh) return null;
    if (language === 'zh-TW') zh = toTW(zh);
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const tail = raw.slice(raw.trimEnd().length);
    return lead + zh + tail;
  }

  function skipElement(el, forAttr = false) {
    if (!el || el.nodeType !== 1) return true;
    if (el.closest('#ag-pulse-status-bar,.ag-pulse-inline-chat-host,pre,code,kbd,samp,script,style,noscript,svg,.monaco-editor,.xterm,.CodeMirror')) return true;
    if (!forAttr) {
      if (el.closest('[contenteditable="true"],textarea,input,[data-testid="model-selector-trigger"],[data-testid="agent-response"] .prose,[data-testid="agent-response"] .markdown,[data-testid="user-message"],[data-message-role="user"]')) return true;
    }
    return false;
  }

  function processTextNode(node) {
    if (!node || node.nodeType !== 3 || !node.isConnected) return;
    const parent = node.parentElement;
    if (skipElement(parent, false)) return;
    if (!textOriginals.has(node)) {
      const val = node.nodeValue;
      const tr = translateText(val);
      if (!tr || tr === val) return;
      textOriginals.set(node, val);
      textLastTr.set(node, tr);
      trackedTexts.add(node);
      if (enabled) {
        node.nodeValue = tr;
      }
      return;
    }
    const orig = textOriginals.get(node);
    const prevTr = textLastTr.get(node);
    const current = node.nodeValue;
    if (!enabled) {
      if (current !== orig) node.nodeValue = orig;
      return;
    }
    const target = translateText(orig);
    if (target && current !== target) {
      if (current === orig || current === prevTr) {
        textLastTr.set(node, target);
        node.nodeValue = target;
      } else {
        // Host framework replaced text with a different original string
        const curTranslated = translateText(current);
        if (curTranslated) {
          textOriginals.set(node, current);
          textLastTr.set(node, curTranslated);
          node.nodeValue = curTranslated;
        }
      }
    }
  }

  const ATTRS = ['aria-label', 'placeholder', 'title'];
  function processElementAttrs(el) {
    if (skipElement(el, true)) return;
    let map = attrOriginals.get(el);
    let lastMap = attrLastTr.get(el);
    for (const attr of ATTRS) {
      const cur = el.getAttribute(attr);
      if (cur == null) continue;
      if (!map || !(attr in map)) {
        const tr = translateText(cur);
        if (!tr || tr === cur) continue;
        if (!map) {
          map = Object.create(null);
          attrOriginals.set(el, map);
          trackedAttrs.add(el);
        }
        if (!lastMap) {
          lastMap = Object.create(null);
          attrLastTr.set(el, lastMap);
        }
        map[attr] = cur;
        lastMap[attr] = tr;
        if (enabled) el.setAttribute(attr, tr);
      } else {
        const orig = map[attr];
        const prevTr = lastMap?.[attr];
        if (!enabled) {
          if (cur !== orig) el.setAttribute(attr, orig);
        } else {
          const target = translateText(orig);
          if (target && cur !== target) {
            if (cur === orig || cur === prevTr) {
              if (!lastMap) {
                lastMap = Object.create(null);
                attrLastTr.set(el, lastMap);
              }
              lastMap[attr] = target;
              el.setAttribute(attr, target);
            } else {
              const curTr = translateText(cur);
              if (curTr) {
                map[attr] = cur;
                if (!lastMap) {
                  lastMap = Object.create(null);
                  attrLastTr.set(el, lastMap);
                }
                lastMap[attr] = curTr;
                el.setAttribute(attr, curTr);
              }
            }
          }
        }
      }
    }
  }

  function walkSubtree(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      processTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    if (skipElement(root, true)) return;
    processElementAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) processTextNode(node);
      else if (node.nodeType === 1) processElementAttrs(node);
    }
  }

  function restoreAll() {
    mutating = true;
    try {
      for (const ref of Array.from(trackedTexts)) {
        if (!ref.isConnected) { trackedTexts.delete(ref); continue; }
        const orig = textOriginals.get(ref);
        if (orig !== undefined && ref.nodeValue !== orig) ref.nodeValue = orig;
      }
      for (const el of Array.from(trackedAttrs)) {
        if (!el.isConnected) { trackedAttrs.delete(el); continue; }
        const map = attrOriginals.get(el);
        if (!map) continue;
        for (const attr of ATTRS) {
          if (attr in map && el.getAttribute(attr) !== map[attr]) {
            el.setAttribute(attr, map[attr]);
          }
        }
      }
    } finally {
      mutating = false;
    }
  }

  function flush() {
    scheduled = false;
    if (disposed || !document.body) return;
    if (!enabled) {
      restoreAll();
      pendingRoots.clear();
      return;
    }
    mutating = true;
    try {
      if (pendingRoots.size === 0) {
        walkSubtree(document.body);
      } else {
        const roots = Array.from(pendingRoots);
        pendingRoots.clear();
        for (const r of roots) walkSubtree(r);
      }
    } finally {
      mutating = false;
    }
  }

  function schedule(target) {
    if (disposed) return;
    if (target) pendingRoots.add(target);
    if (scheduled) return;
    scheduled = true;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn => setTimeout(fn, 16));
    raf(flush);
  }

  const observer = new MutationObserver(records => {
    if (mutating || disposed || !enabled) return;
    for (const r of records) {
      if (r.type === 'characterData') {
        pendingRoots.add(r.target);
      } else if (r.type === 'attributes') {
        pendingRoots.add(r.target);
      } else if (r.type === 'childList') {
        for (const n of r.addedNodes) pendingRoots.add(n);
      }
    }
    if (pendingRoots.size > 0) schedule();
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
    if (enabled) schedule(document.body);
  }

  return {
    setConfig(next = {}) {
      if (disposed) return;
      const nextEnabled = Boolean(next.enabled);
      const nextLang = next.language === 'zh-TW' ? 'zh-TW' : (next.language === 'en' ? 'en' : 'zh-CN');
      const changed = nextEnabled !== enabled || nextLang !== language;
      enabled = nextEnabled;
      language = nextLang;
      if (changed) {
        if (!enabled) {
          restoreAll();
        } else {
          pendingRoots.clear();
          schedule(document.body);
        }
      }
    },
    scan() {
      if (!disposed && enabled && document.body) {
        pendingRoots.clear();
        schedule(document.body);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      pendingRoots.clear();
      restoreAll();
    }
  };
};
