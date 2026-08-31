# 文章发布“开始执行无反应 / Attempt 假运行”系统性治理方案

> 状态：两轮审查的 9 项阻塞已按本文边界实现；自动工程门禁与真实 Electron/CDP 故障注入已通过，真实 CSDN 发布验收待执行。  
> 日期：2026-08-31。
> 适用范围：文章发布中心、`WebAffairService`、Agent Run、BrowserTask、内嵌浏览器。  
> 架构约束：遵守 `docs/architecture.md`；`WebAffairService` 继续是事务、Attempt、检查点和证据的唯一持久状态所有者。

## 结论

这不是按钮点击事件失效。截图中的持久发布事务仍是 `running`，renderer 因而主动禁用了“开始执行”。真正的问题是：Agent、BrowserTask、浏览器 Tab 或 CDP 连接已经结束/断开后，终态没有可靠地收敛回当前 Attempt，导致持久状态和真实运行状态分叉。

截至 2026-08-30，当前工作树已经建立统一、幂等、可重试、可诊断的运行终态收敛链路，并把“真的在运行”“待核验”“确认已经孤儿化”“外部结果未知”分开。启动、看门狗和 Runtime 终态归 main 所有；renderer 只发有界命令。所有 Runtime 事件和副作用授权都绑定发布 generation、launch operation 与 owner 自身代次；上传、正文/字段自动保存、显式保存和发布在实际 Playwright 动作前消费持久一次性能力；启动扫描和固定恢复日志负责崩溃兜底。最终发布结果未知只进入只读发布核验，上传或保存结果未知则留在各自未完成检查点对账，不能互相跳步。

基础实现已进入 v0.1.74，但真实用户日志暴露了启动迁移缺口：旧数据在修正非最终 `result-unknown` 后，可能仍保留不匹配的 Attempt/execution 投影，第二次严格校验会让整个事务服务启动失败。v0.1.75 在同一 `WebAffairService` 启动收敛入口中覆盖全部受约束生命周期组合，并把修复结果持久化；仍没有真实 CSDN 三图发布和最终断线验收证据，因此不能称为“真实用户问题已关闭”。

v0.1.76 的真实日志又暴露了一个更窄但会直接打断长任务的 owner 更新缺口：Playwright 从 connection generation `1` 重连到 `2` 后，`BrowserManager` 已在同一 View/WebContents 上成功 claim 新 Page，但发布协调器和 BrowserTask correlation 仍保留旧 connection/page generation。看门狗因此把已经恢复的页面误判为 `RUNTIME_OWNER_LOST`，随后确认成孤儿。修复后的不变式是：`BrowserManager` 只在 claim 后发布完整 Page 身份；`WebAffairService` 在当前 Attempt/generation 内先把旧 browser-task binding 标为 `lost` 并持久化新 binding；成功后才更新 BrowserTask correlation 和内存租约，再由同一看门狗核验恢复 `running`。任一步失败都继续冻结网页写入，不能用新 Page 冒充旧动作结果。

2026-09-01 对 v0.1.76 现场日志复盘后又确认了更底层的恢复协议缺口：事务只持久化“执行到哪个检查点”，没有持久化“这些副作用属于 CSDN 的哪一篇草稿”。`ArticlePublishingState.draft` 虽然存在，但此前没有生产写入者或恢复读取者；`waitForAccountView()` 复用同 Profile Tab 时也只激活页面，不保证导航到传入 URL。因此旧实现所谓“从中断处继续”实际是新建 Agent/BrowserTask 并接管任意同账号页，可能落到内容管理、空白编辑器或其他文章。

当前修复把 CSDN 数字草稿 URL 作为 Attempt 的不可变平台锚点：首次进入 `https://mp.csdn.net/mp_blog/creation/editor/<draftId>` 后由 main 在任何写入前持久化；同一 Attempt 不得切换 `draftId`；恢复时必须在 Agent 启动前导航并核验该地址。历史 Attempt 已有平台写入但没有锚点时，只允许用户先在绑定账号 Tab 打开原草稿后补绑定，禁止自动打开通用编辑器猜测。自动化已经覆盖锚点冷重载、串稿拒绝、恢复导航先于 Agent 启动和无锚点旧任务 fail-closed；真实 CSDN 半途退出再恢复仍是发布前必须完成的真人验收，不能用这些测试替代。

本轮固定参数为：owner lease `60s`、progress lease `10min`、`checking-runtime` probe deadline `60s`、watchdog interval `10s`、单次收敛最多重试 `3` 次。它们集中在 `ArticlePublishingService`，并使用 fake clock 覆盖“owner 存活但无进度”和“owner 丢失”两条路径；同一 Runtime generation 的用户“继续等待”最多成功一次。真实站点验收后如需调整，只能修改这些集中参数和本文记录。

## 独立审查结论与本次修订

首版方案被独立审查**驳回**，结论成立。驳回不是措辞问题，而是发现了三个会让实现仍不安全的契约缺口和两个当前代码事实：

1. 当前假 `running` 根因已经确认：Attempt 先持久化为 `running`，但窗口关闭、Agent 启动失败或事件丢失时，没有可靠终态能解锁 UI。
2. 当前候选修复只覆盖“Agent 发出终态，并能找到关联 BrowserTask”的窄路径。
3. 首版 runtime binding 只有 `attemptId`，没有 Attempt 内的**执行代次**。同一 Attempt 恢复后，旧 Run 的迟到事件仍可能误杀新 Run。
4. 当前 `finishAttemptNow()` 在 Attempt 进入 `cancelled` 时会保留原 execution 状态，因此确实可能出现 `Attempt=cancelled`、`execution=running`；checkpoint、asset、publication 也缺少统一投影收敛器。
5. 当前最终发布策略会先把 publication 标成 `dispatched` 并返回 `allow-once + sideEffectKey`，但 Browser 工具动作入口只检查 handoff/unknown，随后直接返回，未消费、核销或拒绝重复的 `sideEffectKey`。上传与保存也没有覆盖实际动作入口的完整 write-ahead 协议。

因此，下列三项从“建议”升级为 P0 前置契约：

- 每次启动或恢复同一 Attempt 必须原子递增 `executionGeneration`；所有 Runtime、事件、租约和副作用授权都绑定这一代。
- 文章发布生命周期只能由 `WebAffairService` 的一个原子收敛 reducer 同时更新 Attempt、execution、checkpoint、asset、publication、节点、事务和事件。
- 上传、保存和最终发布都必须取得由主进程持久账本签发的一次性副作用能力，并在实际 Playwright 动作之前原子消费；动作入口不得忽略 key。

复审又指出 4 个剩余阻塞，本文全部接受：

1. 当前 `ArticlePublishingTab.executeTask()` 在 renderer 依次启动持久 Attempt、打开网页、创建 Agent 会话、发送任务，并依赖 renderer catch 再调用 `recoverTaskLaunch()`。窗口在中间销毁时，main 已写 `running`，但恢复命令可能永远不会执行。
2. `executionGeneration` 只能隔离发布 Attempt 的代次，仍不足以隔离同一代内被替换的 Agent Runtime、Browser View/WebContents 和 Playwright/CDP connection。事件必须携带各 owner 自己的 epoch identity。
3. 当前启动修复只扫描瞬态 Attempt；`appendEvent()` 在单事务 2,000 个事件时直接抛错，`WebAffairStore` 在 8MB 时拒绝保存。修复如果还要追加事件或增大快照，本身也可能永远失败。
4. 把“超过静默阈值”直接当中断会误杀正常慢任务，只凭 owner 仍 active 又会让卡死任务永久续租。必须增加持久 `checking-runtime`（用户文案“待核验”），区分 owner 存活、真实进度和有边界的外部等待。

