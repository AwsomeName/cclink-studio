# ADR 0017：主进程拥有的可分离 Workbench Tab

- 状态：accepted
- 日期：2026-08-19
- 负责人：CCLink Studio Maintainers
- 前置证据：`docs/ops/detachable-workbench-tabs-p0-acceptance.md`
- 审查：P0a/P0b、状态 owner、单 writer、权限、Recovery Host、关闭/回滚和平台门禁均已明确
- 实施证据：`docs/ops/detachable-workbench-tabs-m1-acceptance.md`；生产实现与真实 App 自动门禁
  已通过，物理双屏/真实账号真人签收仍待执行

## 问题

用户需要把 Browser Tab 移入独立窗口并放到副屏，同时保留登录现场、页面状态和 Playwright
自动化关联。现有工作台只有一个 `BrowserWindow`、一个完整 renderer 状态树和一套绑定主窗口的
Browser host/event 路由；直接加载第二套完整 App 会产生多个 WorkspaceState writer、重复全局
订阅、错误 IPC 权限和 Browser runtime 生命周期分叉。

P0 已在 Electron 43.1.1 / macOS arm64 证明同一个 `WebContentsView` 可以跨窗口重挂载而不改变
WebContents、Session、CDP target 或 Playwright Page；隐藏 `BaseWindow` 也可以在 source/target
都失效时承载同一 View，且不改变父 Page visibility。技术路线可行，但生产实现仍需唯一 owner、
事务、权限、持久化和关闭语义。

## 用户验收目标

Browser M1 只在以下端到端动作全部成立时交付：

1. 用户在主窗口打开已登录 Browser Tab，填写未提交表单并停在任意滚动、历史位置。
2. 用户通过 Tab 统一上下文操作或命令面板选择“移至新窗口”，辅助窗口出现且原 Tab 不再在主窗口
   重复显示。
3. 用户把辅助窗口移到副屏继续浏览；登录、表单、滚动、前后历史、popup 和 Playwright/BrowserTask
   继续使用同一 `tabId` 和 Page，不 reload。
4. 用户切换主窗口工作空间，辅助窗口中的原工作空间 Tab 继续存活且不串页。
5. 用户关闭辅助窗口，Tab 自动送回主窗口；只有显式“关闭 Tab”才销毁 Browser runtime。
6. target 创建、ready 或 attach 失败时，Tab 回到 source；source 同时失效时进入 Recovery Host 并
   恢复到合法窗口，不能丢页面现场或形成无 owner runtime。

Browser 拖出手势作为 M1 通过后的入口扩展复用同一 transaction，不改变 owner 决策。多 Tab 辅助
窗口、重启恢复 placement、Editor/Terminal/Conversation 仍不属于 Browser M1 完成声明。

## 决策

### 1. 三个互不重叠的主进程 owner

1. `WorkbenchWindowService` 是**进入分离生命周期后**的 Browser Tab placement ledger：拥有顶层窗口
   注册、稳定 `windowId`、role、已 seed placement 的相对 order、generation 和移动事务状态。它不
   镜像主工作台全部 Tab，也不是全局 active Tab 或原生 active View 的事实源；不拥有逻辑 Tab
   descriptor，不直接写 WorkspaceState，也不拥有 Browser runtime。
2. `WorkbenchTabModel` 唯一拥有逻辑 `tabId`、descriptor、tab type、workspace membership、主工作台
   Tab order/active 和 WorkspaceState Tab section 写入，并作为唯一串行、原子持久化 writer；
   renderer 不再提交整份 Tab/WorkspaceState 快照。
3. `BrowserManager` 继续唯一拥有 Browser `WebContentsView`、WebContents、Profile/Session、
   Playwright Page、popup/runtime 监听器以及每个 native host 当前实际 active View。它按
   `windowId` 索引 host registry，并在每个 Browser entry 上保存当前 `ownerWindowId`；IPC placement
   投影的 `active` 由这个原生事实派生，但 BrowserManager 不拥有逻辑 placement 或 workspace
   descriptor。

