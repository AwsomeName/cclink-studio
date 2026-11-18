# 当前代码入口盘点与目标归属

日期：2026-11-18。代码基线：`d50a5dae`。仅为产品设计盘点，不代表每项已经重新运行验收。

此文件记录现有入口，防止重组时只覆盖截图里的大按钮。目标归属已按 2026-11-18 用户最新定义修订：项目类型封装首页和业务功能，工作模式是独立于项目类型的工作版面。目标归属均是提案；不删除原入口、不修改原资料。

## ActivityPanel：17 项

| 当前 ID | 目标归属 |
| --- | --- |
| `workspace-home` | 工作台入口；项目类型首页 |
| `projects` | 工作台选择器/历史入口（兼容类型） |
| `browser` | 通用浏览器工具与标签 |
| `files` | 工作台共用资料 |
| `data-sources` | 连接进设置；查询/结果留资料工具 |
| `company-accounts` | 公司类型功能 → 账目 |
| `company-workspace` | 公司类型功能 → 总览与业务对象 |
| `video-creation` | 内容业务功能 → 视频创作（保留新版/旧版边界） |
| `production` | 电子开发类型 → 检查/报告 |
| `terminal` | 工具抽屉/标签 |
| `operations` | 账号管理进设置；使用入口留任务与浏览器 |
| `affairs` | 任务与运行/业务流程 |
| `article-publishing` | 内容业务功能 → 文章发布 |
| `sessions` | 工作台助手与会话列表 |
| `agent-roles` | 角色管理进设置；选择留会话 |
| `scheduled-tasks` | 工作台 → 任务与运行 |
| `cclink` | 连接进设置/工作台选择器；使用留远程工作台 |

## TabType：24 项

| 当前 ID | 目标归属 |
| --- | --- |
| `workspace-home` | 项目类型首页 |
| `browser` | 网页工作版面/浏览器工具 |
| `editor` | 共享文档编辑器 |
| `settings` | 应用或当前工作台设置（明确作用域） |
| `preview` | 文档派生预览（如微信排版） |
| `file-preview` | 按格式只读预览/降级 |
| `android` | 工具 → 真机画面 |
| `model` | 3D 工作版面/模型查看工具 |
| `conversation` | 工作台会话（可作为标签） |
| `remote-conversation` | 远程工作台会话 |
| `hardware-gerber` | 电路工作版面/专业文件查看工具 |
| `terminal` | 工具 → 终端 |
| `terminal-record` | 终端执行历史/任务跳转 |
| `data-source-query` | 资料 → 数据查询 |
| `data-source-result` | 资料 → 查询结果 |
| `scheduled-task` | 任务与运行 → 定时任务对象 |
| `web-resource` | 设置 → 网站账号详情；业务页可定向进入 |
| `web-affair` | 任务与运行/业务功能 → 网页事务对象 |
| `article-publishing` | 内容业务 → 发布对象 |
| `agent-role` | 设置 → 角色详情 |
| `remote-file` | 远程资料文件工具 |
| `media-production` | 内容业务 → 视频工程（兼容旧版） |
| `company-accounts` | 公司类型 → 账目 |
| `company-workspace` | 公司类型 → 公司业务页面 |

## 设置导航：12 项

| 当前 ID | 当前名称/组 | 目标分组 |
| --- | --- | --- |
| `appearance` | 外观 / 通用 | 通用与编辑 |
| `editor` | 编辑器 / 通用 | 通用与编辑 |
| `shortcuts` | 快捷键 / 通用 | 通用与编辑 |
| `connections` | API Key 与连接 / AI 与服务 | 账号与连接 |
| `agent-capabilities` | Agent 行为与工具 / AI 与服务 | 助手与能力 |
| `model-usage` | 模型用量 / AI 与服务 | 用量与诊断 |
| `components` | 组件管理 / AI 与服务 | 环境与设备 |
| `browser` | 浏览器 / 工作台 | 通用与编辑 |
| `git-backup` | Git 备份 / 工作台 | 工作台 Git 绑定/应用 Git 凭证（拆分） |
| `cad` | 硬件与 CAD / 工作台 | 环境与设备 |
| `updates` | 更新 / 应用 | 更新与关于 |
| `about` | 关于 / 应用 | 更新与关于 |

## MCP 模块源码：12 项

模块源码存在不代表运行时全部启用；实际可用性由现有注册与能力状态决定。

