# IPC 契约单一声明源收敛方案

> 状态：P0-P5 代码迁移与自动化工程门禁完成；P1-P3 阶段退出仍待完整 Terminal、Android 真机与
> 真实只读数据源真人验收
> 最后更新：2026-08-29
> 性质：架构债务与工程准备度修复，不是新增用户功能里程碑
> 关联约束：`docs/architecture.md`“生命周期必须对称”“契约先于实现”

> 2026-08-28 独立评审首轮结论为“不通过，但方向正确”。本文已纳入 preload 现存 Zod、Terminal
> 归一化字段保留、Android 监听器/无生产者事件、P0 增量门禁以及重复连接、错误兼容和凭证不泄漏
> 验收要求；首轮修订没有由文档作者自行宣告通过，后续独立复审结果见下。

> 2026-08-28 独立复审结论为“有条件通过”。复审新增的错误优先级、Terminal execution event
> disposer、事件消费者库存和 Editor 监听器所有权要求已纳入本文。这里的“通过”只表示方案可以从
> P0 开始实施，不表示代码、门禁或真人验收已经完成。

> 2026-08-28 最终复审补充了 Terminal disposer 原子回滚和错误兼容唯一例外。本文已完成对应
> 修订，方案可以实施；这里的“可实施”严格指先完成 P0，不能跳过 P0 直接迁移 Terminal。

## 结论

实施前，CCLink Studio 已经有共享 IPC contract 基础设施，但覆盖不完整。Terminal、Android、
数据源以及若干较新的能力仍在 main 与 preload 中分别手写同一个通道字符串；共享文件只约束
TypeScript API 形状，没有成为通道名、参数解析、错误语义和事件生命周期的唯一事实源。上述缺口
已按“2026-08-29 实施进度”收敛，以下结论保留为本轮问题定义与边界。

这不是 Terminal、Android、数据源的业务逻辑需要合并。需要收敛的是跨进程通信边界：

- shared 轻量 definition 唯一声明通道、参数和返回类型；
- main-only contract 从同一 definition 绑定运行时 parser 和原有错误映射；
- main 使用统一 registrar 注册 handler，preload 使用统一 client 发起调用；
- renderer 事件的生产者和消费者共享事件名及 payload 契约；
- 测试从“人工列出已迁移文件”升级为覆盖全部生产 IPC namespace 的防回退门禁。

Terminal 的 session、审计、命令编排和执行，Android 的 ADB/Scrcpy，数据源的查询、配置和凭证
仍由各自 main 领域模块拥有，不迁入 shared，不互相合并。

## 2026-08-29 实施进度

P0-P5 的代码迁移与自动化工程门禁已按顺序完成，未引入新 IPC 框架，也未改变业务状态所有者；
这里不把代码完成写成对应阶段退出：

- Terminal 的 11 个 invoke、2 个事件，Android/Scrcpy 的 17 个 invoke、触摸事件及 4 个保留推送
  事件，数据源的 7 个 invoke，以及 `workspaceState`、GitBackup、Hardware、CAD、ProjectOps、
  Editor、WeChat 的 32 个保留 invoke 均已从 shared 轻量 definition 派生；无生产者的 Editor
  `contentUpdate` 及其 `contentUpdateAck` 已删除。生产 main/preload 不再直接写 channel 字面量，
  P0 临时 allowlist 已为空。
- Terminal handler 全部注册成功后才订阅 execution event，runtime 在 reset、失败回滚与 shutdown
  中持有并幂等释放 disposer；lifecycle 的 runtime、权限策略与关闭策略有字段保留测试。
- Android 删除了无生产者的 `deviceLost`、`storeInstallResult`，以及无 renderer 消费者的
  `physicalConnected`、`physicalDisconnected`；视频帧、错误和断开监听只释放自身 handler，组件在
  断开、重连与卸载时清理。
- 数据源 parser 失败继续返回 `DATA_SOURCE_QUERY_INVALID`；唯一批准的行为变化是“参数非法 + 服务
  不可用”时参数错误优先。凭证值不进入 parse 错误，配置与审计不落明文的既有测试继续通过。