三者只通过稳定 ID、共享 contract 和显式 transition 协作。任何 renderer store 都是可丢弃只读
投影，不能反向成为第四个 owner。placement 中的 `workspaceKey` 只是从 TabModel descriptor 复制的
校验字段；两者不一致时 transition fail-closed，以 TabModel 的 workspace membership 为事实源。

### 2. 窗口角色和 renderer 权限

- 窗口角色只有 `main` 与 `auxiliary`。M1 每个辅助窗口只承载一个 Browser Tab。
- 主进程在加载 URL 前登记 exact WebContents、main frame、entry URL、`windowId` 和 role；query
  参数、自报 `windowId`、同源 iframe 或 popup 都不能获得信任。
- `WindowBootstrapDescriptor` 由主进程按 sender 返回。辅助 renderer 使用独立最小 preload，只暴露
  bootstrap、Browser projection/command、return/close、bounds、主题和诊断 API；不复用主窗口的
  完整 `window.cclinkStudio` 权限面。它只启动 `AuxiliaryLayout` 和 Browser 当前投影，不执行完整
  workspace hydrate、Agent/Terminal bootstrap 或全量持久化。
- 辅助窗口保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。preload 即使
  复用，handler 也必须按 exact sender、role、当前 `tabId` scope 和 generation 检查；未知命令
  fail-closed。
- renderer 只能提交有界 command；不能提交 Profile、Session、WebContents ID、Cookie、token、
  UserSig、页面正文或目标权限。
- 现有 `TrustedRendererGuard` 的默认权限仍是 main-only；迁移成 registry 后，既有 filesystem、Agent、
  Terminal、设置和全量 WorkspaceState IPC 不自动开放给 auxiliary。只有 contract 显式列出
  `auxiliary` role 且 scope 校验通过时才能调用。
- renderer CSP/webRequest 是 Session 级资源，不能复制当前“每个窗口注册、窗口关闭时清空”的
  `onHeadersReceived` 生命周期。WindowService 使用独立的无持久敏感状态 auxiliary UI Session，
  并按 Session 单次安装、引用计数释放 CSP/导航策略；Browser View 仍使用各自 Profile Session，
  两者不能混用。

### 3. 契约先行和唯一注册

先在 shared IPC contract 与运行时 schema 中定义 bootstrap、projection、move、return、ready、
bounds 和 placement event。通道、参数、角色权限、结构化错误和释放路径来自同一声明源。

IPC handler 和领域监听器在主进程只注册一次。事件发送前由 WindowService/BrowserManager 解析当前
owner；不得在每个窗口重复 `ipcMain.handle`，也不得向所有 trusted renderer 广播后由 renderer
自行过滤。

### 4. 两阶段移动事务

每次移动生成随机 `transferId` 和递增 generation，并采用以下顺序：

1. WindowService 校验 source、tab、workspace、generation、Browser adapter 和目标能力；placement
   进入 `moving`，但 source 投影和 View 保持可用。
2. 创建隐藏 auxiliary `BrowserWindow`，完成 trusted registration；auxiliary renderer 加载最小
   Layout 并回执 ready。
3. BrowserManager 记录 source host，准备 owner 路由；仅在 target ready 后从 source remove 同一个
   View，再向 target add。
4. BrowserManager 设置 target bounds 并确认 View/WebContents/Page 身份与 owner；target renderer
   回执 attachment ready 后，WindowService 原子提交 placement generation，TabModel 持久化新投影。
5. source 删除旧投影，target renderer 接收 committed generation，辅助窗口显示并取得 native/page
   focus。纯焦点失败只形成可诊断 UX 降级；target show/renderer/projection 在 commit 后失效时必须
   新建反向补偿 transaction，不能调用原 transaction 的 rollback。

target create/ready 前失败时 source 不动。remove 后 attach 失败时优先重新 attach source；source
仍合法且回滚成功前不创建第二 runtime、不 reload URL。重复 `transferId`、过期 generation、错误
source 或已关闭 target 都幂等拒绝。commit 前失败走 rollback；commit 后 target renderer/window
失效走新的补偿性 `returning` transaction，补偿自身失败时才进入 Recovery Host；每个终态
transaction 在诊断发出后释放，不能把 generation 倒写成旧值或无限保留历史记录。

