# 可分离 Workbench Tab 与辅助窗口

> 状态：方案文档、P0a/P0b 与 ADR 0017 已通过；Browser-only M1 生产实现和真实 App 自动 smoke
> 已完成。物理双屏与用户自有真实账号真人签收仍待执行，因此最终用户交付仍为 Conditional Go。
>
> 创建时间：2026-08-18。
>
> 本文同时保存产品决策、架构建议和参考推进计划。P0 通过后、M1 施工前必须新增 ADR 固化多窗口
> 状态所有权；若任务规模继续扩大，再拆出独立 development plan，本文保留产品事实源。

## 1. 结论

CCLink Studio 应支持把 Workbench Tab 移入独立顶层辅助窗口，以便用户将 Browser、Editor、
Terminal 或 Agent 会话放到副屏，同时继续在主窗口处理其他工作。

这个方向产品价值高、与 Studio 的多工作现场定位一致，Electron 平台也提供必要的多窗口和
`WebContentsView` 组合 API，因此结论为 **Conditional Go**。Electron 43 文档未明确保证既有
`WebContentsView` 跨窗口迁移后不重载且保持同一 Playwright Page；P0 已在 Electron 43.1.1 / macOS
arm64 证明同一 View/WebContents/Session/CDP target/Page 可以不重载迁移、回滚并经过隐藏 Recovery
Host。生产实现现已采用主进程 WindowService/TabModel、最小辅助 renderer、多 host BrowserManager
和每 View 独立 Recovery Host；当前只支持 Browser M1，不授权拖拽或其他 Tab 类型。

推荐采用以下交付策略：

1. 最终产品目标仍是“所有经过适配的 Workbench Tab 都可以移动到辅助窗口”。
2. P0a/P0b 已通过，可复现证据见
   `docs/ops/detachable-workbench-tabs-p0-acceptance.md`；P0 只是工程验证，不是用户功能进度。
3. ADR 0017 已 accepted，Browser M1 已按主进程 owner、单 writer、可信 renderer、两阶段迁移和
   Recovery Host 实施；统一验收证据见
   `docs/ops/detachable-workbench-tabs-m1-acceptance.md`。任何偏离必须先复审 ADR。
4. 首个用户里程碑只命名为“Browser 辅助窗口”，先提供右键/命令入口，不宣称通用 Tab 或拖出
   手势已完成。
5. Browser M1 真人验收通过后再接入拖出手势，并逐类支持 Editor、Terminal、Conversation 和
   草稿型业务 Tab；拖拽最终仍复用 `workbench.moveTabToNewWindow`，不复制迁移逻辑。

## 2. 用户现在能做什么、还不能做什么

### 2.1 用户现在能做什么

- 在同一个主窗口的 TabBar 内拖拽 Tab 调整顺序。
- 同时打开 Browser、Editor、Terminal、Conversation 和其他 Workbench Tab，并在一个窗口内
  切换。
- 从 Browser Tab 统一右键菜单或命令面板执行“移至新窗口”，在辅助窗口继续浏览，并通过按钮或
  关闭辅助窗口把同一 Browser Tab 送回主窗口。
- Browser、Terminal 和 Agent 的后台运行事实由现有主进程领域 owner 继续维护；切换工作空间
  只改变可见投影，不应终止后台任务。

### 2.2 用户现在还不能做什么

- 把任意 Tab 拖出主窗口形成独立窗口。
- 分离 Browser 以外的 Editor、Terminal、Conversation 或其他 Tab。
- 恢复上次退出时的辅助窗口位置、显示器和 Tab 分布。

Browser M1 生产实现和真实 App 自动门禁已通过；物理双屏与用户自有真实账号真人签收记录见
`docs/ops/detachable-workbench-tabs-m1-acceptance.md`。该签收完成前仍不能声明副屏用户闭环最终交付。

2026-08-20 异常路径复审已关闭五项发布阻断：主窗口关闭会先释放辅助窗口拦截器再退出；主 renderer
刷新会先水合 placement 投影，避免重复 Tab；同工作空间关闭辅助窗口后，Tab 高亮服从实际 active
Browser View；已提交迁移后的窗口失效走 Recovery Host 与递增 generation；旧书签迁移失败时保留
legacy 数据并重试。真实 App smoke 已扩为 12/12，完整 `pnpm verify` 已通过。以上仍不能替代物理
双屏和用户自有真实账号真人签收。

同日第二轮异常事务复审进一步修正：pre-commit failure 才能 rollback 原 transaction；commit 后的
`show/publish/projection/send` 故障必须创建反向补偿 transaction，Recovery Host 送回失败也要补偿
native owner。WindowService 的事实边界已收窄为“进入分离生命周期后的 Browser placement/
generation ledger”，完整 Tab order/active 属于 TabModel，native host active View 属于 BrowserManager。
终态 transfer、关闭窗口和已安全迁移的 legacy 书签副本均有清理路径与故障注入覆盖。

## 3. 产品术语和心智

正式术语使用：

- **主窗口（main window）**：拥有完整 Activity Bar、Sidebar、Workspace Strip、Workbench、
  Agent Panel 和 Status Bar 的 Studio 窗口。
- **辅助窗口（auxiliary window）**：独立顶层、可移动到其他显示器的轻量 Workbench 窗口。
- **移动 Tab（move tab）**：同一个逻辑 Tab 改变窗口归属，不复制运行事实，不生成第二个 tabId。
- **送回主窗口（return to main window）**：辅助窗口关闭或用户显式执行返回命令时，把 Tab 安全
  恢复到主窗口。

不要使用“弹窗”或 modal 作为产品定义。辅助窗口不设置 `parent`，不禁用主窗口，不默认置顶，
也不因主窗口移动而跟随。它是与主窗口平级的顶层窗口。