- 全量 invoke 库存从 shared definition 生成，并记录 owner、唯一 handler 文件、preload consumer、
  parser 与 registration scope；测试扫描全部 shared definition，缺登记、缺 handler、重复 handler 或
  缺 preload consumer 均失败。保留事件另行记录 producer、preload bridge、真实 renderer consumer、
  disposer 与 payload 边界；空 legacy allowlist 只表示没有遗留裸 channel，不能替代现行库存。
- 全仓生产 main/preload IPC 边界继续机器扫描，新增裸 `ipcMain`、trusted registrar、
  `webContents.send` 或 `ipcRenderer` channel 字面量会直接失败；preload 不得导入本次新增的 main-only
  contract。Terminal lifecycle/submit 的完整输入先做结构与大小校验，再判断服务状态；Terminal、
  Android 和 Editor 的保留 main→renderer payload 在 preload 做有界校验。

当前工程证据：`pnpm verify` 通过 332 个测试文件、2041 项测试（2 项跳过），lint、类型检查和生产
构建通过；`smoke:local` 11/11、`smoke:workflow` 21/21、`smoke:restore` 4/4、
`smoke:update-recovery` 1/1 通过。全新临时 Profile 的 `smoke:ui` 通过 13/17；失败的 4 项集中在
Remote Agent Panel、会话快捷入口、Activity Bar 和角色中心，均不经过本次迁移的 IPC 域，作为独立
既有 UI smoke 阻断记录，不在本次最小修复中扩张处理。

当前环境没有 Android 真机和真实只读数据源，因此下述对应真人动作尚未执行；Terminal 也没有本次
完整覆盖 resize、确认批准/拒绝和跨重启恢复的真人记录。这里可以声明 IPC 代码收敛与受影响自动化
工程门禁完成，不能据此声明 P1-P3 阶段退出或三个域的真实用户闭环已经复验完成。

## 用户可执行的端到端验收

本项工作不增加新按钮或新能力。完成后，用户应能在真实 Studio 中继续完成以下原有动作。除已经
批准的“参数非法且服务不可用同时发生时，参数错误优先”这一内部复合场景外，行为与改造前一致：

1. 打开本地工作空间，新建 Terminal，执行 `pwd`，调整窗口大小，关闭并重新进入项目后确认
   Terminal session 投影和输出恢复符合原有策略。
2. 触发一条需要确认的 Terminal 命令，确认请求只出现在所属工作空间，批准与拒绝均能返回
   与改造前相同的错误类型、错误码和关键提示；上述已批准复合场景按 parse-first 新基线验收；
   生命周期操作后 runtime、权限策略和关闭策略不丢失。
3. 在连接用户自有 Android 真机的环境中扫描、连接、投屏、点击、输入、截图和断开，然后重复
   “连接—断开—再连接”和“投屏—停止—再投屏”；不得丢事件、重复回调或误删其他订阅者。无
   `adb` 时 Studio 仍能启动，其他本地能力不受影响。
4. 在已配置只读测试数据源的环境中列出数据源、测试连接、列出集合、执行查询、保存并重新打开
   Saved Query；除上述已批准复合场景外，非法输入仍返回改造前相同的结构化错误。复制诊断并检查
   workspace 持久化结果，password、token、apiKey 和完整凭证不得出现。
5. 在 Terminal、Android 或数据源不可用时，文件、编辑器、浏览器和本地 Agent 仍可使用。

只有 contract、单元测试或构建通过，不能声明用户能力完成；上述真实应用动作必须完成对应复验。

## 问题是什么

Electron 应用中有三个相关边界：

```text
Renderer（React 界面）
        ↓ 调用受限 API
Preload（安全桥）
        ↓ IPC channel + 参数
Main（高权限服务与系统能力）
```

例如 Terminal 启动 PTY 时，preload 调用 `terminal:startPty`，main 必须注册完全相同的名字。
实施前两边各自手写字符串。`TerminalApiContract` 只能检查 preload 对 renderer 暴露的方法形状，
不能证明 main 注册了相同 channel，也不能让 `ipcRenderer.invoke()` 在编译期拒绝错误的字符串或参数。

