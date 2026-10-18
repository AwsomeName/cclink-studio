# 工作空间级三栏布局记忆开发计划

> 状态：已实现；用户初步确认本地可用，按请求收尾；逐项验收与专项复验未全部签收
>
> 最后更新：2026-10-16
>
> 事实源：`AGENTS.md`、`docs/architecture.md`、`docs/features/workspace-system.md`
>
> Browser 回归：`docs/testing/browser-fit-width-30-percent.md`

## 1. 结论与边界

实施范围只包括工作空间级布局保存与恢复：A、B 分别记住自己的左侧工作空间区宽度与可见性、右侧
Agent 区宽度、可见性与布局模式；切换、切回和重启后恢复正确。中央 Workbench 继续弹性填充，不保存
第三个宽度。

方案复用现有 `WorkspaceStateService` 的 `layout` 分区、`WorkspaceRef`、工作空间切换 generation、
restore guard、UI store 和 Browser bounds 上报。`layout` 仍是 renderer-owned opaque section；不新增布局
数据库、独立缓存、main 状态 owner、IPC channel 或切换事务。

本次明确不实施：Editor owner/key/revision 迁移、Agent pending update 改造、通用跨 store 投影框架、
main CAS/transaction lease/repair 重构，以及文件权限或文件移动事务改造。这些问题不能被描述为已修复，
但没有直接因果证据时也不能成为布局功能的隐藏前置条件。

## 2. 用户可执行验收

### 2.1 本地最小闭环

1. 打开本地工作空间 A，把左栏调整到约 `180px`，右侧 Agent 区调整到约 `260px`，并保持右侧模式。
2. 打开本地工作空间 B，把左栏调整到约 `420px`，右侧 Agent 区调整到约 `600px`，再收起右侧 Agent。
3. 连续执行 A → B → A，确认宽度、左右栏可见性和 Agent `center/right/hidden` 模式都恢复为各自值。
4. 重启 Studio，再次打开 A、B，确认两套布局仍分别恢复。
5. 打开从未保存过布局的工作空间 C，确认得到完整默认布局，不继承 A 或 B。
6. 在大窗口把 A 的 Agent 区拉宽到约 `700px`，再缩小窗口使右栏临时被压缩；放大后确认目标宽度恢复，
   未被小窗口的有效宽度覆盖。
7. 在 A 拖拽栏宽时立即切换到 B，继续移动并松开鼠标，确认旧拖拽不能改变或写入 B 的布局。
8. 在 A 收起左栏后切到 B，再通过系统目录选择器打开 A；等待目录恢复及打开流程全部结束，确认左栏仍
   收起，其他布局字段保持 A 的保存值。再次切回 A 或重启后，确认未被收尾代码覆盖保存。
9. 切向 B 的等待期间继续调整 A 的栏宽，B 打开后立即切回 A；再收起/展开侧栏，确认最后宽度仍保持。
10. 保留设置 Tab，切到无布局的新项目，确认设置页仍可见；切到已有 user 布局的项目时，仍以用户模式为准。

### 2.2 完成声明

- 上述真实 Studio 动作通过后，才能声明本地用户闭环完成。
- local、remote、global 的身份隔离先由自动化证明；远程工作空间只有在真实已登录、已配对 Agent 上复验
  后，才能声明远程闭环完成。
- 单元测试、WorkspaceState 文件或 CI 通过不能替代真实界面验收。

2026-10-16，用户反馈“好像可以了，更新文档，归档会话吧”。据此记录本地使用初步确认，并按请求收尾；
不将该反馈扩写为以上每一项均已真人通过。详细结果和保留的复验清单见
`docs/testing/workspace-layout-memory.md`。

## 3. 当前实现与直接缺口闭环

- `ui-store.ts` 的 `normalizeWorkspaceLayout()` 完整恢复默认值，逐字段校验有限宽度、模式及来源；
  Agent mode 决定可见性。UI 初始状态不再读取旧 localStorage，日常修改只写 WorkspaceState layout。