## 4. 产品目标与非目标

### 4.1 产品目标

- 用户可以通过右键命令或把 Tab 拖到当前窗口外，将其移动到独立辅助窗口。
- 辅助窗口可以自由移动到副屏，并持续显示、操作原 Tab。
- 移动不改变 Tab 的 workspace、Profile、session、conversation、terminalSessionId 或其他稳定
  领域引用。
- Browser、Terminal 和 Agent 的后台事实不因窗口迁移、主窗口切换工作空间或辅助窗口失焦而
  停止。
- 关闭辅助窗口默认把 Tab 送回主窗口，不把窗口关闭等同于关闭 Tab。
- 迁移失败必须回滚，源 Tab 和运行事实不能丢失。
- 每一种 Tab 类型只有在明确满足其状态保真门槛后，才显示为“支持移动”。

### 4.2 非目标

- 不把网页 `window.open()`、认证子进程、系统文件选择器或确认对话框称为辅助 Workbench 窗口。
- 不在 Browser M1 同时实现全部 20 种 Tab 类型。
- 不通过 `<webview>`、关闭 sandbox、扩大 preload 或让网页获得 IPC 来简化迁移。
- 不把 Browser 迁移实现成“保存 URL、关闭旧页面、在新窗口重新 `loadURL()`”。
- 不在首版实现窗口网格布局、任意拆分组、窗口预设或类似完整 IDE Layout 系统。
- 不在首版默认支持“复制到新窗口”；Browser、Terminal 和 Conversation 默认只有移动语义。
- 不把 `always-on-top` 作为默认行为；它可以在后续作为显式窗口命令加入。

## 5. 最终用户端到端验收目标

完整产品目标最终必须通过以下真人动作验收：

1. 用户在真实 Studio 中打开一个工作空间，同时打开 Browser、Editor、Terminal 和 Agent 会话。
2. 用户右键一个已支持的 Tab，选择“移至新窗口”；也可以把同一 Tab 拖到当前窗口之外完成相同
   动作。
3. 原窗口不再显示该 Tab，鼠标附近出现一个独立辅助窗口，窗口中只有同一个逻辑 Tab。
4. 用户把辅助窗口移到副屏，继续在主窗口编辑文件或切换其他 Tab。
5. 辅助窗口中的状态保持不变：Browser 不重载，Editor 不丢 dirty 内容、光标、选区和 undo/redo，
   Terminal 不丢输出或输入能力，Conversation 不漏流或重复流式事件。
6. 主窗口切换到另一个工作空间时，辅助窗口继续显示原工作空间 Tab，不串 workspace、Profile、
   conversation 或 Terminal session。
7. 用户从辅助窗口执行“移回主窗口”，或直接关闭辅助窗口；Tab 安全返回主窗口，运行事实不中断。
8. 用户显式执行“关闭 Tab”时才按该领域现有保存、确认和清理规则关闭运行时。
9. App 正常退出并重新启动后，已进入恢复范围的辅助窗口回到可见显示器；显示器缺失时自动回收到
   主显示器可见区域。
10. 任一辅助窗口或可选能力失败时，主窗口、本地工作空间和无关能力继续可用。

只有已适配的 Tab 类型可以计入对应步骤；不支持的类型必须给出明确禁用原因，不能静默重载或丢
状态后伪装为支持。

## 6. Browser M1 用户闭环

首个产品里程碑严格限定为 Browser：

1. 用户在工作空间 A 打开一个已登录网页，产生滚动位置、页面历史和未提交表单状态。
2. 用户右键 Browser Tab 选择“移至新窗口”，也可以从命令面板执行同一命令。
3. 辅助窗口在源窗口所在显示器的可见区域出现；主窗口的 TabBar 不再显示该 Browser Tab。
4. 页面不重载，原 Profile/Session、滚动、表单、历史、WebContents、Playwright Page 和 tabId 均
   保持；浏览器自动化继续精确寻址同一 Page。
5. 用户把窗口移动到副屏，并在主窗口继续操作 Editor。
6. 主窗口切换到工作空间 B；辅助窗口仍属于 A，不被 B 的 Browser reconcile 销毁或错误激活。
7. 用户关闭辅助窗口，Browser Tab 返回主窗口；若主窗口当前在 B，Tab 保持属于 A，并在用户回到
   A 时可见，不能串入 B。
8. 目标窗口创建、renderer ready、View 迁移或确认任一步失败时，源 Tab 留在原位并给出可复制诊断。
9. 用户显式关闭返回后的 Browser Tab，对应 View、WebContents、Playwright Page 和任务关联按现有
   规则释放。

M1 不要求拖出手势、恢复上次退出时的分离位置，也不要求把第二个 Tab 拖入已有辅助窗口。正常
退出时必须确保逻辑 Tab 仍进入 workspace 恢复快照，并在下次启动至少安全恢复到主窗口。拖出
手势在 M1 真人验收通过后接入同一命令。

## 7. 关键产品拷问与推荐答案

### 7.1 真需求是通用 Tab，还是只要 Browser 放副屏？

**推荐答案：最终做通用模型，首个闭环只做 Browser。**

Browser 放副屏、主窗口继续编辑是最清晰且最贴合 Studio 的纵向价值。只写 Browser 特例会留下
架构死角，因此窗口与 placement contract 应按通用 Tab 设计；但在其他类型未满足状态保真门槛前，
不得开放它们的入口。

### 7.2 新窗口是弹窗、子窗口还是顶层窗口？

**推荐答案：独立顶层辅助窗口。**

子窗口在 macOS 可能跟随父窗口移动，modal 会禁用主窗口，都违背副屏并行工作的目标。辅助窗口
应有独立焦点、尺寸、位置和最小化行为，但 App 生命周期仍由统一窗口注册表拥有。

