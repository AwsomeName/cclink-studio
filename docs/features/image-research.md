# 图片调研

> 状态：Conditionally accepted，可进入受控实现。真实小红书人工闭环是 V1a–V1c 实现后的 G1-M
> 发布门禁；
> 真实 Agent 路径是 V3 实现后的 G3-A 发布门禁，均不再倒置为开工前提。
> 最后更新：2026-09-02。
> 开发计划：[`image-research-development-plan.md`](./image-research-development-plan.md)。
> 关联事实源：`docs/architecture.md`、`docs/features/article-platform-publishing.md`、
> `docs/features/ai-web-affairs-agent.md`、`docs/features/context-action-system.md`。

## 结论

CCLink Studio 计划增加一个本地优先的“图片调研”流程。首个平台初步定为小红书，V0 只做一个
已保存小红书账号，不建设服务器，不并发多个账号，也不同时开发抖音、微博适配器。

目标用户流程保持不变：用户配置主题、搜索词、目标数量和当前工作空间内的图片目录；人工路径或
Agent 在可见网页中每次提出一张候选；用户逐张保存或跳过；达到目标后显示分类统计。

当前不能宣称小红书支持，但可以在实验开关后开始最小纵向实现。仓库尚未证明真实小红书页面中的
同 URL 笔记切换、候选恢复和保存事务；这些能力必须先实现，再在真实页面中验收。AI 只代替用户在
可见浏览器中搜索和提出候选；截图、保存或跳过均由用户逐张确认，不做隐藏浏览器、无人值守或批量
下载。

2026-09-02 本轮公开页实测只证明推荐图片在可见 Browser 中出现；页面存在登录遮罩，点击笔记后 URL
仍停留在 `/explore`。这不是已登录账号、详情页、轮播、实际账号身份或完整闭环证据，G1-M/G3-A
仍为 Pending。

## 实施前预检与实现后门禁

### E0：非阻塞预检

开工前只做现有能力可以完成的只读预检，不把尚未实现的候选或保存工具列为前提：

1. 登录、搜索结果、详情页和轮播可以在现有 `WebContentsView` 中使用；
2. 记录同 URL 切换不同笔记、详情弹层、轮播切换时可观察的内容 ID、图片序号和 DOM/页面状态；
3. 记录候选图片的页面表示方式、右键参数和响应格式，为 V1b 探针提供输入；
4. 确认当前网页实际账号可重新观察，不能只依赖账号目录或 Cookie；
5. 冻结 Observation Lease、页面语义身份、`WebAffairStore` journal 泛化和保存协议的初始契约。

E0 信息不完整时采用 fail-closed 的通用“用户选择图片/裁剪区域”薄片继续实现，不能靠猜 selector
扩张适配器；E0 不作为研发阻塞项，也不要求平台书面授权。

### G1-M：V1c 后的人工闭环门禁

V1a–V1c 实现后，真人必须证明人工候选、页面语义身份、实际账号、重启恢复和逐张保存/跳过在真实
小红书可用，才能
默认启用或宣称人工闭环支持。失败时继续隐藏在实验开关后修正，不回退成开工前门禁。

### G3-A：V3 后的 Agent 闭环门禁

V3 实现后，真人必须证明 Agent 在可见浏览器中搜索和提出同一候选，且所有截图、保存和跳过都等待
用户逐张确认，才能默认启用或宣称 Agent 支持。自动路径连续失败两次后停止调延时和猜 selector；
保留已通过 G1-M 的人工闭环，不允许降级为无人值守采集。

## 最终用户验收

只有真人在真实 Studio 中完成以下动作，才能声明 V0 完成：

1. 点击 Activity Bar 的“图片调研”，新建“奥森热门拍照姿势”任务；
2. 填写搜索词，选择一个已保存小红书账号、目标数量和当前工作空间内目录；
3. 保存任务，关闭 Tab 后从侧栏历史重新打开；
4. 开始执行后打开该账号的可见 Browser Tab，右侧显示本任务 Agent；
5. Agent 提出一张候选，网页可见图片、页面语义身份、实际账号观察、来源页和图片序号一致；
6. 对 canvas、背景图或轮播使用“选择图片/裁剪区域”，选择手势立即生成同一目标的受限预览；用户
   跳过后目录没有新增文件，该来源图片不立即重复出现；
