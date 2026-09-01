# 图片调研

> 状态：Blocked on E0 evidence。2026-09-01 独立评审驳回原 `Ready` 方案；真实小红书证据和四项
> 基础契约冻结前不得进入功能实现。
> 最后更新：2026-09-01。
> 开发计划：[`image-research-development-plan.md`](./image-research-development-plan.md)。
> 关联事实源：`docs/architecture.md`、`docs/features/article-platform-publishing.md`、
> `docs/features/ai-web-affairs-agent.md`、`docs/features/context-action-system.md`。

## 结论

CCLink Studio 计划增加一个本地优先的“图片调研”流程。首个平台初步定为小红书，V0 只做一个
已保存小红书账号，不建设服务器，不并发多个账号，也不同时开发抖音、微博适配器。

目标用户流程保持不变：用户配置主题、搜索词、目标数量和图片目录；Agent 在可见网页中每次提出
一张候选；用户逐张保存或跳过；达到目标后显示分类统计。

当前不能宣称小红书支持，也不能开始做完整 UI。仓库尚未证明真实小红书页面中的图片是普通
`<img src>`、`canvas`、背景图还是 `blob:`，也没有可信候选身份、持久目录写授权、可恢复保存事务和
通用 WebAffair Runtime 绑定。E0 取证与契约冻结是硬门禁。

## E0 硬门禁

必须先在真实 Studio、真实小红书账号中取得以下证据：

1. 登录、搜索结果、详情页和轮播可以在现有 `WebContentsView` 中使用；
2. 记录候选图片的页面表示方式、来源页稳定标识、图片序号、右键参数和响应格式；
3. 证明至少一条 Agent 候选路径；
4. 证明一条不依赖相同 `srcURL` 前提的人工降级路径，例如主进程限定元素截图或可见区域提交；
5. 证明当前网页实际账号可以在执行前重新观察，不能只依赖账号目录或 Cookie；
6. 明确平台原图、受限位图预览和页面截图分别如何取得、标记和保存；
7. 重新核对当时有效的平台规则，产品只记录“权利状态未知”，不推断可商用。

如果自动路径连续两次失败，停止调延时和猜 selector，保留人工提交候选闭环。若人工路径也无法证明，
本功能继续 Blocked，不用 Mock 页面冒充小红书闭环。

## 最终用户验收

只有真人在真实 Studio 中完成以下动作，才能声明 V0 完成：

1. 点击 Activity Bar 的“图片调研”，新建“奥森热门拍照姿势”任务；
2. 填写搜索词，选择一个已保存小红书账号、目标数量和本地目录；
3. 保存任务，关闭 Tab 后从侧栏历史重新打开；
4. 开始执行后打开该账号的可见 Browser Tab，右侧显示本任务 Agent；
5. Agent 提出一张候选，网页图片、候选预览、来源页和图片序号一致；
6. 用户跳过第一张，目录没有新增文件，该来源图片不立即重复出现；
7. Agent 在新一轮执行中提出下一张，用户修改分类后确认保存；
8. 图片只保存一次，并显示来源、创作者信息、图片序号、哈希、确认时间和权利状态未知；
9. 分别在等待确认、临时文件写入和最终文件已提交但账本未提交时重启，任务不假运行、不重复保存；
10. 达到目标数量后停止网页动作并显示分类统计；提前结束时显示样本不足。

## 产品入口

### Activity Bar 与侧栏

“图片调研”位于 Activity Bar 的“流程”分组，与“文章发布”并列。

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
3. 一个图片保存目录；
4. 执行计划：核验账号 → 搜索 → 候选 → 用户决定 → 保存或跳过 → 新一轮继续 → 统计。

底部提供 `仅保存任务` 和 `保存并开始执行`。空白 Tab 不进入历史。任务保存后冻结账号、搜索词、
目标、规则和受信目录；运行中修改必须停止当前 Attempt，再由用户明确开始新 Attempt。

### 已保存任务 Tab

任务 Tab 显示冻结配置、当前步骤、保存/跳过/待确认数量、当前候选、已保存图片和分类统计，并提供
开始、暂停、继续、结束并统计、打开网页、打开 Agent 和诊断入口。

控制 Tab 不伪装成网页现场。启动后激活真实 Browser Tab；右侧 Agent 只按完整 Affair Runtime
identity 跟随该 Browser Tab，不能按“最近任务”猜测。

## 可信候选

Agent 和 renderer 不能用图片 URL 自报候选。主进程必须先签发不可伪造的
`CandidateObservation`，至少绑定：

```text
observationId
workspaceId
affairId
attemptId
executionGeneration
launchOperationId
conversationId
agentRunId
agentRuntimeEpoch
agentRuntimeBindingKey
browserTaskRunId
accountId
profileId
tabId
browserViewRuntimeGeneration
webContentsId
playwrightConnectionGeneration
playwrightPageBindingGeneration
navigationGeneration
canonicalPageId
imageIndex
mediaLocatorRef
captureMethod
observedAt
```

BrowserManager 需要新增通用 `navigationGeneration`。适宽缩放使用的 `fitDocumentGeneration` 不能
成为业务页面身份。