### 7.3 移动还是复制？

**推荐答案：默认只移动。**

复制 Browser 会产生新的 WebContents、历史、opener 和自动化 Page，复制 Terminal/Conversation
也会制造第二运行事实。文件只读预览可以后续支持“复制到新窗口”，但它必须是独立命令，不能与
移动共用含糊语义。

### 7.4 辅助窗口展示完整 Studio，还是轻量外壳？

**推荐答案：轻量外壳。**

首版只显示窗口标题/拖动区、必要 TabBar、领域 Toolbar、Workbench 内容和少量窗口命令。不要在
每个辅助窗口重复 Workspace Strip、Sidebar、Agent Panel、全局 bootstrap 和完整状态持久化。

### 7.5 关闭辅助窗口是关闭 Tab 还是送回？

**推荐答案：默认送回主窗口。**

系统窗口关闭按钮表达“我不要这个窗口”，不能隐式等同“销毁网页、终止 Terminal 或处理未保存
草稿”。“关闭 Tab”保留独立命令，并继续使用各领域现有 draft/save/confirmation policy。

### 7.6 主窗口切换工作空间后，辅助窗口是否继续存在？

**推荐答案：必须继续存在，从 Browser M1 就纳入。**

否则用户一切换工作空间，副屏页面就消失，产品会显得不可靠；同时当前 BrowserManager 的全局
`currentWorkspaceKey` 也会成为跨工作空间串页风险。每个窗口必须拥有明确 workspace scope。

### 7.7 Browser 是否允许通过重新加载实现迁移？

**推荐答案：不允许。**

M1 必须迁移既有 `WebContentsView`/WebContents，而不是从 URL 重建。重建会丢滚动、表单、历史、
`window.opener`、POST 现场和稳定 Playwright Page，不能满足“同一个 Tab 移动”的产品承诺。

### 7.8 Editor 支持的最低状态保真是什么？

**推荐答案：dirty 内容、保存基线、版本哈希、光标、选区和 undo/redo 全部保留后才能开放。**

只序列化当前 Markdown 文本不足以称为移动 Editor。若 M2 尚不能迁移 undo/redo，Editor 入口应
继续禁用并显示原因，不能用“内容还在”掩盖编辑现场丢失。

### 7.9 Agent 和 Terminal 迁移时是否暂停运行？

**推荐答案：不暂停运行事实，只迁移可见投影和事件路由。**

Agent run、远程 session 和 Terminal PTY 继续由现有主进程 owner 运行。迁移 transaction 必须
使用 generation/sequence 对事件去重和补发，防止目标 ready 前的窗口造成漏流或双投递。

### 7.10 首版是否恢复窗口位置和分离状态？

**推荐答案：Browser M1 不阻塞于完整恢复；M4 必须补齐。**

M1 退出时至少把逻辑 Tab 安全恢复到 workspace 快照，下次启动可回主窗口。恢复辅助窗口位置、
显示器和 Tab placement 是完整产品门槛，但不应延迟第一个可验收的副屏闭环。

### 7.11 首版辅助窗口能否再接收多个 Tab？

**推荐答案：M1 一个辅助窗口只承载一个 Tab，但数据模型从一开始使用有序 `tabIds`。**

这避免首版同时承担跨窗口命中、TabBar 重排、拖入已有窗口和空窗口回收；同时不给持久化 schema
留下只能表达单 Tab 的死路。多 Tab 辅助窗口放到 M4。

### 7.12 是否默认置顶？

**推荐答案：不默认；后续提供显式“保持在最前”窗口命令。**

默认置顶会遮挡其他 App，也可能把权限确认或敏感页面长期暴露。该状态必须按窗口显式选择、可见
反馈并持久化，不能成为 Browser Tab 自身状态。

## 8. 当前实现事实与差距

### 8.1 当前 Tab 模型

`src/renderer/src/types/index.ts` 定义 20 种 `TabType`。`tab-store` 保存当前 renderer 的 Tab 列表
和 activeTabId，并把当前工作空间 Tab 写入 WorkspaceState。现有 TabBar 的 HTML Drag and Drop
只处理同一数组内 `reorderTabs(fromId, toId)`；`dragend` 只清理 UI 状态。

差距：多窗口后不能让多个 renderer 各自持有并覆盖写入同一 workspace 的完整 Tab 快照，否则会
形成第二状态所有者和最后写入者覆盖。

### 8.2 当前窗口与可信 IPC

`CclinkStudioRuntimeState` 只保存一个 `mainWindow` 和一个 `trustedRendererGuard`。
`createTrustedRendererGuard()` 只信任该窗口的 exact `webContents` 和 main frame，所有 IPC handler
又由同一个全局 registration scope 注册。

差距：不能为每个窗口重复注册同名 `ipcMain.handle`，也不能简单放宽为“同 origin 全部可信”。需要
一个注册一次、按受控 WindowRegistry 校验 sender、windowId、role、main frame 和 URL 的可信
renderer 集合。

### 8.3 当前 BrowserManager

BrowserManager 当前拥有：

- 单个 `mainWindow`；
- 单个 `activeViewId`；
- 单个 `currentWorkspaceKey`；
- 所有 View 共用的一组 `currentBounds/currentRendererBounds`；
- 通过固定主窗口发送 URL、页面元数据、查找、上下文菜单和 popup 事件。

差距：辅助窗口要求 View 绑定具体 host window；每个窗口分别拥有 active View、workspace、bounds、
zoom 和事件接收者。主窗口 reconcile 不能再销毁其他窗口的合法 View。

### 8.4 当前 renderer bootstrap

完整 `App` 会启动 workspace restore/state flush、Agent stream、Terminal events、Browser events、
Context Actions、Shortcut Router 和多个全局 Store。直接在辅助窗口加载完整 `App` 会重复 hydrate、
持久化和事件订阅。