7. Agent 在新一轮执行中提出下一张，用户修改分类；同 URL 切换笔记或切换实际账号后，旧候选必须
   拒绝取得和保存；
8. 回到原目标并重新观察账号后，用户逐张确认取得图片或截图并保存；图片只保存一次，并显示来源、
   实际账号证据、图片序号、哈希、确认时间和权利状态未知；
9. 分别在等待确认、临时文件写入和最终文件已提交但账本未提交时重启，任务不假运行、不重复保存；
10. 达到目标数量后停止网页动作并显示分类统计；提前结束时显示样本不足。

## 产品入口

### Activity Bar 与侧栏

“图片调研”位于 Activity Bar 的“流程”分组，与“文章发布”并列。

该入口不是新的事务系统：它只查询 `WebAffairService` 中 `kind: 'image-research'` 的筛选投影，点击
任务仍以 `webAffair.affairId` 打开或激活统一 `web-affair` Tab。不得新增 `image-research` TabType、
持久 Store、恢复 owner 或生命周期；新建与已保存页面只是统一事务 Tab 的领域视图。

通用“事务”侧栏也必须包含同一条 `image-research` 记录，不能继续只过滤 `generic`；图片调研入口和
通用事务入口打开的是同一个 affairId，不复制任务。

V0 侧栏只提供：

- `＋` 新建任务；
- 任务主题；
- 草稿、执行中、待确认、已完成或失败状态；
- `已保存数量 / 目标数量`；
- 点击历史任务打开或激活同一个控制 Tab。

高级筛选、徽标和多账号摘要不阻塞首个单图闭环。

### 新建任务 Tab

新建任务只填写：

1. 主题、地点、多行搜索词、目标数量和选择/排除要求；
2. 一个已保存小红书账号；
3. 一个当前工作空间内的图片保存目录，默认 `image-research/<任务名>/`；
4. 执行计划：核验账号 → 搜索 → 候选 → 用户决定 → 保存或跳过 → 新一轮继续 → 统计。

底部提供 `仅保存任务` 和 `保存并开始执行`。空白 Tab 不进入历史。任务保存后冻结账号、搜索词、
目标、规则和工作空间相对目录；运行中修改必须停止当前 Attempt，再由用户明确开始新 Attempt。

### 已保存任务 Tab

任务 Tab 显示冻结配置、当前步骤、保存/跳过/重复/待确认/失败数量、当前候选、已保存图片和分类统计，
并提供
开始、暂停、继续、结束并统计、打开网页、打开 Agent 和诊断入口。

底层 Observation、journal、Runtime identity 和平台探针诊断只在实验/诊断开关启用时显示；普通用户
界面只展示可执行状态、失败原因和恢复动作。

控制 Tab 不伪装成网页现场。启动后激活真实 Browser Tab；右侧 Agent 只按完整 Affair Runtime
identity 跟随该 Browser Tab，不能按“最近任务”猜测。

## 可信候选

Agent 和 renderer 不能用图片 URL 自报候选。页面现场授权和持久业务事实必须分开：主进程先签发
短期、一次消费的 `ObservationLease`，它只授权 `propose`；成功提出后立即生成独立持久的
`CandidateRecord`，后续保存或跳过不依赖旧 Agent、BrowserTask、Tab、CDP 或 Lease。

`ObservationLease` 是严格判别联合，公共字段至少绑定：

```text
observationId
observationKind
workspaceId
affairId
registeredAccountId
accountObservationId
profileId
tabId
browserViewRuntimeGeneration
webContentsId
playwrightConnectionGeneration
playwrightPageBindingGeneration
navigationGeneration
pageSemanticGeneration
pageKind
sourceContentId
sourceImageId
imageIndex
mediaLocatorRef
captureMethod
observedAt
expiresAt
```

