# 图片调研开发计划

> 状态：Conditionally accepted，可进入实验开关后的受控实现。E0 只做非阻塞预检；G1-M/G3-A
> 分别位于对应实现之后，门禁默认启用和支持声明，不倒置阻塞编码。
> 最后更新：2026-09-02。
> 产品事实源：[`image-research.md`](./image-research.md)。

## 1. 当前结论

首个平台初步定为小红书，但仓库目前只有站点 host 识别，没有小红书页面适配器、可信候选身份、
可信人工/Agent 观察、Session 图片获取或可恢复的候选保存事务。

2026-09-02 公开页取证只看到推荐图片和登录遮罩，点击笔记后 URL 仍为 `/explore`；尚未证明真实已
登录账号、详情预览、轮播、实际账号观察或保存闭环。该证据进入 E0 记录，但不冒充 G1-M/G3-A。

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
| 非阻塞预检 | E0   | 记录现有真实页面形态和同 URL 切换证据；无新增用户能力               | Pending | 0.5 人日主动工作   |
| 配置薄片   | V1a  | 配置并恢复任务；同一事务可从图片入口和公共事务入口打开              | Pending | 1–2 人日           |
| 候选薄片   | V1b  | 精确人工选图、持久候选、跳过和重启恢复，不取得错误图片              | Pending | 1–2 人日           |
| 保存薄片   | V1c  | 确认后取图、原子发布、hash 去重和互斥基础统计                       | Pending | 2–3 人日           |
| 人工验收   | G1-M | 真实小红书人工逐张闭环通过，允许默认启用人工路径                    | Pending | 0.5–1 人日主动工作 |
| 工程准备   | V2   | 文章和图片共用完整 WebAffair Runtime identity；不计新增用户能力     | Pending | 2–4 人日           |
| Agent薄片  | V3   | Agent 可见搜索并提出一张；用户确认后截图/保存或跳过                 | Pending | 3–5 人日           |
| Agent验收  | G3-A | 真实小红书 Agent 逐张闭环通过，允许默认启用 Agent 路径              | Pending | 0.5–1 人日主动工作 |
| 完整V0     | V4   | 单账号达到目标停止、主动结束和界面分类统计                          | Pending | 1–2 人日           |
| 交付验收   | R1   | 故障矩阵、真实小红书、受影响 Electron smoke 和 `pnpm verify` 全通过 | Pending | 1–2 人日           |

等待登录、风控或页面现场的时间不计入纯编码时间。完整 Agent V0 预计约 12.5–22.5 人日；真实证据取得前
不承诺固定交付日期。

## 4. 实施顺序

### E0：现有能力非阻塞预检

用户结果：无。E0 只减少实现盲区，不是开工或产品支持门禁。

执行项：

1. 确认后续证据绑定可达文档提交的精确 SHA；
2. 在真实 Studio `WebContentsView` 中用一个已保存小红书账号完成登录；扫码、验证码和风控由真人处理；
3. 使用真实搜索词记录搜索列表、详情页、轮播、图片表示方式和图片序号；
4. 专门记录同一 URL 内切换笔记、详情弹层和轮播时可观察的内容 ID、DOM/页面状态与变化时机；
5. 记录 Electron `context-menu` 参数、当前账号核验方式、图片响应格式和可见页面截图能力；
6. 冻结 `PageSemanticIdentity`、`AccountObservation`、两类 Observation Lease、精确选图和决定命令草案；
7. 冻结现有 `WebAffairStore` journal 泛化与文件保存顺序草案；工作空间外目录不属于 V0。

E0 无法取得某项信息时，记录未知并让 V1b 通用选择/裁剪薄片 fail-closed；不得用 Mock 结果冒充真实
页面，也不得因此阻塞 V1a 编码。平台书面授权不属于 E0 或后续技术门禁。

### V1a：任务配置与单一恢复裁判

用户结果：用户可以配置一个小红书账号、主题和工作空间内目录；关闭 Tab 或重启后，从图片调研入口
或公共事务入口都能打开同一任务。

工程任务：