差距：renderer 必须根据由主进程注入并校验的窗口角色，选择 `MainLayout` 或 `AuxiliaryLayout`；
辅助窗口只启动当前 surface 所需的 projection 和 bridge。

## 9. 推荐架构

### 9.1 P0 后再写 ADR

P0 成功只证明平台路线可行，不自动授权 M1。P0 证据完成后、进入 M1 实现前新增 ADR，至少决定：

- 逻辑 Tab descriptor、窗口 placement、窗口 bounds 和 renderer projection 的唯一 owner；
- 主窗口与辅助窗口的生命周期及 App quit 语义；
- WorkspaceState 如何原子保存跨窗口 Tab，而不由多个 renderer 覆盖写；
- Browser View、Editor buffer、Agent stream、Terminal output 各自如何迁移或重新投影；
- 可信 renderer 集合、窗口角色权限和 sender scope；
- 迁移失败、renderer crash、显示器消失和启动恢复策略。

推荐 ADR 不把多窗口作为架构宪法例外，而是通过新的单一 owner 扩展现有边界。

### 9.2 `WorkbenchWindowService` 与主进程 `WorkbenchTabModel`

主进程拆分两个互不重叠的 owner：

- `WorkbenchWindowService` 只拥有窗口注册，以及进入分离生命周期后的 Browser Tab placement、
  相对 order、generation 和移动事务账本；它不镜像主工作台全部 Tab，也不拥有全局 active。
- `WorkbenchTabModel` 唯一拥有逻辑 Tab identity/descriptor、workspace membership、主工作台
  order/active，并作为 WorkspaceState Tab section 的单一持久化 writer。
- `BrowserManager` 拥有每个 native host 的实际 active View；placement IPC 中的 `active` 由该事实
  派生，不能反向把 WindowService 描述成第二个原生 active owner。

建议窗口与 placement 模型：

```ts
type WorkbenchWindowRole = 'main' | 'auxiliary'

interface WorkbenchWindowEntry {
  windowId: string
  role: WorkbenchWindowRole
  workspaceKey: string | null
  orderedTabIds: string[]
  generation: number
  state: 'creating' | 'ready' | 'closing' | 'closed' | 'failed'
  bounds: { x: number; y: number; width: number; height: number }
  displayId?: string
}

interface TabPlacement {
  tabId: string
  workspaceKey: string | null
  windowId: string
  index: number
  generation: number
  state: 'attached' | 'moving' | 'detached' | 'returning'
}
```

`WorkbenchWindowService` 是已 seed、可分离 Browser placement/generation 的运行时 ledger，但不
拥有逻辑 Tab descriptor、完整主工作台 order/active，也不直接写 Tab WorkspaceState；它通过稳定
tabId 引用 `WorkbenchTabModel`。
`WorkbenchTabModel` 不创建或销毁 BrowserWindow，也不能反向成为第二个 placement owner；持久化
时由它串行写入自身 descriptor 与 WindowService 提供的 placement snapshot。两者都不拥有 Browser、
Terminal、Agent、WebAffair 或 Editor 领域运行事实。renderer `tab-store` 改为按 `windowId` 接收
只读/命令式投影，不能再各自覆盖写完整 Tab snapshot。

### 9.3 窗口角色与 renderer 入口

- 主进程创建窗口时生成稳定 `windowId`，并在加载 renderer 前把 exact WebContents 登记到可信
  Window Registry；`windowId` 只是关联 ID，不作为认证凭证。
- 窗口角色不能由普通 renderer query string 自报；preload 只能从主进程获得与当前 sender 绑定的
  `WindowBootstrapDescriptor`。
- `MainLayout` 保留现有完整工作台。
- `AuxiliaryLayout` 只加载必要标题区、TabBar、对应领域 Toolbar、Workbench surface、Toast、
  Context Menu 和窗口命令。
- 辅助窗口不得独立执行完整 workspace hydrate 或把整份 WorkspaceState 写回主进程。

### 9.4 共享契约

新增 `src/shared/ipc/workbench-window.ts` 及运行时 schema，建议包含：

- `window:getBootstrap`
- `window:moveTabToNewWindow`
- `window:returnTabToMain`
- `window:moveTabToWindow`
- `window:auxiliaryReady`
- `window:updateAuxiliaryBounds`
- `window:getPlacementSnapshot`
- `window:placementChanged`
- `tabModel:getWindowProjection`
- `tabModel:projectionChanged`

所有输入在主进程重新解析 tabId、workspaceKey、sourceWindowId 和 generation；renderer 不能自报
Profile、Session、WebContents ID 或目标权限。关闭 Tab 继续执行统一
`workbench.closeTab` command 和领域 draft policy，不在 Window IPC 内建立第二套关闭逻辑。所有
Tab descriptor/active/order 持久化由主进程 `WorkbenchTabModel` 串行合并并写入；renderer 只提交
有界 command 或领域快照，不能提交整份 workspace Tab section。

### 9.5 两阶段移动事务

```text
source command
  -> main validates source window, tab, workspace and adapter support
  -> placement enters moving with transferId + generation
  -> source adapter prepares a bounded transfer snapshot
  -> main creates hidden auxiliary BrowserWindow
  -> trusted auxiliary renderer loads and acknowledges ready
  -> domain adapter rebinds runtime/projection to target
  -> target renders and acknowledges committed generation
  -> placement commits target window
  -> source removes visible projection
  -> auxiliary window shows
```

任一步失败：

```text
target/runtime detach best-effort cleanup
  -> placement rolls back to source generation
  -> source projection remains or is restored
  -> target window closes
  -> structured diagnostic + user toast
```