`observationKind: 'agent-observation'` 另外必须绑定 `attemptId`、`executionGeneration`、
`launchOperationId`、`conversationId`、`agentRunId`、`agentRuntimeEpoch`、
`agentRuntimeBindingKey` 和 `browserTaskRunId`；
`observationKind: 'manual-observation'` 绑定当前受信 renderer、用户手势或上下文操作 token，禁止伪造
任何 Agent/BrowserTask 字段。两种 Lease 均只能由主进程从当时可见页面签发和消费。

`CandidateRecord` 至少持久化 `candidateId`、`affairId`、`revision`、页面语义身份、来源键、图片序号、
计划取得方式、`AccountObservation` 摘要、人工选择的捕获 ID/像素矩形/预览 hash（适用时）、分类、
决定状态和审计时间。它可以记录创建自己的 `observationId`，但该字段仅供审计，不继续授权后续操作。

登记账号不是实际登录账号证据。主进程签发的 `AccountObservation` 至少包含：

```text
accountObservationId
registeredAccountId
evidenceKind: page-visible | user-confirmed
visibleDisplayName?
visibleStablePublicId?
userConfirmationOperationId?
profileId
tabId
browserViewRuntimeGeneration
webContentsId
observedAt
expiresAt
```

`page-visible` 必须含页面可见显示名和稳定公开 ID；`user-confirmed` 必须含一次用户确认 operation，
两者是严格判别联合。平台适配器不能可靠读取时必须显示“当前账号由用户确认”，由用户明确选择登记
账号并生成短期 `user-confirmed` 观察，不得显示“已自动验证”。Profile 重建、登录/退出迹象、页面
身份区域变化、观察过期或用户切换账号都会使观察失效。
消费 Observation Lease 提出候选前，以及实际取得图片/截图前，主进程都必须重新取得或要求用户重新
确认 `AccountObservation`；登记账号与实际观察不一致时 fail-closed。

BrowserManager 需要新增通用 `navigationGeneration`，并由主进程页面探针维护
`PageSemanticIdentity`：至少包含站点、页面类型、笔记/内容 ID、轮播图片 ID 或序号、可验证语义指纹
以及单调递增的 `pageSemanticGeneration`。URL、标题和 `navigationGeneration` 只能作为辅助证据；小红书
在同一 URL 内切换笔记、详情弹层内容或轮播对象时，语义身份变化也必须递增代次。适宽缩放使用的
`fitDocumentGeneration` 不能成为业务页面身份。

MCP `propose` 只接收主进程签发的 `observationId` 和分类建议，不接受模型提供账号、Profile、Tab、
图片 URL 或页面代次。确认卡只以 `affairId + candidateId + revision + decisionOperationId` 提交决定；
旧 revision 或重复 operation 为幂等 no-op。只有需要重新取得像素时才创建新的 Observation Lease，
不得借用旧 Runtime 身份。

消费 Lease、生成 `CandidateRecord` 前，主进程必须重新探测当前 `PageSemanticIdentity`，并逐项复核
`pageSemanticGeneration + sourceContentId + sourceImageId/imageIndex`。即使 URL、Tab 和 WebContents
没有变化，只要语义身份不一致、缺失或不稳定，就以 `stale-observation` 拒绝提交并要求重新观察；
不得把上一条笔记的候选挂到当前笔记。

### 人工精确选图

Browser 增加真实的“选择图片/裁剪区域”上下文动作。普通 `<img>` 可以绑定主进程验证的元素边界、
资源引用和图片序号；canvas、背景图或无法稳定识别的图片进入覆盖在当前可见 View 上的裁剪模式，由
用户拖出唯一矩形。

用户完成选择手势即明确授权主进程当场取得该区域的预览像素。主进程必须在同一捕获序列中固定
View 像素坐标裁剪框、viewport/设备缩放、`PageSemanticIdentity`、`AccountObservation`、元素/资源
引用和捕获时间，立即截取并裁剪，计算预览 hash 后才生成 `manual-observation` Lease。页面或账号代次
在手势与捕获之间变化、矩形越界、元素遮挡或目标不稳定时，丢弃像素并要求重新选择；禁止稍后对
“当前页面”做全 View 截图来冒充原候选。

