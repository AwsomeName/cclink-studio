# 统一上下文操作系统

> 状态：M1-M2 已完成；M3 实现与自动化门禁完成，真人验收进行中；M4-M5 尚未开始。日期：2026-07-22。

## 结论

CCLink Studio 将为主要工作区域建立统一的上下文操作系统。这里的“所有区域支持右键”不是让每个空白像素弹出菜单，而是遵循两个产品规则：

1. 每个可操作对象都有与对象匹配的上下文菜单。
2. 每个主要容器都有用于管理该区域的上下文菜单。

纯装饰元素不强行提供菜单。打开、保存、发送、发布等关键能力仍必须保留可见入口，右键菜单是高效入口，不得成为用户发现核心功能的唯一方式。

本功能不是逐个组件追加 `onContextMenu`。它将统一现有文件树、Workbench Tab、项目、Agent Thread、Terminal 和选中文本菜单，使工具栏、快捷键、命令面板和右键菜单复用同一个命令事实源。

## 产品目标

- 用户在对象附近即可找到下一步相关操作，减少跨区域移动。
- 同一命令在工具栏、命令面板、快捷键和右键菜单中具有相同名称、可用条件和执行结果。
- 右键目标在项目切换、Tab 切换和异步更新后仍能准确归属，不串项目、不串 Profile、不串 Thread。
- 浏览器网页、编辑器、Terminal 等不同渲染表面拥有符合各自技术边界的菜单体验。
- 所有危险操作、远端副作用和凭证相关操作继续遵守权限与人工确认边界。
- 菜单系统可由各功能模块独立贡献命令，不要求持续修改一个全局巨型组件。

## 非目标

- 不在第一阶段实现任意插件注入菜单。
- 不把右键菜单做成第二个命令面板，也不在一级菜单堆放全部命令。
- 不通过网页脚本注入或 CDP 模拟浏览器右键。
- 不允许右键入口绕过发帖、评论、发送、付款、删除远端数据等最终人工确认。
- 不在基础设施迁移阶段顺便新增大量业务动作。
- 不为纯装饰、不可操作的背景元素制造无意义菜单。

## M1 前基线（已迁移）

M1 开始前存在多套相互独立的菜单实现：

- 文件树菜单：`components/common/ContextMenu.tsx`。
- Workbench Tab 菜单：`components/common/TabContextMenu.tsx`。
- 项目条菜单：`components/project-strip/ProjectStrip.tsx` 内部状态。
- Agent Thread 菜单：`components/agent-panel/AgentPanel.tsx` 内部状态。
- 会话选中文本菜单：`components/common/ConversationCopyMenu.tsx`。
- Markdown 编辑器选区菜单：`components/workbench/MarkdownEditor.tsx` 内部状态。

这些实现分别维护定位、关闭、焦点和动作逻辑。现有 `command-store.ts` 可以支持命令面板，但命令只拥有无上下文的 `action()`，还不能表达目标、可见条件、禁用原因、选中状态、危险等级或二级菜单。继续按组件追加菜单会重新形成多套状态所有者和行为分叉。

## 架构原则

### 1. 对象优先，不以像素为单位

右键必须先解析出稳定的 `ContextTarget`，再构建菜单。目标可以是 Project、File、Tab、BrowserPage、TerminalSession、Thread、Message 或 StatusItem，不能只传一个 DOM 节点或坐标。

在列表项上右键时，菜单绑定被点击项，但不擅自执行左键的打开、导航或激活动作。区域空白处只能得到该区域的容器菜单。

### 2. 命令只有一个定义源

每个动作拥有稳定 `commandId`。工具栏、命令面板、快捷键和上下文菜单只引用命令，不复制执行逻辑。

命令定义统一提供：

- 产品名称、图标、分类和快捷键。
- `visible(context)` 可见条件。
- `enabled(context)` 可执行条件和禁用原因。
- `execute(context)` 执行入口。
- `risk` 风险级别和确认策略。
- 可选 `checked(context)` 状态。

### 3. 菜单状态只是瞬时 UI 状态

renderer 的 `ContextMenuService` 是菜单开关、目标、坐标和焦点恢复的唯一所有者。菜单状态不持久化，不进入 WorkspaceState，也不能成为业务事实源。

