# 新会话独立审查指令：文章发布端到端系统闭环

把下面整段原样交给一个新的 Codex 会话。新会话的任务是独立分析并给出系统、全面、可施工的
解决方案，不是继续追加局部补丁。

---

你现在负责对 CCLink Studio 的“Markdown 文稿发布到 CSDN”能力做一次**从产品目标到底层运行协议的
独立闭环审查**，并给出系统性解决方案。

这次先不要修改代码、不要补文档、不要提交、不要打包、不要发布。你可以运行只读检查、测试和诊断
命令，但最终交付物必须是一份有源码证据、失败时序、目标架构和实施门禁的方案。不要继承历史会话
“已经基本修好”的判断，也不要因为测试通过就判定产品闭环。

仓库：`/Users/apple/Desktop/cclink-dev/cclink-studio`

## 一、用户需求和问题背景

用户要完成的事情非常具体：

1. 在文章发布控制 Tab 中选择一篇本地 Markdown、CSDN 账号和发布字段。
2. 点击开始后，左侧主区域显示 Agent 正在操作的**唯一可见 Browser Tab**。
3. 右侧 Agent Panel 显示这个发布任务的**唯一 Agent 会话、实时消息、工具调用、BrowserTask、等待、
   失败和终态**。
4. Agent 按固定顺序完成：打开编辑器、核验账号和页面、上传并核验正文图片、填写并核验正文、填写
   平台字段、保存并复核草稿、执行发布、核验公开文章结果。
5. 文稿提交到一半时，无论 Agent、BrowserTask、Browser Tab、CDP、renderer、窗口还是整个 App 中断，
   用户都能在重启后回到**同一任务、同一 Attempt、同一账号、同一篇 CSDN 草稿**，先对账，再从最后
   一个可信检查点继续。
6. 已确认成功的图片、保存和发布动作不能重复；结果未知时必须停下核验，不能为了“继续”而猜测或
   重放。
7. 用户切换 Browser Tab 时，右侧 Agent 必须跟随该 Tab 的真实持久绑定，不能显示另一个 Tab、另一个
   发布任务或默认助手。
8. 成功只能来自平台可验证事实；不能因为 Agent 文本说“完成了”就把任务标为 published。

历史真实问题包括：开始执行后按钮无反应、Attempt 长期假 `running`、中断后无法继续、恢复时进入错误
页面或新草稿、右侧 Agent 看不到执行过程、Browser Tab 与 Agent 内容串台、Agent 在 CSDN DOM 上不断
猜 selector 并超时。用户已经经历多轮局部修补，因此本次必须解释底层协议，而不是继续增加 if、延时、
Prompt 或宽松重试。

## 二、产品目标：一条发布任务在用户眼里是什么

一条发布任务始终绑定以下持久身份：

```text
本地 Markdown 冻结快照
  + CSDN 网站与账号/Profile
  + 一个 WebAffair
  + 一个可恢复 Attempt
  + 当前 execution generation / launch operation
  + CSDN 上同一篇数字 draftId 草稿
```

三个可见区域分工必须固定：

- **文章发布 Tab**：持久控制面。展示配置、检查点、图片、副作用、卡点、诊断和恢复命令；不直接拥有
  Runtime，也不能自行伪造进度。
- **左侧 Browser Tab**：唯一网页执行现场。Agent 只能操作这个可见 Tab，不得另开隐藏页面代替它。
- **右侧 Agent Panel**：唯一执行者投影。显示当前 Attempt/generation 对应的 Agent Run 和 BrowserTask，
  包括跨 Tab 切换和重启后的历史恢复。

必须区分三种事实：

1. `WebAffairService` 拥有跨重启业务事实：Attempt、generation、检查点、图片、副作用、草稿锚点、发布
   结果和诊断事件。
2. Agent Run、BrowserTask、Browser View/WebContents、Playwright Page/CDP 只拥有当前进程运行事实。
3. renderer 只做投影和发出有界用户命令，不是任何运行或发布状态的第二 owner。

“恢复”不是重新发布：保留原 Affair 和 Attempt，原子创建新 execution generation，先恢复并核验原
`draftId`，再绑定新 Agent Run、BrowserTask 和 Page owner，从最早未核验步骤继续。旧 generation 的
迟到事件必须全部 no-op。