1. 增加图片 Activity/Sidebar 筛选投影，以 `affairId` 打开统一 `web-affair` Tab；同时修正公共事务
   Sidebar，使其包含 `image-research`，禁止新增 TabType、Store 或 lifecycle owner；
2. 扩展 WebAffair kind、`imageResearch` payload、互斥 CandidateOutcome、schema、migration 和 reducer；
3. 任务目录只接受工作空间相对路径，主进程拒绝越界、symlink 逃逸和任意绝对路径；
4. 直接泛化现有 `WebAffairStore` recovery journal，使其保存活动 `image-research` Affair 的完整目标
   快照、revision、hash 和 operation ID；不得新增候选 journal；
5. 启动顺序固定为 Store 按 revision 恢复唯一快照，再由 Service 收敛无 owner 的运行状态。

真人验收：空白 Tab 不产生历史；已保存配置从两个入口打开同一 affairId；分别在 Store journal 写入前、
写入后和 snapshot 替换后重启，任务只恢复一次且不假运行。

### V1b：精确人工候选与跳过

用户结果：用户可以在当前可见网页精确选择图片或裁剪区域，立即看到同一目标的受限预览，保存候选、
重启恢复或跳过；本阶段不写最终图片文件。

工程任务：

1. BrowserManager 增加 `PageSemanticIdentity` 探针；同 URL 内笔记、弹层或轮播对象变化也递增
   `pageSemanticGeneration`；
2. 增加 main-owned `AccountObservation`，支持 `page-visible` 和明确的 `user-confirmed` 证据；提出候选
   前重新观察，无法自动识别时显示“账号由用户确认”；
3. 增加“选择图片/裁剪区域”动作：普通图片绑定元素/资源/边界，canvas、背景图和轮播由用户拖选；
4. 选择手势授权主进程在同一捕获序列立即固定 View 像素矩形、viewport/scale、页面语义代次、账号
   观察和来源身份，捕获并裁剪预览；禁止延迟全 View 截图；
5. 签发一次消费的 `manual-observation` Lease；生成候选前重新复核页面与账号观察，再通过现有
   WebAffair mutation queue/Store journal 持久化 `CandidateRecord + awaiting-decision`；
6. 增加 `skip/updateTags` CAS 命令和确认卡；调用只携带
   `affairId + candidateId + revision + decisionOperationId`；
7. 私有预览缓存限制最长边 2048 px、单项 4 MiB、单任务 64 MiB；跳过或过期后清理像素。

真人验收：普通 img、canvas/背景图和轮播各选择一次，预览与手势目标一致；同 URL 换笔记、轮播变化、
账号变化或捕获期间代次变化均拒绝旧选择；等待确认时重启候选仍存在且无假运行；跳过不产生文件。

### V1c：确认后保存与基础统计

用户结果：用户确认后保存精确候选或跳过；文件只出现一次，并立即看到互斥基础统计。

工程任务：

1. 取得页面原图前重新复核 `PageSemanticIdentity + AccountObservation + media identity`；保存截图直接
   使用 V1b 已绑定像素，目标不稳定时要求重新选择；
2. 实现 `SaveOperation`：同卷临时文件 → 校验/hash → mutation queue 中的去重占位 → 原子
   no-replace 发布 → ledger 提交；
3. 文件名只由内部 ID/hash/format 确定；临时文件完成格式嗅探、SHA-256 和 fsync 后才能申请占位；
4. 使用目标操作系统验证过的原子发布原语，再 directory fsync；普通 rename 和 `open('wx')` 后写入
   都不算原子发布；
5. 只有文件副作用使用独立文件 journal，记录 `operationId/path/hash/dedupeReservation/phase`；它只
   报告事实，由 `WebAffairService` 在 Store 恢复后作唯一对账决定；
6. 持久化来源、实际账号证据、图片序号、取得方式、原图/截图标识、hash 和 `rightsStatus: unknown`；
7. 定义互斥 outcome：非终态为 pending，ledger 成功为 saved，用户跳过为 skipped，hash 命中为
   duplicate，不可恢复且明确放弃为 failed；五项之和等于候选总数；