因此，当前实现依赖人工同步：

- 一边改名、另一边漏改，会在运行时出现 handler 缺失；
- 参数数量、可选参数、归一化和错误映射可以分别演化；
- main 推送事件与 preload 监听事件可能失配；
- 新增通道可能绕过既有 contract 完整性和 preload 依赖边界门禁；
- 单元测试如果也复制同一个字符串，只能证明复制一致，不能证明存在单一事实源。

## 实施前证据与范围

2026-08-28 实施前对生产源码的只读库存如下。计数只覆盖当时 preload 中直接使用字面量的 IPC，
不代表整个仓库的 IPC 总数；这些字面量已按上节实施结果收敛为零。

| 能力域         |                                                   直接字面量库存 | 当前事实                                                                          |
| -------------- | ---------------------------------------------------------------: | --------------------------------------------------------------------------------- |
| Terminal       |                            11 个 invoke、2 个 main→renderer 事件 | `src/shared/ipc/terminal.ts` 只有类型与 API interface；main/preload 双写 channel  |
| Android/Scrcpy | 17 个 invoke、1 个 renderer→main 事件、8 个 main→renderer 事件名 | 参数 schema 在 main；事件名分散在 Android IPC、Scrcpy bridge 与 preload           |
| 数据源         |                                                      7 个 invoke | 结构化结果类型已共享，但 channel 与 runtime parser 未同源                         |
| 其他能力       |                                                 33 个直接 invoke | `workspaceState`、CAD、GitBackup、Hardware、ProjectOps、Editor、WeChat 仍有字面量 |

preload 当前可见的直接字面量 invoke 合计至少 68 个，其中 Terminal、Android/Scrcpy 和数据源
占 35 个。

当前 preload 并非“无 Zod”。`src/preload/index.ts` 会加载带 runtime schema 的 scheduled task、
media 和 workbench 模块，`src/preload/web-resources-api.ts` 也直接使用 shared schema；现有
`out/preload/index.js` 已包含打包后的 Zod 代码。因此，本方案不能把“当前 preload 没有 Zod”当作
前提，也不能用全局“源码不含 Zod”作为这三域迁移的初始门禁。正确边界是：新迁移的 invoke client
继续只加载轻量 definition，不新增 main-only parser 依赖；P0 记录现有 preload schema/Zod 基线，
后续对存量依赖单独作保留或移除决定，并保证 sandbox 不出现未打包的外部 `require("zod")`。

现有 `src/main/ipc/ipc-contract.test.ts` 只对人工列出的已迁移文件和 namespace 做正则检查。
Terminal、Android、数据源等不在该防回退集合中，所以当前 CI 可以在 S3 文档声明“IPC 契约治理
完成”的同时继续接受这些双写字符串。这里需要修正的是实现覆盖和门禁表达；在实际迁移、验证
完成前，不应仅修改历史记录来假装问题已经关闭。

## 严重性判断

当前没有证据表明这是已经发生的权限绕过：这些 main handler 仍通过 trusted renderer guard，
Terminal、Android 和数据源也有不同程度的主进程参数校验。因此不应把它误报成已经确认的安全
事故。

它仍是中高优先级的高权限边界债务：Terminal 能启动命令，Android 能操控真机并安装 APK，数据源
连接外部系统。字符串、parser 或错误模型漂移一旦发生，通常只能在运行时发现，并可能表现为功能
失效、错误降级、监听器泄漏或错误授权提示。

## 目标架构

沿用 FS、Agent、Browser 已采用的两层 contract，不新增第二套 IPC 框架。

### 1. Preload 可加载的轻量 definition

轻量层只包含 channel、TypeScript 参数和结果类型，不导入 Zod 或 Node-only 依赖：