## 三、当前仓库事实（必须重新验证，不能直接采信）

开始审查时先运行只读命令确认分支、HEAD、版本、工作区差异和最近提交。写这份指令时的现场是：

- 分支：`main`
- HEAD：`90a656cdb2a82155020180fa8f26c14f3db56793`
- Tag/版本：`v0.1.79` / `0.1.79`
- `origin/main` 与 HEAD 一致。
- 工作区有 27 个未提交候选修改，约 `+1447/-226`；不要丢弃、覆盖或把它们误认为已经发布。
- 这批候选修改此前执行过一次完整 `pnpm verify` 并通过；该结果只说明工程门禁，当新会话开始时仍要
  核对工作区是否发生变化。

当前代码已经试图实现以下不变量，你必须逐项检查是否真的贯穿所有入口：

- main 在 Agent 获得 MCP 工具前，通过 `onRunPrepared` 持久绑定 Agent Run、BrowserTask、Browser Tab、
  WebContents 和 Playwright/CDP owner identity。
- 每次恢复使用 `executionGeneration + launchOperationId` 隔离旧 Run；Agent epoch、Browser View
  generation、WebContents ID、Playwright connection/page generation 进一步隔离 owner 更替。
- CSDN 数字草稿 URL/draftId 作为 Attempt 的平台锚点；恢复必须先回到该草稿，历史缺锚点任务只能由
  用户明确打开原数字草稿后补绑定。
- renderer 的检查点/图片写入 IPC 已移除；Agent MCP 回报携带由 main 签发、模型不可覆盖的发布身份。
- 检查点只能更新当前步骤并遵守单向状态机；图片 uploaded、正文/字段/草稿完成、最终发布和结果核验
  都必须满足对应证据门禁。
- 上传、自动保存、显式保存和发布动作在实际 Playwright 派发前预留并消费持久一次性副作用能力；
  dispatched 后断线进入结果未知，不直接重放。
- Watchdog、Agent 终态、BrowserTask、Tab/CDP 丢失和启动扫描统一收敛持久生命周期。
- Browser Tab 复用要求 workspace/profile/account 精确匹配，避免把同 Profile 的任意页面当发布现场。
- 发布 Agent 禁用 backend 内置 Shell、文件和网络工具，只开放有界 Browser、文稿只读、事务读取、
  发布回报和 Attempt 收尾工具。

## 四、刚发现的高风险断点（作为审查线索，不是预设结论）

你必须独立复现或驳回下面每条判断，给出绝对路径和行号。

### 线索 A：启动命令生命周期可能设计错误

`ArticlePublishingTab.executeTask()` 等待 `articlePublishing.startTask()`；main 的
`ArticlePublishingService.launchRuntime()` 又等待 `agentBridge.sendMessage()`；`AgentBridge.sendMessage()`
继续等待 backend 整个 Run 结束。

需要判断：

- 启动是否事实上是一条“直到 Agent 完成才返回”的长 IPC，而不是“完成持久绑定后立即返回启动回执”？
- `busy` 是否在整个 Run 期间保持 true，从而禁用文章发布 Tab 的检查、继续、终止和再次启动？
- Browser 资源挂载、激活和“启动成功”通知是否反而要等 Run 结束才执行？
- renderer/window 在长 IPC 中销毁时，main 能否独立维护控制权和终态？
- 正确方案应如何拆分 prepare/bind/dispatch/observe，而不引入第二状态机？

### 线索 B：终态后可能向 renderer 返回旧快照

`launchRuntime()` 在 `onRunPrepared` 时保存 `boundAffair`，Agent 终态后虽然调用统一 reconcile，最后却可能
仍把该绑定时的 `boundAffair` 返回 renderer；renderer 随后 `setAffair(result.data.affair)`。

需要构造至少三种时序：Agent 正常完成、Agent 无 publish 终态结束、Agent 报错。判断是否可能在持久层
已经 `succeeded/interrupted/result-unknown` 后，页面重新显示旧 `running`，以及订阅事件顺序能否可靠
纠正它。不能用“通常会收到 onChanged”代替严格证明。

### 线索 C：右侧 Agent 持久投影可能仍未闭环