MCP 只接收主进程签发的 `observationId` 和分类建议，不接受模型提供账号、Profile、Tab、图片 URL
或页面代次。确认卡绑定候选 revision 和上述执行身份；页面、账号或代次变化后旧按钮失效。

候选预览必须是主进程产生的受限位图，或明确标记的页面截图。不能把远端 HTML、SVG、脚本或认证
Header 放进 renderer、Agent 消息或诊断。

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

- `保存并继续`；
- `跳过并继续`；
- `修改分类`；
- `在网页中查看`；
- `停止任务`。

验证码、扫码、登录失效、风控和未知页面进入独立 `waiting-human`，不冒充候选确认。

候选状态至少为：

```text
observed → awaiting-decision → skipped
                             → approved → prepared → saved
                                                   → save-failed
                             → stale
```

基础 `saved / skipped / pending / failed` 计数从第一张候选起就由持久候选派生，不等到最终统计阶段。

## 目录授权

选择工作空间外目录时，主进程签发一次消费的 `directory-write` capability，绑定 renderer、
workspace 和任务创建操作。创建任务时消费 capability、canonicalize 目录，并把受信根写入
WebAffair。

后续 renderer 和 Agent 只提交任务 ID、候选 ID 和决定操作 ID，不能再次提交任意路径。每次保存前
重新检查 realpath、父目录身份和 symlink 替换；目录失效时保留候选并进入 `save-failed`。

## 保存事务

用户批准和文件保存使用稳定 `decisionOperationId` 与 `SaveOperation`：

```text
reserved → fetching → temp-verified → disk-committed → ledger-committed
```

要求：

1. WebAffair mutation queue 对候选 revision、generation 和决定操作做 compare-and-set；
2. 在目标目录创建同卷 sibling 临时文件，流式限制体积、嗅探格式并计算 SHA-256；
3. 最终提交使用 no-clobber 语义，不覆盖已有文件；
4. 低层磁盘 journal 只记录 `operationId/path/hash/phase`，不拥有候选、决定或统计；
5. 启动时将 journal、磁盘文件和 WebAffair 对账，再认领、重试或清理；
6. Session 获取必须限制来源 host、redirect、Referer、响应类型和体积；链接过期时回到同一来源页
   重新观察，不能改抓当前页另一张图片；
7. 任务停止、重复点击、目录冲突、磁盘满和 App 崩溃都不能产生第二个文件或第二次计数。

现有 BrowserDownloadStore 不能直接作为候选保存账本。

## 去重与来源

候选展示前，主进程尽可能从受限位图预览计算内容/感知指纹，并结合 `canonicalPageId + imageIndex`
生成去重键。签名媒体 URL 不能成为权威身份；`mediaLocatorRef` 只是 main-owned 的短期重新取得引用。

预览只允许经过解码的受限位图，保存到有单项体积、单任务数量和总容量上限的私有临时缓存。决定后
或到期后清理像素，只持久化安全指纹和来源键。重启时缓存缺失，候选进入 `needs-reobservation`，
必须回到相同来源页和图片序号重新观察，不能改用当前页另一张图片。

如果真实小红书页面无法取得预览字节，V0 只承诺“同一来源页和图片序号不立即重复”，不得宣称跨
CDN URL 的内容级去重。已保存图片以 SHA-256 在当前任务内去重；跨任务全局去重不属于 V0。

每个已保存项记录：

- canonical 来源页；
- 创作者显示名和稳定公开 ID（页面可见时）；
- 图片序号；
- 取得时间与取得方式；
- 平台原图或页面截图标识；
- 本地路径、格式、大小和 SHA-256；
- 地点、动作原始值、规范化动作、景别、机位、构图和热度依据；
- `rightsStatus: 'unknown'`。

首次执行前明确提示：该能力只用于合法图片调研；本地保存不授予转载、商业使用、肖像或改编权。
来源清单不得输出“已授权”或“可商用”等推断。

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
- `WebResourceService`、`BrowserManager`、BrowserTask 和 Agent 继续只拥有各自现有事实；
- renderer 只显示快照并发送有界命令。

这条路线符合现有架构宪法，不需要 ADR。若实现选择第二持久任务 Store、第二 Runtime owner、第二
浏览器或 renderer 任意目录写入，必须停止并先提交 ADR；默认不接受这些路线。

## V0 范围

V0 包含：

- 最小 Activity、侧栏、任务 Tab 和历史恢复；
- 一个小红书账号、搜索词、目标数量和受信目录；
- 真实小红书或明确人工降级的逐张候选；
- 每张候选结束当前 Run，用户决定后新 generation 继续；
- 原子文件保存、来源记录、任务内去重；
- 中断恢复、停止和界面分类统计。

基础保存、跳过、待处理和失败计数随单图闭环交付；V0 末尾增加动作归类和地点分布，不把“有计数”
拖到最后一个阶段。

V0 不包含：

- 多账号顺序执行；
- CSV、JSON、Markdown 多格式导出；
- 抖音、微博或其他平台；
- 服务器、云同步、多人协作、隐藏浏览器或无人值守采集；
- 跨任务全局去重；
- 自动判断已获授权或可商用；
- 固定必须生成 12 个模板。
