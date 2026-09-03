# 图片调研 V0 开发计划

> 状态：2026-09-03 已完成 M1-M3 工程实现和自动化门禁；M0/R1 的真实登录小红书真人闭环待执行，当前不能宣称 V0 已交付。

## 1. 用户成品

开发完成并通过真人验收后，用户可以：

1. 从现有“事务”入口配置主题、搜索词、一个小红书账号和目标数量；
2. 启动 Agent，让它在可见小红书中找到一张候选并停下；
3. 自己截图或保存图片；
4. 点击“我已自行保存并继续”或“跳过并继续”；
5. 重复操作，最后查看已自行保存、跳过和待处理统计。

Studio 不负责图片下载、截图、裁剪、文件核验、哈希去重或授权判断。统计只反映用户已确认的操作记录。

## 2. 当前基线与风险

- `image-research` WebAffair schema、候选工具、决定流程和统一事务 Tab UI 已实现。
- `WebAffairStore.save` 已接收完整 `changedAffairIds`；图片或混合批次只走完整快照原子替换。
- 单 Attempt 多 generation、决定幂等、账号租约持有/转交、启动恢复和三项统计已有自动化覆盖。
- 未登录小红书搜索页实测显示登录遮罩；登录态结果、同 URL 换笔记和稳定重开仍需真人账号验证。
- Agent 没有图片像素权限；V0 只能根据笔记标题、作者和有限可见文字筛选，图片视觉质量由用户在可见页面判断。

最危险的偏航是重新建设图片文件系统。任何保存目录、截图、裁剪、图片缓存、文件 journal、原子发布、hash 或自动账号识别都不属于 V0。

## 3. 阶段顺序

| 阶段 | 性质           | 结果                                              | 工程重点                                 | 预计   |
| ---- | -------------- | ------------------------------------------------- | ---------------------------------------- | ------ |
| M0   | 平台预检       | 待真人验证登录态搜索、列表刷新、详情和重开        | 未登录页已证实有登录遮罩                 | 待执行 |
| M1   | 工程准备       | 配置和恢复链路就绪；不计为用户功能完成            | schema、统一 Tab、账号解析、Store 窄修正 | 已完成 |
| M2   | 首个产品里程碑 | 单 Attempt 完成搜索、候选、决定、继续、取消和恢复 | generation、账号租约、决定幂等、恢复     | 已实现 |
| M3   | 完整 V0 里程碑 | 循环至目标数量，达标自动停止并显示三项统计        | reducer、完成条件、UI                    | 已实现 |
| R1   | 交付验收       | 自动化通过；真实小红书闭环通过后才可交付          | 回归已过，真人验收待执行                 | 进行中 |

工程实现已经形成；剩余交付时间取决于提供已保存的小红书账号并完成真人验收，以及真实页面是否需要适配调整。

## 4. M0：真实小红书预检

### 操作

使用现有可见 Browser 和一个已保存账号对应的 Profile，真人完成：

1. 登录或确认已登录；
2. 输入一个搜索词；
3. 打开一条笔记；
4. 切换轮播图片；
5. inspect 搜索结果后触发列表局部刷新或虚拟滚动，验证旧结果引用不会打开另一条笔记；
6. 记录能稳定观察的 `noteId`、从 0 开始的当前 `imageIndex`、总图数、登录/验证码遮罩和 URL 行为；
7. 验证 main 能否根据 `noteId` 构造稳定笔记路径，并在新 Tab 或重启后重开同一笔记、定位同一图片序号；
8. 模拟登录失效或验证码，完成接管、人工处理、交还和重新 inspect。

### 结论规则

- 能稳定取得 `noteId + imageIndex` 且能构造重开路径：记录 M2 平台前提已满足，按顺序先完成 M1。
- 能识别候选但不能稳定重开：M2 必须实现“来源不可恢复”降级，不能把 `/explore` 当作原候选。
- 只能看页面但不能稳定识别候选：M2 对该页面 fail-closed，要求用户接管，不增加截图或裁剪系统绕过。
- 登录或验证码需要人工处理：本轮结束并进入 `needs-attention`，用户处理后复用同一 Attempt 启动唯一 generation 重新 inspect；不尝试绕过。