这 4 项同样是实施前 P0/P1 门禁，不允许留到“后续优化”。

## 一、用户端到端验收动作

只有以下动作全部通过，才可以对用户宣称问题已系统性解决。单测、构建、日志或某一个回调通过都不能替代这些验收。

1. 用真实 CSDN 账号启动一篇含至少 3 张正文图片的发布任务；任务运行中强制断开 Browser/CDP。应用必须在约定的有界时间内离开假 `running`，显示“已中断”或“结果未知”，并给出安全的下一步。
2. 在图片上传期间终止 Agent Runtime 进程。即使 Agent 没有正常发送完成事件，事务也不能永久停在 `running`。
3. 让同一个 Agent Run 先后创建多个 BrowserTask，且绑定当前发布 Attempt 的任务不是最后一个。绑定任务失败或结束后，发布事务必须正确收敛。
4. 关闭当前发布绑定的浏览器 Tab。界面必须显示明确原因，并进入可恢复状态；不得只留下灰色按钮。
5. 任务运行中退出并重启 Studio。重启后不得存在“没有真实 Runtime 仍显示 running”的事务。
6. 恢复一个已中断任务，确认 execution generation 已递增，再注入旧 Agent Run / BrowserTask 的迟到终态。旧事件不得中断新 Run。
7. 模拟“点击最终发布后立即断线”。系统必须进入 `result-unknown`，只能核验结果，不得自动或手工直接重放发布动作。
8. 注入一次 `WebAffairService` 落盘失败。界面应显示状态同步失败，后台可重试；恢复存储后同一收敛命令最终成功，且不重复写入副作用。
9. 在已确认孤儿化的任务上点击“检查运行状态”。系统必须从主进程重新核验 Agent、BrowserTask 和 Tab，并把任务原子地解锁为可恢复状态。
10. 对仍有稳定活动信号的长任务运行超过假死阈值。看门狗不得误杀真实任务。
11. 对同一个上传、保存或发布副作用 key 连续发起两次 Browser 动作。第二次必须在调用 Playwright 前被拒绝；重启后重复同一 key 也必须被拒绝或只允许核验。
12. 用户终止运行中的发布任务。保存后的 Attempt、execution、checkpoint、asset、publication、节点和事务状态不得互相矛盾，尤其不得出现 `Attempt=cancelled` 但 `execution=running`。
13. 点击开始后，在 main 已创建 Attempt、Agent 尚未接收任务时立即关闭 renderer/window。main 必须继续完成或原子中断启动；重开窗口后不得假 `running`，也不得创建第二个 Attempt。
14. 在同一发布 generation 内替换 Agent Runtime、重建 Browser View/WebContents、断开并重连 CDP，再注入旧 owner epoch 的迟到事件。所有旧事件必须 no-op。
15. 把单事务事件填到 2,000 条，并把事务文件推到普通 high-water，再触发 Agent 断线和 App 重启。关键收敛必须成功落盘，不能因为追加诊断失败而保持 running。
16. 模拟 owner heartbeat 持续正常但没有 token、工具、检查点或页面进度的静默任务。任务必须先显示“待核验”，外部写入被冻结；不能直接误杀，也不能靠 heartbeat 永久回到 running。
17. 点击“开始执行”或恢复同一 Attempt 后，主区域必须激活绑定 Browser Tab，右侧必须显示绑定
    conversation 的 Agent 消息和 BrowserTask 活动。切到其他 Tab 再切回该 Browser Tab 时仍恢复同一
    Agent；发布控制 Tab 只能作为配置/历史入口，不能覆盖 Browser View 或劫持 Agent 选择。
18. 在 CSDN 数字草稿页完成第一张图片但尚未完成正文时终止 Runtime 并重启 Studio。点击“从中断处继续”后，main 必须先恢复同一 `draftId`，再启动新 generation 的 Agent；已核验图片不得重传。把可见 Tab 手工切到另一篇草稿后再触发写入，动作必须在 Playwright 派发前被拒绝。历史任务没有锚点时必须提示先打开原草稿，不能导航到通用编辑器新建空稿。

## 二、当前代码事实与根因

### 2.1 表象为什么是“点击没反应”

`ArticlePublishingTab` 只有在发布状态是 `draft`、`waiting-human`、`interrupted` 或 `failed` 时才允许开始。`running` 时按钮使用 `disabled={busy || !canStart}`。因此截图中 `Attempt: 36e4ed0e · running` 已经足以解释按钮无响应：浏览器根本不会派发点击事件。

这里不能通过把按钮强行启用来修复。如果上一轮最终发布动作已经发出，直接启动新 Attempt 可能重复上传、重复保存甚至重复发布。

### 2.2 状态为什么会卡住

当前系统至少有三类事实：

| 事实                                  | 当前所有者                               | 生命周期                    |
| ------------------------------------- | ---------------------------------------- | --------------------------- |
| 发布事务、Attempt、检查点、资源和证据 | `WebAffairService`                       | 持久、跨重启                |
| Agent Run 和 Session                  | Agent Runtime / `AgentRuntimeStateStore` | 当前进程运行事实 + 近期账本 |
| 浏览器动作任务                        | `BrowserTaskRuntime`                     | 当前进程内                  |
| 浏览器 Tab、Profile、WebContents/CDP  | `BrowserManager`                         | 当前进程内                  |
| 页面展示                              | renderer                                 | 只读投影                    |

`running` 是持久事实，但支持它的 Agent Run、BrowserTask 和 Tab 都可能先消失。只要终态事件漏送、关联只命中某一个任务、服务暂不可用或回调落盘失败，持久 Attempt 就不会自动知道 Runtime 已死。

当前 `BrowserTaskRuntime` 只把 `taskChanged` 发给 renderer，没有提供主进程内部的对称订阅接口。当前发布收敛主要挂在 Agent 终态旁路上，因此存在“Browser 先死、Agent 不终止”的盲区。

### 2.3 当前修复覆盖了什么

当前 `main` 的 `AgentBridge.reconcileCorrelatedBrowserTasksEnd()` 已经从“只取最后一个 BrowserTask”改为扫描相同 `conversationId + agentRunId` 的全部任务，并按 `workspace + affair + attempt` 去重。这解决了已复现的多 BrowserTask 关联遗漏。

`WebAffairService.reconcileInterruptedAttempts()` 会在应用重新加载持久数据时，把仍处于 `preparing`、`running-ai`、`verifying` 的 Attempt 标成 `interrupted`，并把瞬态图片和检查点改为需要核验。这解决了重启后的永久假运行。

但这两条都不是统一生命周期协议：第一条依赖 Agent 最终发出终态，第二条依赖用户重启应用。它们应该保留为防线，但不能继续作为主路径。

## 三、不可破坏的不变式

实现前先把规则写死，测试必须直接验证这些规则。