同一时刻只允许一个菜单。打开新菜单、项目切换、窗口失焦、目标被删除或 generation 变化时，旧菜单必须关闭。

### 4. 业务副作用仍由领域模块拥有

菜单项不得直接跨 store 拼装事务。文件删除调用 FS command，Terminal 终止调用 Terminal command，Thread 归档调用 Agent command。每个领域继续拥有自己的运行事实、权限、失败降级和诊断。

### 5. Renderer 与网页使用双适配器

Studio renderer 区域使用 React `ContextMenuHost`。Browser `WebContentsView` 内网页由主进程监听 Electron `context-menu` 事件，并使用原生菜单适配器。两者共享命令语义和 action ID，但不强行共享渲染实现。

网页菜单不得依赖 DOM 注入、preload 或 CDP。主进程只提取经过 schema 校验的选中文本、链接、图片 URL、编辑状态和坐标等允许字段。

### 6. 契约先于跨进程行为

Browser 原生菜单、系统剪贴板、Finder 显示等跨进程操作必须先定义 shared contract 与有界 schema。renderer 不能获得 Node 权限，主进程不能信任 renderer 传入的路径、URL、workspaceKey、tabId 或 profileId。

### 7. 权限和人工确认不可绕过

菜单动作使用与其他入口相同的权限判定。危险本地操作需要确认；不可逆外部提交必须由用户在最后一步确认。Terminal 粘贴只写入输入，不自动提交命令。

### 8. 模块独立贡献，平台统一编排

各模块通过 `MenuContribution` 注册自己的菜单项，不直接修改全局菜单组件。平台层只负责目标解析、排序、渲染、关闭和调用命令。

Contribution 必须声明目标类型、分组、顺序和 commandId；不得捕获长期失效的 store snapshot。

### 9. 键盘和可访问性与鼠标同等重要

菜单支持方向键、Enter、Escape、Home、End 和 Shift+F10/Menu 键。打开后焦点进入菜单，关闭后恢复到触发对象。所有菜单使用正确的 `menu`、`menuitem`、`menuitemcheckbox` 语义。

### 10. 诊断和失败状态属于功能

菜单执行事件记录 commandId、target kind、workspace、tab/thread/session 引用、结果和脱敏失败原因。不得记录选中文本全文、Cookie、密码、验证码、token 或敏感 URL 参数。

## 领域模型

建议的目标类型：

```ts
type ContextTarget =
  | { kind: 'project'; workspaceKey: string; path?: string }
  | { kind: 'activity'; activityId: string }
  | { kind: 'sidebar'; panelId: string; workspaceKey: string | null }
  | { kind: 'file'; workspaceKey: string; path: string; fileType: 'file' | 'directory' }
  | { kind: 'tab'; workspaceKey: string; tabId: string; tabType: string }
  | {
      kind: 'browser-page'
      workspaceKey: string
      tabId: string
      profileId: string
      context: BrowserContext
    }
  | { kind: 'terminal'; workspaceKey: string; tabId?: string; sessionId: string }
  | { kind: 'thread'; workspaceKey: string; conversationId: string }
  | { kind: 'message'; workspaceKey: string; conversationId: string; messageId: string }
  | { kind: 'data-source'; workspaceKey: string; dataSourceId: string }
  | { kind: 'status-item'; itemId: string; workspaceKey: string | null }
```

建议的菜单贡献：

```ts
interface MenuContribution {
  id: string
  targetKinds: ContextTarget['kind'][]
  group: string
  order: number
  commandId: string
  when?: (context: CommandContext) => boolean
}
```

`CommandContext` 在执行瞬间重新从事实源解析目标，不能信任菜单打开时捕获的业务状态。无法重新解析时命令返回结构化 `stale-target`，关闭菜单并显示明确提示。

## 组件和所有权

