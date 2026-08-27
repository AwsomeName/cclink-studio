# 文章发布中心最小研发计划

> 文档版本：1.1
> 状态：Ready，等待独立评审；尚未开始实现
> 最后更新：2026-08-27
> 产品事实源：`docs/features/article-platform-publishing.md`
> 架构约束：`docs/architecture.md`、`docs/decisions/0016-agent-web-account-execution.md`
> 本文只负责第一条 CSDN 单篇文章纵向闭环，不扩张到第二个平台、批量分发、定时发布或适配器插件系统。

## 1. 计划结论

首版只交付一个最小纵向闭环：

> 用户从 Activity Bar 的“文章发布”进入，在专用 Tab 选择当前工作空间内一篇包含一张本地图片的
> Markdown，选择一个已经保存的 CSDN 账号，填写 CSDN 必要字段并点击“开始执行”；Studio 打开
> 可见账号网页和专属 Agent，Agent 按 CSDN 固定流程上传图片、填写并完成常规发布，最后取得文章
> URL。这个 Tab 一一绑定持久发布事务；中断后在同一 Attempt 的最后一个已确认检查点继续。图片上传
> 必须等待平台处理并用页面证据确认，安全失败有界重试，派发后结果未知则先对账、不盲目重复上传。
> 遇到验证码、风控、法律声明或未知动作时暂停给用户，交还后继续；发布结果未知时不重复点击。

这是首个可以称为用户功能闭环的里程碑。只有侧栏、Tab、Schema、Mock 页面、Markdown 解析或
Agent 成功打开网页，均不能宣称文章发布完成。

最小方案采用：

- 一个通用文章包解析器；
- 一个随 Studio 发布的内置 `CsdnArticlePublishingAdapter`；
- 一个专用 Article Activity/Sidebar/Tab 投影；
- 一个由 WebAffair 持久化的发布 Attempt、步骤检查点和单图上传尝试模型；
- 复用现有全局账号、可见 Browser、BrowserTask、Agent run 和 WebAffair 生命周期；
- 一个仅对结构化文章任务生效的外部动作三态判定，不放开所有通用 Agent 发布动作。

## 2. 用户最终验收动作

准备条件：一个允许测试的已保存 CSDN 账号；当前工作空间内一篇 `.md`；正文包含一张可公开的
PNG/JPEG/WebP 本地图片；文章和图片不含敏感信息。

1. 用户点击 Activity Bar“文章发布”，侧栏只显示历史，点击标题栏 `＋`。
2. Studio 打开“新建文章发布”Tab；用户选择 Markdown。
3. Tab 显示解析出的标题、正文图片缩略图、插入顺序、源文件哈希和阻断问题。
4. 用户选择 CSDN 和一个已保存账号，填写标题、摘要、标签、分类，按页面需要选择封面。
5. 用户点击“开始执行”；配置冻结，发布 Tab 保持可见，同时创建正常 Browser Tab 并展开专属 Agent。
6. Agent 打开正确账号的 CSDN 编辑页面，核验登录和页面类型，上传图片并保持正文位置。
7. Agent 填写正文和平台字段，保存并重新读取草稿，随后完成已授权的单篇常规发布。
8. 如果出现验证码、风控、本人声明或未知按钮，任务显示“待人工”，聚焦同一网页；用户处理并
   “交还 Agent”后，Agent 重新观察再继续。
9. Studio 取得并显示文章 URL、标题和发布时间等页面证据，历史状态为“已发布”。
10. 使用含两张本地图片的文章，在第一张核验成功、第二张未完成时中断并重启；历史恢复同一发布
    Attempt，新 Agent 从第二张继续，第一张不重复上传。
11. 注入一次明确可重试的图片失败，Tab 展示等待、核验和第 N/3 次尝试，并只重试失败图片；注入
    派发后结果未知时先对账，无法确认不存在则暂停。
12. 关闭发布 Tab 后可以从历史重新打开；重启 App 后检查点、图片映射、终态和证据仍在。
13. 在发布动作派发后模拟自动化断线，任务显示“结果未知”；继续操作只重新核验，不产生第二篇文章。