- `captureWorkspaceLayout()/persistCapturedWorkspaceLayout()` 同步捕获 WorkspaceRef、generation、owner
  和不可变快照；异步保存只使用捕获值，失败记录脱敏诊断。
- `workspace-runtime.ts` 在已有 restore guard 中首先恢复 layout；`workspace-transition.ts` 沿用最终
  generation 检查，同步提交目标身份并 hydrate，不新增 await 或跨域事务。
  同工作空间重新打开时跳过磁盘 layout 恢复，保留最新内存布局；不同工作空间仍按目标快照恢复。
- 不同工作空间读取快照前，等待捕获的目标 key/owner 的 layout 待写队列排空；包括等待上一项目提交时
  产生的最后调整，不等待其他身份、项目或分区。复用现有队列，不新增布局缓存。
- `ResizeHandle.tsx` 的每个 move 回调校验捕获的 WorkspaceTarget；切换开始、prepare 和最终提交均可
  同步取消拖拽。最终提交取消也覆盖等待期间重新开始的拖拽；过期 apply 不能取消新工作空间的拖拽。
- `workspace-bootstrap-core.ts` 在读取快照前创建目标绑定的 layout restore；成功恢复后在 guard 外完成
  一次性 legacy 写入，成功才删除旧 key。失败或目标失配保留兼容输入。
- `workspace-open-controller.ts` 已删除 `pickLocalWorkspace()` 收尾的无条件 `showPanel('files')`。
  原路径“恢复收起侧栏 → guard 结束 → 收尾展开 → subscription 覆盖保存”已由完整打开结束后的测试覆盖。
- `App.tsx/panel-layout.ts` 继续区分 Agent 保存目标与有效显示宽度，并共用 Sidebar 目标范围常量。
  `use-agent-work-context.ts` 订阅已有 workspace 提交 generation，保留同一个全局 Tab 时也重新计算
  system 布局；user 来源仍复用现有 no-op。Browser 继续使用现有生命周期与 bounds 上报。

源码实现与验证已经形成布局闭环。Editor、Agent pending update、main CAS、通用投影及权限事务没有加入
本次修改；它们的独立风险仍按第 6.2 节记录。

## 4. 布局模型与规范化

### 4.1 唯一持久状态 owner

`WorkspaceStateService.sections.layout` 是唯一持久事实。`ui-store` 只保存当前可见投影；localStorage 在
一次性迁移结束后不再读写布局。沿用现有 WorkspaceState 写队列，不建立第二套布局缓存。

布局快照继续使用现有字段：

```ts
interface WorkspaceLayoutSnapshot {
  activePanel: ActivityPanel
  sidebarVisible: boolean
  sidebarWidth: number
  agentPanelVisible: boolean // 兼容字段；规范化后必须与 mode 一致
  agentPanelWidth: number
  agentPanelMode: 'center' | 'right' | 'hidden'
  agentPanelLastVisibleMode: 'center' | 'right' | null
  agentPanelModeSource: 'system' | 'user'
}
```

不保存中央 Workbench 宽度。中央宽度始终由 viewport 减去当前有效左右栏宽度得到。

### 4.2 完整 replace 与非法字段规则

新增一个纯函数 `normalizeWorkspaceLayout(value)`，永远返回完整快照：

- 整个 layout 缺失或不是普通对象：返回完整 `UI_DEFAULTS`，不保留当前 store 值。
- `sidebarWidth`：仅接受有限数值，并限制在持久目标范围 `160..500`；否则使用默认 `250`。
- `agentPanelWidth`：仅接受有限数值，并限制在持久目标范围 `220..960`；否则使用默认 `350`。
- boolean、Activity panel、Agent mode/source/last-visible-mode 逐字段验证，非法值回默认值。
- `agentPanelMode` 是可见性的主语义；规范化后 `agentPanelVisible === (mode !== 'hidden')`。仅旧快照缺少
  mode 时，才用旧 `agentPanelVisible === false` 推导 `hidden`。
- `agentPanelModeSource: 'user'` 必须原样恢复；后续系统 work context 继续遵守现有 no-op 规则。