在目标 commit 前不得调用普通 `closeTab`，否则 Browser View、Terminal session 或草稿清理规则会被
误触发。重复 transferId、过期 generation 和已关闭 target 必须幂等拒绝。

### 9.6 BrowserManager 多窗口宿主

推荐把当前单窗口字段改为显式 host registry：

```ts
interface BrowserViewHost {
  windowId: string
  browserWindow: BrowserWindow
  workspaceKey: string | null
  activeViewId: string | null
  rendererBounds: BrowserBounds
  nativeBounds: BrowserBounds
}
```

`ViewEntry` 增加 `ownerWindowId`。所有 add/remove child view、bounds、zoom、focus、context menu 和
renderer event 都通过 owner host 解析。Playwright 继续按稳定 tabId 绑定 Page，不能以当前焦点窗口
重新选择全局 Page。

Electron 官方 `View` 支持 `addChildView/removeChildView`，`WebContentsView` 支持采用既有
WebContents，但同一个 WebContents 同时只能由一个 WebContentsView 呈现。P0 必须在项目锁定的
Electron 43 上验证跨 `BrowserWindow.contentView` 重挂载，而不是仅依据文档推断。

参考：

- <https://www.electronjs.org/docs/latest/api/browser-window/>
- <https://www.electronjs.org/docs/latest/api/web-contents-view>
- <https://www.electronjs.org/docs/latest/api/view>
- <https://www.electronjs.org/docs/latest/api/base-window>

### 9.7 可信 renderer 与权限

- IPC handler 仍只注册一次；Trusted Renderer Registry 保存允许的主 frame、windowId、role 和 entry
  URL，不接受任意同源 frame。
- 辅助窗口继续 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- preload 权限按角色收窄；如果复用同一 preload，API handler 仍必须按窗口 role 和当前 Tab scope
  拒绝无关调用。
- Browser Profile、Cookie、token、UserSig 和页面正文不进入 window placement 或诊断。
- 外部不可逆动作继续经过现有最终人工确认；确认 UI 应优先出现在发起操作的窗口，无法安全路由时
  显式聚焦主窗口并说明，不得静默显示在另一个屏幕。

### 9.8 WorkspaceState 与恢复

- Window/Tab placement 只有一个持久化 writer；多个 renderer 不得分别写整份 Tab section。
- WorkspaceState 继续按 workspace 保存逻辑 Tab descriptor；窗口 placement 保存稳定 windowId、
  orderedTabIds、bounds、display hint 和 schema version。
- M1 只要求退出后逻辑 Browser Tab 可安全回到主窗口，不恢复分离 placement。
- M4 恢复辅助窗口时先验证显示器和可见 bounds，再创建窗口和投影；显示器缺失、bounds 完全不可见
  或 schema 不兼容时，所有 Tab 回收到主窗口。
- 恢复快照只能恢复投影，不能覆盖 Browser、Terminal 或 Agent 主进程仍存在的运行事实。

### 9.9 Tab Surface Adapter

每种可分离 surface 通过统一 adapter 声明能力：

```ts
interface DetachableTabSurfaceAdapter {
  tabType: TabType
  canMove(context: TabMoveContext): { enabled: boolean; reason?: string }
  prepare(context: TabMoveContext): Promise<TabTransferSnapshot>
  attach(context: TabAttachContext): Promise<void>
  detach(context: TabDetachContext): Promise<void>
  rollback(context: TabRollbackContext): Promise<void>
  disposeWindowProjection(context: TabProjectionContext): Promise<void>
}
```

Adapter 不拥有 window placement，也不复制领域事实。未注册 adapter 的类型默认 fail-closed，并在
统一命令中返回“当前 Tab 类型尚未支持移至新窗口”。

### 9.10 命令与拖拽

- M1 新增稳定命令 `workbench.moveTabToNewWindow`、`workbench.returnTabToMainWindow`；后续新增
  `workbench.moveTabToWindow`。
- M1 只开放 Tab Context Action 和命令面板，先验收迁移语义；拖出手势不属于 M1 退出门槛。
- M1 真人验收通过后，拖出手势只引用同一个命令，不复制迁移逻辑。
- HTML Drag 结束时 renderer 只上报 tabId 和受控意图；主进程使用 source window bounds 与当前
  cursor/display 重新判断是否真的离开窗口。
- 拖拽取消、落回原 TabBar、目标不支持或坐标无效时不创建窗口。
- 对尚未适配的 Tab，菜单项显示禁用原因；拖出时 Tab 回弹并显示一次简短 toast。

### 9.11 无合法源窗口时的 Browser Recovery Host

如果 View 已从源窗口移除，而 source window 同时销毁、target attach 又失败，单纯“保持 runtime”
没有可验证的 native host 和恢复路径。ADR 必须在 M1 前确定承载方案。

推荐主线是主进程按需创建一个 `BrowserRecoveryHost`：

- 使用隐藏 `BaseWindow` 或经 P0 证明等价的最小 native host，不加载 renderer，不使用 preload，
  不显示给用户。
- 只在 source/target 都无法合法承载 View 的回滚路径创建，把同一个 View 临时 attach 到 recovery
  host，保留 WebContents、Session 和 Page 身份。
- WindowService 继续拥有 placement transaction，BrowserManager 继续拥有 View runtime；recovery
  host 只提供临时 native attachment，不成为第三个 Browser 或 Tab 状态 owner。
- 主窗口或新的安全 target ready 后立即把 View 移出 recovery host；设置有界恢复期限、状态诊断和
  明确的“等待窗口恢复/恢复失败”语义。
- App quit、恢复成功和恢复最终失败都必须显式 remove child view，并按真实 Tab 关闭/保留决策释放
  WebContents；Electron `BaseWindow` 关闭不会自动销毁 child WebContents，不能依赖隐式清理。