`AgentPanel` 已尝试通过当前 Browser Tab 的持久 Attempt 找 `conversationId`，但需要检查：

- BrowserTask 内存跨重启丢失、conversation store 没有加载对应会话时，代码是否会直接 return 而不创建/
  恢复会话？
- 从一个本地 Browser Tab 切到另一个时，旧 `persistedPublishingConversationId` 是否会在异步快照返回前
  短暂残留并造成串台？
- 普通 Browser Tab、已终态发布 Tab、历史任务控制 Tab分别应显示什么？
- 右侧消息、Run 状态和 BrowserTask 活动是否都来自同一持久 identity，还是只切换了 conversation 标题？
- 统一诊断是否优先按当前可见 Browser Tab 取证，还是会拿当前 conversation 的另一个 BrowserTask？

### 线索 D：跨 Affair 启动互斥可能不是原子占用

`ArticlePublishingService.startTask()` 先读取快照检查其他活动发布，再分别调用 resume/start Attempt、
mark started 和 launch；`WebAffairService` 虽有 mutation queue，但这些是多个独立 operation。

请证明或反驳：两个并发 start 是否可能同时读到“无冲突”，随后各自进入运行并争用同一 Agent/Profile/
Browser Tab。方案必须说明互斥粒度是全局发布、workspace、account/Profile 还是 draft，并定义持久租约、
原子获取、释放、崩溃恢复和过期 owner 的处理。

### 线索 E：`csdn@1` 可能只是动作守卫，不是确定性平台适配器

检查当前是否真的存在并被执行链调用的版本化能力，例如：

- `probeAccountIdentity`
- `probeEditor`
- `readDraftSnapshot`
- `locateBodyEditor`
- `readBodyAndAssetState`
- `fillFieldsAndReadBack`
- `saveDraftAndVerify`
- `publishOnce`
- `verifyPublished`

如果不存在，说明当前 Agent 如何寻找 CSDN 编辑器、图片节点、字段、草稿保存结果和公开文章 URL；哪些
证据由平台 DOM/URL/API 读取，哪些只是 Agent 自报字符串。动作安全策略不能冒充页面适配器。

## 五、必须阅读的事实源与现场证据

先完整阅读：

1. `/Users/apple/Desktop/cclink-dev/cclink-studio/AGENTS.md`
2. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/architecture.md`
3. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-platform-publishing.md`
4. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-platform-publishing-development-plan.md`
5. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/testing/article-publishing-runtime-convergence.md`
6. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/testing/browser-playwright-cdp-recovery.md`
7. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/ai-web-affairs-agent.md`

读取两份真实诊断日志，并把日志事实与当前代码区分开：

- `/Users/apple/.codex/attachments/5d2c50e6-1d60-467e-8652-b07bc71af73f/pasted-text.txt`
- `/Users/apple/.codex/attachments/b66bc112-6034-4631-833d-680ef636f28f/pasted-text.txt`

至少检查以下生产实现及其直接测试、schema、IPC 和 preload，不得只审文档：

- `src/main/article-publishing/` 全部文件
- `src/main/web-affairs/web-affair-service.ts`
- `src/main/web-affairs/web-affair-store.ts`
- `src/shared/web-affairs/` 和 `src/shared/article-publishing/`
- `src/main/agent/agent-bridge.ts`
- `src/main/agent/agent-runtime-state-store.ts`
- `src/main/agent-core/backends/` 中实际使用的 backend
- `src/main/agent-core/tools/` 的 ToolExecutionContext 与 allowlist
- `src/main/browser/browser-task-runtime.ts`
- `src/main/browser/browser-manager.ts`
- `src/main/playwright/playwright-bridge.ts`
- `src/main/mcp/modules/browser/index.ts`
- `src/main/mcp/modules/web-affairs/index.ts`
- `src/renderer/src/features/article-publishing/ArticlePublishingTab.tsx`
- `src/renderer/src/components/agent-panel/AgentPanel.tsx`
- Browser Tab open/reconcile/view lifecycle 相关 hooks 和 stores

## 六、必须完成的系统审查

### 1. 画出真实调用链，而不是理想流程

从用户点击开始，逐个标出同步/异步边界、持久提交点、运行 owner、事件订阅、renderer 投影和返回值：