1. `WebAffairService` 是发布 Attempt 和 `ArticlePublishingState` 的唯一持久写入 owner。Coordinator、Agent、BrowserTask 和 renderer 都不能持久化另一份发布生命周期状态。
2. 持久 `execution.status === 'running'` 只在以下条件成立时合法：当前 Attempt 非终态，并且启动宽限期内正在建立 Runtime，或者主进程能观测到当前步骤所必需的、与当前 Attempt 精确绑定的健康 Runtime。仅有一个无关或已经失去页面能力的 Run 仍标记 active，不足以证明发布仍在运行。
3. 任何 Agent、BrowserTask、Tab 或启动失败事件都必须进入同一个幂等收敛入口；不得各自直接拼装不同的发布状态。
4. 运行引用必须带 `workspaceId + affairId + attemptId`，Agent/Browser 标识只是附加相关性。只凭 conversation、当前 Tab 或“最后一个任务”不能改变持久 Attempt。
5. 运行引用还必须带当前 Attempt 的 `executionGeneration`。创建 Attempt 时为第 1 代；同一 Attempt 从中断恢复、创建替代 Runtime 或重新绑定新的 Agent Run/BrowserTask 前，必须由 `WebAffairService` 原子加一并持久化。人工交还若精确恢复同一组 paused binding 可以保持原代，否则按替代 Runtime 升代。老 Attempt、老 generation、老 Agent Run、老 BrowserTask 的迟到事件不得影响新一代运行。
6. 超时不是失败证明。看门狗超时后必须先查询真实 owner，再决定是仍活跃、等待人工、可中断还是结果未知。
7. “外部动作可能已发出”与“外部动作确认未发出”必须分流。最终发布结果未知时禁止自动重放。
8. `interrupted` 表示可核验后恢复；用户明确终止应映射为 Attempt `cancelled`，并给 `ArticlePublishingState.execution` 增加 `cancelled`，UI 文案显示“已终止”。两者不能混用。
9. renderer 不猜测、不修复状态。所有“检查状态”“继续”“终止”命令都调用主进程受信契约，由主进程原子判定并写入。
10. 每次收敛都必须有可审计原因；重复事件必须安全返回当前快照，不重复推进检查点或产生外部副作用。
11. 当前 Attempt 一旦终态，execution 不得仍是 `running`；publication、checkpoint、asset、节点和事务状态必须满足统一映射。每次持久化文章发布事务都执行完整一致性断言，拒绝矛盾快照。
12. 所有外部写入必须遵守 write-ahead：先持久化稳定 `sideEffectKey` 和一次性动作授权，再由实际 Browser 动作入口原子消费为 `dispatched`，之后才能执行上传、保存或发布；执行后只能核验并提交结果。没有已消费的持久授权时不得发出副作用。
13. 启动发布是 main 进程拥有的单一操作。renderer 只能提交“启动/检查/继续/终止/核验”命令和投影结果；renderer/window 销毁不得中止 main 的启动收敛，也不能负责失败回滚。
14. `executionGeneration` 之外，每个事件还必须精确携带产生事件的 Agent Runtime epoch、Browser View runtime generation、WebContents identity 和 Playwright connection/page-binding generation；无法证明属于当前 binding 的事件一律不得改持久状态。
15. 关键生命周期修复不得依赖追加普通事件，也不得被事件数量或普通文件高水位阻断。事件日志是审计投影，不是状态提交前置条件。
16. 静默超限先进入持久 `checking-runtime`，冻结外部写入并主动核验；owner heartbeat 只能证明进程存在，不能无限证明任务有进度。

## 四、目标架构

### 4.0 整套启动移入 main

删除 renderer 中“先 `startTask()`，再打开网页、创建会话、发送 Agent，catch 后 `recoverTaskLaunch()`”的生命周期编排。保留的 renderer 行为只有：

```text
用户点击开始
  → IPC: articlePublishing.startExecution({ workspaceRef, affairId })
  → 显示 main 返回/推送的持久投影
  → 可选打开已经由 main 创建的 Agent 会话和 Browser Tab
```

main 的无持久编排层执行一个可重入启动操作：

1. 做源文件、账号、存储高水位和当前 Attempt 的只读预检；预检失败时不写 `running`。
2. 在 `WebAffairService` mutation queue 中创建/恢复 Attempt，写入 `executionGeneration`、稳定 `launchOperationId` 和 `preparing`。
3. 由 main 打开或复用账号 Browser Tab，记录完整 Browser identity。
4. 由 main Agent owner 创建会话和 Run，记录完整 Agent identity；之后才把 execution 投影为真正 `running`。
5. main 捕获每个阶段的异常并调用统一 reducer；renderer/window 是否存在不影响 catch、重试和落盘。
6. 只有 Attempt、Runtime binding 和启动结果都持久化成功后才向 renderer 广播“已启动”。

启动命令必须幂等：同一 `launchOperationId` 重试返回同一操作；同一 Affair 已有 `preparing/running/checking-runtime` 时不得创建第二个 Attempt 或 generation。renderer 重建后只查询 main 状态，不“补跑”启动步骤。

main 不得反向调用 renderer Zustand。Agent 侧增加 main 内部 `createConversationAndStartRun()`（名称可调整）并由统一 Agent owner 产生 conversation/run 投影事件；Browser 侧调用现有 main owner。renderer 只订阅这些 canonical projection，因此把启动移入 main 不会制造第二套 Conversation 或 Tab 状态。

IPC sender 被销毁不能取消 main 启动。用户显式“终止任务”是另一条带 generation 的 main 命令；它与启动串行进入同一 Affair mutation/operation queue。

### 4.1 扩展无持久状态的运行协调器

扩展现有无持久编排层，形成 main 进程 `ArticlePublishingRuntimeCoordinator` 职责。当前 `ArticlePublishingService` 只承担持久启动准备并把 prompt 返回 renderer，尚未拥有完整 Runtime 启动链；施工时可以扩展该服务或抽出窄职责组件，但不得并存两套发布编排和生命周期规则。它是生命周期协调器，不是第二持久状态 owner。职责仅包括：

- 订阅 Agent Run 的开始、活动、终态；
- 订阅 BrowserTask 的创建、活动、暂停和终态；
- 订阅绑定 Tab/WebContents/CDP 的销毁或不可恢复断线；
- 接收发布启动、绑定、人工交接、恢复和 App shutdown 事件；
- 维护有界的进程内活跃租约与重试队列；
- 查询各 Runtime owner 的当前事实；
- 把判定结果提交给 `WebAffairService` 的唯一收敛命令。

协调器不落独立快照，不拥有 Attempt 状态。进程退出后，其内存租约可以全部丢失；重启恢复由 `WebAffairService` 的持久 Attempt 扫描完成。

### 4.2 主进程内部事件必须对称

为 `BrowserTaskRuntime` 增加主进程内部订阅，例如：

```ts
onTaskChanged(listener: (task: BrowserTaskRun) => void): () => void
```

Agent Runtime 账本也应暴露同等语义的 Run 事件或由其唯一生命周期入口向协调器投递。要求：

- 先更新 owner 自身状态，再发出事件；
- listener 获得不可变快照；
- 注册返回 disposer；App/window rebuild/shutdown 时对称解绑；
- 单个 listener 抛错不能阻断 Runtime owner 的状态提交；
- renderer IPC 继续只是投影，不能被协调器反向依赖。