```ts
export const terminalIpc = {
  startPty: defineIpcCall<[TerminalPtyStartInput], TerminalPtyStartResult>('terminal:startPty'),
  listSessions: defineIpcCall<[], TerminalSessionSnapshot[]>('terminal:listSessions'),
} as const

export const terminalIpcEvents = {
  requestCommandConfirmation: 'terminal:requestCommandConfirmation',
  executionEvent: 'terminal:executionEvent',
} as const
```

preload 只引用这一层：

```ts
startPty: (input) => invokeIpcContract(terminalIpc.startPty, input)
```

### 2. Main 使用的 parser contract

runtime contract 从同一个轻量 definition 绑定参数数量、Zod schema、归一化和解析失败语义：

```ts
export const terminalIpcContracts = {
  startPty: bindIpcParser(terminalIpc.startPty, (args) => {
    requireArgs(args, 1, terminalIpc.startPty.channel)
    return ipcArgs(terminalPtyStartSchema.parse(args[0]))
  }),
  listSessions: bindNoArgsIpc(terminalIpc.listSessions),
} as const
```

main 只通过统一 registrar 注册：

```ts
registerTrustedIpcContract(terminalIpcContracts.startPty, trustedRendererGuard, (_event, input) =>
  terminalExecutionAdapter.start(input),
)
```

### 3. 事件契约与生命周期

所有事件发送和监听使用 shared 常量。renderer→main 的单向事件继续使用 trusted listener 和 main
侧 schema；main→renderer 的不可信 payload 在进入 renderer 回调前进行有界解析或 safe-parse。

每次 preload 监听必须返回只移除自身 handler 的 disposer。Android 现有
`removeAllListeners('scrcpy:*')` 会删除同 channel 的其他订阅者，应改成精确 listener 生命周期；
`onVideoFrame` 与 `onMirrorError` 的 API 返回值应调整为 disposer，并同步调用方清理。

当前源码中未找到 `android:deviceLost` 和 `android:storeInstallResult` 的 main 生产点。迁移 Android
事件前必须确认它们是遗漏的真实能力还是废弃接口：真实能力应补唯一生产者与测试；废弃接口应在
确认无调用后删除，不能只把死 channel 搬进 shared。

## 能力边界与所有权

| 项目                               | 唯一所有者                        | 本次允许的变化                  | 本次禁止的变化                                     |
| ---------------------------------- | --------------------------------- | ------------------------------- | -------------------------------------------------- |
| IPC channel、参数/结果类型、事件名 | shared definition                 | 收敛为唯一声明源                | main/preload 继续复制字符串                        |
| 参数运行时校验和 parse error 映射  | shared main-only contract         | 从 definition 绑定 parser       | 新 invoke client 导入 main-only contract           |
| trusted sender、注册与释放         | main IPC infrastructure           | 复用现有 registrar/scope        | 新建旁路注册器或裸 `ipcMain.handle/on`             |
| Terminal 状态与执行                | main Terminal domain              | handler 接收已解析参数          | 把 registry/store/orchestrator 移入 shared/preload |
| Android 设备与投屏                 | main Android domain               | 复用现有 bridge/action executor | renderer 直连 ADB、合并 Android 与 Terminal 状态   |
| 数据源与凭证                       | main DataSource/CredentialService | 保持结构化结果                  | 凭证进入 renderer、workspace 或普通设置            |

## 兼容性要求

迁移是内部边界重构，不主动改名现有 channel，也不改变 renderer API。每个域必须先固定现有语义：

以下兼容性要求均受一个且仅一个例外约束：“参数非法 + 服务不可用”同时发生时采用 parser 优先。
任何其他单故障、正常路径或错误组合都必须保持兼容；不得把这个窄例外扩张成一般性错误变化授权。

- Terminal：部分非法参数当前返回 `{ success: false, error }`，命令拒绝有专用联合类型；迁移不能
  一律改成 Promise rejection。
- Android：现有 Zod 参数失败通常表现为 Promise rejection；触摸非法 payload 被记录并丢弃，
  不能进入设备 bridge。