候选卡使用这份 main-owned 受限预览并提供“在网页中查看”。跳过后清理像素；用户确认保存截图时
直接使用已绑定像素或要求重新选择，取得页面原图时仍须复核同一页面语义身份、实际账号和资源身份。
Agent 自己不得截图、取得图片字节或写文件。不能把远端 HTML、SVG、脚本或认证 Header 放进
renderer、Agent 消息或诊断。

Agent 只有在平台探针能签发稳定的内容/图片身份和元素引用时才可直接 `propose`。canvas、背景图、
遮罩或轮播无法稳定定位时，必须进入 `waiting-human` 并让用户执行上述精确选择；不得由 Agent 自报
坐标，也不得延迟截取当时的当前页面。

## 逐张确认与继续语义

V0 不让 Agent Run 在内存 Promise 中等待用户：

```text
Agent 搜索并提出候选
→ 主进程原子持久化候选和 awaiting-decision
→ 本轮 Agent Run 与 BrowserTask 正常结束
→ 用户保存或跳过
→ main 持久化决定和保存结果
→ 创建新 execution generation 继续搜索
```

因此用户可以隔几分钟、关闭 Tab 或重启 App 后再处理候选。决定命令不依赖旧 Promise、旧 Agent、
旧 BrowserTask 或通用60秒工具确认。候选未决定前不会创建下一轮搜索。

右侧确认卡提供：

- `取得图片并保存` 或 `截图并保存`；
- `跳过并继续`；
- `修改分类`；
- `在网页中查看`；
- `停止任务`。

验证码、扫码、登录失效、风控和未知页面进入独立 `waiting-human`，不冒充候选确认。

候选状态至少为：

```text
observed → awaiting-decision → skipped
                             → approved → prepared → saved
                                                   → duplicate
                                                   → retryable
                                                   → result-unknown → reconciling
                             → needs-reobservation
                             → abandoned
```

`needs-reobservation` 可回到同一来源和图片序号重新取得；`retryable` 只能复用同一个决定操作继续；
用户可以明确放弃为 `abandoned`。任何无法证明磁盘结果的情况先进入 `result-unknown/reconciling`，禁止
直接重试生成第二个文件。

每个候选另有互斥 `outcome: pending | saved | skipped | duplicate | failed`，统计只按 outcome 计数：
非终态 lifecycle 全部属于 `pending`；`ledger-committed` 才是 `saved`；用户明确跳过是 `skipped`；hash
命中已保存或进行中占位是 `duplicate`；只有不可恢复且被明确放弃的错误才是 `failed`。一个候选任何
时刻只能进入一个桶，`saved + skipped + duplicate + pending + failed` 等于持久候选总数。

## WebAffair 恢复所有权

不得新增独立候选恢复日志。V1a 直接泛化现有 `WebAffairStore` recovery journal，使其 schema、容量、
hash 和 revision 恢复覆盖活动中的 `image-research` Affair、`CandidateRecord` 与稳定 operation ID。
它是候选、决定和事务状态唯一的恢复裁判：`propose`、决定和进入保存都通过同一 mutation queue 生成
目标 WebAffair 快照，再沿用 Store 既有的“journal → snapshot → clear journal”提交顺序。

启动时先由 `WebAffairStore` 按 revision 恢复唯一快照，再由 `WebAffairService` 收敛运行状态：完整的
`awaiting-decision` 继续等待用户；没有真实 owner 的 `observing/searching` 变为可重试中断，不能恢复
成假运行。只有文件副作用保留独立文件 journal；它只报告临时文件、hash、去重占位、发布和 ledger
阶段，不能自行完成或回滚候选状态。文件对账必须在 WebAffair 快照恢复后，由
`WebAffairService` 以同一 operation ID 作唯一决定。

## 目录授权

V0 只允许选择当前工作空间内的相对目录，默认 `image-research/<任务名>/`。主进程通过现有工作空间
边界解析和写入，renderer 与 Agent 只提交任务 ID、候选 ID 和决定操作 ID，不能提交任意绝对路径。
目录失效或越界时保留候选并进入 `retryable`。