### 4.3 运行绑定从“单值覆盖”改成“有界历史”

现有 Attempt 只有一个 `agentRunId` 和一个 `browserTaskRunId`，无法表达同一 Attempt 的多轮 Run、多 BrowserTask 和恢复过程。新增持久引用记录：

```ts
interface RuntimeBindingBase {
  id: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  status: 'binding' | 'active' | 'terminal' | 'lost'
  boundAt: string
  lastObservedAt: string
  endedAt?: string
  terminalReason?: string
}

type WebAffairRuntimeBinding =
  | (RuntimeBindingBase & {
      kind: 'agent-run'
      conversationId: string
      agentRunId: string
      agentRuntimeEpoch: number
      agentRuntimeBindingKey: string
    })
  | (RuntimeBindingBase & {
      kind: 'browser-task'
      browserTaskRunId: string
      tabId: string
      browserViewRuntimeGeneration: number
      webContentsId: number
      playwrightConnectionGeneration: number
      playwrightPageBindingGeneration: number
    })
  | (RuntimeBindingBase & {
      kind: 'browser-tab'
      tabId: string
      browserViewRuntimeGeneration: number
      webContentsId: number
    })
```

它只保存引用和审计，不复制 Agent/Browser 的运行状态机。每次绑定追加或幂等更新对应记录，不再覆盖唯一身份。`executionGeneration` 是发布执行硬隔离边界；owner epoch 是同一代内部的实例隔离边界：

- Agent 事件身份至少是 `{ conversationId, runId, agentRuntimeBindingKey, agentRuntimeEpoch }`。现有 Claude Runtime manager generation 可作为 Claude Code 后端 epoch；其他后端必须提供等价的单调代次，不能只靠 `runId`。
- Browser 事件身份至少是 `{ browserTaskRunId, tabId, browserViewRuntimeGeneration, webContentsId, playwrightConnectionGeneration, playwrightPageBindingGeneration }`。Browser View 重建、WebContents 替换或 CDP 重连后必须建立新 binding。
- CDP 重连不能把旧动作结果“继承”为新连接事实。旧 connection/page generation 的动作回执只能把旧动作标成待核验/结果未知；新连接只负责重新观察。

Agent prompt、Agent Run correlation、BrowserTask correlation、租约、终态事件和副作用授权全部必须携带发布 generation 与相应 owner identity。高频 Agent token、Browser action 活动只刷新协调器的内存租约；持久 binding 只在绑定、重要检查点、owner epoch 变化、终态和失主时更新，避免把心跳变成高频落盘。记录必须有上限并保留当前 Attempt、结果未知和最近终态记录；建议初始上限 40 条，最终值由迁移与诊断体积测试确认。

`ArticlePublishingState.execution` 同时保存 `currentGeneration` 和 `currentLaunchOperationId`。启动流程必须是：

1. `WebAffairService` 在 mutation queue 中创建 Attempt，或在恢复时根据“复用同一 paused binding / 创建替代 Runtime”原子确认当前代或生成下一代 generation；从 `interrupted` 恢复必须生成下一代；
2. 返回 `{ attemptId, executionGeneration }`；
3. 之后才能创建 Agent Run 和 BrowserTask，并把两者精确绑定到这一代；
4. Runtime 创建失败也使用这一代提交启动失败收敛；
5. 任何 generation 小于当前值的事件一律幂等 no-op；大于当前值属于协议错误，拒绝写入并报警。

保留现有 `lastAgentRunId`、`lastBrowserTaskRunId` 作为 UI 快捷投影可以接受，但它们不能再作为唯一相关性依据。

### 4.4 唯一幂等收敛命令

在 `WebAffairService` 增加主进程内部命令；renderer 不直接获得任意状态写权限：

```ts
reconcileArticlePublishingRuntime(input: {
  eventId: string
  workspaceId: string
  affairId: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  source:
    | 'agent-terminal'
    | 'browser-terminal'
    | 'tab-lost'
    | 'launch-timeout'
    | 'lease-expired'
    | 'startup'
    | 'shutdown'
    | 'user-check'
    | 'user-cancel'
  observedAt: string
  runtimeBindingId?: string
  runtimeIdentity?:
    | {
        kind: 'agent-run'
        conversationId: string
        agentRunId: string
        agentRuntimeBindingKey: string
        agentRuntimeEpoch: number
      }
    | {
        kind: 'browser-task'
        browserTaskRunId: string
        tabId: string
        browserViewRuntimeGeneration: number
        webContentsId: number
        playwrightConnectionGeneration: number
        playwrightPageBindingGeneration: number
      }
    | {
        kind: 'browser-tab'
        tabId: string
        browserViewRuntimeGeneration: number
        webContentsId: number
      }
  observedStatus?: string
  reasonCode: string
  reason: string
}): Promise<WebAffairOperationResult<WebAffair>>
```

contract/schema 必须按 `source` 强制 identity：Agent/Browser/Tab 事件的对应 discriminated identity 是必填；只有 startup、shutdown、user-check/user-cancel 等非 Runtime 来源可以不带。不得把这些字段全部做成 optional 后在 service 内“尽量匹配”。

该命令进入 `WebAffairService` 现有按工作空间串行的 mutation queue，并按下列顺序处理：

1. 使用稳定 `eventId` 去重，校验工作空间、Affair、当前 Attempt、`executionGeneration`、`launchOperationId`、完整 owner identity、binding 和事件引用；找不到、已终态、事件属于旧 generation/launch operation，或 owner epoch/CDP generation 与当前 binding 不一致时返回幂等 no-op，并记录安全诊断。`eventId` 必须由 Attempt、发布 generation、launch operation、完整 owner identity、事件类型和 owner 终态代次稳定派生，重试时不得重新生成。去重事实保存在当前 Attempt/generation 的受界账本或 binding 上，不能只依赖可能被裁剪的展示事件日志。
2. 更新对应 runtime binding 的观测或终态。
3. 依据检查点和副作用账本判定安全状态，不由事件来源直接指定最终状态。
4. 通过唯一 `reduceArticlePublishingLifecycle()`（名称可调整，职责不能分叉）原子计算并更新 Attempt、文章 execution、检查点、资源、publication、节点、事务和事件日志。文章发布相关的 finish/cancel/interrupt/handoff/result-unknown/startup-repair 不得再各自拼装局部状态；已有入口只能校验参数后委托该 reducer。
5. 落盘成功后才广播 renderer 变更；落盘失败时返回明确失败，由 Coordinator 以同一个 `eventId` 保留重试任务，不宣布已经收敛。

所有 Agent 终态、BrowserTask 终态、Tab 丢失、启动失败、启动/退出修复和用户检查都必须调用这一入口。当前 `AgentBridge` 的多任务扫描可保留为兼容防线，但最终也要落到该命令，不能继续维护平行规则。

统一 reducer 至少强制以下投影不变式：