- 数据源：参数解析失败映射为 `DATA_SOURCE_QUERY_INVALID`，服务不可用返回结构化 operation error；
  parser 前移后必须保留该错误模型，不能让裸 ZodError 穿过 IPC。
- Preload：新迁移的 invoke client 不得导入 main-only `*-contract.ts` 或为调用 main 而新增 runtime
  schema/Zod 依赖；现有 preload 事件 payload 校验及其 Zod 依赖先纳入 P0 基线，不能假装不存在。
- 能力降级：任一可选域注册或运行失败不能阻断 Studio 启动及无关本地能力。

### 错误优先级

统一 registrar 的固定顺序为：

```text
trusted sender 校验 → 参数 parser → 服务可用性判断 → 业务执行
```

当前部分 Terminal handler 会先判断服务是否存在再 normalize 参数；数据源形如
`getService().createSource(schema.parse(input))` 的调用也会先求值 `getService()`。因此在“服务不可用
且参数非法”同时发生时，迁移到统一 registrar 后会从“服务不可用”变为“参数非法”。

本方案明确接受这一处有意变化，不给通用 registrar 增加领域服务 preflight 特例。理由是非法 IPC
不应依赖运行时服务状态，parse-first 更确定，也与现有 `registerTrustedIpcContract` 行为一致。兼容性
要求据此定义为：

- sender 不可信永远优先拒绝；
- 参数非法时返回该 channel 既定的参数错误形式，即使服务同时不可用；
- 参数合法但服务不可用时，保持现有服务不可用错误码、结构和关键文本；
- 参数与服务均正常时，业务错误语义不变；
- P0 为上述四种组合建立逐通道基线，P1/P3 迁移测试明确记录复合场景的预期变化，不能让求值顺序
  继续依赖表达式写法。

## 开发方案

### P0：冻结库存和行为

目标：在改代码前把所有生产 IPC 通道、方向、参数、结果、错误模型、权限和事件生产者列成可由机器检查的库存。

任务：

- 从 main 注册、main 事件发送、preload invoke/send/on 和 shared definition 生成库存。
- 标记 invoke、renderer→main event、main→renderer event 三种方向。
- 记录每个通道的 trusted role、schema、错误行为、领域 owner、producer、实际 consumer 和
  disposer。必须区分“shared interface 声明了回调”“preload 提供了订阅方法”“renderer 生产代码
  实际调用该订阅”三种状态。
- 为 Terminal、Android、数据源补迁移前行为测试，尤其是逐通道错误映射、字段保留与可选参数。
- 确认 Android 两个疑似无生产者事件的去留。
- 将 `android:physicalConnected`、`android:physicalDisconnected` 标为“有 main producer、preload
  API、无 renderer 生产 consumer”，P2 决定补真实消费方或删除冗余推送，不能把 preload 方法本身
  误计为完成消费。
- 记录 preload 当前 schema/Zod 的源码依赖和构建产物基线，区分“被打包的运行时校验”与 sandbox
  无法加载的外部依赖。
- 在 P0 就加入机器可枚举的 IPC 库存门禁：先以带 owner、原因和删除阶段的窄 allowlist 接纳存量，
  禁止新增未登记 channel；P1-P4 每完成一域就缩小 allowlist。
- 在 `docs/stabilization.md` 和 S3 治理记录中立即标记“契约覆盖缺口已重新打开”，后续每阶段更新
  当前事实和证据，不等到最终阶段才修正文档。
- 在进入 P1 前处理 Editor 三处 `removeAllListeners`：read request、save request 增加并存订阅与精确
  释放测试；每次订阅只移除自身 handler。实施库存确认 content update 没有 main 生产者，而
  `editor_write/append/insert` 的当前事实是主进程直接写盘并回读校验，因此删除
  `contentUpdate/contentUpdateAck` 及 renderer 订阅，不恢复死 channel，并同步产品事实源。

P0 是进入 P1 的硬门槛，必须同时满足：库存中的每个通道有 owner、producer、实际 consumer 和
处置结论；增量库存门禁已运行；四种错误优先级组合有基线；Editor 保留 listener 已改为精确所有权、
无生产者接口已删除并通过测试；S3 事实源已标记覆盖缺口。缺少任一项都不得开始 P1。P0 只是工程
准备度，不能声明用户能力新增或迁移完成。