只有上述真实 Studio + 真实 CSDN 链路通过，才能声明首版完成。

## 3. 当前代码基线与缺口

| 已有能力            | 当前事实                                                                                                       | 本计划怎样复用                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Markdown 文件与资源 | `MarkdownDocumentService` 已能检查引用、工作空间边界、缺失和受管资源；`collectMarkdownDestinations` 已提供位置 | 增加只读 `ArticlePackageBuilder`，不复制编辑器保存逻辑          |
| 网站账号            | `WebResourceService` 全局保存账号和唯一 Profile，`resolveLaunch` 提供安全启动描述                              | 发布任务只保存 `accountId`，不保存 Cookie、密码或第二份 Profile |
| 可见网页            | `AgentWebResourceLaunchCoordinator` 已经请求 renderer 打开正确工作空间账号 Tab                                 | 继续走同一启动链，不建隐藏 Chromium                             |
| 浏览器任务          | `BrowserTaskRuntime` 已有账号互斥、暂停、交还重观察、结果未知和动作日志                                        | 增加文章任务关联和一次性有界动作授权                            |
| Agent 执行          | `conversation-run-controller`、AgentBridge 和统一 runtime 已拥有 run/session                                   | 新建专属 conversation，但不复制发送、取消和恢复流程             |
| 网页事务            | `WebAffairService` 已拥有工作空间事务、Attempt、节点、证据和跨重启状态                                         | 增加 `article-publishing` 领域投影，不另建任务 Store            |
| 统一诊断            | Agent 复制入口已能汇总 main/renderer/Agent 框架日志                                                            | 增加文章 task/attempt/adapter/browser correlation               |

当前关键缺口：

- 没有 `article-publishing` Activity、Sidebar、Tab 和 Tab 去重契约；
- WebAffair schema 没有文章来源、平台字段、图片映射、适配器版本和发布结果的结构化载荷；
- 没有“同一发布 Attempt 跨新 Agent Run/BrowserTask 恢复”的持久检查点和步骤恢复策略；
- 图片上传目前没有文章级的等待、后置页面核验、单图尝试上限和结果未知对账状态机；
- 没有 CSDN 字段 Schema、步骤计划、页面 probe、动作分类和结果核验；
- 当前 Browser 账号动作守卫把包含“提交/发布”的控件统一暂停，不能识别已授权单篇常规发布；
- 当前 Agent 运行没有可由主进程校验的文章任务 execution ref，也没有文章任务专用工具 allowlist；
- 没有真实 CSDN 端到端证据。

## 4. 首版范围

### 4.1 必须包含

- 当前本地工作空间；单篇 `.md`；一次只运行一个文章发布 Attempt。
- 标题来源：Frontmatter `title`、第一个一级标题、文件名，并允许在平台字段中覆盖。
- 正文基础结构：标题、段落、列表、引用、代码块、链接和图片引用。
- 本地正文图片：首版至少 PNG、JPEG、WebP；按 Markdown 出现位置上传和替换派生正文 URL。
- Markdown 行内图片、引用式图片和允许的 HTML `img` 位置识别。
- HTTP(S) 图片保留外链并显示警告；不下载或转存。
- CSDN 标题、摘要、标签、分类和封面字段；动态新增必填项无安全默认值时转人工。
- 已保存、未归档且 origin 匹配的 CSDN 账号。
- 固定步骤、专属 Agent、可见 Browser、暂停/交还、结果核验、历史恢复和完整诊断。
- Tab 与持久发布事务一一对应；同一 Attempt 跨 Agent Run/BrowserTask 恢复，按检查点继续而非从头执行。
- 单图上传派发、等待、页面核验、最多 3 次安全尝试、结果未知先对账和成功图片防重复。
- 点击“开始执行”授权本次单篇常规发布；特殊敏感、范围变化和未知动作暂停。

### 4.2 明确排除