工作空间外目录推迟到 V0 之后；届时必须另行设计不暴露原始路径的 opaque capability，并覆盖撤销、
重新挂载、目录身份、inode/file-id、symlink 和 TOCTOU，不能把系统目录选择结果直接当长期授权。

## 保存事务

用户批准和文件保存使用稳定 `decisionOperationId` 与 `SaveOperation`：

```text
reserved → fetching → temp-verified → dedupe-reserved → atomically-published → ledger-committed
```

要求：

1. WebAffair mutation queue 对候选 revision、决定 operation 和去重占位做 compare-and-set；
2. 先在目标目录创建同卷 sibling 临时文件，流式限制体积、嗅探格式、完成校验并计算 SHA-256；
3. 在 WebAffair mutation queue 中按 hash 取得唯一去重占位；已有成功文件或进行中占位时进入
   `duplicate`，不发布新文件、不增加成功样本；
4. 文件名由 `affairId/candidateId/hash/format` 确定生成，不包含搜索词、账号或创作者信息；临时文件
   `fsync` 后，使用目标操作系统已验证的原子 no-replace 发布原语把完整临时文件发布为最终路径，
   再 `fsync` 父目录；普通 rename 和 `open('wx')` 后再写入都不能视为原子发布；
5. 只有原子发布成功后才提交 ledger；低层 journal 记录 `operationId/path/hash/dedupeReservation/phase`，
   每次副作用前先通过原子替换持久化下一意图；
   journal 损坏或结果不明时 fail-closed 到 `result-unknown`；
6. 启动时将 journal、去重占位、磁盘文件和 WebAffair 对账；只有同一 operation ID 可以认领或继续，
   不能换 operation 重试；发布前失败时也只有在确认最终文件不存在后才能释放去重占位，发布成功后
   占位由 ledger 接管；
7. Session 获取必须限制来源 host、redirect、Referer、响应类型和体积；链接过期时回到同一来源页
   重新观察，不能改抓当前页另一张图片；
8. 停止命令与保存走同一串行队列：等待已进入提交区的 operation 对账后再结束，或明确停在
   `result-unknown/reconciling`；重复点击、目录冲突、磁盘满和 App 崩溃不能产生第二个文件或计数。

现有 BrowserDownloadStore 不能直接作为候选保存账本。

## 去重与来源

Agent 候选展示前只以 `PageSemanticIdentity + sourceImageId/imageIndex` 做来源去重，不自动截图或取得
图片字节；人工候选使用用户选择手势即时取得的受限预览 hash。确认保存后，主进程从临时文件计算
内容指纹并在发布前取得 hash 去重占位。签名媒体 URL 不能成为权威身份；`mediaLocatorRef` 只是
main-owned 的短期重新取得引用。

用户确认后产生的位图最长边不超过 2048 px、编码后不超过 4 MiB；每个任务私有缓存不超过 64 MiB，
且同一时刻只有一个待确认候选。决定后或到期后清理临时像素，只持久化安全指纹和来源键。重启时
页面现场已失效，候选进入 `needs-reobservation`，必须回到相同页面语义身份和图片序号重新观察，不能
改用当前页另一张图片。

用户确认取得图片前，V0 只承诺“同一页面语义身份和图片序号不立即重复”，不得宣称跨 CDN URL 的
内容级去重。已确认取得的图片以 SHA-256 在当前任务内去重；跨任务全局去重不属于 V0。

每个已保存项记录：

- canonical 来源页；
- 登记账号 ID、实际 `AccountObservation` 的 evidenceKind、页面可见公开身份或用户确认记录；
- 创作者显示名和稳定公开 ID，以及 `authorEvidence: page-visible | user-confirmed | model-suggested`；
- 图片序号；
- 取得时间与取得方式；
- 平台原图或页面截图标识；
- 本地路径、格式、大小和 SHA-256；
- 地点、动作原始值、规范化动作、景别、机位、构图和热度依据；
- `rightsStatus: 'unknown'`。

`model-suggested` 只是待确认建议，不能作为创作者事实展示或导出。历史统计同时区分“成功保存过的
数量”和“当前仍可用的文件数量”；外部删除或修改不会改写历史成功事实。删除任务时默认保留已保存
文件并清理临时缓存；删除已保存文件必须由用户另行明确确认并列出目标。