这里的 `160..500` 与 `220..960` 是可持久化目标范围，不是当前窗口的临时可见范围。

### 4.3 目标宽度与有效宽度

- `sidebarWidth` 和 `agentPanelWidth` 保存用户目标值。
- 当前窗口过窄时，沿用 `App.tsx` 和 `panel-layout.ts` 对 Agent 区计算有效显示宽度；Sidebar 仍使用其
  `160..500` 目标范围。窗口 resize 不调用任一宽度 setter，因而不能写回被 clamp 的 Agent 值。
- 用户在小窗口主动拖拽属于新的用户意图，可以更新目标值；仅由窗口变化产生的 clamp 不更新目标值。
- 把 Sidebar 的 `160/500` 与 Agent 的 `220/960` 常量收敛到 `panel-layout.ts`，规范化、拖拽和测试共用，
  避免三处边界漂移。

## 5. 最小修改流程

### 5.1 普通布局保存

UI 变化时，在同一个同步调用栈完成两件事：

1. 捕获 `WorkspaceTarget { ref, generation }`、owner key 和完整 `WorkspaceLayoutSnapshot`；
2. 把这个不可变的 `CapturedWorkspaceLayout` 交给现有 WorkspaceState 写队列。

异步写入只能使用捕获对象中的 workspace key、owner key 和 snapshot，不得在 Promise 回调中重新读取
当前 workspace 或 UI store。布局模块不提供“传入任意 workspace key，再读取当前 UI”的 API。

普通 store subscription 与切换前 flush 复用同一个 capture/write helper。底层通用
`persistWorkspaceSection()` 可以继续服务其他分区，但生产 layout 调用点只能提交已经捕获的对象。

### 5.2 切出当前工作空间

在现有 `prepareWorkspaceRuntimeTransition()` 内做最小扩展：

1. 先确认传入 generation 仍 current；过期请求直接退出，不能取消新请求的拖拽。
2. 同步调用 `cancelActivePanelResize('workspace-transition')`。
3. 捕获出站 workspace target 与 layout snapshot。
4. 用捕获值发起目标明确的 layout 写入；可以与现有 `persistRuntimeSections()` 并行等待。
5. 写入失败记录包含脱敏 target、generation 和失败分类的诊断，但不把 layout 写到其他 workspace，也不
   阻断用户切换。返回原 workspace 时只能恢复最后一次成功快照；不能伪称失败值已经保存。

本流程不改变其他 runtime section 的保存、合并或失败语义。

### 5.3 切入目标工作空间

只在现有提交点恢复 layout：

读取阶段先捕获目标 key 与 owner，等待该目标的 layout 队列（running 及合并后的 pending）排空，再用
同一 key/owner 读取快照。写入失败不使等待拒绝：沿用保存诊断，读取最后成功值。不同项目才需要此等待；
同项目重开不 hydrate 磁盘 layout，继续保留内存值。既有最终 generation 检查仍控制是否允许 apply。

1. `applyWorkspaceRuntimeTransition()` 保留当前 generation 检查；旧请求在最终检查失败时不执行 layout
   hydrate。
2. 最终检查通过后，现有代码在同一同步调用栈提交 `activeWorkspaceRef` 并调用
   `hydrateRuntimeSections()`；两者之间不增加 `await`。
3. 在 `hydrateRuntimeSections()` 已有 `beginWorkspaceStateRestore()/endWorkspaceStateRestore()` 内，首先调用
   `useUIStore.getState().hydrateFromWorkspaceState(sections.layout)`。
4. hydrate 使用完整 replace：有合法快照就恢复，缺失/整体非法就使用完整默认值，部分非法逐字段回退。
5. restore guard 内 UI subscription 不写盘；退出 guard 后的后续真实用户操作才形成新快照。
6. 删除 `pickLocalWorkspace()` 收尾的 `showPanel('files')`；打开流程完成后保持目标恢复值。无 layout 时
   由完整默认值决定初始侧栏，后续用户主动点击文件面板仍按现有操作处理。