### P1：迁移 Terminal

建议文件：

- 扩展 `src/shared/ipc/terminal.ts`：轻量 invoke definition 与事件常量；
- 新建 `src/shared/ipc/terminal-contract.ts`：main-only parser binding；
- 按需新建 `src/shared/ipc/terminal-schema.ts`：把 IPC 边界 schema 与现有 normalize 规则收敛；
- 修改 `src/main/ipc/terminal-ipc.ts` 和 Terminal 事件生产者；
- 修改 `src/preload/index.ts`，只通过 `invokeIpcContract` 和事件常量调用。

`registerTerminalIpc` 当前在注册第一个 IPC handler 前调用
`terminalExecutionAdapter.onEvent()`，并忽略其 disposer。任一后续 handler 注册失败都会留下调用方
拿不到 unsubscribe 的订阅，IPC registration scope 也不会自动拥有这个领域事件。P1 必须使用原子
顺序：先完成全部 handler 注册，只有全部成功后才建立 execution event 订阅，随后立即返回幂等
unsubscribe（没有 adapter 时返回 no-op）。如果未来在订阅后增加任何可能抛错的步骤，必须用
`try/catch` 在异常路径立即 unsubscribe 后再抛出。

runtime 只在 `registerTerminalIpc` 成功返回后保存 disposer 为
`terminalExecutionEventUnsubscribe`；Terminal reset、窗口/服务重建失败回滚和主进程 shutdown 必须
在清空 adapter 引用前调用并置空。测试至少覆盖：在后段 handler 注入注册失败时 `onEvent` 尚未调用、
成功注册后单次 dispose、重复 dispose、回滚，以及重建后只有一个 execution event 投递。

Terminal 不能把现有 `normalize*` 机械前移到 parser。尤其 lifecycle 输入同时服务于两个目的：
审计记录只保留有界字段，而 session 同步仍需要完整的 `runtime`、`permissionPolicy` 和
`closePolicy`；如果 parser 只返回当前 audit normalization 的结果，这些字段会被丢弃。第一阶段
parser 只负责参数数量、结构和上限校验，返回不丢字段的完整输入；审计投影、命令 trim/截断、权限
规则去重以及 session 同步继续在 main 的具名语义函数中完成。只有逐字段兼容测试证明等价后，才可
移动纯边界逻辑。PTY 启动、command orchestration、registry/store 同步始终留在 main。

退出标准：11 个 invoke 与 2 个事件同源；lifecycle 的 `runtime`、`permissionPolicy`、`closePolicy`
不丢失；除已批准的双故障 parser-first 场景外，逐通道 rejection/结构化失败、错误码和关键错误文本
与基线一致；Terminal 订阅注册/回滚原子且 disposer 被 runtime 对称释放；真实 Terminal 验收通过；
没有改变 workspace 状态所有权。Terminal namespace 随本阶段退出 P0 allowlist，防回退门禁立即生效。

### P2：迁移 Android/Scrcpy

建议文件：

- 扩展 `src/shared/ipc/android.ts`：Android/Scrcpy definitions 与事件常量；
- 新建 `src/shared/ipc/android-contract.ts` 和 `android-schema.ts`；
- 修改 `src/main/ipc/android-ipc.ts`、`src/main/android/scrcpy-bridge.ts` 及其他确认后的事件生产者；
- 修改 `src/preload/android-api.ts` 和对应订阅调用方。

同时把视频帧、错误和断开事件从 `removeAllListeners` 改为精确 disposer。高频视频帧不应因为增加
schema 而发生不必要的数据复制；验证应在边界做最小结构检查，并保留 ArrayBuffer 传输行为。

`physicalConnected/Disconnected` 当前虽然由 main 发送且 preload 暴露订阅 API，但 renderer 没有
生产调用点。P2 必须根据用户状态投影决定：若连接状态需要事件驱动，补唯一 renderer consumer 及
释放路径；若界面只依赖连接调用返回值或主动快照，则删除无消费推送和 preload API。不能为了让
库存表看起来完整而保留无人消费的事件。

