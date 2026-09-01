# 图片调研开发计划

> 状态：Conditionally accepted，可进入实验开关后的受控实现。P0 只做非阻塞预检；G1-M/G3-A
> 分别位于对应实现之后，门禁默认启用和支持声明，不倒置阻塞编码。
> 最后更新：2026-09-02。
> 产品事实源：[`image-research.md`](./image-research.md)。

## 1. 当前结论

首个平台初步定为小红书，但仓库目前只有站点 host 识别，没有小红书页面适配器、可信候选身份、
可信人工/Agent 观察、Session 图片获取或可恢复的候选保存事务。

原计划错误地假设以下能力可以直接复用：

1. 普通 Browser 图片右键可以覆盖小红书的 `canvas`、背景图、`blob:` 或预览层；
2. Agent 可以在内存中等待用户而不触发超时、失主和假运行；
3. 系统目录选择器已经授予后续任意子文件写入能力；
4. 文章发布的完整 Runtime binding 已经是 WebAffair 公共能力；
5. 现有下载记录足以承担跨崩溃一次保存。

源码证据否定了这些假设。因此实施顺序改为：现有能力预检，实验开关后的人工单图薄片，真实人工
验收，随后抽取公共 Runtime、实现 Agent 逐张循环并做真实 Agent 验收。

产品文档、开发计划和索引已在 `main` 的提交 `a8b29d9a` 可达。后续独立评审必须记录精确 SHA；
本次条件通过后的修订应进入新的可审计提交后再做最终复核。

## 2. 最终验收动作

V0 完成必须由真人在真实 Studio 中完成产品事实源的十步验收，至少证明：

1. 一个真实小红书账号可以启动任务并重新核验实际网页身份；
2. Agent 候选、网页可见图片、页面语义身份、来源页和图片序号一致；
3. 用户先跳过一张，再确认保存一张；
4. 被跳过图片不落盘，被确认图片只保存一次；
5. 等待确认、临时写入和最终文件提交后三个重启窗口都能安全恢复；
6. Agent、BrowserTask、Tab 或 CDP 中断后不假运行，旧 generation 不写入；
7. 达到目标后停止并显示只统计真实保存文件的分类结果。

Mock 页面、普通 `<img>` 页面、Schema、单元测试或 Activity 图标均不能替代真实小红书验收。

## 3. 阶段总表

| 类别       | 阶段 | 用户可验收结果                                                      | 状态    | 估算               |
| ---------- | ---- | ------------------------------------------------------------------- | ------- | ------------------ |
| 非阻塞预检 | P0   | 记录现有真实页面形态和同 URL 切换证据；无新增用户能力               | Pending | 0.5 人日主动工作   |
| 实验薄片   | V1   | 配置并恢复单账号任务，人工提交一张候选，保存或跳过并看到基础计数    | Pending | 3–5 人日           |
| 保存门禁   | S1   | 候选与文件在崩溃、停止、重试后不丢失、不假运行、不重复              | Pending | 1–2 人日           |
| 人工验收   | G1-M | 真实小红书人工逐张闭环通过，允许默认启用人工路径                    | Pending | 0.5–1 人日主动工作 |
| 工程准备   | V2   | 文章和图片共用完整 WebAffair Runtime identity；不计新增用户能力     | Pending | 2–4 人日           |
| Agent薄片  | V3   | Agent 可见搜索并提出一张；用户确认后截图/保存或跳过                 | Pending | 3–5 人日           |
| Agent验收  | G3-A | 真实小红书 Agent 逐张闭环通过，允许默认启用 Agent 路径              | Pending | 0.5–1 人日主动工作 |
| 完整V0     | V4   | 单账号达到目标停止、主动结束和界面分类统计                          | Pending | 1–2 人日           |
| 交付验收   | R1   | 故障矩阵、真实小红书、受影响 Electron smoke 和 `pnpm verify` 全通过 | Pending | 1–2 人日           |

等待登录、风控或页面现场的时间不计入纯编码时间。完整 Agent V0 预计约 11.5–20.5 人日；真实证据取得前
不承诺固定交付日期。

## 4. 实施顺序

### P0：现有能力非阻塞预检

用户结果：无。P0 只减少实现盲区，不是开工或产品支持门禁。

执行项：