| 当前 Attempt                              | execution          | publication / checkpoint / asset 约束                                                |
| ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `preparing` 且 main 正在启动              | `preparing`        | 必须有 `launchOperationId` 和启动期限；还不能执行网页副作用                          |
| `running-ai`                              | `running`          | 必须属于同一 Attempt + generation + owner identity；瞬态项必须有对应运行或副作用记录 |
| `checking-runtime`                        | `checking-runtime` | 冻结外部写入，只允许 owner 探测和只读页面核验                                        |
| `waiting-human`                           | `waiting-human`    | 看门狗停租，不得自动推进                                                             |
| `interrupted`                             | `interrupted`      | 瞬态 checkpoint/asset 必须转 `needs-reconcile` / `reconciling` 或更保守状态          |
| `cancelled`                               | `cancelled`        | 不得保留 execution `running`；未确认最终副作用仍优先 `result-unknown`                |
| `failed`                                  | `failed`           | 不得把已 dispatched 的未知最终结果降成普通 failed                                    |
| `verifying` 且核验 Runtime 健康           | `running`          | publication 必须是 `dispatched` / `verifying`，只允许观察动作                        |
| `verifying` 且 Runtime 丢失、无法判断结果 | `result-unknown`   | publication 必须是 `dispatched` / `verifying` / `result-unknown`，禁止发布动作       |
| `succeeded`                               | `published`        | publication 必须 `published` 且有可复核 URL                                          |

`assertIntegrity()` 必须检查上述跨对象约束，而不只是各字段各自满足 union/schema。

### 4.5 副作用安全分流

收敛命令按已持久化检查点判定：

| 已知事实                                      | 目标状态                                                           | 用户可执行动作                       |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| 尚未发出任何外部写入                          | `interrupted`                                                      | 从安全检查点继续                     |
| 图片上传/草稿保存已发出但未核验               | `interrupted`，相关资产/检查点为 `reconciling` / `needs-reconcile` | 先重观测页面，再决定补传或继续       |
| 明确进入人工接管                              | `waiting-human`                                                    | 用户完成后交还 Agent                 |
| 最终发布已 dispatched/verifying，但结果未确认 | `result-unknown`                                                   | 只允许核验文章结果，禁止重放发布     |
| 用户明确终止且没有待确认最终副作用            | execution `cancelled`、Attempt `cancelled`                         | 新建 Attempt，不恢复旧 Attempt       |
| 用户明确终止但最终副作用结果未知              | `result-unknown`                                                   | 仍只能核验，不能用“终止”掩盖未知结果 |
| 已确认发布成功                                | `published` / Attempt `succeeded`                                  | 查看结果                             |

判断必须基于持久副作用 key、检查点和 evidence，不能基于 Agent 文本声称“完成”。

### 4.6 一次性副作用能力必须在实际 Browser 动作入口消费

只让策略返回 `allow-once` 不算实现幂等。新增由 `WebAffairService` 持久化的副作用账本：

```ts
interface ArticlePublishingSideEffect {
  key: string
  affairId: string
  attemptId: string
  executionGeneration: number
  kind: 'upload-asset' | 'save-draft' | 'publish'
  targetId: string
  actionFingerprint: string
  status: 'reserved' | 'dispatched' | 'result-unknown' | 'verified' | 'rejected'
  reservedAt: string
  dispatchedAt?: string
  observedAt?: string
  browserTaskRunId?: string
}
```

每个上传、保存草稿、最终发布动作都必须采用：

```text
reserve intent persisted
  → BrowserToolModule 在实际 Playwright 调用前 consume(key, generation, task, fingerprint)
  → WebAffairService 原子 reserved -> dispatched
  → 只有 consume 成功才调用 Playwright
  → action return/error 只写观察事实
  → 页面后置核验后 verified，断线或无法判断则 result-unknown
```

强制规则：

- `BrowserToolModule` 不能像当前实现一样收到 `allow-once` 后直接 `return`；必须携带 capability 进入具体动作分派，并在离 Playwright 调用最近的公共边界消费。
- 同一个 key 只能从 `reserved` 消费一次。`dispatched`、`result-unknown`、`verified` 再次消费必须在调用 Playwright 前拒绝。
- key 稳定绑定逻辑副作用；generation 是授权代次。恢复新 generation 不会自动获得同一最终发布 key 的新授权。
- `actionFingerprint` 至少固定动作类型、规范化目标、资源/内容 hash；调用参数与授权不一致时拒绝。
- 图片上传的显式重试必须先核验上一 key 的结果，再由 `WebAffairService` 根据重试策略签发新的逻辑 attempt/key；不能复用或绕过旧 key。
- 自动保存可能由 fill 触发的平台必须按适配器建模；不能因为动作名不是“保存”就假设没有外部副作用。
- Playwright 调用返回不等于平台已提交成功。成功只进入待核验，只有页面证据能进入 `verified`。

如果在 consume 持久化成功和实际 Playwright 调用之间崩溃，状态保守进入 `result-unknown`/核验，即使动作可能尚未执行也不自动重放。这会牺牲一点自动恢复率，但不会重复上传或发布。尤其是最终发布，持久化/消费失败就不允许点击。

## 五、假死检测与可靠收敛

### 5.1 活跃租约不是第二状态库

协调器为当前进程中的活动 Attempt 维护有界内存租约：

```text
workspaceId + affairId + attemptId
  -> executionGeneration
  -> current Agent/Browser/CDP owner identities
  -> launchDeadline
  -> bound Agent Run IDs
  -> bound BrowserTask IDs
  -> bound tabId
  -> lastObservedAt
  -> pending reconciliation attempts
```

活动信号只来自身份与当前 binding 完全匹配的可信 main owner：Agent 流式/工具/终态事件、BrowserTask 状态或动作更新、Tab/CDP 生命周期。renderer 心跳和按钮页面是否打开都不算运行证明。

租约分成两类，不能混为一个 `lastObservedAt`：

- **owner lease**：证明当前 identity 的进程、Run、View/CDP 仍能响应主动探测；只说明“还活着”。
- **progress lease**：证明检查点推进、工具动作完成、页面观察变化，或进入有截止时间的显式等待；说明“任务有进展”。

owner lease 不能无限延长 progress lease。所有合法的长等待必须显式转换成 `waiting-external` 并持久化 next-check/deadline；否则超过当前步骤的 no-progress budget 就进入“待核验”。

### 5.2 “待核验”三阶段看门狗

为 Attempt 和 `ArticlePublishingState.execution` 增加 `checking-runtime`，UI 文案固定为“待核验”。看门狗不得在计时器触发时直接续租或改成失败：

1. **持久冻结阶段**：启动宽限或 progress lease 过期后，通过统一 reducer 原子进入 `checking-runtime`，记录 suspicion reason、最后进度时间和 probe deadline；立刻禁止上传、保存、发布等外部写入。
2. **主动核验阶段**：同时查询 `AgentRuntimeStateStore`、Agent owner epoch、`BrowserTaskRuntime`、Browser View/WebContents identity 和 Playwright connection/page generation；必要时只读重观测页面。
3. **有界判定阶段**：
   - 当前步骤所需 Runtime identity 全部匹配，主动探测成功，并取得新的真实进度证据：返回 `running` 并同时刷新 owner/progress lease；
   - owner 存活但没有新进度，且步骤存在已持久化的合法外部等待：进入 `waiting-external`，由等待计划负责下一次检查；
   - owner 存活但没有新进度、也没有合法等待：保持 `checking-runtime` 并向用户显示“运行存在但无进度”；到 probe deadline 后转 `waiting-human/needs-attention`，不能永久续租；
   - 明确处于人工暂停：进入/保持 `waiting-human`；
   - 全部终态或不存在，且没有最终副作用未知：提交 `interrupted`；
   - Tab/CDP 丢失且最终动作已发出：提交 `result-unknown`；
   - 查询本身失败：保持 `checking-runtime`，显示核验失败并进行有界重试；超过 deadline 转 `waiting-human/needs-attention`，不能假装仍在运行。