### 5. Recovery Host

采用 P0 验证过的主进程 `BrowserRecoveryHostRegistry`。它由 BrowserManager 生命周期拥有，不登记为
用户顶层 Workbench window；WindowService 只记录对应 placement 的 `recovering` 状态：

- 每个 recovering View 按需创建一个隐藏 `BaseWindow`，尺寸为最小安全 bounds，不加载 renderer、
  不使用 preload，只临时 attachment 该既有 Browser View。P0 只证明单 View host，因此 M1 不把
  多个恢复中的 View 堆到同一个未经验证的 BaseWindow。
- source 无效且 target attach/commit 失败时，BrowserManager 把同一个 View attach 到 Recovery
  Host；WindowService 将 placement 标记为 `recovering`，记录原 workspace/tab/source/target 和
  generation。Recovery Host 不成为 Tab、placement 或 Browser runtime owner。
- 服务立即尝试找到或重建 trusted main host并送回。主动恢复尝试有 10 秒上限；超时后进入明确
  `recovery-failed` 降级态，View 继续由 Recovery Host 承载而不销毁。任一 surviving trusted
  窗口显示持久恢复入口；若没有用户窗口则尝试重建主窗口。
- 用户重试、窗口重建或 App quit 都使用同一幂等 transition。恢复成功后显式 remove child View；
  App quit 或用户显式关闭 Tab 时先 remove，再显式关闭 WebContents。不能依赖 `BaseWindow.close()`
  自动销毁 child WebContents。

### 6. 关闭、崩溃、工作空间和 App quit

- 用户关闭辅助窗口时拦截 native close，进入 `returning`，把 Tab 送回 main；返回 commit 后才销毁
  辅助 renderer/window。关闭窗口不调用普通 `closeTab`。若 main 当前显示其他 workspace，Tab 只
  回到其原 workspace 的 main placement，不强制切走用户当前 workspace；用户返回原 workspace 时
  可见，并收到“已送回工作空间”的明确反馈。
- 用户关闭主窗口继续表示退出 Studio，不能因为仍有辅助窗口而悄悄留在后台。WindowService 将其
  转为一次 App quit；所有辅助窗口跳过送回动画，先由 TabModel 保存逻辑 Tab 并归一化下次启动的
  main placement，再统一清理。主 renderer crash/reload 不等同于用户关闭，走重建/Recovery 路径。
- 用户显式关闭 Tab 时继续走统一 `workbench.closeTab` 和 Browser 领域清理；关闭成功后空辅助窗口
  才销毁。
- target renderer reload/crash 时 Browser runtime 仍由主进程存在；WindowService 将 View 送回
  main，main 不可用时进入 Recovery Host。source renderer crash 不取消已经由主进程提交的 target。
- 主窗口切换 workspace 只改变 main host 投影；辅助窗口继续绑定创建时的 workspace。main 的
  reconcile 不能销毁其他 host 的合法 View。
- 正常 App quit 不执行“送回”动画。TabModel 先保存可恢复逻辑 Tab，并将 M1 placement 归一为
  下次启动回到 main；随后对所有 host、View、listener 和窗口按注册表反向显式清理。
- M1 不恢复辅助窗口 placement。异常退出后只按现有 Browser Tab 恢复能力回到 main，不伪称保留
  进程内 Page。

### 7. popup、focus、下载、自动化和认证

- popup 继续由 BrowserManager 采用到与父 Tab 相同的 Profile/Session 和 owner host；父 Tab
  移动不重建 popup opener 关系。popup 自身若成为独立 Browser Tab，必须有独立稳定 `tabId`。
- move/return commit 后由当前 owner host 取得 native focus，再通过真实 surface 交互恢复页面焦点；
  不能只以 `webContents.focus()` 被调用作为成功证据。
- find、context menu、title/favicon、zoom、download、popup 和 BrowserTask event 都按当前
  `ownerWindowId + generation` 单播。下载运行事实留在主进程，UI 只投影到当前 owner。
- Playwright/BrowserTask 始终按稳定 `tabId` 取已登记 Page，不因焦点或 active window 重新选择
  全局 Page。