| 模块 | 目标位置 |
| --- | --- |
| `agent-device` | 设备工具；显式设备和操作授权 |
| `android` | 设备工具；环境配置进设置 |
| `browser` | 通用工具/业务执行能力 |
| `cad` | 3D/CAD 工具；环境配置进设置 |
| `data-source` | 查询工具；连接配置进设置 |
| `editor` | 通用资料与编辑工具 |
| `hardware` | 电子开发类型功能工具 |
| `image-generation` | 内容业务功能/文档配图工具；Provider 进设置 |
| `meshy` | 3D/素材生成工具；Provider 进设置 |
| `scheduled-task` | 工作台任务（当前 MCP 为查询能力） |
| `web-affairs` | 原网页事务执行 owner；汇总页仅投影 |
| `web-resources` | 网站资源领域；配置与使用拆分 |

## 现有命令声明的兼容要求

命令面板、快捷键、菜单均复用原命令；入口搬迁只重定向，不另建业务执行路径。下表提取 bootstrap 命令文件中的字面量 ID，不将动态生成命令误称为完整运行时清单。

| 来源 | 字面量命令 ID |
| --- | --- |
| `agent-commands.ts` | `agent.showConversations`, `agent.newConversation`, `agent.resetSession` |
| `browser-commands.ts` | `browser.navigate`, `browser.zoomIn`, `browser.zoomOut`, `browser.toggleDeviceMode` |
| `diagnostics-commands.ts` | `diagnostics.copyWorkspaceState`, `diagnostics.copyFrameworkLogs` |
| `file-commands.ts` | `file.newFile` |
| `markdown-commands.ts` | `markdown.insertDateTime`, `markdown.insertTime`, `markdown.undo`, `markdown.redo`, `markdown.bold`, `markdown.italic`, `markdown.strike`, `markdown.inlineCode`, `markdown.bulletList`, `markdown.orderedList`, `markdown.taskList`, `markdown.blockquote`, `markdown.codeBlock`, `markdown.hardBreak`, `markdown.link`, `markdown.paragraph`, `markdown.indentList`, `markdown.outdentList` |
| `settings-commands.ts` | `settings.open`, `preferences.openKeybindings` |
| `tab-commands.ts` | `workbench.newTab`, `browser.newTab`, `terminal.newTab`, `workbench.closeTab`, `workbench.moveTabToNewWindow`, `tab.nextTab`, `tab.prevTab` |
| `view-commands.ts` | `workbench.toggleSidebar`, `workbench.toggleAgentPanel`, `workbench.focusAgentPanel`, `workbench.resetAgentLayout`, `view.zoomIn`, `view.zoomOut`, `view.zoomReset`, `view.toggleFullscreen`, `theme.switchTheme` |
| `window-commands.ts` | `window.reload`, `window.toggleDevtools` |
| `workbench-commands.ts` | `workbench.showCommands`, `workbench.save`, `workbench.find` |
| `workspace-commands.ts` | `workspace.new-note`, `workspace.home`, `workspace.create-operations-draft`, `workspace.open-default`, `workspace.set-default`, `workspace.unfiled`, `workspace.open` |

动态入口还包括：Markdown 标题级别、Agent 内置操作定义、公司分区命令、TTS 命令，以及 context-actions 的领域贡献。它们随对应对象/工具保留；不得因未在上表逐字列出就删除。

## 主进程模块兜底盘点

以下为源码目录，不是应逐一展示给用户的菜单。业务模块归位见主设计矩阵；IPC、运行时、持久化和权限保持现有单一 owner。

`agent`、`agent-core`、`altium`、`android`、`article-publishing`、`browser`、`cad`、`cclink-remote`、`cdp`、`company-accounts`、`company-workspace`、`credentials`、`data-source`、`diagnostics`、`fs`、`git`、`git-backup`、`hardware`、`identity`、`image-generation`、`image-research`、`ipc`、`local-tts`、`mcp`、`media-production`、`meshy`、`migrations`、`official`、`persistence`、`playwright`、`project-ops`、`remote`、`runtime`、`runtime-components`、`scheduled-task`、`settings`、`terminal`、`update`、`usage`、`web-affairs`、`web-resources`、`wechat`、`workbench`、`workspace`

## 复核规则

1. 每个 ActivityPanel 和 TabType 都已映射；没有以“更多工具”代替未决定的归属。
2. 配置和使用分开，不把查询、记账、任务运行藏进设置。
3. 源码里的占位页、只读能力、旧版路径单列完成边界；不能把类型存在写成功能完成。
4. 未发现代码实现的未来方案仅列为候选，不进入“现有可用功能”统计。
5. 实施时须按主设计中的真实应用动作逐条回归；本次不运行应用验收，因为没有改应用代码。