如果 P0 证明 View 在无 host 状态下同样可以安全保活，ADR 可以选择更小方案，但必须用 crash/
destroy 证据说明最终 owner 和恢复时序；不能把“对象还在内存”当作用户可恢复能力。

## 10. 分阶段支持矩阵

| 阶段 | Tab 类型                                                                                                                                | 支持门槛                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P0a  | 仅测试 Browser runtime                                                                                                                  | 同一 View A -> B -> A；WebContents/Session/Page/tabId 不变、不重载、可回滚 |
| P0b  | 最小测试宿主                                                                                                                            | popup、focus、最小 owner 事件路由和显式释放无泄漏                          |
| M1   | `browser`                                                                                                                               | 右键/命令完成第 6 节真人闭环；所有 M1 发布平台通过核心正确性门禁           |
| M2a  | `terminal`、`terminal-record`                                                                                                           | PTY 不重启；输出补发无重无漏；输入只到 owner window；记录只读恢复          |
| M2b  | `editor`、`preview`、`file-preview`、`model`、`hardware-gerber`、`remote-file`                                                          | Editor 保留 dirty/基线/光标/选区/undo；只读 surface 可重建且状态定义明确   |
| M3   | `conversation`、`remote-conversation`                                                                                                   | run/session 不重启；stream sequence 对账；确认卡、取消和诊断路由正确       |
| M3   | `settings`、`data-source-query`、`data-source-result`、`scheduled-task`、`web-resource`、`web-affair`、`agent-role`、`media-production` | 草稿、单例页、查询结果、上传/渲染进度和领域事件逐项定义 owner 与恢复       |
| M4   | 已支持的全部类型                                                                                                                        | 拖出/拖入、多 Tab、重启/显示器恢复和各平台完整体验                         |

`android` 暂不自动进入任何阶段。Android display、scrcpy、输入、旋转和设备 session 当前也绑定
单窗口能力，只有完成独立 adapter 评审和真机迁移验收后才能加入支持矩阵。

## 11. 推进计划与参考工作量

以下为一名熟悉当前代码库的工程师参考估算，不作为承诺排期：

### P0：跨窗口 Browser 技术验证，4–7 天

#### P0a：核心身份与回滚，2–3 天

- 在隔离测试入口创建 A/B 两个最小受控 native window，不加载完整第二套 Studio App。
- 把同一个 Browser View 从 A 移到 B，再移回 A。
- 验证 WebContents、Session/partition、CDP target/Playwright Page 和稳定 tabId 全程保持同一身份。
- 用导航计数和页面内不可恢复现场证明没有 reload、re-navigation 或重建。
- 注入一次 target attach 失败，证明同一个 View 可以回滚到 A。

P0a 失败立即停止，不继续 P0b，不写多窗口生产基础设施。

#### P0b：最小窗口交互与释放，2–4 天

- 只在最小测试宿主验证 popup/`window.opener`、focus、一个 owner-routed 测试事件。
- 验证 A -> B -> A 后 listener 不重复，旧 owner 不再接收事件。
- 显式关闭临时窗口/View/WebContents，检查无残留 child view、timer、listener 和 CDP/Page 注册。
- 验证 source window 销毁时 View 能进入候选 Recovery Host 或等价安全承载点，再恢复到合法窗口。
- 写出成功证据、平台范围、未知项和明确失败点，不把 auth、download、workspace reconcile 或完整
  BrowserManager 事件路由带入 P0。

退出门禁：

- P0a/P0b 成功：只允许进入 ADR 编写与评审，不授权 M1。
- 失败但存在不重载的官方支持替代：更新 ADR 后重新估算。
- 只能关闭并重载页面：Browser M1 No-Go，不用缩水语义冒充移动。

### M1：Browser 辅助窗口，4–6 周

- ADR、Window Registry、主进程 WorkbenchTabModel/单一持久化 writer、可信多 renderer、
  AuxiliaryLayout。
- BrowserManager 多 host、owner event routing 和两阶段迁移。
- 统一命令、右键入口、关闭送回和失败回滚；拖出入口后置到 M1 真人验收之后。
- 工作空间切换、主/辅窗口焦点、缩放、上下文菜单和自动化关联。
- Browser M1 真人闭环与受影响工程门禁。

### M2：Terminal、Editor 与预览，3–5 周

- Terminal session/output/input 的 owner window 投影与补发。
- Editor buffer transfer、undo/selection 和文件外部变更对账。
- 只读预览、模型、Gerber 和远程文件 adapter。
- dirty 关闭、保存、窗口 crash 和返回主窗口验收。

### M3：会话和业务 Tab，3–5 周

- Agent/Remote stream、confirmation、cancel、diagnostics 路由。
- 草稿型、单例型和长任务型页面逐项适配。
- 不支持类型保持 fail-closed，不因通用外壳存在而自动开放。

### M4：完整窗口体验，2–3 周

- 把 Tab 拖入已有辅助窗口、跨窗口排序和空窗口回收。
- 辅助窗口多 Tab、恢复位置/显示器/placement、可见区域纠正。
- 显式 always-on-top/compact mode（若产品仍需要）。
- macOS、Windows、Linux 的拖拽、DPI、显示器恢复和窗口交互体验收尾；不能把 M1 基本不重载、
  可回滚和状态归属正确性推迟到这里。

完整通用能力在 P0 前只能粗估为 13–20+ 人周，其中主进程 Tab Model、Editor undo/selection、
会话流对账和草稿型页面是主要不确定项；必须在 P0 和 Browser M1 后重新估算。Browser M1 可以
独立交付，不必等待所有类型。

## 12. P0 必须证明什么

P0 是整个方案的止损门，不允许扩张为通用多窗口重构或提前实现半个 M1。

### 12.1 P0a：核心身份与回滚