- 第二个平台、跨平台同步、一个任务多账号、运营矩阵、并行发布。
- 任意文件系统路径、工作空间外图片、文件夹批量、文章批量。
- 定时、后台、App 退出后继续运行或无人值守账号队列。
- CSDN API、隐藏接口、Cookie/Token 提取、验证码识别或风控绕过。
- 自动选择原创/转载、版权/授权声明、付费选项或法律承诺。
- AI 自动猜未引用图片的位置、自动改写正文、SEO 优化或生成摘要。
- 可下载适配器、插件市场、热更新、远程适配器目录或第三方脚本执行。
- 修改历史文章、删除文章、发布后数据统计和运营动作。

## 5. 最小架构

```text
ArticlePublishingSidebar / ArticlePublishingTab
  → articlePublishing IPC（只传有界 command 和安全 snapshot）
  → WebAffairService（任务、Attempt、步骤、证据和终态唯一 owner）
  → ArticlePackageBuilder（只读 Markdown、图片位置与哈希）
  → ArticlePublishingCoordinator（无持久状态）
  → CsdnArticlePublishingAdapter（字段、步骤、probe、动作分类、验证）
  → 统一 Agent run controller / AgentBridge
  → WebResourceService + AgentWebResourceLaunchCoordinator
  → BrowserTaskRuntime + Browser MCP
  → 可见 CSDN Browser Tab
```

### 5.1 状态所有权

| 状态                              | 唯一所有者                       | 禁止做法                                            |
| --------------------------------- | -------------------------------- | --------------------------------------------------- |
| 源 Markdown 与保存冲突            | 文件/Markdown 现有服务           | renderer 直接读 Node 文件或缓存第二份可编辑正文     |
| 文章发布任务、步骤、Attempt、证据 | `WebAffairService`               | 新建 `article-publishing-store` 保存业务真相        |
| 账号与 Profile                    | `WebResourceService`             | 文章任务复制账号、Cookie 或 Session                 |
| Browser Tab/View                  | Workspace/Tab + `BrowserManager` | coordinator 创建隐藏浏览器或维护第二套 Tab registry |
| 单次网页动作                      | `BrowserTaskRuntime`             | Article Tab 根据按钮返回值直接判成功                |
| Agent run/session                 | 统一 Agent runtime               | 组件直接调用 `agent.sendMessage` 拼第二套生命周期   |
| 平台差异                          | 版本化 CSDN adapter              | CSDN selector 散落到通用 Browser/Agent Prompt       |

### 5.2 WebAffair 最小扩展

持久化 schema 升级一版，旧记录迁移为 `kind: 'generic'`；新任务使用
`kind: 'article-publishing'` 和有界 `articlePublishing` 载荷。概念字段：

```ts
type ArticlePublishingResumePolicy = 'skip-if-verified' | 'reconcile-then-run' | 'manual-only'

interface ArticlePublishingCheckpoint {
  stepId: string
  inputHash: string
  adapterVersion: number
  status:
    | 'pending'
    | 'running'
    | 'waiting-platform'
    | 'verifying'
    | 'completed'
    | 'retryable-failed'
    | 'result-unknown'
    | 'needs-reconcile'
    | 'waiting-human'
    | 'failed'
  resumePolicy: ArticlePublishingResumePolicy
  attemptCount: number
  startedAt?: string
  finishedAt?: string
  outputRefs?: Record<string, string>
  evidenceIds: string[]
  error?: { code: string; message: string }
}

interface ArticleAssetUploadAttempt {
  number: number
  status:
    | 'uploading'
    | 'waiting-platform'
    | 'verifying'
    | 'succeeded'
    | 'retryable-failed'
    | 'result-unknown'
    | 'failed'
  startedAt: string
  finishedAt?: string
  evidenceIds: string[]
  error?: { code: string; message: string }
}

interface ArticlePublishingState {
  source: {
    markdownPath: string
    contentHash: string
    modifiedAt: string
  }
  target: {
    adapterId: 'csdn'
    adapterVersion: number
    websiteId: string
    accountId: string
  }
  fields: Record<string, string | string[] | boolean | null>
  assets: Array<{
    id: string
    sourcePath: string
    contentHash: string
    occurrences: Array<{ start: number; end: number; alt: string }>
    status:
      | 'pending'
      | 'uploading'
      | 'waiting-platform'
      | 'verifying'
      | 'uploaded'
      | 'retryable-failed'
      | 'result-unknown'
      | 'reconciling'
      | 'failed'
    platformUrl?: string
    verifiedAt?: string
    uploadAttempts: ArticleAssetUploadAttempt[]
  }>
  checkpoints: ArticlePublishingCheckpoint[]
  draft?: {
    url?: string
    lastVerifiedAt?: string
  }
  authorization?: {
    scopeHash: string
    authorizedAt: string
  }
  publication?: {
    status: 'not-started' | 'dispatched' | 'verifying' | 'published' | 'result-unknown'
    url?: string
    observedAt?: string
  }
}
```