“当前步骤所需 Runtime”必须由持久检查点决定，不能统一采用“任意一个 active 就算活着”：

| 阶段                         | 合法的运行证明                                                                   | 已知丢失时的处理                                 |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| 启动/绑定                    | main launch operation 在 grace 内，或 Agent Run 已按完整 identity 绑定并产生进度 | grace 后进入待核验；无 owner 则中断              |
| Agent 规划、尚未操作网页     | Agent Run identity 匹配，且有近期 token/tool/checkpoint 进度                     | 只有 heartbeat 时进入待核验                      |
| BrowserTask 正在执行网页动作 | BrowserTask 活跃，绑定 Tab 存在，页面自动化连接健康；Agent 状态按该步骤契约核验  | Browser/Tab/CDP 丢失则按副作用阶段中断或结果未知 |
| 人工接管                     | Attempt 必须是 `waiting-human`，不要求 Agent/Brower 活跃租约                     | 不得被看门狗误判成失败                           |
| 外部等待                     | Attempt 必须是 `waiting-external`，由既有等待计划 owner 证明                     | 等待计划丢失则 needs-attention                   |
| 最终结果核验                 | 可重观测页面的 BrowserTask/Tab 健康                                              | 丢失时保持 `result-unknown`，不能重发            |

启动宽限、各步骤 no-progress budget、owner 探测间隔、probe deadline 和最大重试次数必须集中配置、使用 fake clock 测试。不能凭感觉在方案阶段固定一个会误杀慢任务的数字；实施时应依据真实 Agent 首事件、上传和站点响应数据确定默认值，并把最终值记录在本文。用户选择“继续等待”只能创建一次有截止时间、带原因的等待计划，不能把 `checking-runtime` 无期限改回 `running`。

### 5.3 可靠重试

当前 fire-and-forget + `console.error` 不足以保证持久收敛。新链路要求：

- 终态提交要 `await`，或进入由协调器持有的有界重试队列；
- 使用相同幂等键重复提交；
- 指数退避并设上限，重试失败保持可见诊断；
- 下一次看门狗、用户“检查运行状态”和 App shutdown flush 都能重新触发；
- 存储恢复后只产生一个最终事件，不重复完成 Attempt；
- 队列是进程内可靠性机制，不是新的持久事实源。进程崩溃后由启动扫描重新发现瞬态 Attempt。

### 5.4 启动和退出顺序

启动：

1. 加载 Agent 近期 Run 账本并把失主非终态 Run 标记为 `runtime_owner_lost`；
2. 加载 `WebAffairService`；
3. 遍历**全部文章发布 Affair**执行跨对象一致性审计，不只扫描 `preparing/running-ai/verifying` Attempt：检查 currentAttempt、execution、generation、binding、checkpoint、asset、publication、副作用账本、节点和事务投影；
4. 由于进程内 BrowserTask、View/CDP binding 已失主，任何旧 `preparing/running/checking-runtime` 都通过统一 reducer 进入 interrupted/waiting-human/result-unknown；`Attempt=cancelled` 但 `execution=running` 等矛盾也必须修复；
5. 启动协调器订阅与看门狗；
6. 最后接受新的发布任务。

退出：

1. 停止接受新的发布启动；
2. 停止/取消 Runtime 并等待其 owner 写入终态；
3. flush 协调器待提交的收敛；
4. flush `WebAffairService`；
5. 对称解绑 listener、销毁窗口和 Runtime。

强制崩溃无法保证 flush，因此启动扫描仍是必须的最后防线。

### 5.5 事件/文件上限不能阻断关键修复

当前单事务事件上限是 2,000，事务主文件硬上限是 8MB。治理要求：

1. 普通写入使用低于硬上限的 high-water mark，预留固定的关键生命周期修复空间；达到 high-water 后拒绝新事务和非关键诊断增长，但仍允许 interrupt/cancel/result-unknown/checking-runtime 等收敛。
2. 事件日志不是 authoritative state。普通事件达到上限时，先把旧非关键事件压缩成带时间范围、数量和 hash-chain 摘要，再追加关键生命周期事件；绝不能因 `appendEvent()` 抛错回滚状态修复。
3. 当前 Attempt、当前 generation、未核验副作用、`result-unknown`、发布 URL 和关键 evidence 不得被压缩掉。可丢弃/汇总的只能是重复诊断和已被权威状态取代的普通事件。
4. `WebAffairStore` 在保存关键收敛前执行确定性 compact-to-fit。若旧版本数据已经贴近 8MB，先压缩普通历史，再保存修复；不能先尝试一个必然超限的 append。
5. 为极端情况下的关键状态更新保留由同一个 `WebAffairStore` 管理的固定大小 recovery journal。journal 只记录带 revision、affair、attempt、generation 和完整目标状态 hash 的关键 delta；加载时先合并 journal，再向 renderer 提供快照，主文件成功保存后清除。它是同一状态 owner 的事务日志，不是第二状态库。
6. 如果磁盘 `ENOSPC`、权限或文件损坏导致主文件和 recovery journal 都无法写入，系统必须 fail closed：冻结所有外部动作、显示持久化故障并导出诊断。无法写入任何字节时不能虚假承诺跨重启恢复，但当前会话也不得继续发布。

启动加载不能因为主文件略超正常写入 high-water 就拒绝读取修复；读取使用独立、有安全上限的 recovery limit，解析后立即 compact/repair。超出 recovery limit 或 schema 损坏时保留原文件并进入只读故障态，不能回退空快照后允许重复发布。

recovery journal 按 Affair 保存“最新关键目标状态”，同一 Affair 覆盖旧 delta，不无界追加。journal 容量必须覆盖产品允许的最大发布并发数；main 在启动新发布前先预留 journal slot，无法预留时拒绝启动。首版继续串行化发布任务，就只需为当前活动发布和一次原子切换预留有界空间。

## 六、用户恢复界面

灰掉“开始执行”但不解释原因是产品缺陷。目标 UI：

- 真正活跃时显示“正在执行”，并显示最近活动时间、当前 Agent Run/BrowserTask 的短引用；保留“打开 Agent”“打开网页”。
- 所有 `running` 页面都提供“检查运行状态”。该按钮调用主进程核验，不由 renderer 自行把状态改成 interrupted。
- `checking-runtime` 显示“待核验”，说明最后进度、owner 是否响应、核验截止时间和冻结原因；只提供“立即核验”“有界继续等待”“终止任务”，不提供普通开始或任何外部写入动作。
- Browser policy 对关联任务处于 `preparing/checking-runtime` 时必须显式拒绝所有页面 mutation，不能返回 `null` 后落入通用 Browser 动作路径；只读探测使用单独的受限命令。
- 核验确认 Runtime 已丢失且可安全恢复后，原子切换成“已中断”，主按钮变为“从中断处继续”。
- 提供“终止任务”。普通运行要确认；存在最终副作用未知时，终止不能越过 `result-unknown`。
- `result-unknown` 显示强警告和“核验发布结果”，不显示“开始执行”或“重试发布”。
- 状态核验/落盘失败时显示具体但脱敏的原因和“重新检查”，不能继续保持无解释的灰色按钮。
- disabled 控件旁必须有原因文本，例如“检测到 Attempt 仍运行，最近活动于 14:09:41；可检查状态”。