M0 是平台预检，不是产品功能进度。

## 5. M1：配置与恢复

### 实现

- 为现有 WebAffair schema 增加 `image-research` kind、配置状态和最小迁移。
- 在现有“事务”入口支持创建和查找该事务。
- 在统一 `web-affair` Tab 展示配置；不新增 Activity、专用 Sidebar 或 TabType。
- 配置字段仅为主题、搜索词、一个保存的 `accountId`、范围 `1..50` 的目标数量和可选说明；Profile 由 main 根据 `accountId` 解析，不进入用户配置。
- 不出现保存目录或图片文件权限。
- 为任务增加 main-owned 冻结执行配置；第一次开始后锁定 `accountId`、主题、搜索词、`targetCount` 和包含/排除说明，运行中或等待决定时不可修改。
- schema 明确 `imageIndex` 在适配器、token 和持久化中都从 0 开始；UI 只在展示时加 1。
- 将 Store 保存接口收窄为 `save(snapshot, { changedAffairIds })`；调用方必须传入本次全部实际变更的 Affair ID。
- 只有全部变更对象都是需要 recovery journal 的活动文章事务时才写文章 journal，且 journal 必须覆盖全部变更对象；单个/多个图片事务或文章与图片混合批次只走完整快照原子替换。

### 自动化验收

- 图片任务配置在关闭 Tab、关闭应用和重启后恢复。
- 开始后修改搜索词、账号或目标数量被拒绝，完成条件只读取冻结的 `targetCount`。
- `imageIndex` 在适配器、token、持久化和复核中始终从 0 开始，UI 展示时才加 1。
- 单 Affair、双 Affair、纯文章批次、纯图片批次和文章/图片混合批次均不会写出“事务子集 + 全局 revision”的不完整 journal。
- 现有文章发布恢复矩阵继续通过。

## 6. M2：一次完整纵向闭环

这是第一条用户功能里程碑，必须一次性交付“搜索 → 候选 → 用户决定 → 同一 Attempt 替代运行一次 → 重启恢复”，不能在只显示候选时宣布 M2 完成，也不能被 Runtime 抽取或通用平台建设推迟。

### 实现

- 整个图片任务开始时只创建一个 Attempt；后续每轮复用该 Attempt，只递增 `executionGeneration`，禁止创建第二 Attempt。
- 复用现有 BrowserTask 的 Affair、Attempt、generation、Tab 和页面绑定。
- 增加 `image_research_search(query)`；只接受冻结配置中的完整搜索词，由 main-owned 小红书适配器填写和提交。
- 搜索结果页 inspect 最多返回 10 条 `{ resultRef, title, authorDisplayName }`；main 的引用记录还必须绑定被观察结果的稳定 `noteId`，但不向 Agent 暴露。
- 增加 `image_research_open_result(resultRef)`；main 生成的短期引用绑定 `affairId + attemptId + generation + tabId + browserTaskRunId + pageBindingGeneration + stableNoteId`，校验后由适配器打开结果。
- `resultRef` 不暴露 selector、DOM、任意 URL 或平台内部定位信息；旧页面、旧 generation、旧 Tab 或旧 BrowserTask 引用一律拒绝。
- 打开详情后重新读取 `noteId`；与 resultRef 内部 `stableNoteId` 不一致时拒绝、不签发 token，并要求返回搜索页重新 inspect。不能只靠页面绑定代次判断列表未变。
- 增加小红书专用 `CandidateProposalToken`：
  `affairId + attemptId + generation + tabId + browserTaskRunId + pageBindingGeneration + noteId + imageIndex`。