| 组成                       | 所有者            | 职责                                          | 生命周期                |
| -------------------------- | ----------------- | --------------------------------------------- | ----------------------- |
| Command Registry           | renderer 平台层   | 注册命令、解析可见/可用状态、统一执行         | 窗口创建到销毁          |
| Menu Contribution Registry | renderer 平台层   | 按目标组合菜单，不执行领域事务                | 窗口创建到销毁          |
| Context Menu Store         | renderer 平台层   | 当前唯一菜单、目标、坐标、焦点和 generation   | 瞬时，不持久化          |
| React Menu Host            | renderer UI       | 定位、边界避让、键盘和 ARIA                   | 随 App 挂载             |
| Browser Context Adapter    | main Browser 模块 | 接收网页 context-menu、校验参数、显示原生菜单 | Browser View 创建到释放 |
| Domain Commands            | 各能力模块        | 执行业务动作、权限、确认、失败降级和诊断      | 跟随领域 runtime        |

建议代码边界：

```text
src/renderer/src/features/context-actions/
  context-target.ts
  command-registry.ts
  menu-contribution-registry.ts
  context-menu-store.ts
  ContextMenuHost.tsx
  menu-position.ts

src/shared/ipc/context-actions.ts
src/shared/ipc/context-actions-schema.ts

src/main/browser/browser-context-menu.ts

src/renderer/src/features/<domain>/context-actions.ts
```

不建立一个包含所有业务动作的 `GlobalContextMenu.tsx`。每个领域的 contribution 和 command 留在自己的功能目录。

## 菜单组合规则

- 一级菜单原则上不超过 12 个可执行项；超出后按领域进入二级菜单。
- 分组顺序统一为：打开/导航、创建/编辑、复制/发送、管理、危险操作。
- 常用动作显示快捷键；没有快捷键时不留空占位。
- 禁用项在目标存在但当前状态不允许时显示，并提供禁用原因。
- 与目标无关的动作不显示，避免长菜单中充满灰色选项。
- 危险操作置于最后一组，使用危险样式和省略号表示仍有确认步骤。
- 菜单自动避开窗口四边，跟随 UI zoom 正确换算坐标。
- 列表滚动、区域 resize、项目切换和 Browser View 重建时关闭菜单。

## 区域能力矩阵

| 区域/目标        | 第一阶段操作                                                 | 后续增强                             | 危险或权限边界                         |
| ---------------- | ------------------------------------------------------------ | ------------------------------------ | -------------------------------------- |
| 项目条 Project   | 切换、关闭、复制路径、Finder 显示、项目诊断                  | 关闭其他、关闭右侧、Git 备份         | 有运行任务时关闭只关闭视图，不终止任务 |
| Activity Bar     | 打开面板、显示/隐藏侧栏                                      | 隐藏入口、恢复默认顺序               | 不允许隐藏唯一恢复入口                 |
| Sidebar 容器     | 刷新、新建当前领域对象                                       | 折叠全部、复制项目信息               | 刷新失败只降级当前面板                 |
| 文件/目录        | 打开方式、新建、重命名、复制路径、发送给 Agent、Finder 显示  | 多选、压缩/解压、复制/移动           | 删除统一移到废纸篓并确认               |
| Workbench Tab    | 重命名、复制、关闭                                           | 固定、关闭其他、关闭右侧、恢复关闭项 | 关闭草稿继续使用现有保存确认           |
| 编辑器正文       | 剪切、复制、粘贴、全选、发送选区给 Agent                     | 格式、链接和图片动作                 | 不覆盖系统输入法与密码字段行为         |
| Browser 页面     | 后退、前进、刷新、复制选区/链接、在新 Tab 打开、发送给 Agent | 保存图片、查看页面诊断               | 不使用 CDP；下载和外部协议继续校验     |
| Browser 侧栏 Tab | 激活、刷新、复制 URL、复制 Tab、关闭                         | Profile 信息、页面诊断               | Profile 变更必须走现有绑定规则         |
| Terminal         | 复制、粘贴、查找、清屏、发送选区给 Agent                     | 重启、查看审计记录                   | 终止需确认；粘贴不能自动执行           |
| Agent Thread     | 打开、重命名、停止、归档、恢复、复制诊断                     | 在 Workbench 打开、复制引用          | 删除需确认；停止绑定当前 runId         |
| Agent Message    | 复制、复制 Markdown、引用到输入框                            | 从这里重试、发送到新 Thread          | 重试不能重复已完成的外部副作用         |
| 数据源           | 测试、刷新、编辑、复制安全标识                               | 复制配置、导出结果                   | 凭证值不进入菜单或剪贴板               |
| 运营/生产        | 打开配置、生成草稿、查看状态、复制诊断                       | 模板与批量准备                       | 发布、评论、发送仍需最终人工确认       |
| Android          | 截图、复制设备信息、刷新设备                                 | 重连、打开日志                       | Shell/设备写操作继续走权限策略         |
| 设置项           | 重置当前项、复制设置键                                       | 恢复默认分组                         | 密钥只能复制配置状态，不能复制原值     |
| 状态栏项         | 查看详情、复制对应状态、打开诊断                             | 快速恢复动作                         | 只针对被右键的状态项构建菜单           |
| 布局分隔条/空白  | 隐藏区域、重置尺寸                                           | 保存布局预设                         | 不为纯装饰背景显示空菜单               |