```text
click
→ renderer command
→ IPC
→ Affair/Attempt/generation transaction
→ Browser Tab/Profile/View/Page
→ Agent Run/BrowserTask bind
→ Agent tools
→ Browser side effects
→ checkpoint/evidence
→ terminal reconciliation
→ renderer projection
```

每个 `await` 都要回答：此处窗口关闭、进程崩溃、服务落盘失败、旧事件迟到会发生什么。

### 2. 给出完整状态机和不变量

至少覆盖：

- Affair/Attempt/execution/checkpoint/asset/publication 的组合状态。
- `draft/preparing/running/checking-runtime/waiting-human/interrupted/result-unknown/failed/cancelled/succeeded`。
- 新建、恢复、人工交还、用户检查、继续等待、终止、Agent complete/error、BrowserTask 终态、Tab 丢失、
  CDP 重连、App 启动修复。
- 哪些状态允许只读核验，哪些允许网页写入，哪些只能创建新 generation。
- 最终发布与非最终上传/保存的 result-unknown 必须分流。

明确写出跨对象不变量；不能只给一张状态图而不说明谁原子地维护它们。

### 3. 审计副作用和证据可信度

对上传、正文/字段自动保存、显式保存和最终发布分别检查：

- reserve、consume、Playwright dispatch、observe、verify 的严格顺序。
- capability 消费后但 Playwright 尚未调用、调用后未返回、返回后未核验三个崩溃窗口。
- action fingerprint、generation、owner identity 和重启后的防重放。
- 页面核验证据是否由受信 main adapter 产生，Agent 是否能伪造 URL、outputRef、asset URL 或 completed。
- `finishAttempt` 是否可能绕过任何前置步骤。

### 4. 审计恢复语义

至少构造并逐项推演：

1. 第一张图片已上传，第二张上传前 Agent 被杀。
2. upload capability 已消费但浏览器是否收到动作未知。
3. 正文 fill 导致平台自动保存后 CDP 断开。
4. 发布按钮已派发但公开 URL 尚未读取时 App 崩溃。
5. App 重启后 BrowserTask 内存为空，Tab 和 conversation snapshot 存在或分别缺失。
6. 原 Tab 被关闭，但同账号另一个普通 Tab 或另一篇草稿仍存在。
7. 用户手工把绑定 Tab 导航到另一篇草稿后点击继续。
8. 旧 Agent/BrowserTask 终态在新 generation 启动后迟到。
9. 两个 Affair 同时启动或同时恢复同一账号。
10. `WebAffairService` 在关键终态落盘时 ENOSPC/损坏/暂时失败。

每个场景都必须给出期望状态、允许动作、用户可见提示和下一步，不能只写“系统会恢复”。

### 5. 审计三栏身份投影

给出一个唯一映射规则：

```text
当前可见 Browser Tab
→ 持久 Attempt + generation
→ conversationId + agentRunId + browserTaskRunId
→ 右侧消息、Run 状态、活动和诊断
```

说明控制 Tab、普通网页 Tab、已终态发布网页、重启后无内存 BrowserTask、缺失 conversation 快照和
workspace 切换时的行为。禁止通过标题、最近会话或同 Profile 猜测。

### 6. 设计真正的 CSDN 适配器边界

方案必须明确：

- 通用发布内核与 `CsdnPublishingAdapter` 各自拥有的状态和职责。
- Adapter 的版本、页面版本探测、输入输出 schema、只读 probe、写动作 plan、核验结果和未知版本降级。
- Agent 是调用确定性能力的编排者，还是继续直接猜 selector；若保留 fallback，权限和成功语义是什么。
- CSDN DOM 变化、富文本/Markdown 编辑器差异、图片上传顺序、自动保存、弹窗、风控和登录失效如何
  fail closed 并转人工。
- 不得通过页面 reload、重新建稿或隐藏 Tab 掩盖状态不确定。

### 7. 给出原子启动与运行控制协议

重点解决“启动是一场长 IPC”与“多任务争用”：

- 启动命令的事务边界和返回时机。
- 如何保证返回启动回执时 Attempt、Agent Run、BrowserTask、Tab/Page owner 已经绑定，但 Agent 可以继续
  在后台运行。
