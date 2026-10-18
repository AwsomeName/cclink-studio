# Activity Bar 文字横排开发方案

> 状态：最小方案代码与测试装配已实现；相关测试和真实 Electron 自动化已通过。真人使用签收及正式发布未执行。
>
> 实施证据：[文字横排验收记录](../design/activity-bar-text-navigation/README.md)。
>
> 日期：2026-10-15。
>
> 产品事实源：[文字横排产品方案](activity-bar-text-navigation-product-design.md)。
>
> 下文保留已实施的范围与验收标准；实际执行结果、证据及未验证项以验收记录为准。

## 结论与本轮验收能力

交付一个完整的 renderer 导航改版：用户免登录启动后，可以直接阅读完整能力名称，点击进入原功能，
区分当前位置、悬停和焦点；缩小窗口后仍能找到全部入口，放大、切换工作空间及重启后保留既有布局目标。
验收按产品文档 U1–U8 执行，不能用组件快照通过替代产品完成。

主线缺口是当前上下排列、短名称和 48px 行高，以及导航加宽后暴露的中央空间预算不足。
独立评审还确认入口缺陷、完整手势保存规则和验收证据三个直接阻塞，均纳入本轮，不能以“保留原行为”或“最小修改”排除。
2026-10-16 根据用户反馈将导航从 154px 收窄至 140px，并同步宽度表；最小改动落在 ActivityBar、局部 CSS、现有布局纯函数、
MainLayout 接入，并定向补齐 UI store 白名单、现有菜单命令及 ResizeHandle 手势结束语义和相应测试。
不新增 IPC、主进程服务、持久化字段、路由、菜单 owner 或泛化导航框架；不需要架构例外 ADR。
若实施中发现必须越过这些边界，先停下记录证据并修订方案，不能直接扩张。

## 当前代码事实与直接缺口