首版不把正文全文复制进 WebAffair JSON。开始执行时主进程读取一次正文并冻结内存快照；重启后只有
源文件和所有素材哈希仍一致时才能重建并继续，否则当前 Attempt 失败并要求基于新内容创建 Attempt。
平台字段必须经过 adapter schema 限长，不能保存任意深层 JSON。

固定 CSDN 步骤及检查点保存在文章载荷中；WebAffair 首版只需要一个“发布文章”网页节点和一个
Attempt，避免把每个小步骤拆成新的 Agent Run。步骤状态由文章专用主进程 command 以 revision 更新，
事务仍保存完整事件。每个发布 Tab 只投影一个 `affairId`；同一事务重开时必须复用该 ID，Workbench
不得复制发布状态。

一次“开始执行”只创建一个发布 Attempt。App 或执行 runtime 中断后允许新建 Agent Run 和 BrowserTask，
但它们必须重新绑定原 `attemptId`，从最早一个未核验检查点继续。只有冻结输入哈希、账号、平台字段或
适配器版本变化时，才结束旧 Attempt 并要求用户明确创建新 Attempt。

单图上传是检查点内的子状态机。上传控件调用成功只进入 `waiting-platform`；适配器必须在默认 60 秒
有界窗口内观察平台处理结果，再读取编辑器中的平台 URL/图片节点进行核验。只有后置证据匹配素材哈希
和预期位置才写 `uploaded`。安全失败最多自动尝试 3 次；派发后无法判断结果时进入 `result-unknown`，
恢复先对账，不能直接再传。成功素材映射不随 Agent Run、BrowserTask 或 App 重启丢失。

### 5.3 Agent execution ref 与工具收窄

`开始执行` 由主进程校验 affair、revision、workspace、source hash、adapter、account 和字段后创建
Attempt，并生成不可由 renderer 扩权的 execution ref。renderer 只把 `{ affairId, attemptId }`
交给统一 run controller；AgentBridge 再向 `WebAffairService` 解析真实授权。

文章 Agent 的工具集由主进程收窄为：

- 只读文章任务/正文工具；
- `web_account_open`；
- 完成 CSDN 流程所需的有界 Browser 读取、导航、填写、点击和上传工具；
- 文章步骤报告、人工卡点和结果证据工具。

不开放 Terminal、Android、数据源、Git、任意文件写入、Cookie/HTML 全页提取或任意脚本执行。Agent
Prompt 不能扩大工具或动作权限。

### 5.4 外部动作三态守卫

通用账号任务保持当前安全默认。只有 BrowserTask 关联了主进程验证通过的文章 execution ref 时，
Browser 工具才调用 adapter 的动作策略：

```ts
type ExternalActionDecision =
  | { kind: 'allow-once'; sideEffectKey: string }
  | { kind: 'handoff'; reason: string }
  | { kind: 'unknown'; reason: string }
```

- `allow-once`：只允许与 scope hash、账号、origin、adapter step 和未消费 side-effect key 全部匹配的
  单篇常规发布；派发前记录，成功后核验，断线后进入“结果未知”。
