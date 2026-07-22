# 上下文操作区域库存

> 状态：M5 事实源。日期：2026-07-22。

## 结论

CCLink Studio 只有一个 renderer 菜单 Host、一个瞬时菜单 Store 和一个 Browser 原生适配器。业务模块只能贡献结构化 target、command 和 contribution，不得创建第二套菜单生命周期。

当前维护门禁统计：

- Renderer context-menu owner：17 个组件文件。
- Browser 原生菜单 owner：1 个主进程文件。
- ContextMenu Store owner：1 个。
- 结构化 `ContextTarget`：21 种，全部有 contribution 覆盖。

`pnpm verify:context-actions` 使用 TypeScript AST 校验 owner 文件；catalog 单元测试校验 command/contribution 唯一性、owner、分组、顺序和 target 覆盖。新增区域必须同时更新本库存和源码门禁。

## 工作台框架

| 区域 | Target | Renderer owner | 结论 |
| --- | --- | --- | --- |
| Project Strip | `project` | `ProjectStrip.tsx` | 切换、路径、Finder、诊断、关闭 |
| Activity Bar | `activity` | `ActivityBar.tsx` | 打开区域、Sidebar 布局 |
| Sidebar 容器 | `sidebar` | `Sidebar.tsx` | 创建、刷新、宽度、隐藏 |
| 文件树 | `file` | `FileTree.tsx` | 文件领域命令；作用域由 workspace 再校验 |
| Workbench Tab | `tab` | `TabBar.tsx` | 重命名、复制、批量关闭和关闭 |
| Status Bar | `status-item` | `StatusBar.tsx` | 复制具体状态、工作台诊断 |
| 布局分隔条 | `layout` | `ResizeHandle.tsx` | 重置尺寸、隐藏区域 |

## 核心内容

| 区域 | Target | Renderer owner | 结论 |
| --- | --- | --- | --- |
| Source 编辑器 | `editor` | `SourceTextEditor.tsx` | 输入、选区、链接和图片命令 |
| Markdown 编辑器 | `editor` / `markdown-selection` | `WorkbenchContent.tsx` | 复用编辑器 surface，不创建独立菜单 |
| Terminal | `terminal` | `WorkbenchContent.tsx` | 复制、粘贴、查找、清屏、挂载和生命周期 |
| Agent Thread | `thread` | `AgentPanel.tsx` | 打开、重命名、停止、诊断和归档 |
| Agent Message | `message` | `ConversationMessageRenderer.tsx` | 复制、Markdown、引用到 Composer |
| Agent 文本选区 | `conversation-selection` | `AgentPanel.tsx` | 只复制选区 |
| Browser 页面 | bounded native context | `src/main/browser/browser-context-menu.ts` | Electron 原生菜单；不注入页面、不使用 CDP |

## 领域模块

| 区域 | Target | Renderer owner | 结论 |
| --- | --- | --- | --- |
| 数据源 | `data-source` / `data-collection` / `saved-query` | `DataSourcesPanel.tsx` | 只读查询、稳定标识和连接状态 |
| 数据记录 | `data-record` | `DataSourceQueryTab.tsx` | 复制当前记录、挂载但不自动发送 |
| 运营平台 | `operations-platform` | `ProjectOperationsSection.tsx` | 准备会话、配置和状态；不发布 |
| 硬件生产 | `production` | `HardwareProductionSection.tsx` | 扫描、检查、本地报告；不下单 |
| Android | `android` | `AndroidDisplay.tsx` | 当前 Tab 的连接/断开与能力降级 |
| 设置项 | `setting` | `SettingsPage.tsx` | 安全重置和非敏感 key；凭证行不绑定 |

## 其他绑定组件

- `DataSourcesPanel.tsx`、`DataSourceQueryTab.tsx`、`ProjectOperationsSection.tsx`、`HardwareProductionSection.tsx`、`AndroidDisplay.tsx` 和 `SettingsPage.tsx` 是领域 target adapter。
- `ConversationMessageRenderer.tsx` 只解析消息 target；业务动作仍由 Agent 领域 command 拥有。
- `ResizeHandle.tsx` 只解析布局 target；不拥有 Sidebar 或 Agent 状态。

## 明确不提供菜单

- Logo、标题、分隔装饰、空白填充和纯状态图标。
- 密码、Token、API Key 等凭证输入行。
- 没有稳定对象身份且不能产生有意义操作的页面空白。
- 发布、发送、付款、下单和不可逆远端提交的最终确认按钮。

## 维护规则

1. 新增 target 时先扩展 `ContextTarget` 和本库存，再由领域 `context-actions.ts` 注册。
2. 不得新增 renderer 原生 `Menu`、第二个 `ContextMenuHost` 或第二个菜单 Store。
3. Browser 网页菜单只能走现有主进程原生适配器。
4. 禁用项必须给出原因；菜单构建不得等待网络或慢 IPC。
5. 失败诊断只记录类别、command/contribution ID、target kind 和脱敏消息，不记录 target payload、凭证或网页正文。
6. 新增 owner 文件必须更新 `scripts/verify-context-action-boundary.mjs`，否则 `pnpm verify` 失败。