退出标准：17 个 invoke、触摸事件和保留的 main→renderer 事件同源；APK 路径、坐标、按键、文本、
设备 ID 和触摸 schema 在调用 bridge 前生效；同一窗口重复连接—断开—再连接、投屏重复启停、
订阅—释放—再订阅以及两个并存订阅者互不删除均通过；无 ADB 降级与真实设备 smoke 通过。Android/
Scrcpy namespace 随本阶段退出 P0 allowlist。

### P3：迁移数据源

建议文件：

- 扩展 `src/shared/ipc/data-source.ts`：7 个轻量 invoke definition；
- 新建 `src/shared/ipc/data-source-contract.ts` 与 `data-source-schema.ts`，或将现有 main schema 通过
  兼容 re-export 迁到 shared main-only 层；
- 修改 `src/main/data-source/data-source-ipc.ts`；
- 修改 `src/preload/data-source-api.ts`。

需要为 parser 使用 `mapParseError` 或等价边界，确保 schema 失败仍返回现有
`DATA_SOURCE_QUERY_INVALID`，业务异常仍由 `runOperation` 归一化，且 renderer 永远拿不到凭证。

退出标准：7 个 invoke 同源；真实只读数据源的连接、查询和 Saved Query 验收通过；除已批准的双故障
parser-first 场景外，逐通道非法参数、服务不可用错误码和关键错误文本与基线一致；创建、测试、查询、
复制诊断和工作空间持久化均证明 password、token、apiKey 及完整 credential 不进入 renderer
payload、日志、诊断或 workspace。数据源 namespace 随本阶段退出 P0 allowlist。

### P4：收敛剩余直接字面量

按风险和依赖分批迁移 `workspaceState`、GitBackup、Hardware、CAD、ProjectOps、Editor、WeChat。
每批保持一个最小纵向闭环，不借 IPC 重构合并领域 store、重写 renderer API 或扩张权限。

建议优先级：

1. `workspaceState`：涉及持久化和项目切换；
2. GitBackup、Hardware：有外部副作用和文件边界；
3. CAD、ProjectOps：本地文件与工具调用；
4. Editor、WeChat：双向事件与转换调用。

退出标准：生产 main/preload 不再存在未登记的 IPC channel 字面量；所有保留例外都有明确原因和
测试，不能通过扩大 allowlist 隐藏债务。每个子批次都必须同时缩小门禁 allowlist、更新事实源并
提交对应验证证据。

### P5：关闭全局门禁例外并完成事实源复审

- contract 完整性：每个轻量 definition 都有 main runtime parser；允许无 parser 的事件必须有方向、
  payload schema 和生命周期测试。
- namespace 唯一性：生产 main/preload/事件生产者不能重复出现已登记 channel 字面量。
- 注册完整性：每个 invoke definition 恰好有一个生产 handler；重复注册由 registration scope 拒绝。
- preload 边界：新 invoke client 不加载 main-only contract；存量 schema/Zod 依赖均有明确用途和
  打包验证，构建产物不存在 sandbox 运行时无法解析的外部 `require("zod")`。是否彻底移除 preload
  中已打包的 Zod 由单独库存结论决定，不能在本方案中虚假宣称已经不存在。
- 生命周期：监听只移除自身 handler；窗口重建和重复 stop 不残留 listener/handler。
- 文档：复核 P0 起逐阶段更新的 `docs/stabilization.md` 与 S3 记录，写入最终补救提交、门禁和真人
  验收证据；P5 只负责关闭剩余例外，不负责第一次承认问题。

源码门禁应基于机器可枚举的 definition/inventory，而不是继续人工维护“已经迁移的文件列表”。如果
某个通道必须暂时保留字面量，应使用带 owner、原因和删除条件的窄例外，而不是 namespace 级放行。

## 测试与验证矩阵