- `handoff`：验证码、本人声明、法律/财务/账号后果、批量或范围变化，暂停 BrowserTask。
- `unknown`：页面、按钮或 adapter 版本无法证明，默认暂停，不退回通用关键词猜测。

renderer 传入的“已确认”、Agent 文本或通用 Permission 确认均不能制造 `allow-once`。

## 6. CSDN 最小适配器

`CsdnArticlePublishingAdapter` 首版是内置 TypeScript contribution，不是插件。职责仅限：

1. 描述 CSDN 平台字段和本地校验。
2. 生成稳定步骤 ID、完成条件、Agent 指令和人工边界。
3. 识别允许的 origin、文章编辑页和编辑器模式。
4. 识别图片上传入口并读取上传后的平台 URL 或编辑器结果。
5. 重新读取标题、正文摘要、图片数量和平台字段，证明草稿已写入。
6. 分类当前最终控件是否为本任务的单篇常规发布。
7. 发布后取得文章 URL 和可见结果证据。

adapter 不拥有任务状态，不读取 Cookie/Token，不调用隐藏发布接口，不绕过验证码，不修改源
Markdown。页面不匹配时 fail-closed。

## 7. 运行链

### 7.1 配置和预检

1. `articlePublishing.create` 打开空白 Tab，不立即写历史。
2. 主进程列出当前工作空间 Markdown；选择后构建 ArticlePackage 安全投影。
3. 用户选择 CSDN 和已保存账号；adapter schema 渲染字段。
4. 选定文章与网站后创建 `draft` WebAffair；后续表单保存使用 revision 防覆盖。
5. 点击“开始执行”前重新读取文件、图片、账号和 adapter；任何哈希变化先返回配置页。

### 7.2 执行

1. 主进程冻结 scope hash、固定步骤和 side-effect key，创建 Attempt。
2. renderer 用现有 Tab 层打开专属 Agent conversation；统一 run controller 发送任务 execution ref。
3. Agent 调用 `web_account_open`，复用全局账号 Profile 打开可见 Tab；BrowserTask 绑定
   workspace/account/conversation/run/affair/attempt/authorization。
4. Coordinator 从原 Attempt 的检查点选择最早未核验步骤；新任务从第一步开始，恢复任务不得重放已
   通过 `skip-if-verified` 对账的步骤。
5. Agent 按 adapter 步骤执行；步骤进入、派发、等待、核验、失败和完成均通过文章工具写回结构化
   checkpoint，Tab 订阅同一 snapshot。
6. 图片逐张执行 `uploading → waiting-platform → verifying → uploaded`；每次等待默认上限 60 秒，
   已核验 URL 不重复上传。可安全重试的单图最多自动尝试 3 次；结果未知先对账。派生正文只替换内存
   快照，不回写源 Markdown。
7. 草稿后置读取通过后，三态守卫决定继续常规发布或暂停人工。
8. 最终动作派发后只进入核验；取得 URL 才标记“已发布”。

### 7.3 人工卡点、终止和重启

- 人工接管复用现有 BrowserTask pause/resume 和 WebAffair handoff/return；交还后第一步必须重观察。
- 用户终止只结束 Attempt，不撤销已上传图片或平台草稿。
- App 退出把未结束 Attempt 标为 interrupted，不后台继续。
- 重启后 source/asset/adapter/account 全部重新校验；一致时新 Agent Run/BrowserTask 绑定原 Attempt，
  瞬时状态先转 `needs-reconcile`，从最早未核验检查点继续；任一冻结输入变化时不恢复旧 Attempt。
- 平台草稿 URL 已核验时从该草稿重入；没有草稿 URL 时，适配器按步骤恢复策略重建页面状态，但不得
  重传已核验图片。无法判断步骤副作用时转人工，不从头猜测执行。
- `publication.status === 'dispatched'` 且没有结果证据时，只开放“重新核验”和“打开网页”，不开放
  “再次发布”。

## 8. 研发阶段