1. 确认后续证据绑定可达文档提交的精确 SHA；
2. 在真实 Studio `WebContentsView` 中用一个已保存小红书账号完成登录；扫码、验证码和风控由真人处理；
3. 使用真实搜索词记录搜索列表、详情页、轮播、图片表示方式和图片序号；
4. 专门记录同一 URL 内切换笔记、详情弹层和轮播时可观察的内容 ID、DOM/页面状态与变化时机；
5. 记录 Electron `context-menu` 参数、当前账号核验方式、图片响应格式和可见页面截图能力；
6. 冻结 `PageSemanticIdentity`、两类 Observation Lease、持久 `CandidateRecord` 和决定命令草案；
7. 冻结候选恢复日志与保存顺序草案；工作空间外目录不属于 V0。

P0 无法取得某项信息时，记录未知并让 V1 通用截图薄片 fail-closed；不得用 Mock 结果冒充真实页面，
也不得因此阻塞 V1 编码。平台书面授权不属于 P0 或后续技术门禁。

### V1：单账号、单图人工纵向闭环

用户结果：用户从最小“图片调研”入口配置一个小红书账号、一个工作空间内目录和任务主题；关闭后可恢复。
用户在当前可见网页提交一张候选，右侧确认卡可以保存或跳过。

工程任务：

1. 增加最小 Activity 和 Sidebar 筛选投影；它们查询同一 `WebAffairService`，以 `affairId` 打开统一
   `web-affair` Tab，禁止新增 TabType、持久 Store 或生命周期 owner；
2. 扩展 WebAffair kind、独立 `imageResearch` payload、schema、migration 和纯 reducer；
3. 任务目录只接受工作空间相对路径，主进程解析并拒绝越界、symlink 逃逸和任意绝对路径；
4. BrowserManager 增加业务通用 `navigationGeneration` 和 `PageSemanticIdentity` 探针；同 URL 内
   `sourceContentId/sourceImageId/imageIndex` 变化也递增 `pageSemanticGeneration`；
5. 主进程从当前账号、View、WebContents、页面语义身份和用户手势签发一次消费的
   `manual-observation` Lease；消费前重新探测语义身份，完全一致才生成持久 `CandidateRecord`；
6. 增加领域确认卡和 `approve/reject/updateTags` CAS 命令，调用只携带
   `affairId + candidateId + revision + decisionOperationId`，不复用60秒工具权限确认；
7. V1 同时增加图片候选恢复日志；`propose/decision/save` 先记录转换意图，再提交 WebAffair，启动时
   对账 `awaiting-decision`、不完整转换和无 owner 的假运行；
8. 实现 `SaveOperation`：临时文件 → 校验/hash → 去重占位 → 原子发布 → ledger 提交；
9. 文件名只由内部 ID/hash/format 确定；使用同卷 sibling 临时文件、流式上限、格式嗅探、SHA-256 和
   file fsync；hash 完成后先在 mutation queue 取得唯一去重占位；
10. 使用目标操作系统验证过的原子 no-replace 原语发布完整临时文件，再 directory fsync；普通 rename
    和 `open('wx')` 后再写入都不算原子发布；
11. 增加只保存 `operationId/path/hash/dedupeReservation/phase` 的文件 journal；副作用前先原子持久化
    意图，损坏时 fail-closed，启动时与 WebAffair 和候选恢复日志对账；
12. 保存来源、图片序号、取得方式、平台原图/截图标识和 `rightsStatus: unknown`；创作者信息带
    `page-visible/user-confirmed/model-suggested` 证据级别，模型建议不作为事实；
13. 从持久候选显示历史 `saved/skipped/pending/failed` 与当前文件 `available/missing/changed` 计数；
14. 截图或取得图片字节只在用户点击逐张确认动作后发生；取得前再次复核持久候选的页面语义身份，
    不一致则进入 `needs-reobservation`；缓存最长边 2048 px、单项 4 MiB、单任务 64 MiB；
15. 冻结 `1..50` 目标、150 个候选决定上限、一次一个待确认候选；待决定时禁止预取；
16. 删除任务默认保留成功文件并清理缓存；删除成功文件使用独立明确确认。

V1 验收：

- 空白 Tab 不产生历史；任务关闭和重启后可恢复；
- 一次最多一个候选，旧页面/旧候选/重复点击不能保存；
- 在同一 URL 中切换到另一笔记后，旧 Lease 提交被 `stale-observation` 拒绝且不会生成候选；候选已
  持久化后再切换，逐张保存进入 `needs-reobservation`，不会截图或保存当前笔记；