## 浏览器特殊方案

Browser `WebContentsView` 位于 renderer 视图之外，普通 React 浮层可能被网页覆盖。浏览器网页菜单采用主进程原生菜单：

1. `BrowserManager` 为每个 View 注册 `webContents.on('context-menu')`。
2. 主进程把 Electron 参数归一化为有界 `BrowserContext`。
3. 先通知 renderer 关闭 React 菜单，再根据 link、image、selection、editable 和导航状态生成原生菜单。
4. 菜单动作直接调用当前 `tabId` 对应的 BrowserManager/WebContents 能力，不经过 Playwright 或 CDP。
5. 需要 renderer 参与的“发送给 Agent”等动作通过 shared 事件携带 workspace/tab/profile 关联。
6. View 销毁、Tab 重建或 Profile 变化时释放监听器并使旧 action token 失效。

只允许以下网页上下文字段进入命令上下文：

- 截断并清洗后的选中文本。
- 通过 URL parser 校验的 link URL、src URL 和 page URL。
- `isEditable`、`mediaType`、`editFlags` 等布尔或枚举状态。
- 当前 workspaceKey、tabId 和 profileId。

不传递 Cookie、DOM、HTML 全文、认证 header 或任意网页脚本句柄。

## 状态与生命周期

菜单状态结构至少包含：

- `menuId`：每次打开生成的新 ID。
- `target`：结构化目标，不保存业务对象实例。
- `anchor`：窗口坐标或触发元素引用。
- `workspaceGeneration`：打开时的项目 generation。
- `focusReturn`：关闭后恢复焦点的元素。

生命周期：

1. 右键或 Shift+F10 解析目标。
2. 关闭当前菜单并生成新 menuId。
3. 从 contribution registry 组合可见项。
4. 打开菜单并聚焦首个可用项。
5. 执行前重新解析目标和命令状态。
6. 命令完成、取消或失败后关闭菜单并恢复焦点。
7. 项目切换、窗口 blur、目标删除或 generation 变化时立即失效。

菜单构建不得触发网络请求或慢 IPC。需要异步信息时先显示已有状态和明确的加载/不可用项，不能阻塞右键打开。

## 权限与确认

命令风险统一分为：

| 风险                 | 示例                                   | 行为                            |
| -------------------- | -------------------------------------- | ------------------------------- |
| read                 | 复制路径、刷新、查看诊断               | 直接执行                        |
| local-write          | 重命名、本地保存、清屏                 | 使用领域既有策略                |
| destructive          | 移到废纸篓、终止 Terminal、删除 Thread | 显式确认                        |
| external-side-effect | 发帖、评论、发送消息、付款             | AI 可准备，最后提交必须真人确认 |
| credential           | Profile、数据源密钥、登录状态          | 不显示原值，不进入剪贴板和诊断  |

菜单只是入口，不能重新定义领域风险。相同 commandId 从任意入口调用都得到相同确认策略。

## 诊断

记录以下脱敏事件：

- `context-menu-opened`：target kind、workspace、可用项数量。
- `context-command-started`：commandId、target 引用、触发来源。
- `context-command-completed`：耗时和结果。
- `context-command-rejected`：stale target、permission、unavailable 或 invalid input。
- `context-menu-closed`：execute、escape、outside、blur、workspace-switch 或 target-invalidated。

默认不记录鼠标精确轨迹、选中文本全文、完整 URL 查询参数或剪贴板内容。

## 里程碑

### M1：统一命令与菜单基础设施

状态：已完成。

#### 目标

