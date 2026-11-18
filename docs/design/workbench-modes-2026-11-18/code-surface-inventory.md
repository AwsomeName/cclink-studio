# 当前代码入口盘点与目标归属

日期：2026-11-18。代码复核基线：`7c54acaa`。仅为产品设计盘点，不代表每项已经重新运行验收。

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
| `data-source-result` | 保留类型兼容；当前结果在 DataSourceQueryTab 中呈现，不把独立类型声明计为独立已交付页面 |
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
| `appearance` | 外观 / 通用 | 外观与编辑 |
| `editor` | 编辑器 / 通用 | 外观与编辑 |
| `shortcuts` | 快捷键 / 通用 | 外观与编辑 |
| `connections` | API Key 与连接 / AI 与服务 | 模型与 API；Git/数据连接进入对应设置项 |
| `agent-capabilities` | Agent 行为与工具 / AI 与服务 | Skills 与 MCP |
| `model-usage` | 模型用量 / AI 与服务 | 用量与诊断 |
| `components` | 组件管理 / AI 与服务 | 组件与设备 |
| `browser` | 浏览器 / 工作台 | 外观与编辑 |
| `git-backup` | Git 备份 / 工作台 | 工作台 Git 绑定/应用 Git 凭证（拆分） |
| `cad` | 硬件与 CAD / 工作台 | 组件与设备 |
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
| `hardware` | 电子开发的硬件工具 |
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

## 本轮补充核查

- 最近会话：当前项目快捷切换、列表搜索、关闭/恢复/删除保留，配置管理迁移不能移走日常会话入口。
- STEP：`cad_plan_modification`、`cad_modify_step`、结果自动打开已存在；必须归入 3D 工作版面，不能仅列模型预览。
- FPC：当前服务提供扫描、检查、报告、Gerber 几何和形状上下文；完整自动改板不因方案文档存在就计为已实现。
- 朗读：MD/网页统一底栏入口，消息/选区入口保留；不重新在编辑器和浏览器工具栏增加重复入口。
- Claude 组件：保留安装/修复后启用和选择 Studio 管理版本的现有流程。
- 视频：新版口播与旧版素材/声音/导出分别保留，新版后三页不视为已实现。

## MCP 工具声明核对

下面提取各模块 index.ts 的字面量工具声明，防止遗漏没有主侧栏入口的能力。声明存在不代表当前已授权或所有操作已重新验收；条件注册和权限继续由原服务控制。

| 模块 | 声明数量 | 工具 ID |
| --- | --- | --- |
| `agent-device` | 4 | `agent_device_snapshot`, `agent_device_click`, `agent_device_swipe`, `agent_device_type` |
| `android` | 14 | `android_screenshot`, `android_dump_ui`, `android_device_info`, `android_list_packages`, `android_current_activity`, `android_tap`, `android_swipe`, `android_press_key`, `android_type_text`, `android_launch_package`, `android_go_home`, `android_install_apk`, `android_uninstall_package`, `android_push_file` |
| `browser` | 44 | `browser_screenshot`, `browser_extract`, `browser_title`, `browser_input_value`, `browser_wait_for_selector`, `browser_navigate`, `browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_click`, `browser_fill`, `browser_select`, `browser_check`, `browser_uncheck`, `browser_press`, `browser_hover`, `browser_scroll`, `browser_upload_file`, `browser_wait_for_navigation`, `browser_press_key`, `browser_drag_drop`, `browser_evaluate`, `browser_handle_dialog`, `browser_set_auto_dialog`, `browser_clear_cookies`, `browser_intercept_request`, `browser_mock_response`, `browser_get_network_logs`, `browser_clear_intercepts`, `browser_new_tab`, `browser_close_tab`, `browser_list_tabs`, `browser_switch_tab`, `browser_get_tab_info`, `browser_wait_for_download`, `browser_download_info`, `browser_save_download`, `browser_list_frames`, `browser_frame_execute`, `browser_frame_content`, `browser_get_console_logs`, `browser_wait_for_popup`, `browser_mouse_click`, `browser_mouse_move` |
| `cad` | 8 | `cad_get_backend_status`, `cad_get_model_support`, `cad_inspect_model`, `cad_convert_model`, `cad_get_cache_status`, `cad_clear_cache`, `cad_plan_modification`, `cad_modify_step` |
| `data-source` | 6 | `data_source_list_sources`, `data_source_list_collections`, `data_source_list_saved_queries`, `data_source_search`, `data_source_get_record`, `data_source_run_saved_query` |
| `editor` | 6 | `editor_write`, `editor_append`, `editor_insert`, `editor_read`, `editor_list`, `editor_save` |
| `hardware` | 5 | `hardware_scan_project`, `hardware_inspect_production_package`, `hardware_write_production_report`, `hardware_prepare_fpc_shape_context`, `hardware_read_gerber_layer_geometry` |
| `image-generation` | 2 | `image_generation_status`, `markdown_illustrate` |
| `meshy` | 5 | `meshy_create_preview`, `meshy_create_refine`, `meshy_get_task`, `meshy_save_asset`, `meshy_generate_and_save` |
| `scheduled-task` | 3 | `scheduled_task_list`, `scheduled_task_get_runtime_status`, `scheduled_task_list_runs` |
| `web-affairs` | 11 | `image_research_search`, `image_research_inspect_page`, `image_research_open_result`, `image_research_propose`, `web_affair_get`, `web_affair_propose_flow_diff`, `web_affair_finish_attempt`, `web_affair_complete_check`, `article_publishing_inspect_page`, `article_publishing_report_checkpoint`, `article_publishing_report_asset` |
| `web-resources` | 2 | `web_accounts_list`, `web_account_open` |