7. 在最终 generation 检查通过后、提交 renderer 身份之前判断目标 key 是否仍等于当前 key。同工作空间
   重开只跳过 layout hydrate，避免待写或等待 main 期间的新调整被旧磁盘值覆盖；其他分区照常恢复。

因此快速 A → B → C 时，B 只有在既有 generation 仍 current 的情况下才可能应用；B 过期后不能迟到
覆盖 C。本方案不新增 CAS，也不承诺修复 main/renderer 的所有既有事务风险。

### 5.4 拖拽生命周期

增加一个仅保存活动 cancel callback 的轻量 `panel-layout-drag-lifecycle`，不保存布局值：

- pointer-down 捕获 `WorkspaceTarget`、pointer ID 和起点；注册幂等 cleanup。
- pointermove、pointerup、pointercancel 每次都验证捕获 target 仍 current；失配时只 cleanup，不调用
  `onResize`。
- workspace prepare 阶段同步取消活动拖拽；组件卸载、window blur 和第二次 pointer-down 也走同一 cleanup。
- cleanup 释放 pointer capture、移除 window listener、恢复 cursor/user-select、清除
  `is-resizing-panels`，并结束现有 `panelResizing` UI 状态；取消路径不提交最终 delta。

### 5.5 旧 localStorage 一次性迁移

`cclink-studio-ui-state` 只作为启动兼容输入：

1. `ui-store` 不再把 legacy 值直接合并进初始状态，也不再持续写 localStorage。
2. bootstrap 读取目标 WorkspaceState 后：若 `sections` 自有 `layout` 字段，WorkspaceState 胜出，legacy
   不参与字段合并；若整个 layout 字段缺失且 legacy 可解析，则在 restore guard 内应用规范化后的
   legacy 快照。
3. 当次 bootstrap 的 WorkspaceRef、owner、generation 在读取快照前捕获，legacy snapshot 在应用时捕获；
   restore guard 结束后再次校验目标仍 current，通过 layout 专用写入落到捕获目标。
4. 迁移写入成功后才删除旧 key；失败则保留旧 key，下次启动重试。目标在迁移前失配则取消写入并保留
   key。
5. 若 WorkspaceState 已有 layout，在本次完整 restore 成功后删除已被忽略的 legacy key；损坏或未完成
   restore 时保留，且绝不反向覆盖 WorkspaceState。

remote/global/local 都通过现有 `WorkspaceRef` 和 `workspaceRefKey()` 隔离；legacy 只迁入启动时已经确认的
单一目标，不复制到多个 workspace。

### 5.6 Agent 与 Browser

- 不修改 Agent 数据。`use-agent-work-context.ts` effect 增加已有 workspace 提交 generation 依赖：即使
  全局设置 Tab 对象不变，也在提交后的渲染重新按 Tab context 计算 system 布局，避免缺布局的默认
  `center/system` 遮住设置页。恢复出的 `user` 来源仍由 `applySystemWorkContext()` 的既有 no-op 保护，
  `center/right/hidden` 三种 user 模式均不覆盖。
- 不修改 Browser IPC、BrowserManager、缩放算法或 View 生命周期。布局恢复改变 DOM 宽度后，继续依赖
  现有 `ResizeObserver → reportWorkbenchBounds → BrowserManager` 链路收敛原生 View bounds。
- 由于曾发生 30% page/visual scale 事故，mock 测试不足以关闭 Browser 回归；必须执行第 8.2 节真实
  Electron 验收。

## 6. 直接阻塞与独立既有风险

### 6.1 直接缺口的实现闭环