- 跳过不落文件，保存产生一个已核验文件；
- 保存或跳过后基础计数立即变化，重启后可从候选记录重建；
- 候选不是普通 `img/srcURL` 时，已证明的人工降级仍可工作；
- 等待确认、临时写入和磁盘提交后账本前重启均不丢候选、不重复文件；
- `propose` 或决定转换中重启时，候选恢复日志完成/回滚同一 operation，无 owner 状态不假运行；
- 目录删除、只读、symlink 替换、`ENOSPC`、`EEXIST`、HTML 伪装和链接过期进入
  `needs-reobservation/retryable/result-unknown/reconciling/abandoned` 中的明确状态。

### S1：保存事务故障门禁

用户结果：V1 已有人工单图闭环在崩溃、停止、重试和结果未知后仍不重复保存或计数。

必须在接 Agent 前完成：

1. 故障注入覆盖候选恢复日志、临时文件、校验/hash、去重占位、原子发布、目录 fsync 和账本提交前后；
2. 同一 `decisionOperationId` 重试可认领，换 operation 重试被拒绝；
3. `停止` 与 `保存` 并发时串行等待或进入 `result-unknown/reconciling`，不得误报已停止；
4. journal 损坏、文件存在但哈希不明、目录重新挂载和 App 重启均 fail-closed；
5. 每个故障只能得到零或一个最终文件、零或一次历史成功计数。

S1 未通过，不进入 G1-M，也不开始 V2/V3。

### G1-M：真实人工闭环发布门禁

用户结果：真人在真实小红书完成一张跳过和一张保存后，人工路径才可默认启用并对外声明支持。

必须完成：

1. 从实验开关进入 V1，在真实账号中人工提交、跳过一张，再提交并保存一张；
2. 网页对象、`PageSemanticIdentity`、候选来源和图片序号一致；同 URL 切换笔记使旧 Lease 失效，
   已持久候选的保存也要求重新观察；
3. 截图或图片获取只由用户逐张确认触发，跳过不截图、不获取文件、不落盘；
4. 等待确认和候选转换中分别重启，候选不丢失且任务不假运行；
5. S1 保存故障矩阵已通过，成功样本只来自 `ledger-committed` 文件。

失败时 V1 继续留在实验开关后修正；G1-M 不是回溯性的开工门禁，也不要求平台书面授权。

### V2：公共 WebAffair Runtime 身份

用户结果：无新增图片调研能力。V2 是 Agent 闭环必需的工程准备度。

前置门禁：S1 和 G1-M 已通过，避免在未证实的人工语义上抽象 Agent Runtime。

工程任务：

1. 从文章发布专用链收敛 WebAffair 公共 acquire、完整 runtime bind、tab-lost、startup reconcile、
   cancel 和 sealed execution policy；
2. 公共 binding 固定 Attempt、generation、launch operation、Agent runtime epoch/binding key、
   BrowserTask、Tab、View/WebContents 和 Playwright connection/page generation；
3. 文章发布和图片调研分别保留独立 payload/reducer，只调用公共生命周期命令；
4. 图片 coordinator 只保存可丢弃运行句柄，不持久化任务快照；
5. Agent Panel 按完整 Affair Runtime identity 投影，停止按同 Tab 最近 BrowserTask 猜任务；
6. Affair 的暂停、继续、终止走精确主进程命令，renderer 不直接 cancel BrowserTask 冒充事务终态；
7. 将 V1 已交付的候选恢复日志扩展到 Agent launch/bind/terminal 转换，并纳入通用 WebAffair recovery
   contract；不得另建第二份图片候选日志。

V2 退出门禁：

- generic、article-publishing 历史迁移和现有文章发布回归全绿；
- 旧 generation、旧 owner、旧 Tab 和迟到终态全部幂等 no-op；
- renderer/Coordinator 没有第二状态机；
- startup 能把无运行 owner 的任务收敛为明确中断或待处理，不恢复成假运行。

### V3：Agent逐张闭环

用户结果：用户点击开始后，Agent 在真实小红书中提出一张候选并结束本轮。用户保存或跳过后，main
启动新 generation 继续寻找下一张；同一 Agent 会话保持连续展示。

工程任务：

1. 增加最小图片调研 MCP：读取冻结任务、消费主进程签发的 `agent-observation` Lease、报告本轮终态；
2. Agent 工具只允许明确账号打开、Browser观察/导航和图片调研命令；不含截图、文件保存、shell、
   任意文件写、Cookie、evaluate、网络日志或拦截；
3. `propose` 消费 Lease 前重新复核 `PageSemanticIdentity`；一致后通过 V1 候选恢复日志原子持久化候选
   和 `awaiting-decision`；
4. propose 成功后本轮 Agent Run 与 BrowserTask 正常结束，不保留内存等待 Promise；
5. 用户明确点击逐张动作后，main 才截图/取得图片并保存或跳过；完成决定后才签发下一 generation，
   未决定时不能截图、保存、预取或继续导航；