- 隔离认证子进程不成为普通 detachable Browser，不接入 CDP/preload；账号 Profile 完成受控回传
  后的普通 Browser Tab 才可移动。

### 8. 持久化、诊断和平台声明

- TabModel 对 WorkspaceState Tab section 串行、原子单写；窗口投影改变时只合并最新 generation，
  过期 renderer 快照不能覆盖主进程事实。
- 现有 `browserTabs` section 同时包含 Tab 恢复状态和书签，M1 必须先做可回滚 schema 拆分：
  `tabs` 与 `browserTabs.tabs` 由 TabModel 写；`browserTabs.bookmarks` 迁移到独立
  `browserBookmarks` section，由窄作用域的主进程 `BrowserBookmarkModel` 拥有和写入。TabModel 不
  拥有书签，BookmarkModel 不拥有 Tab。迁移保留原 section/备份直至新快照成功；成功后在同一
  WorkspaceState 串行队列中原子移除 `browserTabs.bookmarks` 保护副本，清理失败可重试且不回删
  已写入的独立 section。
- main renderer 对 Tab 标题、active、Browser URL 输入投影、view/zoom/history 或书签的修改使用
  类型化 command；对应主进程 model 校验 workspace/tab/generation 后写入。通用
  `workspaceState:setSection` 对 `tabs`、`browserTabs` 和 `browserBookmarks` fail-closed，避免旧
  renderer 路径重新成为 writer；其他既有 WorkspaceState section 维持当前 owner 和接口。
- BrowserManager 是真实 URL、导航历史、view/zoom 和 Page 状态的运行时事实源；TabModel 只保存
  可恢复投影和 renderer 尚未提交导航的 URL 输入草稿。BrowserManager 事件更新投影时运行事实
  优先，TabModel 不能用恢复快照反向覆盖仍存活的 runtime。
- 每个 transfer 记录脱敏的 transferId、tabId、tabType、workspaceKey、source/target windowId、
  generation、阶段、耗时、回滚、最终 owner 及 View/WebContents/Page matched/mismatch。不得记录
  URL 查询参数、Cookie、Header、token、页面正文或表单内容。
- 当前 M1 发布目标仅 macOS arm64。增加 Windows/Linux 目标前，必须在对应平台通过核心不重载、
  身份连续、失败回滚和 owner 路由门禁；未验证平台不进入支持声明。

## 不变量

1. 一个逻辑 Tab 只有一个 `tabId`、workspace membership、placement 和领域 runtime owner。
2. 移动 Browser Tab 不创建新 WebContents、Session、Playwright Page 或 Profile，不调用 `loadURL`
   恢复现场。
3. renderer 只持有投影；WorkspaceState Tab section 只有 TabModel 一个 writer。
4. 一个 Browser View 同时最多 attach 到一个 native host；任何无 source/target 的间隙都必须进入
   有记录的 Recovery Host transition，不能成为悬空对象。
5. 关闭窗口与关闭 Tab 是两个动作；前者送回，后者才执行领域销毁和 draft policy。
6. 未注册 Tab adapter、未知 renderer、过期 generation 和越权 scope 全部 fail-closed。
7. 多窗口失败只能降级 Browser/该 Tab，不阻断本地 Editor、Agent、Terminal、数据源或 Android。
8. 所有窗口、终态 transfer、IPC、listener、View、WebContents 和 Recovery Host 都有对称、幂等
   释放路径；关闭的辅助窗口与历史 transfer 不得形成无界内存账本。
9. 不扩张外部不可逆动作的人工确认边界，不触碰系统钥匙串。

## 备选方案

- **每个辅助窗口加载完整 App 和独立 Zustand/持久化**：拒绝。会形成多个 writer、重复订阅和
  最后写入覆盖。
- **保存 URL/Profile 后在新窗口重建页面**：拒绝。丢失表单、JS 内存、历史和 Playwright Page，
  不符合移动语义。
- **让 `WorkbenchWindowService` 同时拥有 Tab descriptor 和 Browser runtime**：拒绝。会吞并
  TabModel/BrowserManager 已有领域 owner，形成生命周期分叉。