- main-owned `image_research_inspect_page` 在搜索页只返回上述有界结果和有限可见文字；在笔记页只返回页面类型、笔记标题、作者显示名、`noteId`、当前 `imageIndex`、总图数、最多 20 段且合计最多 2,000 字符的白名单可见文字，以及短期单次 token。
- inspect 不返回截图、HTML、DOM、selector、样式、媒体 URL 或媒体字节；无法稳定取得 `noteId + imageIndex` 时不签发 token。
- `image_research_propose` 只接受 token ID，不接受标签、账号、URL 或页面身份。
- main 在提交时复核全部绑定、token 时效和单次使用状态。
- 保存最小来源：`noteId + imageIndex + sanitizedPageUrl`；main 在 M0 证明可行时额外保存由适配器构造的受限 `reopenPath`。
- WebAffair 持久化成功后才显示候选；随后立即结束本轮 Agent run 和 BrowserTask。
- 提出候选后，同一 Attempt 进入既有 `waiting-human`；此时没有活跃 Agent run 或 BrowserTask。
- 使用逐项 `allowedTools`、`disableBuiltinTools: true` 和服务端拒绝，只允许受限 search/inspect/openResult/propose 及 Affair 生命周期工具；禁止截图、文件、下载、shell、任意 evaluate、通配 `browser_*` 以及接受 Agent selector/任意 URL 的导航工具。
- 候选页提供“打开候选页面”；main 先解析 `profileId`，再以完整 `accountId + profileId + affairId + attemptId + executionGeneration + launchOperationId` 调用现有 `acquireAccountRecoveryLease`，成功后才能打开 `reopenPath` 并核对 `noteId + imageIndex`。
- 同账号正被其他任务占用时只提示稍后重试，不得创建、激活或导航 Tab。核对失败立即释放；核对成功后继续持有租约，覆盖用户查看页面、自行截图或保存和提交决定的全过程。
- 持有租约期间，同账号其他任务必须被拒绝，且不能激活或导航候选 Tab。用户关闭候选 Tab、取消打开、结束任务、打开/核对异常或 App/窗口销毁时释放；未决定候选仍保持 `pending`。
- 无法重开时显示“来源不可恢复”，只禁用或警告打开动作；用户仍可确认已自行保存、重试打开、放弃该候选并重新搜索，或跳过并继续。放弃重搜由用户确认并将当前候选记为 `skipped`。
- 候选页提供“我已自行保存并继续”和“跳过并继续”。
- 决定命令只提交 `affairId + candidateId + candidateRevision + decision`；main 首次接受时生成 `decisionOperationId`。
- 决定使用 revision 做 compare-and-set；相同候选和相同决定重复提交返回原结果，相反决定被拒绝。
- 决定后仍需继续时，`decisionOperationId` 同时作为同一 Attempt 替代运行的 `launchOperationId`；在同一个 WebAffair 快照提交中原子持久化候选决定、该 Attempt 递增一次后的 `executionGeneration` 和该 ID，成功后才启动 Agent run 与 BrowserTask。
- 当前持有账号恢复租约时，快照提交成功后先调用现有 `transferAccountRecoveryLeaseToTask`，将租约直接转交给这个 generation 的唯一 BrowserTask，再允许启动或导航；禁止释放后重新获取。
- 转交失败时不得启动 BrowserTask；按同一 `launchOperationId + executionGeneration` 保留并恢复转交。达到目标则提交成功终态并释放租约。
- 恢复时按同一 Attempt 的 `launchOperationId + executionGeneration` 对账；已持久化的 generation 只恢复或认领，不能再次递增，不能创建第二 Attempt。相同 ID 最多产生一个 Agent run 和一个 BrowserTask。
- 达到目标时只原子提交决定并把同一 Attempt/节点置为成功，不再递增 generation；`pending` 候选重启后继续等待决定。
- 没有真实 run owner 时不得显示“搜索中”，不得用内存 Promise 表示等待用户。
- 提供“结束任务”，复用现有 WebAffair 取消链路取消 Agent run 和 BrowserTask、把同一 Attempt/节点置为既有 `cancelled`、阻止迟到 propose/continuation，并保留三项统计；运行中和等待决定时都可调用。
- 登录失效、验证码或 unknown 页面结束本轮并进入 `needs-attention`；用户处理后复用同一 Attempt 启动唯一 generation 重新 inspect。处理前的 resultRef 和候选 token 全部失效，不增加人工候选提交或新状态。
- 搜索结果为空时结束当前 Agent run 和 BrowserTask，显示“重试搜索”或“结束任务”；重试以冻结配置启动新 generation，没有 owner 时不得显示“搜索中”。

