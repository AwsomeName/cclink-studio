# 文章发布逐步可观测执行协议修复方案

状态：最小修复继续补强；真实 CSDN 取证发现验收缺口，产品闭环未完成
日期：2026-09-07
目标需求：[article-publishing-observable-execution-protocol.md](article-publishing-observable-execution-protocol.md)

## 结论

2026-09-07 继续修复时明确收缩范围：沿用 WebAffair/current operation/transition、长 Agent Run 和
Runtime handshake，不引入 ledger、claim/report MCP、短 Run 调度或时间线 UI。
验收终点不是 inspect 成功，而是继续原未完成步骤且原有完成记录不倒退。
真实现场及尚未通过项见 [中断恢复测试清单](../testing/article-publishing-runtime-convergence.md)。

保留现有账号、草稿、Runtime binding、recovery permit 和副作用安全围栏，不引入完整
`operationRuns` 账本。新增最小的“一个 current operation + 最多 200 条 transition”，由
`WebAffairService` 与 checkpoint、Attempt、runtime binding 和 permit 在同一 reducer 中维护。

一个 execution generation 保持一个 Agent Run。ToolExecutionContext 只固定不可变外层身份；每次工具调用
由 main 动态读取 current operation。P0 不新增 claim/report MCP，只修复并展示：

```text
recovery.restore-exact-draft
→ runtime.prepare-first-inspect
→ page.first-inspect
```

正文、图片、字段、保存和发布的单步化全部留到 P1。P0 真实 CSDN 首次 inspect 没有通过前，不扩张范围。

## 当前源码基线

独立评审基线是 2026-09-07 `main` 的 HEAD `27f51a1588124ef54cd09698f1d827420c0ede6e`、版本
`0.1.87`。实施时仍须重新确认 HEAD 和工作区，不能把这里的行号当作永久事实。

当前已有：启动 IPC 在持久绑定后返回、`onRunPrepared` 工具屏障、execution generation、launch
operation、三类 Runtime binding、recovery lease、精确草稿找回、write permit、Page rebind、字段级
mismatch 日志和启动审计。

此前独立评审确认、当前基线已先行处理的 P0 缺口：

1. 早到 `onPageRuntimeBound` 只 schedule 异步 rebind，`onRunPrepared` 没有等待其完成；
2. 运行期 rebind 分两次持久提交，核验失败只写日志，当前业务步骤没有结构化失败；
3. 页面 attestation 缺少 View/WebContents/CDP/Page generation；
4. Runtime 无进度可能被错误映射成 waiting-human；
5. UI 只显示粗 checkpoint，不能显示 Runtime 准备卡在哪个 transition。

## 复审修正（2026-09-07）

此前“P0 已实现”的结论撤回。当前骨架仍有五类必须先关闭的安全缺口：发布语义可能绕过副作用账本；取消或
接管没有同步终结 operation/permit；恢复账号与 saved 证据来源过宽；probe 后提交前没有再次核对 Task、可见
View、Page 和 operation；当前 operation 没有真正限制全部工具。

施工分两批：

1. 批次 A：adapter 输出的语义动作决定 save/publish 副作用；生命周期 reducer 原子终结 operation 并撤销
   permit；所有迟到完成使用 operationRunId/status/revision CAS；派发前再次验证 live owner；内部 unknown 不再
   自动转人工。
2. 批次 B：恢复前置 operation 与业务 checkpoint 解耦；生产 Task 克隆语义下等待 rebind 后重新取 Task；
   inspect probe 前后及证据使用时复核 operation、Task、实际挂载 View、Page 和主文档代次；
   精确找回原草稿后只将旧保存记为已对账，不宣称旧正文写入成功。

每个 current operation 增加单调 `revision`。任何入场、派发和完成提交必须携带 expected
operationRunId/status/revision；reducer 在成功转换和终态撤权时递增 revision。schema 升级时按产品要求删除旧
文章发布事务，不迁移；其他 WebAffair 保留。