| 原直接缺口                                     | 当前修复及验证                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| 运行时切换不 hydrate layout                    | 现有 guard 内恢复；A→B→A、重启及真实界面通过                       |
| 缺失值继承上一 workspace，非法宽度可进入 store | 完整默认值与逐字段校验；缺失/非法输入测试通过                      |
| 全局 localStorage 初始化与持续双写泄漏         | 只作启动兼容输入；迁移成功删除、失败重试及已有 layout 优先测试通过 |
| 旧 pointer callback 可修改新 workspace         | target/generation 校验及同步取消；事件单测与真实拖拽切换通过       |
| 本地打开收尾展开侧栏并覆盖保存                 | 删除无条件调用；完整 picker 流程结束并 drain 写队列后断言布局保持  |
| B 提交等待期产生的 A 调整在快速切回时未落盘    | 读 A 前等待 A layout 队列；延迟成功路径测试覆盖读取及后续保存      |
| 全局设置 Tab 对象不变，system 布局未重新评估   | hook 依赖提交 generation；设置页可见及 user 三种模式优先回归       |

layout 生产调用点只接收同步形成的 `CapturedWorkspaceLayout`，没有新增“任意 workspace key + 当前 UI”
组合。延迟写入测试确认捕获的 A snapshot 与 owner 在 B 激活后仍只写 A。

### 6.2 独立既有风险，不作为布局前置

以下风险在当前代码中存在，但本次 layout 变更不创建它们，也不修改对应领域：

- `workspace-transition.ts:204-218` 在 main identity 提交前会等待 Browser/Terminal，且 main 接口不是 CAS；
  这是整体 workspace 事务风险。本次只依赖最后 renderer generation 检查，不能宣称该风险已修复。
- `fs-store.ts:603-624,688-699` 的目录恢复和调用者尾处理仍有独立的迟到状态问题；layout hydrate 已在
  更早的同步提交点完成，不依赖这些尾处理。
- Editor 虚拟草稿 owner、Agent pending update 和文件移动崩溃窗口仍按各自事实源处理；本计划不修改、
  不验证、也不声称关闭。

如果实现时发现新的阻塞，只有同时给出“本次 layout 改动触发它”的可复现时序和源码位置，才能加入
本次范围；仅能复现于原有功能的缺陷单独建问题。

## 7. 实际修改文件