8. 冻结 `1..50` 目标、150 个候选决定、一次一个待确认候选；删除任务默认保留成功文件。

退出门禁：故障注入覆盖 Store journal、临时文件、校验/hash、去重占位、原子发布、directory fsync、
ledger 和停止并发；同一 operation 可认领，换 operation 被拒绝；每个窗口只能产生零或一个最终文件、
零或一次 saved 计数。`ENOSPC/EACCES/EEXIST`、HTML 伪装、链接过期和 journal 损坏均 fail-closed。

### G1-M：真实人工闭环发布门禁

用户结果：真人在真实小红书完成一张跳过和一张保存后，人工路径才可默认启用并对外声明支持。

必须完成：

1. 从实验开关进入 V1a–V1c，在真实登录账号中精确选择、跳过一张，再选择并保存一张；
2. 网页对象、`PageSemanticIdentity`、`AccountObservation`、候选来源和图片序号一致；
3. canvas/背景图/轮播的选择预览与用户手势完全一致；同 URL 换笔记或切换账号使旧候选拒绝保存；
4. 等待确认和 Store journal 提交窗口分别重启，候选不丢失、不重复且任务不假运行；
5. V1c 保存故障矩阵已通过，成功样本只来自 `ledger-committed` 文件。

失败时 V1a–V1c 继续留在实验开关后修正；G1-M 不是回溯性的开工门禁，也不要求平台书面授权。

### V2：公共 WebAffair Runtime 身份

用户结果：无新增图片调研能力。V2 是 Agent 闭环必需的工程准备度。

前置门禁：V1c 和 G1-M 已通过，避免在未证实的人工语义上抽象 Agent Runtime。

工程任务：

1. 从文章发布专用链收敛 WebAffair 公共 acquire、完整 runtime bind、tab-lost、startup reconcile、
   cancel 和 sealed execution policy；
2. 公共 binding 固定 Attempt、generation、launch operation、Agent runtime epoch/binding key、
   BrowserTask、Tab、View/WebContents 和 Playwright connection/page generation；
3. 文章发布和图片调研分别保留独立 payload/reducer，只调用公共生命周期命令；
4. 图片 coordinator 只保存可丢弃运行句柄，不持久化任务快照；
5. Agent Panel 按完整 Affair Runtime identity 投影，停止按同 Tab 最近 BrowserTask 猜任务；
6. Affair 的暂停、继续、终止走精确主进程命令，renderer 不直接 cancel BrowserTask 冒充事务终态；
7. 将 Agent launch/bind/terminal operation ID 纳入 V1a 已泛化的 WebAffair schema；继续只使用现有
   `WebAffairStore` recovery journal，不新增图片专用恢复裁判。

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
2. 创建 Run 时设置 `disableBuiltinTools: true`，逐项允许 `web_account_open`、`browser_title`、
   `browser_get_tab_info`、`browser_wait_for_selector`、`browser_click`、`browser_fill`、
   `browser_press`、`browser_scroll`、`browser_wait_for_navigation`、受限 inspect/propose、
   `web_affair_get` 和 `web_affair_finish_attempt`；禁止 `browser_*` 通配符；
3. 工具服务端读取 main-issued `imageResearchPolicy` 和完整 Runtime identity，再执行同一白名单；无论
   客户端配置如何，都拒绝 screenshot、extract/evaluate、文件、编辑器、shell、上传和下载；
4. `propose` 消费 Lease 前重新复核 `PageSemanticIdentity + AccountObservation`；一致后通过现有
   WebAffair mutation queue/Store journal 原子持久化候选和 `awaiting-decision`；
5. 平台探针无法给出稳定图片身份/元素引用时进入 `waiting-human`，要求用户走 V1b 精确选择；Agent
   不得自报坐标或触发延迟截图；
6. propose 成功后本轮 Agent Run 与 BrowserTask 正常结束，不保留内存等待 Promise；
7. 用户明确点击逐张动作后，main 才取得图片并保存或跳过；需要人工截图时进入 V1b 精确选择，完成
   决定后才签发下一 generation，
   未决定时不能截图、保存、预取或继续导航；