状态只使用 `Ready / Pending / In Progress / Acceptance / Complete / Blocked`。E0 是工程准备度，
不计用户功能进度；M1–M3 必须报告用户当前能做什么。

| 类别     | 阶段 | 用户可见结果                                      | 状态    | 估算     |
| -------- | ---- | ------------------------------------------------- | ------- | -------- |
| 工程准备 | E0   | 无新增用户能力；真实页证据和 contract 冻结        | Ready   | 1 人日   |
| 用户增量 | M1   | 能从独立入口配置并保存一条 CSDN 发布草稿          | Pending | 2–3 人日 |
| 用户闭环 | M2   | Agent 完成真实发布；图片有等待、核验和有界重试    | Pending | 4–6 人日 |
| 可靠闭环 | M3   | 原 Attempt 断点恢复、人工卡点、防重和统一诊断可用 | Pending | 2–3 人日 |
| 交付验收 | R1   | 真实 App 验收、受影响 smoke 和 `pnpm verify` 通过 | Pending | 1–2 人日 |

以一名熟悉现有 WebAffair、BrowserTask 和 Agent runtime 的工程师估算，共 10–15 人日。CSDN 页面
结构、风控或真实账号等待不计入纯编码时间；同一阻塞连续失败两次即触发止损，不用调整超时或放宽
动作守卫掩盖问题。

### E0：实施门禁

- **目标**：证明现有能力足以承载最小闭环，不增加用户能力。
- **工作**：用测试账号现场记录编辑入口、编辑器模式、字段、图片、封面、最终控件和结果 URL；冻结
  WebAffair v4 增量、Article contract、checkpoint/单图上传状态机、adapter contract、Agent execution
  ref、三态动作策略和诊断字段。
- **验证**：形成脱敏页面证据；schema migration fixture 可回滚；未知 adapter/action 默认暂停。
- **不得超出**：不写第二个平台，不做 selector 大全，不建设插件注册中心，不先重构整个 WebAffair。
- **止损**：若 CSDN 明确禁止目标自动化、无法在可见 Browser 使用登录态，或关键编辑器无法被现有
  Playwright/CDP 可靠操作，E0 直接 Blocked，先汇报替代路径，不继续堆 UI。

### M1：独立入口与可执行草稿

- **用户结果**：进入“文章发布”侧栏，点击 `＋`，在专用 Tab 选择 Markdown、查看图片位置、选择
  CSDN 已保存账号、填写字段并保存草稿；关闭 Tab 后可从历史恢复。
- **实现**：ActivityPanel/TabType/WorkspaceState 增量；Article Sidebar/Tab；ArticlePackageBuilder；
  WebAffair kind/payload/migration；持久步骤检查点和单图 Attempt schema；CSDN field schema；revision 和
  主进程路径校验。
- **验收**：真实工作空间含一张图片的 Markdown 能得到正确位置和哈希；缺图、越界、脏文件和账号
  不匹配阻止开始；普通事务和其他 Activity 不回归。
- **不得超出**：不能用假的“开始执行”按钮伪装发布能力；不做多平台抽象 UI。

### M2：CSDN 真实纵向闭环

- **用户结果**：点击“开始执行”后打开专属 Agent 和正确账号 Browser Tab；Agent 上传图片时显示等待、
  后置核验和重试状态，随后填写正文与字段、完成常规发布并把真实文章 URL 写回 Tab。
- **实现**：ArticlePublishingCoordinator；Agent execution ref 和工具收窄；CSDN 固定 workflow、probe、
  upload wait/verify/reconcile、有界单图重试、draft verify、action classification、publication verify；
  BrowserTask/WebAffair correlation；一次性 side-effect key。
- **验收**：真人在真实 CSDN 完成正常发布；受控注入一次派发前安全失败后只重试失败图片；另一个
  CSDN 账号不会被误用；页面 probe 失败时不填写；源 Markdown 不被平台 URL 修改。
- **不得超出**：不以 mock 页面、只保存草稿、手工点击最终发布或 Agent 文本声称成功替代闭环。