- 建立单一 Command Registry、Menu Contribution Registry 和 ContextMenuHost。
- 迁移现有菜单，不改变已有业务行为。
- 清除多个菜单可以同时打开、定位算法重复和组件直接修改业务 store 的基础问题。

#### 方案

- 扩展 Command 类型，加入 context、visible、enabled、disabledReason、checked 和 risk。
- 建立 ContextTarget、ContextMenuStore、统一位置计算和焦点管理。
- 为 File、Tab、Project、Thread、Conversation selection 和 Markdown selection 编写 contribution。
- 旧菜单组件在迁移完成后删除，不保留兼容双写。
- 命令面板继续调用同一 Command Registry；无目标命令使用当前工作台上下文。

#### 验收标准

- 同一时间最多显示一个菜单。
- 现有文件、Tab、项目、Thread 和选区菜单行为无回归。
- 同一命令从菜单和命令面板执行结果一致。
- 项目切换和窗口失焦会关闭菜单，旧目标不能执行。
- 菜单定位、排序、可见性、禁用原因和键盘导航有单元测试。
- 不新增 preload 权限，不新增业务副作用。
- `pnpm verify` 和受影响 UI smoke 通过。

#### 完成证据

- 已建立唯一 `ContextMenuStore`、`ContextMenuHost`、结构化 `ContextTarget` 和 Menu Contribution Registry。
- Command Registry 已支持 context、visible、enabled/禁用原因、checked、risk 和统一异步执行结果。
- File、Tab、Project、Thread、Conversation selection、Markdown selection 六套现有菜单已迁移；旧菜单组件与旧 Store 已删除，不保留双写。
- Tab 浏览器截图遮罩、Tab/Thread 内联重命名、草稿关闭确认、Thread 归档/恢复和 Markdown 带行号发送行为保留。
- 项目切换、窗口失焦、外部点击和 Escape 会关闭菜单；执行前再次验证 workspace 与目标是否仍有效。
- 单元测试覆盖中央执行、stale target、贡献过滤/排序、单菜单所有权、边界定位、禁用项键盘跳转和浏览器预览生命周期。
- 2026-07-22 本地门禁：`pnpm verify` 通过（146 files / 885 tests），`pnpm smoke:standalone` 通过（local 9/9、UI 6/6、workflow 5/5、restore 4/4）。

### M2：工作台框架全覆盖

> 状态：已完成。

#### 目标

- 覆盖 Project Strip、Activity Bar、Sidebar、文件树、Workbench Tab、Status Bar 和布局区域。
- 让工作台导航和管理对象拥有一致的右键入口。

#### 方案

- 为每个框架区域增加显式 target resolver。
- 文件删除从 Markdown 特例收敛为受保护的通用移到废纸篓命令。
- Tab 增加关闭其他、关闭右侧；项目增加 Finder 显示、复制路径和项目诊断。
- Status Bar 按具体 itemId 构建菜单，不使用整条状态栏的万能菜单。
- 布局分隔条只提供隐藏和重置，不显示业务命令。

#### 验收标准

- 每个可操作框架对象都能通过鼠标和 Shift+F10 打开正确菜单。
- 右键非活跃项目/Tab 不会先切换项目或激活 Tab。
- 关闭其他/右侧遵守草稿保存、Terminal 和 Thread 既有生命周期。
- 文件操作严格限制在当前 workspace，非法路径被 schema 拒绝。
- 窄窗口、UI zoom 和屏幕四边不裁切菜单。
- Project/Tab/文件树自动化测试和 standalone smoke 通过。

#### 完成证据