8. App重启后可以先处理候选，再创建新 Run；决定不依赖旧 Runtime；
9. 登录、验证码、风控、账号不明和未知页面进入人工接管，交还后重新观察；
10. 每 generation 最多 30 次 Browser 动作且页面变更间隔至少 1 秒；达到候选/目标上限或风险信号
    立即结束自动动作。

V3 验收：

- 真实完成“提出 → 跳过 → 新 generation → 再提出 → 保存 → 新 generation 继续”；
- Agent 候选、网页图片、页面语义身份、实际账号观察和来源页是同一对象；
- 客户端 allowedTools 和工具服务端都拒绝截图、文件、extract/evaluate 与内置工具；
- Agent/BrowserTask/Tab/CDP 任一中断后不假运行；
- 旧 Agent 迟到候选、迟到终态和重复工具调用不修改当前状态；
- 链接过期只从同一来源和图片序号重新观察，不抓当前页其他图片。

### G3-A：真实 Agent 闭环发布门禁

用户结果：真人在真实小红书完成 Agent 提出、逐张跳过、逐张保存和继续循环后，Agent 路径才可默认
启用并对外声明支持。

必须完成：

1. Agent 只在可见 Browser 中搜索和提出候选，网页对象、页面语义身份和候选完全一致；
2. Agent 没有截图、图片获取或文件工具；用户决定前没有文件写入或下一候选预取；
3. 真实完成“提出 → 用户跳过 → 新 generation → 提出 → 用户确认截图/保存 → 继续”；
4. 同 URL 切换笔记、实际账号变化、旧 Agent 迟到、Tab/CDP 中断和重启都不能串候选或恢复成假运行；
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
- `src/main/browser/browser-manager.ts`：navigation generation、页面语义身份、实际账号观察、精确选择
  即时裁剪、可信 observation 和 Session 获取边界；
- `src/main/web-affairs/`：V1a 泛化现有 Store recovery journal 与启动对账，V2 再扩展 Runtime 字段；
- `src/main/fs/`：工作空间相对目录校验、hash 去重占位、原子 no-replace 发布和文件 journal；
- 图片 Activity、图片 Sidebar、公共事务 Sidebar 和既有 `web-affair` Tab 激活链：同一任务的两个入口；
- AgentPanel：完整 Affair binding 和候选卡；
- Browser原生菜单/人工提交入口：实现“选择图片/裁剪区域”与即时 main-owned 裁剪；
- Agent runtime/MCP dispatcher：精确 allowedTools、`disableBuiltinTools` 和服务端
  `imageResearchPolicy` 双重拒绝；
- runtime registry、preload 和 shared IPC inventory：成对注册、校验和释放。

`image-research` 保持独立 reducer。现有 `WebAffairStore` journal 是事务快照唯一恢复裁判；文件 journal
只记录文件副作用事实，并在 Store 恢复后由 `WebAffairService` 以同一 operation ID 对账。不得增加
第二份候选、决定、计数或任务终态。

## 6. 必测门禁

### 自动化证据

- 新 Schema/migration 保留 generic、article-publishing 和全部历史；损坏、超限和降级 fail-closed；
- 图片入口和公共事务 Sidebar 打开同一 affairId；没有新增 TabType、事务 Store 或 recovery owner；
- 一次最多一个候选；旧 generation、旧账号、旧页面、重复工具和迟到事件均 no-op；
- 同 URL 切换笔记、弹层或轮播时 `pageSemanticGeneration` 递增；Lease 消费和用户确认取得图片前均
  复核，不一致即拒绝；
- `AccountObservation` 在提出候选和取得图片前复核；页面身份可见时比对稳定 ID，无法识别时要求用户
  明确确认且界面不声称自动验证；
- 精确选图固定 View 像素矩形、scale、页面/账号代次并立即裁剪；代次变化、越界或遮挡要求重选，
  禁止延迟全 View 截图；