| 位置                                                                         | 已核对的当前事实                                                                                                                                   | 本轮需要改变的内容                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/activity-bar/ActivityBar.tsx`                   | `MAIN_ICON_GROUPS` 定义 15 项；`label/shortLabel` 分开；图标 22px；选中读取 `activePanel`；公司、账目、浏览器、设置有既有特殊路径                  | 同行呈现完整显示名称，图标 18px；保留 ID、顺序、入口行为与状态来源                           |
| `src/renderer/src/assets/main.css`                                           | `--activitybar-width: 76px`；按钮 48px、纵向 flex、文字 11px；计数绝对定位；中部滚动、底部独立                                                     | 总宽 140px、行高 32px、文字 13px、横向对齐、行末计数，区分 hover/active/focus                |
| `src/renderer/src/components/activity-bar/ActivityBar.css`                   | 只有“局部样式在 main.css”说明                                                                                                                      | 无须迁移整段样式；不同时保留两份生效规则                                                     |
| `src/renderer/src/utils/panel-layout.ts`                                     | `ACTIVITY_BAR_WIDTH = 76` 与 CSS 同步；当前仅计算 Agent 上限；Sidebar 范围 160–500、Agent 范围 220–960，中央预算 320                               | 更新导航宽度；在现有模块内增加必要的 Sidebar 有效宽度计算，同一预算决定两栏显示宽度          |
| `src/renderer/src/App.tsx`                                                   | Sidebar 直接显示保存目标宽度；Agent 区分目标与有效宽度；实际仅 right 模式挂载右分隔条                                                              | 接入 Sidebar 有效宽度并按可见面板计算预算；保持 mode/source/visible 的用户状态不变           |
| `src/renderer/src/stores/ui-store.ts`                                        | `VISIBLE_ACTIVITY_PANELS` 漏掉 `company-accounts`，导致 `setActivePanel/showPanel` 和快照恢复把账目回退为 files；其余布局持久化复用 WorkspaceState | 补上已存在的合法 ID 及回归；不新增字段、不改存储格式；窗口 resize 不能保存临时压缩值         |
| `src/renderer/src/features/context-actions/domains/shell-context-actions.ts` | `activity.open` 已有，但用于验证入口的 `ACTIVITY_LABELS` 缺少五个合法 ID，账目打开还需原 Tab 动作                                                  | 在原命令内补齐合法入口及必要业务动作，保留菜单和状态 owner，不搭建新导航框架                 |
| `src/renderer/src/components/common/ResizeHandle.tsx`                        | pointerup、pointercancel、blur 等均进入相同 cleanup/无参数 `onResizeEnd`；move 使用从起点累计的 delta                                              | 在现有手势内区分正常提交和取消，移动只预览，按最终有效位置一次提交，保留跨工作空间取消       |
| `src/renderer/src/components/activity-bar/ActivityBar.test.tsx`              | 断言短名称、顺序、15 项 pressed 属性                                                                                                               | 改验完整可见名称及兼容名称，继续守住入口数量和状态语义                                       |
| `scripts/ui-smoke.mjs`                                                       | 现有 Activity 验证只有部分菜单执行与旧文字几何；`page.setViewportSize()` 不能独立证明窗口尺寸改变                                                  | 补完整文字、计数、所有合法入口打开；保留已有视频/硬件及 Browser 检查，不能直接沿用旧通过结论 |
| `scripts/workspace-layout-smoke.mjs`                                         | 已有 `_electron` 和真实 `BrowserWindow.setContentSize()`、布局记忆及 Browser 回归                                                                  | 复用真实窗口路径覆盖宽高与 zoom，补完整手势、持久目标和新版原生几何；不新建测试平台          |

实现前重新确认这些路径及工作区差异；它们是方案编写时的事实，不允许把并行会话的新改动覆盖掉。

## 能力边界与所有权

| 关注点         | 本轮规则                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 能力边界       | Activity Bar 只承载入口呈现；Sidebar、Tab、Agent、Browser、公司与账目继续由各自原模块负责                                      |
| 状态 owner     | 当前选中与栏宽目标继续由 UI store 投影；持久布局继续由 `WorkspaceStateService.sections.layout` 保存；有效宽度是可丢弃计算值    |
| 生命周期       | 保留现有 React 挂载、resize 监听、定时 Runtime 状态订阅和对应清理；不因改布局预加载所有业务侧栏                                |
| 失败降级       | 可选能力失败使用原提示；定时计数读取失败不使导航渲染失败；远程失败不阻断文件、浏览器、终端等本地能力                           |
| 权限与人工确认 | 不新增权限、不触碰凭证或系统钥匙串；进入业务页不构成发布、付款或其他外部动作授权                                               |
| 命令与菜单     | 保留统一 ContextTarget、command 与 contribution；定向修复合法入口拒绝和账目误选，保留正确产品语义，不保留已知缺陷              |
| 诊断           | 复用当前 UI 状态与 Browser Runtime 诊断；测试记录 viewport、导航实际宽度、目标/有效宽度及原生 bounds；不建新日志服务或常驻遥测 |
| Browser owner  | 原生 bounds、zoom、visual page scale 继续由 BrowserManager 独占；renderer 只报告真实 DOM 几何                                  |

不能为“唯一高亮”新增 `selectedNavigationId`、以当前 Tab 反推 Activity，或将焦点/悬停写入持久状态。
保留 `activePanel` 在 Sidebar 收起时的上下文语义；设置仍是动作按钮，不新增 `settings` 面板枚举。

### 已核对的入口缺陷及定向修复

1. `ActivityBar` 对账目调用 `setActivePanel('company-accounts')` 后打开账目 Tab，但 `ui-store.ts` 的
   `VISIBLE_ACTIVITY_PANELS` 未包含这个已存在的 `ActivityPanel`，被 `normalizeActivityPanel()` 回退为 `files`。
   在原集合补齐 ID，验证 `setActivePanel/showPanel/normalizeWorkspaceLayout` 及真实打开后的选中与侧栏一致；
   不新增状态或迁移格式，也不从当前 Tab 反推一个“修正选中”。
2. 现有 `activityPanel()` 用 `ACTIVITY_LABELS` 判断 ID 是否有效，后者漏掉 `agent-roles`、`company-accounts`、
   `cclink`、`affairs`、`article-publishing`。在原命令边界补齐全部 15 个合法能力及名称；设置单独保留动作语义，
   未知 ID 仍拒绝，不能改成接受任意字符串。
3. 菜单打开公司账目不能止于展开 Sidebar，还要复用原账目打开/激活 Tab 的动作；公司、浏览器及设置的必要联动继续有效。
   左键普通项的 toggle 和菜单幂等打开可以不同，但打开目标及领域行为不能互相矛盾。只做有证据的局部共享或调用，
   不为此建立新的注册框架、菜单 Store、路由或通用 command 调度层。
4. 先以针对性用例固定当前失败条件，再随主线实现修复；通过这些缺陷测试只代表入口问题关闭，不能替代文字、计数、布局和 Browser 的完整交付。

## 实施设计

### 入口与样式

1. 在现有 `MAIN_ICON_GROUPS` 内固定产品文档中的完整显示名；可将仅用于旧布局的 `shortLabel` 收敛为 `displayLabel`，
   终端显示“终端”并兼容原 `label/title/aria-label = Terminal`。不为显示文案新建全局注册表。
2. 保留现有按钮、`type`、tooltip、无障碍名称、`aria-pressed`、右键和键盘事件；可见文字与装饰图标不重复朗读。
3. 在 main.css 的 Activity Bar 局部规则中改为横向 flex；名称占用可用空间，定时计数使用行末元素而非绝对定位。
   现有全部名称须在 140px 下显示完整；长名称兜底不能掩盖本轮名称裁剪失败。
4. 选中、悬停和焦点分别处理；hover 不能覆盖 active 的色条，也不能让第二项产生同等选中视觉。
5. 中部继续 `min-height: 0`、独立 `overflow-y: auto`；设置区不可收缩，位于滚动区之外。
   不新增分组交互、浮层或折叠按钮。
6. `--activitybar-width` 与 `ACTIVITY_BAR_WIDTH` 同步为 140；沿用当前“两处声明、真实 UI 比对”的轻量方式，
   不为一个固定尺寸搭建 token 生成系统。

### 三栏宽度预算

这是主线直接阻塞：只改 CSS 后，900px 视口、250px Sidebar、220px Agent 会使中央只剩 282px。
不能仅修改旧布局单测的预期数字后忽略这个变化。

在现有 `panel-layout.ts` 内用一个确定性的纯计算统一处理尺寸。实现时函数命名可以沿用项目风格，
但只能有一套实际生效的预算；如替换 `getAgentPanelWidthBounds`，同时迁移调用与测试，避免两套公式继续并存。

输入为现有值：有效 viewport 宽度、`sidebarVisible`、Sidebar 保存目标、Agent 保存目标、Agent mode。
输出限于本帧的有效 Sidebar/Agent 宽度及拖拽边界，不包含新的持久状态或 visibility 决策。

计算顺序：

1. 导航固定占 140px；Sidebar 展开才计入其 4px 分隔条，Agent 为 `right` 才计入右侧宽度和 4px 分隔条。
   `center/hidden` 不得继续预留幽灵右栏或右分隔条。
2. 以中央 320px 为预算目标。两栏展开且总预算足够下限时，先按 Sidebar 目标分配，并为 Agent 预留 220px；
   再把剩余预算分给 Agent，最高不超过其保存目标与原范围。
   等价地，先让 Agent 从目标压缩至 220px，再在不足时压缩 Sidebar 至 160px。
3. 仅一栏展开时，把预算用于该栏，其余留给中央。保存目标先按原范围规范化；有效值不写回 store。
4. 当两栏下限与 320px 中央无法同时成立（小于 848px）时，保持可见栏的现有下限，中央接受剩余非负空间，
   不自动切换显隐或 Agent mode。重点验证 800px 下顶栏收栏按钮与导航仍可用；不承诺任意极窄窗口三栏可读。
5. 两栏均隐藏时不计入任何分隔条，只有导航占宽。负数、非有限输入沿用现有规范化边界，输出不得为 NaN 或负数。

必须覆盖以下确定样例（忽略不超过 1px 的原生换算取整误差）：

| 内容视口宽度 | Sidebar / Agent 模式 | 保存目标：左 / 右 | 有效：左 / 右 | 中央剩余                |
| ------------ | -------------------- | ----------------- | ------------- | ----------------------- |
| 1400         | 展开 / right         | 250 / 350         | 250 / 350     | 652                     |
| 900          | 展开 / right         | 250 / 350         | 212 / 220     | 320                     |
| 900          | 展开 / hidden        | 250 / 350         | 250 / 0       | 506                     |
| 900          | 隐藏 / right         | 250 / 350         | 0 / 350       | 406                     |
| 900          | 展开 / center        | 500 / 350         | 436 / 0       | 320（居中 Agent）       |
| 900          | 隐藏 / hidden        | 250 / 350         | 0 / 0         | 760                     |
| 848          | 展开 / right         | 250 / 350         | 160 / 220     | 320                     |
| 800          | 展开 / right         | 250 / 350         | 160 / 220     | 272；用户可主动收起一栏 |

`App.tsx` 的 Sidebar shell 使用有效值；Agent 继续使用有效值；尺寸来源只在此纯计算内决定。
窗口 resize 只触发重新计算，不调用 `setSidebarWidth/setAgentPanelWidth`，不更改 mode/source，
不触碰 WorkspaceState 的保存、restore guard 或 generation 事务。

### 压缩状态下的拖拽

原方案“每次 move 保存，回到起点时跳过保存”不成立：之前的非零 move 已经写入新目标，最后跳过不能恢复原偏好。
本次明确采用**手势内实时预览，正常结束后单次提交**，左右栏规则相同；不改持久化格式或 WorkspaceState 队列。

1. pointerdown 在现有手势内捕获 WorkspaceTarget、该栏原保存目标 `savedStart`、起始有效宽度 `effectiveStart` 和当前有效预算。
   预算快照包括 CSS 视口宽高、DPR、`sidebarVisible`、`agentPanelMode` 及两栏保存目标宽度。
   这只是拖拽期间的局部引用/预览值，不成为新的布局状态 owner，也不写入 WorkspaceState。
2. move 用 `effectiveStart + 累计 delta` 计算候选并夹到同一预算，预览由 App 接入当前布局呈现；
   不能反复对最新值累加，不能在 move 中调用 `setSidebarWidth/setAgentPanelWidth`。
   候选回到起始有效宽度时，恢复以 `savedStart` 为目标计算的预览，而非将临时有效宽度认作目标。
3. 正常 pointerup 按**最终位置**重算候选（不能假定最后一次 move 与松手坐标一致），确认 WorkspaceTarget 仍有效且预算未失效（提交时复核视口及 store 中的全部预算输入，防止事件处理或 React 呈现晚于 pointerup）；
   候选不同于 `effectiveStart` 才调用原 setter 提交一次。等于起点或始终被边界夹回起点时不提交，原保存目标完整保留。
4. pointercancel、blur、组件卸载、工作空间切换、被下一次拖拽替代、窗口 resize 或上述 store 预算输入变化均取消：清除预览，不提交，
   不把待提交值写入已切换的工作空间。窗口 resize 和预算输入变化均复用 `cancelActivePanelResize()`；App 同步订阅现有 UI store，卸载时释放订阅。
   取消只丢弃拖拽预览，保留用户的栏位切换或目标宽度修改。
5. 当前 `onResizeEnd()` 无法区分正常松手和取消，需要对 ResizeHandle 与 App 的既有回调作有界调整，
   显式区分提交/取消并保证结束只处理一次；保留原指针释放与监听器清理，不另造全局拖拽 owner 或持久事务。
6. 保留现有键盘上下文菜单，不假设当前已有方向键调宽能力。取消后的大窗口恢复和已提交新目标的恢复分别验证。

| 例子：保存目标 250px、压缩后有效宽度 212px | 结束后的目标与持久化结果                         |
| ------------------------------------------ | ------------------------------------------------ |
| 点击手柄不动即松手                         | 仍为 250px；无提交                               |
| 212 → 180 → 212，回起点松手                | 仍为 250px；无提交，move 期间也不能写入 180px    |
| 向无法加宽的方向拖动，始终被夹在 212px     | 仍为 250px；无提交                               |
| 212 → 180，正常松手                        | 提交 180px 一次，后续放大、切换及重启恢复 180px  |
| 212 → 180 后取消、失焦或 resize            | 仍为 250px；丢弃预览                             |
| 212 → 180 后切工作空间或卸载               | 不提交；原空间仍为 250px，目标空间不被旧手势改写 |

若夹到起点，比较的是最终有效候选，不是原始指针 delta，也不是先前某次 move。即使中途触发过持久化队列 flush，
未提交手势也不能落盘；必须用完整手势用例证明，不能只检查起点事件或结束时的一次 setter 调用。

## 实施批次与完成条件

只设一个产品交付闭环，以下是施工顺序，不将测试或布局纯函数单独计为产品进度。

| 顺序 | 改动及直接原因                                                                | 对应验收 | 退出条件                                                          |
| ---- | ----------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| 1    | 完整文字横排、计数、状态样式、统一宽度预算及 App 接入；定向修复入口与手势提交 | U1–U7    | 真实开发 App 能使用全部入口，短窗口与恢复正确，往返拖拽不污染偏好 |
| 2    | 更新现有组件/布局测试和两条真实 Electron smoke；验证恢复与 Browser            | U2–U8    | 受影响门禁通过，保存真实几何、主题、短窗口及恢复证据              |
| 3    | 人工按 U1–U8 复验，更新实施状态与文档中的实际结果                             | U1–U8    | 逐项记录通过/失败/未执行及证据；未执行项不能写成已完成            |

第一批应尽早出现可见结果。连续 60 分钟未增加用户可验收表现，或同一阻塞失败两次时停止扩张，
说明已耗时间、直接阻塞和替代路径；不能转去重构导航框架、工作空间持久化或 Browser 缩放。

## 验证计划

### 针对性自动验证

- `ActivityBar.test.tsx`：完整可见名称、15 个稳定 ID/顺序和设置；保留终端兼容名；pressed 状态读取现有 owner。
  不用全量 HTML 快照或 CSS 字符串测试证明可用性。
- `ui-store.test.ts`：显式覆盖账目 `setActivePanel/showPanel` 和保存布局规范化，不再回退 files；
  `shell-context-actions.test.ts`：表驱动覆盖 15 个合法 ID、设置及未知 ID 拒绝，断言真实打开动作与必要 Tab/联动，
  不能仅断言命令返回不抛错。
- `panel-layout.test.ts`：上述宽度样例；center/hidden 不留右分隔条；窄窗口不产生非法值。
  App 接入后仍需真实几何验证，纯函数结果不能证明实际 shell 正确使用。
- `workspace-layout.test.ts`、`workspace-state.test.ts`：继续验证布局规范化、保存队列、恢复与工作空间切换竞态；
  `ResizeHandle.test.tsx`、`panel-layout-drag-lifecycle.test.ts`：验证完整手势提交/取消、旧拖拽失效、替换与幂等清理。
  四个现有测试必须纳入下面的执行清单，不能只跑 UI store 和菜单测试；按本轮新增可观察行为补用例，不复制无关测试。
- 现有 `--activity-bar-only` smoke：更新完整标签与同行断言（文字位于图标右侧、垂直居中、落在按钮内），
  检查每个实际文字范围未裁剪、字号与行高符合规格、名称和计数不重叠，而非只匹配文字字符串。
  加入 hover 不制造双选中、短窗口键盘可达及底部设置；实际执行全部入口的左键和菜单打开，验证账目不再误选文件；
  保留视频/硬件分离、老视频工程打开和硬件检查原回归。公司等有条件入口在隔离本地工作空间验证；
  远程只验证入口和真实未登录/离线降级，不将其算作在线远程闭环。
- 该 smoke 的“短窗口必然滚动”断言改为先检查真实可用高度：溢出时验证能滚动到底且不遮设置，
  未溢出时验证全部入口可见。禁止为满足旧断言人为撑高导航。
- 定时计数 0、1、99、100 须在真实 Electron 呈现并检查行末几何、`99+` 和无障碍语义，标记边界 fixture。
  必须有经真实 `getRuntimeStatus/onChanged` 驱动非零再归零的记录；已实现下一节所述的测试侧专用装配。不能直接运行会调用 Agent 的现有定时任务 smoke 来代替，也不能只改 renderer 数字或 mock 订阅。
  测试装配未落地或链路未通过时仍属验收阻塞，不得以单元测试绿灯宣称计数闭环完成。
- 拖拽用例覆盖上述完整手势表，正常松手单次提交、往返/受限/取消零提交；包括无最后一次 move 的松手坐标、
  多次 move 的累计位移、取消后再次拖拽，以及队列 flush 后保存目标未被预览污染。
- `workspace-layout-smoke.mjs`：补充左栏有效压缩后不写回目标、放大恢复、往返和取消手势、主动拖拽形成新目标、A/B 切换及重启；
  不删除现有拖拽跨工作空间失效和待写队列回归。增加 900px 窗口下 Agent 目标 700px、显示 436px、拖至 416px 时按 `⌘B` 展开左栏的回归：
  手势取消、显示压至 220px，松手及 flush 后目标仍为 700px，放大恢复 700px。

### 非零计数：已有注入点与已实现的测试装配

已核对的事实：`src/main/scheduled-task/scheduled-task-service.ts` 的构造选项已有 `runExecutor?: ScheduledTaskRunExecutor`；
`startRuntime()` 只在未注入时创建 `ScheduledTaskAgentRunner`。
`src/main/scheduled-task/scheduled-task-service.test.ts` 的 `createService(runExecutor)` 和受控 Promise 用例已使用此入口。
但 `src/main/runtime/core-services.ts` 的正式装配没有传该选项，`scripts/scheduled-tasks-smoke.mjs` 也没有安全替代执行器。
测试侧已复用上述构造注入点与写法实现独立装配；没有为正式 App 新增执行器替换能力。

实现采用以下仅测试装配，纳入现有 `scripts/workspace-layout-smoke.mjs` 的必跑阶段；不新增生产 IPC、
环境开关、执行器 setter、调度机制或通用测试框架：

1. 在 `scripts` 下增加仅用于这段验证的 Electron 启动/renderer 夹具，复用现有隔离 userData、临时工作空间及窗口启动清理方式。
   该阶段直接构造 `ScheduledTaskService(workspaceStateService, { userDataPath, homePath, runExecutor })`，
   不走会创建默认执行器的完整 Studio 装配，也不与正式服务在同一 Electron 进程中重复注册同名 IPC。
   夹具加载真实 ActivityBar 及其原 preload/主题/样式；只验证计数集成，不冒充完整 Studio 的 U1–U8 已通过。
2. `runExecutor` 实现已有的 `run/cancel` 接口：首个 run 等待测试侧可释放、可取消的 Promise；释放后只在临时工作空间
   写入预先确定的 Markdown，返回实际文件的相对路径、字节数与 SHA-256。所有后续 run 使用同一已释放闸门正常结束。
   不调用 Agent、模型、网络或系统调度；`startRuntime()` 使用任何 Agent 执行调用都会失败的测试 bridge，避免静默回落。
3. 单个服务实例按真实生命周期 `load → startRuntime → stopRuntime/flush`；使用原 `registerScheduledTaskIpc()`、
   真实窗口对应的 TrustedRendererGuard、原 preload 的 `getRuntimeStatus/onChanged` 与服务原 `onChanged` 转发。
   renderer 不替换这两个 API，不手动广播 changed，不直接改服务队列或 ActivityBar 计数。
4. 按用户本次实施要求精简计数验证：只通过原 `save/runNow` 启动一个未自动启用的受控任务，验证 `0 → 1 → 0`。
   首个执行器等待期间比对真实 `queuedCount + (runningRunId ? 1 : 0)` 与 badge；测试主进程释放 Promise 后，
   由原 changed 订阅刷新并归零，不手动触发 renderer 刷新、不创建 100 个任务。
5. 0/1/99/100 的显示与 `99+` 无障碍语义由现有 ActivityBar 单元测试覆盖；真实 Electron 中另用明确标记的行副本，
   只检查 99/99+ 的行末几何。这些是展示边界夹具，不冒充 Runtime 真实累计任务数。
6. 异常时取消等待，在 finally 停止/flush 服务、释放注册并关闭独立 Electron 进程；不停止用户其他开发实例，
   不让夹具任务或计数订阅泄漏到布局/Browser 验收。

实际代码为 `scripts/activity-count-smoke.mjs`、`scripts/fixtures/activity-count-main.ts` 和
`scripts/fixtures/activity-count-renderer.tsx`，由 `node scripts/workspace-layout-smoke.mjs` 的计数阶段调用。
只对测试入口生成临时 bundle，不改生产 main/preload 输出；使用真实 WorkspaceStateService、ScheduledTaskService、
TrustedRendererGuard、IPC、原 preload 和 ActivityBar。执行器只在临时目录写确定的 Markdown 并返回实际哈希，不调用 Agent。
测试结果单列 Runtime 查询/事件集成与展示边界，不能将它们表述为完整 Agent 生成闭环。

### 真实窗口与应用 zoom

`ui-smoke.mjs` 现有 `page.setViewportSize()` 只作为补充，不承担 U4/U5/U8 的真实窗口验收。
复用 `workspace-layout-smoke.mjs` 已有 `_electron` 与 `BrowserWindow.setContentSize()`，
把已有 resize helper 有界扩展到宽高，真实调整主窗口后读取 `getContentBounds()`、renderer `innerWidth/innerHeight`、
主 renderer zoom 及 DPR，确认实际发生 resize 后再测量所有区域。

在正常应用 zoom 和一个原有设置支持的非默认 zoom 下执行短窗口、放大恢复与 Browser 检查。
窗口 DIP 与 renderer CSS 尺寸分别记录，宽度表仍按实测 CSS 视口判断；不能拿窗口外框尺寸或模拟视口套用预算。
不新增应用设置/IPC，也不通过提高主窗口最小尺寸让小窗口用例消失。

必需的受影响验证入口（本轮已执行；实际结果见验收记录）：

```bash
pnpm exec vitest run \
  src/renderer/src/components/activity-bar/ActivityBar.test.tsx \
  src/renderer/src/utils/panel-layout.test.ts \
  src/renderer/src/stores/ui-store.test.ts \
  src/renderer/src/features/context-actions/domains/shell-context-actions.test.ts \
  src/renderer/src/utils/workspace-layout.test.ts \
  src/renderer/src/utils/workspace-state.test.ts \
  src/renderer/src/components/common/ResizeHandle.test.tsx \
  src/renderer/src/utils/panel-layout-drag-lifecycle.test.ts