- `ContextTarget` 已增加 Activity、Sidebar、StatusItem 和 Layout；Project、File、Tab 继续使用稳定对象标识，不以 DOM 节点作为业务目标。
- Project 菜单已提供切换、复制路径、Finder 显示、工作台诊断和关闭；右键非活跃项目不会先触发项目切换。
- Activity Bar、Sidebar 容器、Status Bar 具体状态项和左右布局分隔条已接入统一 Host；鼠标右键、Menu 键和 Shift+F10 共用同一目标解析与命令。
- 文件菜单已增加 Finder 显示，并将 Markdown 特例删除收敛为通用“移到废纸篓”；主进程使用 `workspacePath + targetPath` 契约再次校验作用域，拒绝越界路径和工作区根目录。
- Tab 已增加关闭其他、关闭右侧，按顺序复用现有草稿保存、Terminal 视图关闭和 Conversation 视图生命周期；用户取消一次确认后停止后续关闭。
- 任意 React 上下文菜单打开时都会暂时卸载 Browser View，避免 Electron `WebContentsView` 遮挡框架菜单；Tab 菜单仍保留页面截图预览。
- 单元测试覆盖工作区路径保护、通用废纸篓、Finder 显示、Tab 批量关闭、键盘触发和框架布局命令。
- 2026-07-22 全新 detached worktree 门禁：`pnpm install --frozen-lockfile`、`pnpm verify` 通过（148 files / 893 tests），`pnpm smoke:standalone` 通过（local 9/9、UI 6/6、workflow 6/6、restore 4/4）。

### M3：核心内容工作面

> 状态：实现与自动化门禁已完成，等待 `docs/ops/context-action-m3-acceptance.md` 真人验收后关闭。

#### 目标

- 覆盖 Browser 网页、编辑器正文、Terminal、Agent Thread 和消息。
- 在不破坏网页登录、文本输入和任务归属的前提下提供高频操作。

#### 方案

- 实现 Browser 原生 Context Adapter 和 shared BrowserContext schema。
- 编辑器根据 editable/selection/image/link 状态贡献命令，保留系统输入行为。
- Terminal 接入复制、粘贴、查找、清屏、发送选区、重启和终止命令。
- Agent Thread 与 Message 菜单复用 conversation run controller 和诊断链。
- “发送给 Agent”只挂载资源或引用到 Composer，不自动发送消息。

#### 验收标准

- Browser 网页右键不启用 CDP、不注入脚本，登录 Profile 保持不变。
- 链接、图片、选区、输入框和普通页面得到不同且正确的菜单。
- Browser action 始终绑定当前 workspace/tab/profile，不漂移到其他项目。
- Terminal 粘贴不自动执行；终止操作有确认并留下审计记录。
- Agent 停止动作只影响打开菜单时重新验证后的当前 runId。
- 项目切换期间打开的 Browser/Terminal/Agent 菜单立即失效。
- Browser、Terminal、Agent 回归测试和真人跨项目验收通过。

#### 当前证据

- Browser 网页使用主进程原生菜单；Electron `context-menu` 参数先归一化为严格、有界的 `BrowserContext`，菜单打开和执行均绑定 workspace、tab、profile 与一次性 action token，不依赖 CDP 或页面脚本注入。
- Browser 的新 Tab 操作显式继承当前 Profile；发送选区、链接、图片或页面给 Agent 只挂载资源并聚焦 Composer，不自动发送消息。
- Source/Markdown 编辑器已接入剪切、复制、粘贴、全选、选区挂载以及链接/图片源复制，并保留编辑器自身输入与选区语义。
- Terminal 已接入复制、粘贴、查找、清屏、发送选区、重启和终止；粘贴只写入 PTY 输入且不附加回车，重启/终止在确认后再次校验当前 workspace、tab 与 session，并记录生命周期审计。
- Agent Thread 已接入打开、重命名、停止当前 run、复制诊断和归档/恢复；停止命令执行前重新核对 `runId`。消息已接入复制、复制 Markdown 和引用到 Composer，引用不会触发发送。
- 2026-07-22 全新 detached worktree 自动门禁：`pnpm install --frozen-lockfile`、`pnpm verify` 通过（151 files / 902 tests），`pnpm smoke:standalone` 通过（local 9/9、UI 6/6、workflow 7/7、restore 4/4）。
- M3 尚未关闭：Browser Profile、Terminal 确认、Agent run 归属和跨项目失效仍需按真人验收记录确认。

### M4：领域模块独立贡献

#### 目标

- 覆盖数据源、运营、生产、Android 和设置。
- 证明各模块可以独立注册菜单，不修改 ContextMenuHost。

#### 方案

- 每个领域新增自己的 `context-actions.ts`，只导出 commands 和 contributions。
- 数据源命令复用只读查询、凭证隔离和能力状态。
- 运营/生产菜单只提供准备、配置、状态和诊断；外部提交继续进入人工确认。
- Android 菜单复用设备能力状态与现有权限规则。
- 设置菜单只允许重置安全配置和复制非敏感键，不读取密钥原值。