1. Electron 43 下，同一个 `WebContentsView` 能否从窗口 A 的 `contentView` 移除并挂到窗口 B，
   再挂回 A？
2. WebContents ID、Session/partition、CDP target/Playwright Page 和稳定 tabId 是否逐项保持同一身份？
3. 导航计数、页面内状态和事件是否证明没有 reload、re-navigation 或 renderer 重建？
4. target attach 失败时，同一个 View 是否可以回到 A，且原运行时仍可交互？

### 12.2 P0b：最小交互、Recovery Host 和释放

1. 最小 popup/`window.opener` 语义和 focus 是否在 A -> B -> A 后仍成立？
2. 一个带 owner windowId/generation 的测试事件是否只发给当前 owner，旧 owner listener 是否释放？
3. source window 销毁且 target attach 失败时，View 能否进入候选 Recovery Host/等价承载点并恢复？
4. 显式结束测试后，child view、WebContents、timer、listener、CDP target 和 Page 注册是否全部释放？

P0 使用本地可控页面和最小 native host，不使用真实账号作为唯一证据，也不要求验证完整 auth、
download、BrowserTask event、renderer crash recovery 或 workspace reconcile。这些属于 ADR/M1；M1
仍必须补真实已登录网站和生产事件路由验收。

## 13. 失败矩阵

| 失败场景                              | 推荐行为                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------ |
| 辅助 BrowserWindow 创建失败           | 原 Tab 不动；结构化 `window-create-failed`                               |
| 辅助 renderer 未 ready/超时           | 销毁目标窗口；placement 回滚；原 Tab 保持                                |
| View 从源窗口 detach 失败             | 不提交迁移；恢复源 active/bounds                                         |
| View 已 detach、目标 attach 失败      | 优先重新 attach 源窗口；源窗口无效则进入 Recovery Host，再恢复到合法窗口 |
| source window 同时销毁                | View 进入主进程 Recovery Host/ADR 等价承载点，不能成为无 owner 悬空对象  |
| source renderer 在迁移中 reload/crash | main owner 取消或接管事务；目标未 commit 不显示半成品                    |
| target renderer crash                 | Browser/Terminal/Agent 运行事实继续存在；尝试送回主窗口                  |
| 主窗口切换 workspace                  | 只更新主窗口 host；不 reconcile 其他窗口 View                            |
| 辅助窗口关闭                          | 非 App quit 时送回；显式“关闭 Tab”才执行领域清理                         |
| App 正常退出                          | M1 保存逻辑 Tab 可恢复；M4 保存并恢复 placement                          |
| 显示器拔出                            | M4 把窗口 bounds 回收到最近可见 display；运行事实不中断                  |
| 过期/重复 transfer event              | generation/transferId 幂等拒绝并记录脱敏诊断                             |
| 不支持的 Tab 被拖出                   | 不创建窗口；回弹并说明尚未支持                                           |

## 14. 诊断要求

每次移动至少记录：

- `transferId`、tabId、tabType、workspaceKey；
- source/target windowId 和 role；
- placement generation；
- `prepare/create/ready/detach/attach/commit/rollback` 当前阶段和耗时；
- Browser View/WebContents/Page 关联状态，只记录稳定 ID 和 matched/mismatch，不记录页面正文；
- 失败分类和脱敏消息；
- 回滚是否成功、最终 owner window。

不得记录 URL 查询参数、Cookie、Header、token、UserSig、Terminal 输入正文、Agent 消息全文或未保存
文档正文。复制诊断应能回答“Tab 最终在哪个窗口、运行事实是否仍在、回滚是否完成”。

## 15. 验证矩阵

### 15.1 自动化

- shared window/placement contract parser 和非法 sender/role/scope。
- WorkbenchWindowService 状态机、generation、超时和幂等回滚。
- 窗口关闭、renderer crash、App quit 的生命周期对称。
- BrowserManager 多 host reconcile：A 窗口不能销毁 B 窗口 View。
- Browser event 只投递 owner renderer；owner 变化后不双投递。
- WorkspaceState 单 writer、跨窗口 descriptor 聚合和旧 schema 回退。
- Context Action inventory、统一 command 和禁用原因。
- 各 adapter 的 prepare/attach/detach/rollback contract。

### 15.2 真实 App

- 单显示器拖出/送回、拖拽取消、窗口 close 与显式 close Tab。
- 双显示器不同缩放比例、主副屏互换、窗口最大化/最小化。
- Browser 已登录页、表单、滚动、前后历史、popup、下载、find、context menu。
- BrowserTask/Playwright 在迁移前、中、后运行；同 tabId 精确寻址。
- 主窗口切 workspace A -> B -> A，辅助窗口不串页、不销毁。
- 辅助 renderer reload/crash、主窗口 reload、App quit。
- M2 后验证 Editor dirty/undo、Terminal 输出/输入；M3 后验证 Agent stream/confirmation/cancel。

### 15.3 工程门禁

- `pnpm verify` 和受影响 smoke 通过。
- 多窗口/辅助窗口新增独立 smoke，不依赖人工鼠标拖拽作为唯一自动门禁；自动测试可以调用同一个
  command，真人再验证拖拽手势。
- 真实应用端到端验收通过前，只能报告工程准备度，不能宣称对应产品能力完成。
- M1 准备发布到哪个平台，哪个平台就必须通过核心“不重载、同一身份、失败可回滚、状态归属正确”
  门禁；如果当前只发布 macOS，Windows/Linux 不得宣称 M1 已支持。M4 只承接拖拽、DPI、显示器恢复
  等完整体验，不能补做基本正确性。

## 16. 风险分级

### 高风险