### M3：人工接管、恢复、防重和诊断

- **用户结果**：登录过期/验证码/未知页面时看见明确卡点；交还后继续；关闭/重启后恢复同一 Attempt
  的未完成步骤；结果未知只核验；一键复制完整诊断。
- **实现**：三态 guard 负向覆盖；checkpoint 恢复策略；interrupted/needs-reconcile/result-unknown 投影；
  source/asset/adapter 重新对账；原 Attempt 与新 Agent Run/BrowserTask 重新绑定；
  task/attempt/agent/browser/action log correlation；统一诊断追加步骤和单图尝试摘要。
- **验收**：含两张图片时在第一张成功后关闭 App，重启只处理第二张；另覆盖 Tab 关闭、Agent 失败、
  上传派发后结果未知、发布派发后断线和页面结构不匹配；均不产生假成功、重复图片或重复文章。
- **不得超出**：除每张图片最多 3 次的有界安全重试外，不增加通用自动重试循环、后台轮询、定时
  检查或并行队列。

### R1：交付门禁

- **用户结果**：按本文第 2 节完成真人验收并保存脱敏证据。
- **工程门禁**：受影响单测、shared contract/parser、renderer 测试、Electron smoke、`pnpm verify`。
- **完成声明**：分开报告用户功能和工程准备；没有真实 CSDN 结果 URL 时不得宣称完成。

## 9. 预期代码边界

```text
src/shared/article-publishing/
├── article-publishing-types.ts
├── article-publishing-schema.ts
└── article-publishing-contract.ts

src/main/article-publishing/
├── article-package-builder.ts
├── article-publishing-coordinator.ts
├── article-publishing-policy.ts
├── article-publishing-diagnostics.ts
└── adapters/
    ├── article-publishing-adapter.ts
    └── csdn-article-publishing-adapter.ts

src/main/mcp/modules/article-publishing/
└── index.ts

src/preload/
└── article-publishing-api.ts

src/renderer/src/features/article-publishing/
├── ArticlePublishingSidebar.tsx
├── ArticlePublishingTab.tsx
├── ArticlePublishingSourcePicker.tsx
├── ArticlePublishingFields.tsx
├── ArticlePublishingProgress.tsx
├── article-publishing-controller.ts
├── article-publishing-view-model.ts
└── article-publishing.css

docs/ops/
└── article-platform-publishing-acceptance.md
```

允许修改现有边界：ActivityBar/Sidebar/WorkbenchContent/Tab 类型与恢复、WebAffair shared schema/service/
store/IPC、Agent send context/AgentBridge、BrowserTask correlation、Browser MCP action guard、preload 总入口、
诊断汇总和相应测试。不得复制这些模块的核心生命周期。

## 10. 验证矩阵

### 10.1 纯逻辑和 contract

- Markdown 标题优先级、图片位置、重复图片、引用式图片、HTML `img`、代码块假引用和 URL 重写。
- 工作空间内真实路径、符号链接越界、缺失/修改素材、大小和格式限制。
- CSDN 字段 schema、步骤版本、scope hash、旧 WebAffair v3 → v4 迁移与损坏回退。
- checkpoint 状态迁移、三种恢复策略、瞬时状态重启转 `needs-reconcile`、冻结输入变化拒绝恢复。
- 单图等待超时、后置核验、最多 3 次安全尝试、结果未知先对账、重复内容哈希只上传一次。
- `allow-once / handoff / unknown` 分类；renderer 伪造 task/confirmation 不能放行动作。
- side-effect key 单次消费；派发后异常进入 result-unknown。

### 10.2 服务和 renderer

- Activity 入口、侧栏只筛选文章任务、空白草稿不入历史、Tab 去重和工作空间切换。
- Tab 重开复用原 `affairId`；恢复时复用原发布 `attemptId`，只替换临时 Agent Run/BrowserTask。
- 配置保存 revision、开始后只读、源文件变化、账号归档、adapter 版本变化。
- Agent conversation/run、BrowserTask、WebAffair Attempt 和文章 task ID 关联一致。
- 人工接管、交还重观察、取消、App shutdown interrupted、两图中断后从第二张恢复。
- 完整诊断包含关键关联但不含正文全文、Cookie、Token、验证码或 `browserProfileId`。