#### 验收标准

- 新增领域菜单不修改全局 Host 和其他领域 command 文件。
- 关闭或缺失某个可选模块时，只隐藏/禁用该模块菜单，不阻断其他区域。
- 数据源和设置菜单无法复制凭证原值。
- 运营/生产菜单不能直接完成远端发布或发送。
- Android 缺少 adb 时菜单显示明确不可用原因，Studio 继续正常运行。
- 各领域单元测试、能力降级测试和受影响 smoke 通过。

### M5：一致性、可访问性与退出验收

#### 目标

- 完成所有区域库存、视觉一致性、键盘操作、诊断和长期维护门禁。
- 删除遗留菜单实现，形成可扩展的正式产品基线。

#### 方案

- 建立区域/目标/命令库存，逐项标记已覆盖、明确不需要或延期。
- 统一图标、分组、危险样式、快捷键文案、边界定位和二级菜单。
- 增加命令冲突、重复 commandId、无 owner contribution 和敏感诊断检查。
- 对桌面和窄窗口执行视觉与键盘验收。
- 更新 README、功能文档、架构文档和本地 smoke 清单。

#### 验收标准

- 库存中的所有主要区域都有明确结论，不存在“漏了但不知道”的区域。
- 所有菜单可完全使用键盘完成打开、导航、执行和关闭。
- 没有重复 commandId、孤立 contribution、第二套菜单 store 或遗留全局菜单组件。
- 诊断能区分菜单构建失败、目标失效、权限拒绝和领域执行失败。
- 全新 detached worktree 通过锁定安装、`pnpm verify`、standalone 和受影响 smoke。
- 真人验收覆盖项目切换、Browser Profile、Terminal、Agent、危险确认和可选能力降级。
- 远端 CI 通过，工作树干净后才能宣称功能完成。

## 测试策略

### 单元测试

- ContextTarget 解析和 workspace scope。
- Contribution 排序、分组、可见性和禁用原因。
- 命令 ID 唯一性和同命令多入口一致性。
- 菜单位置计算、UI zoom、边界避让和二级菜单。
- stale target、generation 变化和目标删除。
- BrowserContext schema、URL 清洗和敏感字段拒绝。

### 集成测试

- renderer 右键到领域 command 的完整链路。
- Browser WebContentsView 原生菜单到 BrowserManager 的完整链路。
- 项目 A 打开菜单后切到项目 B，A 的命令无法执行。
- Terminal/Agent 正在运行时菜单动作绑定正确 session/run。
- 可选模块故障时菜单系统和其他模块继续工作。

### 真人验收

- 鼠标、触控板、Shift+F10 和纯键盘使用。
- 窄窗口、全屏、不同缩放比例和多显示器边缘。
- Browser 登录态、链接、图片、文本选区和输入框。
- 文件删除、Terminal 终止、Thread 删除和外部提交确认。
- 项目切换与回切后目标、状态和诊断不串。

## 发布与回滚

- 每个里程碑独立分支、独立提交、独立验收，不在一个工作树横跨所有领域。
- M1 只迁移已有行为，失败时可以按领域回退 contribution，不保留新旧菜单双写。
- Browser 原生菜单作为独立能力失败时，只回退网页菜单，不影响 Browser 导航和自动化。
- 某领域 contribution 注册失败时，记录降级原因并跳过该领域，不阻断工作台启动。
- 任何需要违反架构宪法的实现必须先提交 ADR。

## /grilling

必须持续拷问：

1. 是真的复用了命令，还是只把相同代码复制到另一个菜单？
2. 菜单目标是否在执行前重新验证，还是可能操作已经切走的项目、Tab 或 Thread？
3. Browser 网页菜单是否偷偷依赖 CDP、脚本注入或高权限 preload？
4. 是否把关键功能藏进右键，导致新用户找不到？
5. 是否因为“方便”而绕过 Terminal、外部发布和删除操作的确认边界？
6. 某个领域失败时，是否只损失自己的菜单，而不是拖垮全局 MenuHost？
7. 菜单项增加后是否仍保持短、相关、可解释，还是变成第二个命令面板？

最先应推进 M1。没有统一命令、目标和生命周期之前，不允许继续为新区域追加独立右键组件。