本轮实现还把副作用派发拆成两个持久时点：`consumedAt` 表示一次性 capability 已被领取但尚未触达网页；
`dispatchedAt` 在初步 execution/Task/Page/attestation 核对成功后写入；该异步落盘返回后，在真正调用
页面动作前同一段同步代码再次检查 abort、执行代次、实际动作 Page、View 和文档代次。取消发生在两者之间时，前者可安全
转为 rejected，不会把一个根本没有点击的动作误报成 result-unknown；一旦写入 dispatchedAt，恢复仍严格只核验、
不重放。

## 唯一状态结构

在 `ArticlePublishingState` 内新增：

```ts
executionProtocol: {
  version: 1
  current?: {
    operationRunId: string
    revision: number
    definitionId:
      | 'recovery.restore-exact-draft'
      | 'runtime.prepare-first-inspect'
      | 'page.first-inspect'
    checkpointId: 'open-editor' | 'verify-account'
    status:
      | 'ready'
      | 'running'
      | 'verifying'
      | 'waiting-human'
      | 'interrupted'
      | 'result-unknown'
      | 'failed'
    owner: 'studio' | 'agent' | 'adapter' | 'human'
    attemptId: string
    executionGeneration: number
    launchOperationId: string
    startedAt?: string
    lastTransitionAt: string
    runtime?: ExactRuntimeSnapshot
    failure?: StructuredOperationFailure
  }
  recentTransitions: OperationTransition[] // 最多 200 条
}
```

不保存完整 operationRuns。完成结果仍折叠进现有 checkpoint、draft、runtime binding 和 permit。checkpoint
保留为持久派生投影，但只能由同一个 WebAffair reducer 随 current operation 一起更新。

transition 只记录随机 ID、operationRunId、稳定 kind、时间、脱敏摘要、适用时的 previous/current Runtime
snapshot 和结构化 failure。它不拥有业务进度，超过 200 条删除最旧项。

不引入任何内容/正文/图片/证据哈希或 `actionFingerprint`。schema 升级继续直接删除所有旧文章发布事务，
同时覆盖 primary、backup 和 recovery journal；其他 WebAffair 保留。

## P0 operation

### `recovery.restore-exact-draft`

- 起点：新 generation 已 preparing，recovery lease 已取得，无 write permit；
- 动作：从管理页按数字 draftId 找回并核验账号、draftId、标题和 saved；
- 终点：原草稿已核验，仍无 Agent 写入许可。

### `runtime.prepare-first-inspect`

- 起点：原草稿已核验，无 Agent 工具权限；
- 动作：创建 BrowserTask、比较最新 Page、必要时重核验、转交 lease、持久提交 binding/permit、登记 active
  runtime，并 await 早到 Page 事件收敛；
- 终点：WebAffair、BrowserTask correlation、当前 View/Page 和 permit 五者一致。

`page_identity_sampled`、`page_identity_changed`、`draft_reverified`、`lease_transferred`、
`binding_committed`、`cached_identity_replayed` 是 transition，不是 operation。

### `page.first-inspect`

- 起点：Runtime 完全收敛，AgentBridge 工具门开放；
- 动作：只执行 `article_publishing_inspect_page`；
- 终点：main 在当前精确 Page 上返回结构化页面事实。

内部 Runtime 失败使用 `studio_runtime.*` 或 `studio_state.*`，不得转 waiting-human。

## 唯一 Runtime handshake

1. WebAffair 原子创建新 generation，Attempt=`preparing`，current=`recovery.restore-exact-draft/running`，无
   permit。
2. BrowserTaskRuntime 取得 recovery lease。
3. 从管理页找回并核验原草稿，记录只读 observation。
4. 完成恢复 operation，current=`runtime.prepare-first-inspect/running`。
5. 读取 Page identity P31，仅作为诊断采样，不签发新写权限。
6. AgentBridge 创建无账号 owner 的 BrowserTask，`onRunPrepared` 保持阻塞。
7. 读取 direct identity 和缓存的最新 `onPageRuntimeBound`，取最新者。若成为 P32，在 P32 上重新核验原
   草稿；核验中再次改代则有界循环，超过上限报 `studio_runtime.page_unstable`。