## 七、诊断要求

“复制完整诊断日志”必须包含足以独立判断分叉的结构化摘要：

- workspace、affair、attempt、execution、currentStep、publication 状态；
- runtime bindings：发布 generation、Agent Runtime epoch/binding key、Browser View generation、脱敏 WebContents ID、Playwright connection/page generation、绑定/最后观测/终态时间和 reason code；
- Agent Run 当前权威状态、更新时间和 error code；
- BrowserTask 当前权威状态、Tab 是否存在、Profile/账号/工作空间是否匹配；
- Browser/CDP 最近断线和恢复结果；
- 看门狗 launch/lease 状态、最近核验结果；
- owner lease、progress lease、no-progress budget、`checking-runtime` suspicion/probe deadline；
- 事件计数、序列化字节数、high-water、compact 结果和 recovery journal 状态；
- 收敛命令 source、decision、幂等 no-op 原因、重试次数和最后错误；
- 当前 UI 为什么允许或禁止“继续/终止/核验”。

通用“框架诊断日志”也应带这段安全摘要，否则用户在页面卡死后复制到的日志仍无法回答“谁还活着”。禁止输出 Cookie、Token、密码、正文全文、图片二进制和完整 Session 标识。

## 八、数据迁移与兼容

需要提升 WebAffair 持久 schema，并完成以下迁移：

- 旧 Attempt 的 `agentRunId`、`browserTaskRunId` 转成 runtime binding 历史；
- 旧 Attempt 增加 `executionGeneration`：从未运行的 Attempt 可初始化为 0；正在/曾经运行且无法证明代次的旧数据初始化为 1，并在启动时进入安全核验，不能直接续租；
- `ArticlePublishingState.execution.currentGeneration` 必须与当前 Attempt 一致；旧 `running` 数据不得通过迁移凭空获得活跃证明；
- 为 Attempt 和 execution 增加 `preparing` / `checking-runtime` 所需 schema、suspicion 与 probe deadline；迁移后的旧运行状态先进入 startup 全量核验，不能直接视为健康；
- runtime binding 迁移增加 Agent Runtime epoch/binding key 和 Browser View/WebContents/Playwright generations；缺字段的旧 binding 只能用于诊断，不能续租或接受终态；
- 缺少 binding 的旧 `running` Attempt 在启动时按未知 Runtime 处理并安全中断/核验；
- 为 `ArticlePublishingState.execution` 增加 `cancelled`；旧数据无需默认写入该值；
- 增加副作用账本；现有 publication `dispatched/verifying/result-unknown` 迁移成不可重放的发布记录，缺少 key 时生成只用于核验的 legacy key，不能因此重新授权动作；
- 为 store high-water、事件摘要和 recovery journal 增加版本化迁移；journal 合并必须幂等并校验 base revision/target hash；
- 保留旧快捷字段的只读兼容，直到 renderer、诊断和测试全部迁移；
- 迁移必须原子保存并保留现有备份恢复能力；损坏数据不能静默丢弃事务；
- 降级读取若不被支持，要在版本兼容说明中明确，不能假设新 schema 可被旧版本安全写回。

## 九、实现阶段与退出门禁

### P0：先固定契约和安全状态机

- 写入上述不变式和状态转换表；
- 增加 `preparing`、`checking-runtime`、`executionGeneration`、完整 owner identity/runtime binding、副作用账本、`cancelled` 及迁移；
- 在 `WebAffairService` 实现唯一幂等收敛命令和跨对象生命周期 reducer；
- 让所有文章 finish/cancel/interrupt/handoff/result-unknown/startup-repair 入口委托该 reducer，并对每次持久化执行跨对象一致性断言；
- 实现副作用 reserve/consume/observe/verify；在实际 Browser/Playwright 动作公共入口强制消费，删除当前被忽略的 `allow-once` 语义漏洞；
- 实现 store high-water、事件压缩、关键 compact-to-fit、recovery journal；关键收敛不能调用会因事件上限抛错的普通 append 路径；
- 把现有启动重启修复改为全部文章 Affair 的一致性扫描并迁移到统一命令；
- 用状态机测试覆盖旧 generation、重复/乱序事件、矛盾状态拒绝、一次性动作消费和 `result-unknown`。

退出条件：在没有 Coordinator 的情况下，给定任意终态事实，`WebAffairService` 都能原子得到安全且幂等的全量投影；旧发布 generation 或旧 owner identity 不能误改状态；同一副作用 key 第二次调用无法到达 Playwright；事件 2,000 条和普通文件 high-water 下关键收敛仍能保存。

### P1：接通所有 Runtime owner

- 增加 Agent 和 BrowserTask 主进程内部订阅及 disposer；
- 实现 `ArticlePublishingRuntimeCoordinator`；
- 把 renderer 的打开网页、创建 Agent 会话、发送任务和失败回滚全部移入 main 的幂等 start operation；renderer 只发单一命令和消费投影；
- 接入 Browser Tab/CDP 丢失、启动绑定失败；
- Agent Run、BrowserTask、Tab、租约和所有事件都绑定 `{ attemptId, executionGeneration, owner identity }`；
- 现有 AgentBridge 多任务扫描改为统一命令的兼容防线；
- 覆盖窗口重建和 shutdown 顺序。

退出条件：关闭 renderer/window 不影响 main 完成或回滚启动；任何正常终态都不依赖 renderer、不依赖“最后一个 BrowserTask”，旧 Agent Runtime/CDP/View 事件全部 no-op。

### P2：处理“根本没有终态”的假死

- 实现启动宽限、owner/progress 双租约、主动权威查询和持久 `checking-runtime` 三阶段核验；
- 实现幂等重试队列和 fake-clock 测试；
- 验证静默长任务不会被立即误杀，也不会凭 heartbeat 永久续租；所有长等待显式进入 `waiting-external`。

退出条件：Agent 不发终态、Browser/CDP 丢失、假活静默和收敛暂时失败都能在有界时间内变成“待核验”、可恢复或明确需人工处理状态。

### P3：给用户自救和足够诊断

- 增加“检查运行状态”“终止任务”“核验发布结果”；
- 增加“待核验”界面和有界继续等待；显示禁用原因、最后真实进度、owner 响应和核验错误；
- 扩充页面诊断与通用框架诊断，增加隐私测试。

退出条件：用户不需要重启 App、改 JSON 或等待开发者介入，就能处理已确认的孤儿 Attempt；未知最终副作用仍受保护。

### P4：自动门禁和真实站点验收

- 跑完第十节矩阵；
- 在真实 Electron `WebContentsView` / CDP 中做故障注入 smoke；
- 按第一节用真实 CSDN 账号完成真人验收并记录结果。

退出条件：自动化全绿且第一节真人验收全部通过。此前只能称“方案完成”或“工程门禁通过”，不能称“用户问题已彻底解决”。

## 十、必须覆盖的测试矩阵

至少覆盖：