6. App重启后可以先处理候选，再创建新 Run；决定不依赖旧 Runtime；
7. 登录、验证码、风控、账号不明和未知页面进入人工接管，交还后重新观察。
8. 每 generation 最多 30 次 Browser 动作且页面变更间隔至少 1 秒；达到候选/目标上限或风险信号
   立即结束自动动作。

V3 验收：

- 真实完成“提出 → 跳过 → 新 generation → 再提出 → 保存 → 新 generation 继续”；
- Agent 候选、网页图片、页面语义身份和来源页是同一对象；
- Agent/BrowserTask/Tab/CDP 任一中断后不假运行；
- 旧 Agent 迟到候选、迟到终态和重复工具调用不修改当前状态；
- 链接过期只从同一来源和图片序号重新观察，不抓当前页其他图片。

### G3-A：真实 Agent 闭环发布门禁

用户结果：真人在真实小红书完成 Agent 提出、逐张跳过、逐张保存和继续循环后，Agent 路径才可默认
启用并对外声明支持。

必须完成：

1. Agent 只在可见 Browser 中搜索和提出候选，网页对象、页面语义身份和候选完全一致；
2. 用户确认前没有截图、图片获取、文件写入或下一候选预取；
3. 真实完成“提出 → 用户跳过 → 新 generation → 提出 → 用户确认截图/保存 → 继续”；
4. 同 URL 切换笔记、旧 Agent 迟到、Tab/CDP 中断和重启都不能串候选或恢复成假运行；
5. 达到动作上限、验证码、风控或未知页面立即停在可执行人工状态。

自动路径连续失败两次后停止调延时和猜 selector，V3 保留在实验开关后；已通过 G1-M 的人工路径不受
影响。平台书面授权不是技术门禁，来源和权利未知继续作为普通产品提示。

### V4：单账号目标与分类统计

用户结果：已有基础计数上增加动作归类和地点分布；任务达到目标数量后停止，提前结束显示样本不足。

前置门禁：G3-A 已通过。

工程任务：

1. 保存动作原始值和用户确认的规范化动作，用户修改后可重算；
2. 候选展示前只按页面语义身份做来源去重；用户确认后才取得像素并计算内容指纹；签名 URL 只进入
   main-owned 短期 locator；
3. 已保存图片以 SHA-256 在当前 Affair 内去重；不同搜索词命中同一内容只计一次；
4. 用户确认取得图片前，界面明确只保证同一页面语义身份/图片序号不立即重复，不宣称内容级去重；
5. 历史成功统计只计 `ledger-committed`；当前可用文件另计 `available/missing/changed`，外部删除或
   修改不篡改历史事实；
6. 达到目标后不再产生 Browser 动作；主动结束保存现有统计。

多账号顺序执行和 CSV/JSON/Markdown 导出移到 V0 之后。

### R1：故障矩阵与真实交付

用户结果：用户可以在真实小红书和真实目录中完成最终十步验收，失败时能继续或得到明确终态。

必须完成：

1. 自动化故障注入覆盖候选 CAS、工作空间目录边界、全部保存阶段、旧 generation 和启动对账；
2. 覆盖窗口重建、工作空间切换、目录删除、磁盘满、下载中断、账号失效和事件迟到；
3. 运行 shared/schema/reducer/file/runtime 定向测试、受影响 Electron smoke 和 `pnpm verify`；
4. 真实小红书验收自动与人工候选路径、逐图循环、中断恢复和来源/权利字段；
5. 在 `docs/ops/` 记录真人结果。真实平台门禁未通过时，只能声明对应工程或人工闭环完成。

## 5. 主要代码落点

```text
src/shared/image-research/
src/main/image-research/
src/main/mcp/modules/image-research/
src/renderer/src/features/image-research/
src/preload/image-research-api.ts
```

需要受控修改：

- `src/shared/web-affairs/`、`src/main/web-affairs/`：kind、payload、公共 Runtime contract、迁移和恢复；
- `src/main/browser/browser-manager.ts`：navigation generation、页面语义身份、可信 observation 和
  Session 获取边界；
- `src/main/web-affairs/`：V1 即交付图片候选恢复日志与启动对账，V2 再扩展 Runtime 转换；
- `src/main/fs/`：工作空间相对目录校验、hash 去重占位、原子 no-replace 发布和文件 journal；
- Activity、Sidebar 和既有 `web-affair` Tab 激活链：最小任务筛选入口与恢复；
- AgentPanel：完整 Affair binding 和候选卡；
- Browser原生菜单/人工提交入口：实现逐张确认后截图/取得图片，并在 G1-M 覆盖真实页面表示方式；
- runtime registry、preload 和 shared IPC inventory：成对注册、校验和释放。