### 自动化验收

- Agent 每个 generation 最多提出一张候选并停止。
- 候选等待时同一 Attempt 为既有 `waiting-human`，且没有活跃 Agent run 或 BrowserTask。
- 搜索结果只包含最多 10 条有界文字和短期 `resultRef`；旧页面、旧 generation、旧 Tab 和旧 BrowserTask 引用均被拒绝。
- SPA 列表局部刷新或虚拟滚动后，旧 resultRef 只能打开其内部 `stableNoteId`；打开到其他详情时拒绝并要求重新 inspect。
- Agent 能通过受限 search 和 openResult 从搜索结果进入一条真实笔记，不提交 selector 或任意 URL。
- Agent 能依据标题、作者和有限可见文字提出符合关键词的候选；不宣称完成图片视觉判断。
- inspect 只返回约定的有限可见字段，不返回截图、HTML、DOM 或媒体字节。
- 旧 generation、旧 Tab、旧 BrowserTask、旧 page binding、过期或重复 token 均被拒绝。
- 同 URL 切换笔记时，旧 `noteId/imageIndex` propose 被拒绝。
- Store 保存失败时 renderer 看不到候选。
- 用户选择任一决定后完成“记账 → 同一 Attempt 增加一个 generation → 再继续一次”，不创建第二 Attempt。
- 双击、IPC 重试和 renderer 重挂载只计一次；`decisionOperationId/launchOperationId` 重放只对应同一 Attempt 的一个 generation、一个 Agent run 和一个 BrowserTask。
- 在提出候选后、同一 Attempt 的新 generation 保存后和实际运行启动前分别模拟崩溃，恢复结果一致。
- 重启后可以打开同一笔记和图片序号；无法重开时两个决定仍可使用，不显示为已恢复。
- 主动结束后 Agent、BrowserTask、propose 和 continuation 全部停止，重启仍为 `cancelled`，统计保留。
- 打开候选并核对成功后租约仍存在；持有期间同账号其他任务被拒绝，且不能激活或导航候选 Tab。
- 用户决定并继续时，租约通过 `transferAccountRecoveryLeaseToTask` 无缝转交给唯一 BrowserTask；达标、关闭候选 Tab、取消、结束、失败和 App/窗口销毁后均释放或清理。
- 确认或跳过完成后，原账号恢复租约必须已转交或释放，不得留下悬挂 recovery lease。
- 人工处理后旧 resultRef/token 全部失效；用户重试后 Agent 重新 inspect 并能继续。
- 空搜索结果结束当前运行，只能重试或结束，不保留假运行状态。
- 任务只保存 `accountId`，Profile 由 main 解析。
- 图片调研模块没有图片文件写入、下载、截图、裁剪、缓存或 hash 接口。

## 7. M3：循环、停止与统计

### 实现

- reducer 只计算三个互斥状态：`self-saved`、`skipped`、`pending`。
- 完成条件只看 `self-saved >= frozenExecutionConfig.targetCount`。
- 达标后结束任务并拒绝新的 Agent run、BrowserTask、propose 和 continuation。
- UI 明示统计是用户点击记录，不代表文件存在、图片唯一或拥有授权。

### 自动化验收

- 三项之和等于已持久化候选总数。
- 重复命令不改变统计。
- 达标后不再产生 Browser 动作。
- 重启完成态不会恢复成运行态。

## 8. R1：最终门禁

### 自动化证据