1. Agent succeeded/failed/cancelled，BrowserTask 仍在运行或已终态；
2. BrowserTask completed/failed/cancelled，Agent 仍活跃、已终态或永不终态；
3. 同一 Agent Run 多个 BrowserTask，绑定发布事务的不是最后一个；
4. 多个 BrowserTask 绑定同一 Attempt，终态去重；
5. 恢复后 generation 增加，旧 Agent/Browser 终态、活动心跳和重试事件迟到，全部 no-op；
6. Attempt 建立后、Runtime 绑定前启动失败；
7. 工作空间解析失败、服务未就绪、第一次落盘失败后重试；
8. Browser Tab 关闭、WebContents 销毁、CDP 暂断后恢复、CDP 永久丢失；
9. 无事件假死被看门狗发现；持续活动的长任务不被误杀；
10. App 正常退出、强制退出、崩溃和重启恢复；
11. 人工接管、交还 Agent、接管期间关闭 Tab；
12. 图片上传/草稿保存结果未知后的重观测；
13. 最终发布 dispatched/verifying 后断线，严格禁止重放；
14. 用户检查状态、重复检查、检查与迟到终态并发；
15. 用户终止、重复终止、终止与发布结果回执并发；
16. 窗口重建、工作空间切换、Tab 转移后的 listener 和路由；
17. schema 升级、损坏快照、备份恢复和旧字段兼容；
18. 诊断日志包含判定证据但不泄露凭证与正文；
19. Attempt `cancelled`、`failed`、`interrupted`、`succeeded` 后，故意构造 execution/checkpoint/asset/publication 矛盾组合，完整一致性断言必须拒绝保存；
20. 上传、保存、发布分别验证：reserve 失败不调用 Playwright；第一次 consume 才能调用；第二次相同 key、旧 generation、错误 fingerprint 全部在调用前拒绝；
21. 在 `reserved -> dispatched`、`dispatched -> Playwright`、Playwright 返回、后置核验、结果落盘的每个缝隙注入崩溃，恢复后不得重复调用；
22. 模拟 CSDN fill 引发自动保存，验证适配器不会绕过保存副作用账本；
23. main 启动的每个 await 边界销毁 renderer/window；操作必须继续完成或收敛，新窗口查询得到唯一结果，不能依赖 renderer catch；
24. 同一发布 generation 内依次替换 Agent Runtime epoch、Browser View generation、WebContents ID、Playwright connection/page generation；每一种旧事件都必须 no-op，新 identity 的事件正常生效；
25. 事件恰好 1,999/2,000 条、快照略低/达到普通 high-water 时分别触发 interrupt/result-unknown/checking-runtime；关键状态必须保存，非关键日志按规则压缩；
26. 在 compact、写 recovery journal、主文件保存、journal 清除各阶段崩溃；重启合并结果幂等，不能回退 running 或重复副作用；
27. owner heartbeat 持续但无 progress、owner 暂时探测失败后恢复、合法 waiting-external、用户有界继续等待分别使用 fake clock 验证，既不误杀也不永久续租；
28. 启动全量扫描修复 terminal Attempt + running execution、旧 generation binding、未知副作用和缺失 currentAttempt，而不只扫描瞬态 Attempt；
29. 主文件无法写但 journal 可写时关键收敛仍对重启有效；主文件和 journal 都因 ENOSPC/权限失败时冻结外部动作并显示不可恢复的存储故障。
30. 同一 View/WebContents 上 CDP 重连并成功 claim 新 Page 后，旧 browser-task binding 必须持久化为 `lost`、新 binding 成为唯一 active owner、BrowserTask correlation 随后更新；看门狗不得再产生 `RUNTIME_OWNER_LOST`，重复或倒退的 Page 身份必须 no-op。
31. 草稿锚点首次捕获必须先于第一个填充/上传副作用授权落盘；Store 冷重载后保持同一 `draftId`。恢复时导航并核验锚点必须先于 Agent Run 启动；可见页是另一 `draftId`、通用编辑器或未知页时不得派发写入。旧数据有非空副作用/资源进度但无锚点时，只能从用户已打开的数字草稿补绑定。

单元测试必须使用确定性 fake clock 和可控 owner 查询，不允许依赖真实 sleep。独立审查报告当前 27 个相关测试通过，但没有覆盖上述 generation、跨投影一致性和副作用消费崩溃窗口，因此这 27 个测试不能作为本问题关闭证据。受影响 smoke 通过后仍必须执行真实 Electron 和真实 CSDN 验收。

## 十一、拷问结论与禁止的伪修复

以下做法不能关闭本问题：

- 直接把 `running` 加进 `canStart`；这可能重复发布；
- 再增加一个只在 Agent 终态触发的回调；Agent 不终态时仍会卡；
- 只依靠 App 重启修复；用户当前会话仍无法恢复；
- 只看最新 BrowserTask、当前 Tab 或 conversation；同一 Run 可以有多个任务；
- 只用 `attemptId` 不用 generation；恢复后的旧事件仍能误杀新 Run；
- 用固定超时直接标失败；慢上传和人工接管会被误杀；
- Coordinator 自建持久状态文件；这会制造第二状态 owner；
- 收敛失败只打 `console.error`；这不是可靠交付；
- 把最终发布断线统一改成 `interrupted` 并允许重试；这会制造重复文章；
- 策略返回 `allow-once + sideEffectKey`，但实际 Browser 动作入口不原子消费；key 没有执行约束力；
- 只有 mock 单测，没有真实 `WebContentsView` / CDP 与真实 CSDN 验收。

本方案没有要求违反架构宪法，因此不需要 ADR。若施工时要让 Coordinator、renderer 或 BrowserTask 持久化第二份 Attempt 状态，必须停止施工并先提交 ADR；默认不得这样做。

## 十二、当前完成度与下一步

用户在当前实现中可以对运行任务执行“检查运行状态”“继续等待”“终止任务”；无终态、Tab/CDP 丢失或长期无真实进度时会先进入持久“待核验”，再有界收敛为可恢复、待人工或结果未知。窗口关闭不再承担启动回滚；旧 generation/owner 的迟到事件不能修改当前运行；最终发布已经派发时，终止、断线和重启都只能进入结果未知，不能直接重放。

已取得的工程证据：

- `pnpm verify` 通过：337 个测试文件，2112 个测试通过、2 个跳过；format、lint、类型检查、边界检查与生产构建通过。
- 发布链专项覆盖 main 启动、完整 owner identity、旧 generation/owner no-op、统一生命周期投影、上传/自动保存/发布一次性副作用消费、最终与非最终结果未知分流、同一 generation 并发请求也只能成功一次的有界继续等待、v0.1.73 非最终未知状态的保守启动修复、v0.1.74 真实崩溃组合及 44 组终态/人工接管投影冲突的持久化重启矩阵、2,000 事件收敛、high-water 压缩、带 revision/hash 的固定恢复日志、损坏日志 fail closed，以及 fake-clock 的静默/失主核验。
- `pnpm smoke:browser-cdp-recovery` 在真实 Electron `WebContentsView` 中通过；Playwright connection generation 为 `1 → 2 → 3`，URL、WebContents、CDP target、Profile、Session、表单和滚动状态保持。

剩余产品门禁只有本文第一节的真实 CSDN 验收。没有完成真实三图发布、Agent/Tab/CDP 故障注入、最终发布断线核验之前，不得把本文状态改成 Closed。