- **renderer 自己 `window.open()` 并声明角色**：拒绝。无法建立 exact trusted sender 和最小权限。
- **View detach 后无 host 保活**：拒绝。没有可验证归属、恢复 UI和对称释放。P0 已证明隐藏
  `BaseWindow` 可保留 visibility 和身份。
- **M1 同时实现拖拽、全部 Tab、多 Tab 辅助窗口和 placement 恢复**：拒绝。扩大失败面且推迟首个
  可验收纵向闭环。

## 风险与影响

- `BrowserManager` 当前单 host、单 bounds、固定 renderer 路由需要受控改造，任何遗漏都可能让
  主窗口 reconcile 销毁辅助窗口 View。
- WindowService 与 TabModel 是新主进程 owner；如果 renderer 旧持久化路径未先关闭，会出现双写。
- macOS P0 不能代表 Windows/Linux；未来扩大发布平台会增加前置门禁。
- 隐藏 Recovery Host 在 P0 保持 `visible`，但生产的 background throttling、长时间恢复和内存压力
  仍需 M1 故障 smoke 与真实 App 验证。
- popup、下载、菜单、权限确认和 BrowserTask 事件的 owner 路由比页面搬迁本身更容易漏项；必须按
  事件清单逐项验收，不能只证明页面可见。

## 迁移计划

1. 先落 shared schema、Window Registry/Trusted Renderer Registry 和只读 projection，不开放用户
   move 命令。
2. 引入 TabModel 单 writer与 BrowserBookmarkModel，拆分 `browserTabs` 混合 section，迁移现有
   renderer Tab/Browser/书签持久化调用；用旧 schema 兼容读取、备份和原子回滚保护现有
   WorkspaceState。
3. 实现 WindowService 状态机和 BrowserRecoveryHost，并以 fake adapter 验证 generation、超时、
   close/quit/crash 和幂等回滚。
4. 把 BrowserManager 改成多 host registry；先保持所有 View 在 main，固定行为测试后接 Browser
   adapter。
5. 接入隐藏 auxiliary renderer、两阶段 move/return 和 production 事件路由；最后开放统一上下文
   操作/命令入口。
6. 完成 macOS 真实 App 验收与受影响 smoke/`pnpm verify`；Browser 拖出入口通过后，其他 Tab 仍需
   独立 adapter 与状态保真验收。

每一步都必须保持普通单窗口 Browser 可用；新服务初始化失败时禁用“移至新窗口”并给出可诊断
原因，不阻断 Studio 启动。

## 回收或复审条件

- Electron 升级后 WebContentsView 跨窗口身份、visibility 或 popup opener smoke 失败；
- 产品要支持多个 Tab 共处辅助窗口、重启恢复 placement 或跨窗口拖入；
- Windows/Linux 加入正式发布目标；
- Recovery Host 在真实故障或长时间运行中改变 Page 行为、产生泄漏或无法提供恢复入口；
- TabModel 单 writer 无法与 WorkspaceState 现有原子事务兼容；
- Editor/Terminal/Conversation adapter 进入施工，需要各自状态保真 ADR 补充或本 ADR 修订。

## 验证

- P0：`pnpm smoke:detachable-tabs-p0` 在 Electron 43.1.1 / macOS arm64 通过。
- shared schema：非法 role、sender、scope、generation 和 descriptor 全部拒绝。
- WindowService：create/ready/move/commit/return/rollback/recovery/close/quit 状态机、超时和重复事件。
- TabModel：多 renderer 投影下仍只有一个串行 writer；过期 generation 不覆盖新状态；旧 schema
  可回退。
- BrowserManager：main/aux/recovery host 隔离；A reconcile 不影响 B；所有 owner event 单播且监听器
  不重复。
- 故障：target create/ready/attach/commit、source close、target renderer crash、main reload 和 App quit。
- 真实 App：完成“用户验收目标”六步，并补真实登录页、popup、下载、find、context menu、缩放、
  BrowserTask、工作空间切换和双显示器。
- `pnpm verify`、受影响 smoke 和架构拷问全部通过前，不得声明 Browser M1 完成。