8. `transferAccountRecoveryLeaseToTask` 在 BrowserTaskRuntime 内同步更新 correlation 和账号 owner。
9. 一次 `commitRuntimeReady` 持久提交 Agent/Task/Tab binding、最终 recovery verification、P32 permit，
   完成 `runtime.prepare-first-inspect` 并创建 `page.first-inspect/ready`。
10. 登记 active runtime，但 Agent 工具门仍由 `onRunPrepared` 关闭。
11. 重放并 **await** 登记前缓存的 identity；如有更新，先同步移动 BrowserTask fence，再重新核验新 Page，
    最后用一次 CAS 同时替换 binding、permit 和 current runtime snapshot。
12. 再比较 WebAffair、BrowserTask、当前 View/Page、permit 五者完全一致。
13. `onRunPrepared` 返回，Agent 第一次 inspect 才能开始。
14. inspect 再读当前 exact identity；adapter 成功后 main 完成 `page.first-inspect`。

第 14 步必须拆成 capture/commit 两个 transition：capture 后异步 probe；commit 前重新读取生产
BrowserTask clone、当前 operation revision、可见 View 和 Playwright Page。任一变化都废止本次观察并回到
Runtime 收敛，不能用 capture 时的快照提交。

WebAffair 与 BrowserTaskRuntime 不构成数据库原子事务。这是 fail-closed handshake：

- transfer 前崩溃：无 permit，重启后重新恢复；
- transfer 后、持久 commit 前失败：不开放工具，取消 BrowserTask；整进程崩溃后内存 lease 自动消失；
- commit 后、active runtime 登记前崩溃：启动审计撤销无主 permit 并标记 interrupted；
- active runtime 登记后、工具开放前失败：结构化收敛为 Studio Runtime；
- 工具开放后：每次调用仍重新比较 current operation 和 exact Page identity。

## WebAffair reducer 和旧入口切断

P0 领域命令全部进入现有 affair mutation queue：

- `beginArticlePublishingOperation`
- `transitionArticlePublishingOperation`
- `commitArticlePublishingRuntimeReady`
- `completeArticlePublishingFirstInspect`
- `failArticlePublishingOperation`

CAS 条件是：

```text
affairId + attemptId + executionGeneration + launchOperationId
+ expected operationRunId + expected operation status + expected operation revision
```

每次提交同时维护 current、recentTransitions、所属 checkpoint、Attempt/execution、runtime binding/permit。
取消、接管、Run/Task 终止和 Runtime 丢失也走同一 reducer：关闭 current、递增 revision、撤销 permit，并把可能
派发的副作用标记 result-unknown。
旧 generation、旧 operation、旧 Agent 和重复 transition 不推进 revision。

P0 激活 `open-editor/verify-account` 的 operation 所有权时，旧
`article_publishing_report_checkpoint` 必须拒绝这两个 checkpoint；其余 checkpoint 暂留现有 fail-closed
路径，P1 再原子切换并删除旧 checkpoint/asset/finish 推进入口。

## Agent、Browser、attestation 和终态

- 一个 generation 一个 Agent Run，不采用每 operation 短 Run。
- ToolExecutionContext 保持不可变外层 identity；每次工具调用从 WebAffair 动态解析 current。
- P0 不新增 claim/report MCP；首次 inspect 自动把 `page.first-inspect` 从 ready 变 running，并在可信 adapter
  成功后完成。
- operationRunId 如由工具回显，只是 CAS expected value；授权始终来自 main 动态状态。
- attestation 必须绑定 tabId、View generation、WebContents ID、Playwright connection/Page generation；
  任一改代立即失效。