| 文件                                                                                   | 修改目的                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/renderer/src/stores/ui-store.ts`                                                  | 完整快照/规范化、捕获目标保存、legacy 单次迁移、停止双写          |
| `src/renderer/src/stores/ui-store.test.ts`                                             | 默认值、非法字段与 mode/visible 一致性                            |
| `src/renderer/src/utils/panel-layout.ts`、`src/renderer/src/App.tsx`                   | Sidebar 目标范围共用；保留目标/有效宽度分离                       |
| `src/renderer/src/utils/workspace-runtime.ts`                                          | 在现有 guard 内首先恢复 layout                                    |
| `src/renderer/src/utils/workspace-transition.ts`                                       | 捕获出站保存、读前等待目标 layout、同项目保留内存、同步取消拖拽   |
| `src/renderer/src/utils/workspace-state.ts` 及 `.test.ts`                              | 复用现有队列提供目标分区等待；验证隔离与合并 pending 排空         |
| `src/renderer/src/bootstrap/use-agent-work-context.ts` 及 `.test.ts`                   | 提交 generation 触发 system 重算；保留设置 Tab 及 user 模式优先   |
| `src/renderer/src/utils/panel-layout-drag-lifecycle.ts` 及 `.test.ts`                  | 单一取消入口及幂等释放，不保存布局                                |
| `src/renderer/src/components/common/ResizeHandle.tsx` 及 `.test.tsx`                   | pointer target/generation 绑定，blur/cancel/卸载/切换释放         |
| `src/renderer/src/bootstrap/workspace-bootstrap-core.ts`、`use-workspace-bootstrap.ts` | 读取前捕获布局恢复目标；迁移写入在 guard 外                       |
| `src/renderer/src/features/workspace-open/workspace-open-controller.ts` 及 `.test.ts`  | 删除打开收尾覆盖；完整 picker 流程测试                            |
| `src/renderer/src/utils/workspace-layout.test.ts`                                      | 切换、默认、隔离、失败、迁移、bootstrap stale、用户优先级集成测试 |
| `scripts/workspace-layout-smoke.mjs`                                                   | 真实 Studio 的布局、设置页、重启、View bounds 与两类缩放回归      |
| `docs/testing/workspace-layout-memory.md`                                              | 工程结果、证据与待真人验收动作                                    |

原有 runtime、transition、bootstrap 和 panel-layout 测试继续参与验证；没有为本功能新增 Browser IPC、
修改 BrowserManager、Editor/Agent/Tab store、`fs-store.ts` 或文件权限入口。

## 8. 自动化测试

### 8.1 必要测试矩阵

- A 保存 `180/260/right/user`，B 保存 `420/600/hidden/user`，A → B → A 精确恢复。
- 重建 store/bootstrap 模拟重启，A、B 仍读取各自 WorkspaceState layout。
- C 无 layout 时得到完整 defaults；A 的宽度、可见性和模式不残留。
- 同工作空间重开：磁盘宽度 200px、300px 布局写入仍在等待时，经完整目录选择器流程重开；写入完成后
  再收起侧栏，UI 和持久值仍为 300px。另测等待 main 提交期间的新调整，不能被准备阶段的旧快照覆盖。
- 快速 A→B→A：B main 提交等待时把 A 从 200px 调到 300px，并延迟这次保存；返回 A 不得提前读取
  旧 layout，保存完成后恢复 300px，后续侧栏操作仍保存 300px。目标队列等待涵盖 running 与最新 pending，
  不等待不同 workspace、owner 或分区的阻塞写入。
- 目标 layout 的侧栏为收起状态，await `pickLocalWorkspace()` 完整结束并 flush 写队列后，断言所有布局
  字段仍与恢复快照一致，未出现收尾产生的 `sidebarVisible=true/activePanel=files` 覆盖写入；断言不能只
  停在 hydrate 完成时。
- `NaN`、`Infinity`、字符串、越界宽度、非法 mode/source 分别按第 4.2 节回退；有效字段不受无效字段
  牵连。
- local A、remote R、global 分别保存不同 layout，往返切换不串写；断言使用现有 WorkspaceRef key。
- 延迟 B 的 prepare/apply 后启动 C：B generation 过期后不 hydrate layout，最终只显示并保存 C。
- A 拖拽未结束时切 B：同步取消；之后合成的旧 pointermove/up 均不调用宽度 setter，也不产生 B layout
  write。
- 出站 A layout 写入延迟到 B 已激活后完成，断言 payload 和 key 仍为捕获的 A；不得重新读取 B UI。
- layout 持久化失败不写错目标、不删除 legacy、不阻断切换；日志明确失败，返回 A 时恢复最后成功快照。
- 窗口从大变小再变大：有效 Agent 宽度被临时 clamp，但 UI store 与 WorkspaceState 中目标宽度不变。
- 恢复 `agentPanelModeSource: 'user'` 后分别触发 empty/browser context，模式与可见性不被覆盖；`system`
  来源仍按现有规则变化。
- 同一个全局设置 Tab 跨项目保留：无 layout 项目提交后 system 重算为 right，设置页可见；恢复的
  user center/right/hidden 均不被重算覆盖。真实 Electron 补验 system 设置页可见与 user hidden 优先。
- restore guard 内 hydrate layout 不触发 WorkspaceState 写入；guard 结束后的真实用户修改才写入。
- legacy：缺 layout 时只迁入启动目标，成功才删；写失败、target/generation 失配均保留；已有 layout 时
  不用 legacy 补字段。

主线实现运行 `pnpm verify`；定向补修运行受影响测试、`pnpm typecheck`、定向 lint 及真实 Electron smoke。
它们只证明对应工程门禁，不替代真实应用验收，也不把早期完整 verify 当成本轮全量复验。

### 8.2 真实 Electron Browser 回归

使用真实 `WebContentsView`，在 A、B 各保留一个 Browser Tab 和明显不同的左右栏布局：

1. A → B → A 后，记录 renderer Workbench pane bounds、BrowserManager View bounds，确认每次稳定收敛且
   View 不进入 Tab 栏或工具栏。
2. 侧栏从窄变宽、Agent 从宽变窄、收起/展开后，复核页面 viewport 与 View bounds 一致。
3. 对事故页执行新 Tab、页内导航、后退、手动 page zoom 30% 后恢复、切换工作空间和重启恢复。
4. 单独建立 visual scale 前置条件：在同一真实 Tab 通过测试 CDP 会话调用
   `Emulation.setPageScaleFactor({ pageScaleFactor: 0.3 })`，先实测 `visualViewport.scale ≈ 0.3`，并确认
   page zoom 为 `1`；随后通过产品适宽恢复及 A → B → A 激活链路，验证 visual scale 恢复为 `1`。
   每条恢复链路前重新注入并确认 30% 前置条件；测试代码不得代替产品复位，也不得 reload 掩盖异常。
   当前 View 的生产 visual zoom 下限为 `1`，因此仅在隔离的测试主进程中临时放开下限以注入异常；实测
   产品复位为 `1` 后恢复测试下限。生产 BrowserManager、权限与缩放 owner 不作修改。
5. 同时记录 `WebContents.getZoomFactor()` 与 `visualViewport.scale`；两者最终都为 `1`。不能只看工具栏
   百分比或 mock。
6. 若失败，先收集 `browser-fit-width-30-percent.md` 要求的 pane/View bounds、三次样本、raw/applied
   factor 和 visual scale，再决定是否修改 Browser 代码；禁止为了本功能预先调整延时、阈值或缩放 owner。

## 9. 验证门禁与退出条件

2026-10-14 的工程记录：主线首次实现的生产构建及完整 `pnpm verify` 已通过；定向补修通过受影响 162 项测试、Web/Node
typecheck、定向 lint，以及 `node scripts/workspace-layout-smoke.mjs` 的 11 项真实 Electron 自动化回归。
没有重新执行全量 verify，记录见
`docs/testing/workspace-layout-memory.md`。

2026-10-16 仅更新文档，不修改代码、不重跑工程测试。按用户请求结束本会话，不以补齐全部专项验收作为
归档前置。只有第 2 节真人本地动作全部签收，才能声明逐项产品验收完成；remote/global/local 隔离的
自动化通过不等于真实在线远程验收，远程仍需已登录、已配对 Agent 复验。

## 10. `/grilling` 开工判断

开工前必须能回答：

1. 缺失 layout 是否完整回默认，而不是保留当前 store？
2. 任一 layout Promise 是否会在 await 后读取当前 workspace 或当前 UI？
3. A 的旧 pointer listener 是否可能在 B 提交后继续调用宽度 setter？
4. 窗口 clamp 是否只影响有效宽度，还是偷偷覆盖了持久目标？
5. 恢复出的 `user` Agent 模式是否可能被 system context 立即覆盖？
6. localStorage 是否已经停止持续双写，迁移失败时旧 key 是否仍保留？
7. B generation 过期时，layout hydrate 是否必然发生在 no-op 分支之后？
8. Browser 证据是否同时包含原生 View bounds、page zoom 和 visual scale？
9. 本地打开流程全部结束后，侧栏收起状态是否仍保持，且没有被收尾覆盖保存？
10. Browser visual scale 是否先实测为 30%，再经产品恢复链路实测回到 100%？
11. 快速切回 A 是否在读快照前排空 A layout 待写队列，而不是恢复旧值后再次覆盖保存？
12. 保留同一全局设置 Tab 时是否按提交 generation 重算 system，且 user 模式始终优先？

**收尾判断：用户已初步确认本地可用，按要求结束本会话；不宣称所有场景均已签收。**
布局实现与此前工程门禁记录保留，直接布局缺口已随实现修复，
没有新增跨域事务或第二状态 owner。真实 View 的两条 visual scale 回归均先实测为
`0.3000000119`，再经产品恢复为 `1`；适宽路径保持原页面输入，未用 reload 掩盖。

本地逐项真人验收结果未完整补录，真实在线远程验收和事故页真人复验仍待完成。
第 6.2 节独立既有风险没有被本次修改修复，也不因会话收尾或工程测试通过而被宣称关闭。