### 10.3 Electron smoke 与真人验收

- Electron smoke 负责入口、Tab、IPC、故障投影和本地受控网页；不能代替真实 CSDN。
- 真实 CSDN 至少执行一次成功发布、一次登录/验证接管、一次图片失败/结果未知对账和一次最终动作后
  结果未知核验。
- 验收账号、文章和图片必须是允许公开和允许测试的内容；不使用生产主账号做破坏性测试。

## 11. 主要风险与止损

| 风险                | 最小控制                                               | 止损条件                                                     |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| CSDN DOM/编辑器变化 | adapter version + probe + unknown pause                | 同一关键步骤连续两次因页面证据不足失败，停止调 selector 延时 |
| 登录/风控           | 可见页面和人工接管                                     | 平台明确阻止自动化或要求绕过验证，停止该路径                 |
| 重复上传            | 单图检查点 + 后置核验 + 结果未知先对账                 | 无法判断图片是否已进入编辑器时停止写动作并转人工             |
| 重复发布            | side-effect key + dispatched/result-unknown + 后置观察 | 无法证明是否发布时不再执行任何写动作                         |
| 状态分叉            | WebAffair 唯一 owner，UI 只投影                        | 需要第二持久 Store 才能推进时先复审架构                      |
| Agent 临场偏航      | adapter 固定计划 + 主进程工具 allowlist                | Agent 需要任意脚本/Terminal/全工具才能成功时停止扩权         |
| 前置建设膨胀        | 只注册内置 CSDN adapter                                | E0/M1 超过 4 人日仍未打开真实 CSDN 时执行偏航检查            |

## 12. 完成定义

首版只有同时满足以下条件才是 Complete：

- 第 2 节真实用户验收全部通过并有脱敏证据；
- CSDN 正常路径由 Agent 完成常规发布，不要求用户手工点击最终发布；
- 验证码/敏感/未知路径能暂停和交还，不绕过；
- 每个 Tab 绑定唯一持久事务；App 重启后在原 Attempt 的未完成检查点继续，已确认步骤不重放；
- 图片上传有明确等待、页面核验、最多 3 次安全尝试和结果未知对账，成功图片不重复上传；
- 发布派发后断线不会自动重放；
- 关闭/重启后历史、终态和证据可信；
- 完整诊断可复制且不泄密；
- 普通 Browser、网站账号、通用事务、Agent、Markdown 和其他本地能力没有回归；
- `pnpm verify`、受影响 Electron smoke 和真人验收均通过。

任何只完成 UI、Schema、Mock、纯文本文章、无图片草稿或只打开网页的结果，都只能报告对应增量，
不能报告“文章自动发布已完成”。

## 13. 独立评审重点

独立评审必须优先找出以下问题，而不是评价文档是否完整：

- 是否真的只做 CSDN 单篇最小闭环，仍有隐藏的平台框架、批量或插件扩张；
- WebAffair 扩展是否是最小复用，还是把文章领域强塞进通用事务导致更大耦合；
- Agent execution ref 和三态动作策略能否由主进程证明，renderer/Prompt 是否能伪造授权；
- 图片上传、派生正文和发布后核验是否有真实证据链；
- Tab/事务是否真的一一对应，还是恢复时偷偷创建新 Attempt 并从头执行；
- 图片上传“控件调用成功”是否被误判为成功，等待、后置核验、重试上限和未知结果对账是否完整；
- 结果未知、防重复和重启恢复是否存在重复上传或重新点击最终动作的路径；
- M1 是否只是 UI 半成品，M2 是否真的形成真人可执行的纵向闭环；
- 10–15 人日估算中最可能被低估的工作是什么，应该删范围还是增加门禁。