- Agent/Browser terminal 只进入统一 reducer。无外部副作用则 interrupted；已可能派发则 result-unknown；
  owner alive 但无进度属于 `agent_runtime.no_progress`，不是 waiting-human。

## P0 施工顺序

### P0.1 契约和 reducer

修改 shared article schema/types、WebAffairService 和 store。门禁覆盖组合状态、CAS、重复/旧代次、200 条
上限、启动审计和旧文章事务删除。

### P0.2 Runtime handshake

修改 ArticlePublishingService、draft recovery coordinator 和 BrowserTaskRuntime。门禁覆盖 generation
31→32、早到事件、await 收敛、transfer/commit 崩溃窗口和首次 inspect 前工具屏障。

### P0.3 inspect 门禁和最小 UI

修改 BrowserPolicy、web-affairs/browser MCP 和 ArticlePublishingTab。旧同 URL attestation 改代后必须
失效；UI 显示 current operation、owner、最新 transition、expected/actual 和结构化 failure。

## P0 强制测试

跨 service 测试必须真实驱动：

```text
恢复找到 draft 164148817
→ recovery verify 读取 Page generation 31
→ BrowserTask 创建触发 generation 32
→ onPageRuntimeBound 在 activeRuntimes 登记前到达
→ 缓存 generation 32
→ onRunPrepared 在 generation 32 重核验账号、draftId、标题和 saved
→ transfer lease/correlation
→ 单次 commit binding + permit
→ 登记 active runtime
→ await 缓存重放
→ Agent 第一次 inspect 成功
```

必须断言：Agent Runtime 在最终收敛前没有开始；五方身份全为 32；generation 31 的迟到调用不推进；不产生
waiting-human/登录提示；transfer/commit 各失败窗口都不开放工具；测试逐条验证 transition。

纯 reducer 单测不能替代跨 service 测试；mock Page 不能替代真实 Electron WebContentsView 生命周期测试。

## P0 真人验收和完成门禁

使用已有登录 Profile 和已有数字 draftId，用户不重复登录：

1. 从草稿管理页恢复原草稿。
2. 在恢复核验后、首次 inspect 前制造 WebContents/CDP/Page 改代。
3. UI 显示找到原草稿、Runtime 改代重核验、首次 inspect。
4. 第一次 inspect 成功，账号、draftId、标题、saved 和最新 Runtime 全部一致。
5. 分别在 transfer 前后、commit 后和 inspect 前退出 Studio，再恢复。
6. 全程不出现登录、验证码或人工接管提示。

只有 reducer、跨 service、真实 Electron、真实 CSDN、受影响 smoke/`pnpm verify` 和一次可直接定位 owner 的
诊断全部通过，P0 才完成。文档、mock、单测或一次正常发布不能单独证明完成。

## 后续 P1/P2

- P1a：先补真实 CSDN 只读 adapter，覆盖账号、草稿分页/搜索、正文、逐图、字段、保存状态和公开候选；
- P1b：迁移 draft anchor、逐图、正文、字段和保存 operation，并删除旧 checkpoint/asset 推进入口；
- P1c：最后迁移发布和公开核验，删除文章发布对通用 `web_affair_finish_attempt` 的写入口；
- P2：收口 AgentPanel exact binding、历史压缩、诊断脱敏和完整中断矩阵。

新任务何时取得数字 draftId 必须先由真实 CSDN 证明。若平台没有确定 ID/回执，不开放自动新建；用户需先
建立草稿。图片 URL 改写不能使已确认存在的图片失败，结果未知仍只提供“网页里有 / 网页里没有，重新上传”。

## 止损

- P0 不新增完整 claim/report MCP，不迁移正文、图片、保存或发布。
- 如果实现需要第二个进度 store、自由格式 Agent 自报或 checkpoint/operation 双写，立即停止。
- 如果连续两次失败仍只能靠 raw log 猜原因，先修结构化 transition，不增加延时或宽松重试。
- 真实 CSDN 首次 inspect 未通过前，不声明恢复闭环、不发版让用户试错。