- App启动对账 `preparing/searching/awaiting-decision/saving`，无 BrowserTask 时不恢复成运行中；
- 现有 Store journal 覆盖 image-research 的 propose/decision/save 快照；恢复只按 revision 裁决一次；
- 工作空间目录覆盖绝对路径、越界、跨 workspace、symlink 替换和重新挂载；
- 保存故障按临时文件、校验/hash、去重占位、原子 no-replace 发布、directory fsync、账本提交顺序覆盖，
  并覆盖
  `ENOSPC/EACCES/EEXIST`、journal 损坏、redirect、
  HTML伪装、超限、链接过期和重复点击；
- Agent Run 设置逐项 allowedTools 和 `disableBuiltinTools: true`，客户端及服务端都拒绝 screenshot、
  extract/evaluate、文件、内置工具与 `browser_*` 通配符；
- 只有用户精确选择手势可以立即取得人工预览；Agent 无像素工具，用户决定前无文件写入或下一候选
  预取；
- 每个候选只属于 `saved/skipped/duplicate/pending/failed` 一个 outcome，五项之和恒等于候选总数；
- Agent Panel、工作空间切换、Tab切换和窗口重建不串任务；
- IPC、事件 producer/consumer/disposer 进入现有 inventory 和 AST 门禁；
- 文章发布、普通事务、Browser、Agent Panel 和文件能力回归、受影响 Electron smoke、`pnpm verify` 全绿。

### 真实小红书证据

- 已保存账号真实登录，扫码、验证码和风控由真人处理；
- 执行前网页实际账号与任务账号一致；
- 自动无法识别实际账号时显示并记录“账号由用户确认”，切换账号后旧观察和旧候选失效；
- 搜索列表、详情、轮播、图片表示方式、来源页和图片序号已记录；
- G1-M 人工候选和 G3-A Agent 候选分别通过；
- 网页图片、精确裁剪预览、页面语义身份、实际账号、来源和“在网页中查看”是同一张；同 URL 换笔记
  或切换账号使旧 Lease/候选失效；
- 跳过不落盘且不立即重复，保存只产生一个文件和一次计数；
- 重复点击、旧卡、旧 Agent、三个保存崩溃窗口不重复文件；
- Agent、BrowserTask、Tab、CDP 中断各一次后安全收敛；
- 链接过期、目录删除、只读和磁盘满有可执行恢复；
- 达到目标后无新 Browser 动作，统计只计真实成功文件；
- 开始前普通提示研究用途/来源与权利未知，来源记录保留创作者、图片序号和取得方式；该提示不是
  技术验收或书面授权门禁。

## 7. 止损与不得扩张

- E0 未知项采用 fail-closed 薄片，不阻塞 V1a；
- V1c/G1-M 未通过，不默认启用人工路径，也不开始 V2 抽象；
- G3-A 未通过，不默认启用 Agent 路径，但不撤销已通过 G1-M 的人工路径；
- V1a–V1c 单图人工闭环未通过，不抽象多平台；
- V2 公共 Runtime 未通过，不接 Agent循环；
- 不建设服务器、云同步、多账号并发、隐藏浏览器、批量采集或全局去重；
- 不把通用工具确认当成持久候选决定；
- 不让 Agent 自报 URL、身份或保存成功；
- 连续60分钟没有用户可验收增量，停止横向重构并回到当前最短闭环；
- 同一小红书自动路径连续失败两次，切换人工降级并汇报，不调延时掩盖失败。

## 8. 当前最短主线

```text
E0 真实小红书非阻塞预检
→ V1a 同一 WebAffair schema、配置恢复、泛化现有 Store journal
→ V1b 精确人工选图、持久候选、跳过、重启恢复
→ V1c 确认后取图、原子发布、hash 去重、互斥基础统计
→ G1-M 真实人工闭环发布门禁
→ V2 公共 WebAffair Runtime 身份
→ V3 Agent提出一张后结束，用户决定后新代次继续
→ G3-A 真实 Agent 闭环发布门禁
→ V4 单账号目标与分类统计
→ R1 故障矩阵和真人验收
```