`image-research` 保持独立 reducer。候选恢复日志只解决 WebAffair 转换意图，文件 journal 只解决文件
提交阶段，两者以同一 operation ID 对账；均不得保存第二份候选、决定、计数或任务终态。

## 6. 必测门禁

### 自动化证据

- 新 Schema/migration 保留 generic、article-publishing 和全部历史；损坏、超限和降级 fail-closed；
- 一次最多一个候选；旧 generation、旧账号、旧页面、重复工具和迟到事件均 no-op；
- 同 URL 切换笔记、弹层或轮播时 `pageSemanticGeneration` 递增；Lease 消费和用户确认取得图片前均
  复核，不一致即拒绝；
- App启动对账 `preparing/searching/awaiting-decision/saving`，无 BrowserTask 时不恢复成运行中；
- 候选恢复日志覆盖 propose/decision/save 转换中崩溃，候选不丢失、不形成第二状态 owner；
- 工作空间目录覆盖绝对路径、越界、跨 workspace、symlink 替换和重新挂载；
- 保存故障按临时文件、校验/hash、去重占位、原子 no-replace 发布、directory fsync、账本提交顺序覆盖，
  并覆盖
  `ENOSPC/EACCES/EEXIST`、journal 损坏、redirect、
  HTML伪装、超限、链接过期和重复点击；
- Agent只使用 main-issued `agent-observation` Lease；人工 Lease 不伪造 Agent 字段；工具 allowlist 不含
  截图、任意文件、网络、Cookie 或 evaluate；
- 用户确认前没有截图、图片字节获取、文件写入或下一候选预取；
- Agent Panel、工作空间切换、Tab切换和窗口重建不串任务；
- IPC、事件 producer/consumer/disposer 进入现有 inventory 和 AST 门禁；
- 文章发布、普通事务、Browser、Agent Panel 和文件能力回归、受影响 Electron smoke、`pnpm verify` 全绿。

### 真实小红书证据

- 已保存账号真实登录，扫码、验证码和风控由真人处理；
- 执行前网页实际账号与任务账号一致；
- 搜索列表、详情、轮播、图片表示方式、来源页和图片序号已记录；
- G1-M 人工候选和 G3-A Agent 候选分别通过；
- 网页图片、页面语义身份、来源和“在网页中查看”是同一张；同 URL 切换旧 Lease 失效；
- 跳过不落盘且不立即重复，保存只产生一个文件和一次计数；
- 重复点击、旧卡、旧 Agent、三个保存崩溃窗口不重复文件；
- Agent、BrowserTask、Tab、CDP 中断各一次后安全收敛；
- 链接过期、目录删除、只读和磁盘满有可执行恢复；
- 达到目标后无新 Browser 动作，统计只计真实成功文件；
- 开始前普通提示研究用途/来源与权利未知，来源记录保留创作者、图片序号和取得方式；该提示不是
  技术验收或书面授权门禁。

## 7. 止损与不得扩张

- P0 未知项采用 fail-closed 薄片，不阻塞 V1；
- S1/G1-M 未通过，不默认启用人工路径，也不开始 V2 抽象；
- G3-A 未通过，不默认启用 Agent 路径，但不撤销已通过 G1-M 的人工路径；
- V1 单图人工闭环未通过，不抽象多平台；
- V2 公共 Runtime 未通过，不接 Agent循环；
- 不建设服务器、云同步、多账号并发、隐藏浏览器、批量采集或全局去重；
- 不把通用工具确认当成持久候选决定；
- 不让 Agent 自报 URL、身份或保存成功；
- 连续60分钟没有用户可验收增量，停止横向重构并回到当前最短闭环；
- 同一小红书自动路径连续失败两次，切换人工降级并汇报，不调延时掩盖失败。

## 8. 当前最短主线

```text
P0 现有能力非阻塞预检
→ V1 实验开关后的单账号单图人工闭环（含页面语义身份、候选恢复日志）
→ S1 保存故障门禁
→ G1-M 真实人工闭环发布门禁
→ V2 公共 WebAffair Runtime 身份
→ V3 Agent提出一张后结束，用户决定后新代次继续
→ G3-A 真实 Agent 闭环发布门禁
→ V4 单账号目标与分类统计
→ R1 故障矩阵和真人验收
```