- 启动后 renderer 立刻可用的检查、暂停/继续、终止和打开 Agent/网页命令。
- 后台执行失败如何独立收敛，不依赖原 renderer Promise/catch。
- 原子占用租约如何获取、冲突、释放和在崩溃后回收。
- 重复点击、IPC 重试和窗口重建如何按 operationId 幂等。

## 七、解决方案必须满足的架构约束

- `WebAffairService` 仍是唯一持久业务状态 owner；不得新建 renderer 状态机或第二份发布数据库。
- BrowserTask、Agent Run、Tab/Page 只保存自身运行事实，通过有 identity 的事件投影给 Affair。
- 不复制 Workspace、Tab、Agent、Terminal、Profile 或 IPC contract。
- 本地能力不能被登录或 CSDN 故障阻断。
- renderer 不获得 Node、Cookie、Token 或直接文件写权限。
- 不以 Prompt、测试 mock、按钮启用、日志数量或“Agent 有输出”作为成功事实。
- 如果方案需要违反 `docs/architecture.md`，必须明确指出条款并要求 ADR；否则说明为什么不需要 ADR。

## 八、输出格式

严格按下面结构输出：

1. **唯一结论**：第一行只能是 `通过`、`有条件通过` 或 `驳回`，对象是“当前代码是否已经端到端闭环”。
2. **给用户的产品解释**：用人话说明当前能做什么、不能做什么，以及为什么之前会反复修不好。
3. **当前真实调用链**：给 Mermaid 或等价时序图，并标出状态 owner、持久点和长事务边界。
4. **已闭环能力**：每项附绝对源码路径和行号；只列能证明的事实。
5. **阻塞问题**：按 P0/P1 排序。每项必须包含失败时序、用户后果、源码证据和根因类别；不要把症状
   写成根因。
6. **目标架构与协议**：包含状态机、原子启动、后台 Run、运行控制、租约、终态收敛、三栏投影和 CSDN
   Adapter 契约。
7. **关键接口草案**：给出必要的 TypeScript 类型/方法签名和所有权说明，但不要展开成完整实现代码。
8. **失败与恢复矩阵**：覆盖第六节列出的至少 10 个场景，并写清持久状态、允许动作、UI 和是否可重放。
9. **迁移与兼容**：说明 v0.1.79 历史 Attempt、有/无 draft anchor、旧 conversation/binding、旧副作用
   记录和当前未提交数据如何迁移或 fail closed。
10. **最小纵向实施顺序**：按用户可验收增量拆分，明确第一步如何先消除假 running 和不可控制，随后
    如何关闭 Agent 串台和 selector 猜测；不能用重构、测试数量或内部接口完成冒充产品里程碑。
11. **测试矩阵**：分别列纯状态机、进程内集成、真实 Electron/WebContentsView/CDP、真实 CSDN；每个测试
    给前置、操作、故障注入和预期。
12. **最终验收门禁**：给可勾选清单。必须包含真实三图发布、半途退出/App 重启/原草稿继续、已上传
    图片不重复、最终发布断线只核验、跨 Tab Agent 不串台、跨 Affair 并发拒绝和诊断可还原。
13. **残余风险和 ADR 判断**：第三方页面变化、平台风控和人工卡点不能假装被软件消除。

## 九、审查纪律

- 必须主动找反例，不得以“看起来合理”“理论上会”“建议加强”代替证据。
- 每个代码判断给绝对路径和精确行号；找不到就写“未找到证据”。
- 区分 `v0.1.79` 已发布代码、当前未提交候选修改、尚未实现的目标方案。
- 不能因为 `pnpm verify` 通过就判产品闭环；也不能忽略已经通过的底层门禁而建议推翻一切重写。
- 优先修正协议和状态所有权，不接受继续增加 Prompt、selector 尝试次数、sleep、reload 或 renderer 补偿。
- 若当前代码还有未列出的 P0/P1，必须新增；若上述线索不成立，必须用完整时序和源码证明其不成立。
- 最终方案必须回答：**为什么这次修完后，文稿提交一半时能够安全继续，并且左侧 Browser Tab、右侧
  Agent 和持久发布状态永远指向同一件事？**

---