pnpm exec vitest run \
  src/main/scheduled-task/scheduled-task-service.test.ts \
  src/main/scheduled-task/scheduled-task-ipc.test.ts
pnpm typecheck:web
pnpm verify:context-actions
pnpm smoke:ui --activity-bar-only
node scripts/workspace-layout-smoke.mjs
git diff --check
```

合入功能代码仍遵循架构宪法与仓库 `pnpm verify` / 受影响 smoke 门禁。避免在没有新变化或失败原因时反复重跑同一检查。
本轮不包含打包、签名、公证或正式发布。

### 真实 Browser 回归

导航加宽和 Sidebar 有效宽度变化会直接改变 pane 几何，必须验证真实 Electron `WebContentsView`：

1. 复用现有隔离网页，记录 renderer bounds、native bounds、pane、保护线和当前 View ID；
   在两栏展开、隐藏、拖拽、缩窗及放大后逐项比对，允许坐标换算取整误差 1px。
2. 依 [覆盖事故回归](../testing/browser-tab-bar-native-view-occlusion.md)验证 Tab/工具栏仍可点击，
   `overlapsProtectedTop=false`，原生 View 不覆盖左侧导航和内容栏。
3. 依 [30% 缩放回归](../testing/browser-fit-width-30-percent.md)在真实 View 检查新 Tab、页内导航、pane 变宽、
   手动 30% 恢复和重启恢复；保留 raw/applied factor、三次测量及实际 page/visual scale。
   不修改阈值、延时或通过 reload 隐藏异常。
4. 复用已有测试页和能力；如已有脚本不能覆盖某项，记录具体缺项并人工补验，不为本轮新建缩放测试平台。

### 证据与完成声明

实施时把新证据放入单独的 `docs/design/activity-bar-text-navigation/`，只保存脱敏截图、必要诊断和验收记录；
不要覆盖旧窄导航的通过截图。验收记录逐项包含 U 编号、执行者、时间、viewport/主题、动作、实际结果、证据路径与限制。
真实 Electron 自动化与真人操作分开标记；fixture 计数、离线入口验证、真实远程闭环也分别标记。

本地导航 U1–U8 与适用工程门禁均通过后才可声明本轮产品闭环完成。若 Browser、重启恢复或真人操作仍待验证，
第一句说明用户能做什么、尚不能确认什么，再分列“用户功能进度”和“工程准备度”。

## 自审、风险与回退

| 风险 / 反例                        | 防线与停止条件                                                          |
| ---------------------------------- | ----------------------------------------------------------------------- |
| 只修改导航 CSS，布局模块仍扣 76px  | CSS 与常量同改；真实 DOM 宽度对比及中央预算不通过则不交付               |
| 只压右栏，900px 中央跌到 268px     | 必须接入有界 Sidebar 有效宽度；不以调低 320px 目标掩盖                  |
| 临时压缩或往返拖拽保存成永久偏好   | move 只预览；最终有效位移决定单次提交；往返及取消零提交，检查持久值     |
| 压缩后轻拖左栏跳回保存目标         | 用有效值作为主动拖拽起点；分别测第一次移动和新目标恢复                  |
| 重写公司/设置行为以求入口整齐      | 保留原 command 与动作路径；样式调整不能改变业务语义                     |
| 只凭截图认定存在双 owner           | 当前问题先按视觉区分处理；不引入第二选中状态                            |
| 导航局部效果合格，网页仍挡住工作台 | 原生 View 几何和 page/visual scale 回归是必做项                         |
| 独立评审演变成重建导航/布局框架    | 要求每项修改对应 U1–U8 或直接阻塞证据；无关建议另记，不加入当前主线     |
| “保留原行为”变成保留入口缺陷       | UI 白名单与菜单缺项是明确修复范围；全入口实际打开是退出条件             |
| 现有测试绿灯被当成新版产品证明     | 完整文字、计数、完整手势、真实窗口及 Browser 新证据缺一不能宣称闭环完成 |

回退以本轮导航、宽度计算及对应 App 接入作为一致单元恢复到前一基线，不能只回退 CSS 留下 140px 预算，
也不能只回退预算留下宽导航。由于不迁移持久化格式，原有布局与领域数据无需反向迁移；
用户在新版主动保存的合法栏宽仍由原范围读取。回退不能删除用户数据或覆盖其他会话的改动。

独立评审三项结论已纳入：入口缺陷须定向修复、拖拽须以完整手势的最终有效位置决定提交、验收须有新版真实 App 证据。
有条件通过的两项补充已写入：四个遗漏的现有测试列入实际命令；非零计数使用已有构造注入点与测试侧 Electron 装配，
明确区分已有能力与尚缺夹具，生产接口和调度机制均不扩张。
当前 140px 导航和更新后的宽度表作为基线；实现完整需求所必需的 UI 白名单、菜单与手势回调修改属于有证据的主线工作，
不是另建框架的理由，也不能因追求小 diff 而删掉。本轮已实现并执行相关门禁与真实 Electron 自动化，真人签收及正式发布仍未执行；不将自动化结果改写为用户本人验收。