- 旧 generation、旧 Tab、旧 BrowserTask、旧页面绑定和迟到 propose 被拒绝。
- 搜索结果只返回有界文字和短期 `resultRef`；旧页面、旧 generation、旧 Tab、旧 BrowserTask 引用全部拒绝。
- 搜索列表变化后，旧 `resultRef` 只能打开内部绑定的 `stableNoteId`，否则拒绝并重新 inspect。
- inspect 只返回有限可见信息，不返回截图、HTML、DOM 或媒体字节。
- 候选只有在 WebAffair 持久化成功后才显示。
- 等待决定时重启，能打开原候选；无法重开时仍能确认已保存或跳过。
- 候选等待时，同一 Attempt 为 `waiting-human` 且没有活跃 Agent run/BrowserTask；每次决定只为该 Attempt 增加一个 generation，不创建第二 Attempt。
- 重复点击任一决定只计一次；`decisionOperationId` 重放只产生一个 Agent run 和一个 BrowserTask。
- 登录人工处理后必须重新观察，处理前的 resultRef 和 token 全部失效。
- 主动结束后 Agent、BrowserTask、propose 和 continuation 全部停止，统计保留。
- 打开候选并核对成功后租约仍存在；持有期间同账号其他任务被拒绝且不能激活或导航候选 Tab。
- 用户决定并继续时，租约无缝转交给唯一 BrowserTask；达标、关闭候选 Tab、取消、结束、失败和 App/窗口销毁后均释放或清理。
- `accountId` 由 main 解析 Profile。
- 候选持久化后、决定/同一 Attempt 新 generation 原子提交后、实际启动前三个崩溃窗口，以及取消与候选/决定并发测试全部通过。
- 单 Affair、双 Affair 及文章与图片混合保存的 journal/revision 崩溃测试通过。
- 图片调研代码没有图片文件写入、下载、截图、裁剪、缓存或 hash 接口。
- 达到目标后不再产生 Browser 动作。
- 文章发布和原有 WebAffair 恢复测试不回归。

### 真实小红书真人证据

- 已保存账号对应的 Profile 打开真实登录页面并完成一次搜索。
- Agent 从真实搜索结果选择一条笔记，打开并提出当前图片后停止。
- inspect 后刷新或滚动列表，旧结果不能串到另一笔记。
- 登录失效后人工处理，完成后重试 Agent 能够继续。
- 用户自行截图或保存，再点击“我已自行保存并继续”。
- 跳过下一张后，Agent 再次继续。
- 等待候选期间重启，可重开与不可重开两种路径都能完成决定。
- 两个任务使用同一账号时，旧任务打开候选不会干扰正在运行的任务。
- 用户打开候选并停留保存期间，第二个同账号任务不能切走页面；关闭候选而不决定后，账号可被其他任务正常使用。
- 同 URL 切换笔记时，旧候选提交被拒绝。
- 运行中和等待决定时都能主动结束，并保留统计。
- 达到目标后统计与用户点击记录一致。

只有自动化与真人证据都通过，才能宣称 V0 用户闭环完成。只有 schema、测试或 mock 通过时，只能报告相应工程准备度。

## 9. 预计代码落点

- `src/shared/ipc/web-affair.ts`：kind、配置、候选、决定和事件契约；
- `src/main/web-affairs/`：唯一状态所有者、Store 窄修正、reducer 与恢复；
- `src/main/image-research/`：小红书 search/resultRef/openResult、token、inspect/propose 和流程服务；
- `src/main/mcp/`：最小 Agent 工具及服务端权限拒绝；
- `src/renderer/src/features/web-affairs/`：现有入口、统一 Tab、两种决定和统计；
- 现有 Agent Panel / BrowserTask 接线：按 Affair 绑定和单 generation 生命周期运行。

V0 不应修改 `src/main/fs/`、新增图片 preload 文件 API，或扩展 Browser 截图/裁剪能力。

## 10. 开发止损与后续决策

- M2 前不得抽取文章发布公共 Runtime；只有出现第二处真实重复且影响交付时再评审。
- 单项前置工作超过 60 分钟未增加可验收能力，停止扩张并检查是否偏离单候选闭环。
- 同一平台识别失败两次，先报告页面证据和人工接管路径，不转向开发通用视觉或文件系统。
- 真实小红书 V0 验收通过后，再决定独立 Activity、详细动作分类、自动下载或裁剪是否值得建设。

## 11. 架构判断

当前方案不需要 ADR：仍由 `WebAffairService`、统一 `web-affair` Tab、既有 Store、BrowserTask 和 Agent 会话拥有状态与生命周期。

若实现中出现第二 Store、第二恢复裁判、第二 Runtime owner、图片文件写入或截图权限扩张，必须停止并重新评审；违反架构宪法时先提交 ADR。