| 层级             | 必测内容                                                                                |
| ---------------- | --------------------------------------------------------------------------------------- |
| Contract 单测    | definition/parser key 完整对应、参数个数、可选参数、错误优先级、非法输入和错误映射      |
| Main IPC 单测    | trusted sender 先于业务调用、parser 先于 service/bridge、结构化错误不漂移               |
| Preload 源码边界 | 新 invoke client 使用轻量 definition；不新增 main-only contract 依赖；记录现有 Zod 基线 |
| 事件库存         | 每个事件记录 producer 与实际 consumer；无生产者/无消费者事件必须有删除或补齐结论        |
| 事件生命周期     | Terminal/Editor/Android 多订阅者互不删除，disposer 幂等，重建后无重复 listener          |
| 能力降级         | Terminal/Android/数据源分别故障时 Studio 和其他本地能力继续可用                         |
| 安全回归         | 除批准的双故障例外外保持精确错误兼容；数据源凭证不进入 renderer、日志、诊断或 workspace |
| 应用内 smoke     | Terminal 原有闭环、Android 重复连接真机闭环、真实只读数据源闭环                         |
| 增量/全量门禁    | P0 禁新增、每阶段缩 allowlist；最终 `pnpm verify` 和受影响 smoke 全部通过               |

改造完成声明必须附当前提交上的门禁结果和真人验收记录。mock handler 注册、TypeScript 通过或 contract
key 对齐只证明工程边界，不能替代真实 Electron IPC 和设备/数据源路径。

## 失败路径与止损

- 如果 parser 前移改变了已批准双故障场景之外的现有错误类型，先恢复兼容语义，再继续迁移；不要要求
  renderer 同时大改，也不能用 parser-first 例外掩盖其他回归。
- 如果新迁移让 preload 增加 main-only contract 依赖、产生新的外部 `require("zod")` 或导致 sandbox
  无法加载，说明轻量 definition 与 runtime contract 分层被破坏，立即回退该依赖方向；不能把当前
  已打包的 Zod 事实误判成这项新增回归。
- 如果同一域连续两次出现真实应用回归，停止扩张到下一域，先补端到端测试和迁移适配层。
- 如果某域需要改变状态 owner、生命周期或权限面，暂停本方案并单独评审；需要违反架构宪法时先写
  ADR，不能借“统一 contract”顺手改架构。
- 不以 reload、全应用重启或 `removeAllListeners` 掩盖 listener 所有权问题。

## 不做什么

- 不生成一套新的通用 RPC/codegen 框架；复用现有 `defineIpcCall`、`bindIpcParser`、
  `registerTrustedIpcContract` 和 `invokeIpcContract`。
- 不把业务 service、store、bridge 或 Electron 对象放入 shared。
- 不改变 renderer 可见 API 命名，不扩张 preload 权限。
- 不把 Terminal、Android、数据源合并成一个“通用工具服务”。
- 不把这项工程重构计为新用户功能进度。

## 拷问清单

- 共享了 TypeScript interface，是否就误以为已经共享 IPC contract？interface 在运行时不存在。
- 新增通道时，main 注册、preload 调用、parser、错误映射、事件 disposer 是否来自同一条声明？
- 防回退测试是在枚举全库存，还是又维护了一份容易漏项的手工文件清单？
- Android 的事件真有生产者吗？如果没有，为什么继续暴露给 renderer？
- Terminal parser 前移后，人工确认、workspace 过滤和 session 唯一所有者是否保持不变？
- 数据源 schema 失败是否仍是结构化错误，凭证是否仍只在 main？
- preload 当前为什么加载 Zod？新增迁移是否扩大了该依赖，构建后是内联代码还是 sandbox 无法解析的
  外部 require？
- mock 测试绿色以后，是否真的在 Electron、真机和真实只读数据源上走过用户动作？

最应该先做的是 P0 库存与 Terminal 纵向迁移。它能用最小范围验证方案，同时优先降低最高权限
通道的漂移风险；在 Terminal 验收通过前，不应并行铺开所有 namespace 的机械替换。