- 多 renderer 同时写 WorkspaceState，造成 Tab、dirty buffer 或 active state 覆盖。
- BrowserManager 的单窗口/单 workspace 假设导致跨窗口 View 被 reconcile 销毁。
- Browser 迁移重建 WebContents，破坏登录现场和 Playwright 关联。
- Agent/Terminal 流在 owner 切换时漏投、重复投递或错误路由。
- 辅助窗口关闭误用普通 `closeTab`，触发运行时销毁或草稿清理。
- Trusted Renderer Guard 为支持多窗口而放宽成任意同源 sender。

### 中风险

- HTML Drag 在不同 OS/Wayland 下的鼠标坐标和拖出反馈差异。
- 多显示器 DPI、窗口 bounds、Zoom 和 WebContentsView bounds 换算。
- 快捷键、菜单、保存对话框和权限确认显示在错误窗口。
- 页面 occlusion/background throttling 改变定时器或自动化行为。

### 低风险但必须收尾

- 窗口标题、favicon、dirty 标记和系统文档 edited 状态。
- 空辅助窗口回收、焦点返回、无障碍和键盘移动命令。
- 多窗口主题、app zoom 和 compact mode 一致性。

## 17. 明确 No-Go 的捷径

以下实现即使演示可见，也不能合入为正式能力：

- 直接 `new BrowserWindow()` 加载完整 `App`，让第二套 Zustand Store 自行 hydrate 和 persist。
- 用 `window.open()` 或 renderer 自己创建未登记的窗口。
- Browser 只保存 URL，在新窗口重新 `loadURL()`。
- detach 时先从 source 调用普通 `closeTab`，再尝试在 target 重建。
- 为每个窗口重复注册同名 `ipcMain.handle`。
- Trusted Renderer Guard 只校验 origin，不校验 exact main frame、window registry 和 role。
- BrowserManager 继续使用全局 `activeViewId/currentWorkspaceKey/currentBounds`，靠“当前最后一个窗口”
  猜 owner。
- Editor 丢 undo/selection、Agent/Terminal 丢流后仍把该类型标记为支持。
- 只做拖拽入口，没有命令、键盘入口、失败提示和回滚。

## 18. 阶段退出条件

### P0 退出

- 2026-08-19 已在 Electron 43.1.1 / macOS arm64 通过；证据与统一命令见
  `docs/ops/detachable-workbench-tabs-p0-acceptance.md`。
- P0a 先通过；失败立即止损。P0a 通过后 P0b 与第 12 节问题全部有可复现证据。
- 结论明确为继续、替代或 No-Go；不能把未知项留给 M1 顺便解决。
- P0 没有扩散为全部 Tab、恢复系统或通用 Layout 重构。
- P0 通过只授权编写/评审 ADR；ADR 未明确 Window owner、Tab owner、单一 writer、权限和回滚语义
  前仍不得启动 M1。

### Browser M1 退出

- 第 6 节全部真人验收通过。
- Browser runtime、Profile、Page 和 tabId 不变。
- 主窗口工作空间切换不影响辅助窗口。
- 关闭送回、显式关闭和迁移失败回滚均有证据。
- `pnpm verify`、受影响 smoke 和架构复审通过。
- 所有计划发布 M1 的平台均已通过核心不重载、身份连续、失败回滚和归属正确性门禁；未验证平台
  不进入支持声明。
- 拖出手势不属于 M1 完成声明；只能在上述闭环通过后作为同一命令的新入口接入。

### 通用能力退出

- 第 5 节覆盖的每一种宣称支持类型都有独立状态保真验收。
- M4 placement/显示器恢复、跨窗口拖入和多 Tab 辅助窗口完成。
- 未适配类型仍 fail-closed，不存在“外壳支持所以默认支持”的隐式扩权。
- 产品文档、架构文档、Context Action inventory、诊断与运维验收事实同步更新。

## 19. 独立审查必须继续拷问

- `WorkbenchWindowService` 是否只拥有窗口/placement，`WorkbenchTabModel` 是否唯一拥有逻辑 Tab 和
  持久化，还是 renderer 仍能绕过两者改变归属或覆盖 WorkspaceState？
- BrowserManager 从单 host 改成多 host 后，是否仍存在任何读取“全局当前窗口/当前 workspace/当前
  Page”的路径？
- P0 是否真实保留 WebContents 和 Playwright Page，还是测试只验证了相同 URL/Profile？
- M1 是否为了缩短排期省略工作空间切换、关闭送回或失败回滚，从而留下不可用的演示版本？
- 辅助窗口权限是否最小化，还是为了复用完整 App 把全部 preload API 暴露给每个窗口？
- 事件路由是否有 sequence/generation 证据证明无重无漏，而不是依赖“通常很快”？
- Editor、Agent、Terminal 和草稿型页面是否逐项证明状态保真，还是通过通用序列化假设它们相同？
- 窗口 crash、App quit 和显示器拔出后，运行事实、投影和持久化最终是否能确定归属？
- 自动化是否只证明 command；M1 真人验收是否覆盖真实双屏交互，后续拖出阶段是否另行覆盖真实
  拖出手势？
- 团队是否把 ADR、Schema、测试数量或 P0 spike 当成用户功能进度？Browser M1 真人闭环完成前，
  用户功能进度仍然是未交付。

## 20. 外部参考

VS Code 的浮动窗口提供拖出和“Move into New Window”两种入口，并逐步扩展到 Terminal、Notebook、
Webview 和集成浏览器。其 Webview 跨窗口迁移可能需要 reload 的公开限制，也反向说明 Studio 不能
假设所有 surface 天然可搬迁；每类 Tab 必须定义自己的状态保真门槛。

- <https://code.visualstudio.com/docs/configure/custom-layout>
- <https://code.visualstudio.com/docs/editing/userinterface>
- <https://code.visualstudio.com/updates/v1_85>
- <https://code.visualstudio.com/updates/v1_88>