首次执行前以普通产品提示说明来源和权利状态未知，用户自行判断使用范围；本地保存不自动取得转载、
商业使用、肖像或改编权。来源清单不得输出“已授权”或“可商用”等推断。该提示和平台书面授权均不
作为研发、默认启用或技术验收门禁。

## Agent 工具硬边界

图片调研 Agent 不得复用 Browser scope 的 `browser_*` 通配符。V3 创建 Run 时必须设置
`disableBuiltinTools: true`，并逐项列出最小工具白名单：`web_account_open`、`browser_title`、
`browser_get_tab_info`、`browser_wait_for_selector`、`browser_click`、`browser_fill`、
`browser_press`、`browser_scroll`、`browser_wait_for_navigation`、受限的
`image_research_inspect_page`、`image_research_propose`、`web_affair_get` 和
`web_affair_finish_attempt`。名单不得包含 `browser_screenshot`、`browser_extract`、evaluate、文件、
编辑器、shell、上传或下载工具。

客户端白名单不是唯一安全边界。Browser/MCP 服务端必须识别 main-issued `imageResearchPolicy` 和完整
Affair Runtime identity，只允许上述动作；即使 scope 通配符、提示词或调用方配置错误，也要拒绝图片
任务调用截图、任意页面提取/evaluate、文件与内置工具。用户精确选图和确认后保存走独立的主进程
领域命令，不暴露为 Agent 工具。

## 状态所有权

图片调研仍是新的持久网页事务类型：

```ts
kind: 'image-research'
```

- `WebAffairService` 唯一拥有任务、Attempt、generation、候选、决定、保存账本和终态；
- 图片 reducer 与 article-publishing payload 分离；
- 先将 acquire、完整 runtime bind、tab-lost、startup reconcile、cancel 和 sealed Agent policy
  收敛为 WebAffair 公共能力，再供文章发布和图片调研调用；
- 图片 coordinator 只持可丢弃运行句柄；文件 journal 只保存跨文件提交阶段，不是第二任务 Store；
- 现有 `WebAffairStore` recovery journal 泛化后仍是事务快照唯一恢复裁判；文件 journal 只提供副作用
  事实，由 `WebAffairService` 以同一 operation ID 对账；
- `WebResourceService`、`BrowserManager`、BrowserTask 和 Agent 继续只拥有各自现有事实；
- renderer 只显示快照并发送有界命令。

这条路线符合现有架构宪法，不需要 ADR。若实现选择第二持久任务 Store、第二 Runtime owner、第二
浏览器、独立候选恢复 journal 或 renderer 任意目录写入，必须停止并先提交 ADR；这些例外没有当前
必要性，默认不接受。

## V0 范围

V0 包含：

- 最小 Activity、侧栏、任务 Tab 和历史恢复；
- 一个小红书账号、搜索词、目标数量和工作空间内目录；
- 真实小红书或明确人工降级的逐张候选；
- 每张候选结束当前 Run，用户决定后新 generation 继续；
- 原子文件保存、来源记录、任务内去重；
- 中断恢复、停止和界面分类统计。

基础保存、跳过、重复、待处理和失败计数随单图闭环交付；V0 末尾增加动作归类和地点分布，不把
“有计数”拖到最后一个阶段。

V0 固定运行上限：每任务目标保存数 `1..50`、候选决定总数最多 150、每个 Agent generation 最多
30 次 Browser 动作、自动页面变更间隔至少 1 秒。候选待决定时禁止预取或继续导航；达到任一上限、
出现验证码/风控/未知页面或平台风险信号时立即停止自动动作。G3-A 可以根据真实证据提高间隔或降低
上限，不得在没有新证据时放宽。

V0 不包含：

- 多账号顺序执行；
- CSV、JSON、Markdown 多格式导出；
- 抖音、微博或其他平台；
- 服务器、云同步、多人协作、隐藏浏览器或无人值守采集；
- 跨任务全局去重；
- 工作空间外目录；
- 自动判断已获授权或可商用；
- 固定必须生成 12 个模板。
