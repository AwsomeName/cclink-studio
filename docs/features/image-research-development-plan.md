# 图片调研开发计划

> 状态：Blocked on E0 evidence。独立评审已驳回原 `Ready` 计划；真实小红书取证和基础契约冻结前
> 不得施工 V1。
> 最后更新：2026-09-01。
> 产品事实源：[`image-research.md`](./image-research.md)。

## 1. 当前结论

首个平台初步定为小红书，但仓库目前只有站点 host 识别，没有小红书页面适配器、可信候选身份、
持久目录写授权、Session 图片获取或可恢复的候选保存事务。

原计划错误地假设以下能力可以直接复用：

1. 普通 Browser 图片右键可以覆盖小红书的 `canvas`、背景图、`blob:` 或预览层；
2. Agent 可以在内存中等待用户而不触发超时、失主和假运行；
3. 系统目录选择器已经授予后续任意子文件写入能力；
4. 文章发布的完整 Runtime binding 已经是 WebAffair 公共能力；
5. 现有下载记录足以承担跨崩溃一次保存。

源码证据否定了这些假设。因此实施顺序改为：真实证据先行，合并任务壳与单图人工闭环，随后抽取
公共 Runtime 身份，再接 Agent 逐张循环。

当前两份图片调研文档仍是工作区新增文件，尚未进入 `main` 的可达 Git 历史。下一次使用独立工作树
或干净 checkout 评审前，必须先让产品文档、开发计划和 `docs/README.md` 进入同一个可审计提交，并
要求评审记录精确 SHA；否则“文件不存在”只能证明评审环境没有该提交，不能评价当前修订内容。

## 2. 最终验收动作

V0 完成必须由真人在真实 Studio 中完成产品事实源的十步验收，至少证明：

1. 一个真实小红书账号可以启动任务并重新核验实际网页身份；
2. Agent 候选、网页可见图片、预览、来源页和图片序号一致；
3. 用户先跳过一张，再确认保存一张；
4. 被跳过图片不落盘，被确认图片只保存一次；
5. 等待确认、临时写入和最终文件提交后三个重启窗口都能安全恢复；
6. Agent、BrowserTask、Tab 或 CDP 中断后不假运行，旧 generation 不写入；
7. 达到目标后停止并显示只统计真实保存文件的分类结果。

Mock 页面、普通 `<img>` 页面、Schema、单元测试或 Activity 图标均不能替代真实小红书验收。

## 3. 阶段总表

| 类别      | 阶段 | 用户可验收结果                                                      | 状态    | 估算               |
| --------- | ---- | ------------------------------------------------------------------- | ------- | ------------------ |
| 硬门禁    | E0   | 真实小红书证据和四项基础契约冻结；无新增用户能力                    | Blocked | 0.5–1 人日主动工作 |
| 最小闭环  | V1   | 配置并恢复单账号任务，提交一张候选，保存或跳过并看到基础计数        | Pending | 3–5 人日           |
| 工程准备  | V2   | 文章和图片共用完整 WebAffair Runtime identity；不计新增用户能力     | Pending | 2–4 人日           |
| Agent闭环 | V3   | Agent 提出一张后结束本轮；用户决定后新 generation 继续              | Pending | 3–5 人日           |
| 完整V0    | V4   | 单账号达到目标停止、主动结束和界面分类统计                          | Pending | 1–2 人日           |
| 交付验收  | R1   | 故障矩阵、真实小红书、受影响 Electron smoke 和 `pnpm verify` 全通过 | Pending | 1–2 人日           |

E0 等待登录、风控或页面现场的时间不计入纯编码时间。E0 通过后预计 10–18 人日；在真实证据取得前不应
承诺固定交付日期。

## 4. 实施顺序

### E0：真实小红书证据与契约冻结

用户结果：无。E0 是硬门禁和工程准备度，不得作为功能进度汇报。

必须完成：

1. 将两份事实源和文档索引放入同一个可达 Git 提交，后续证据绑定精确 SHA；
2. 在真实 Studio `WebContentsView` 中用一个已保存小红书账号完成登录；扫码、验证码和风控由真人处理；
3. 使用真实搜索词记录搜索列表、详情页、轮播、图片表示方式、来源页稳定标识和图片序号；
4. 记录 Electron `context-menu` 参数、Playwright Page binding、当前账号核验方式和图片响应格式；
5. 证明一条 Agent 候选路径；
6. 证明一条不依赖相同 `srcURL` 前提的人工降级，例如主进程限定元素截图或可见区域提交；
7. 冻结 `CandidateObservation` 的完整身份和 BrowserManager `navigationGeneration`；
8. 冻结一次消费的 `directory-write` capability；
9. 冻结 `SaveOperation`、低层 journal、no-clobber、Session 获取、链接过期重观察和来源/权利字段；
10. 冻结 WebAffair 公共 acquire/bind/reconcile/sealed execution policy 的最小 contract。

E0 退出门禁：

- 自动候选和独立人工降级至少各有一条真实证据；
- 真实账号身份、页面、轮播图片和预览能建立同一候选身份；
- 目录授权、保存阶段、候选决定和 Runtime identity 已有 contract 与故障时序；
- 当时有效的平台规则已复查，产品继续只标记 `rightsStatus: unknown`；
- 未知页面、账号和图片取得方式默认暂停。

止损：自动路径连续失败两次后停止深挖，保留人工路径；人工路径也无法证明时维持 Blocked，不施工 V1。

### V1：单账号、单图人工纵向闭环

用户结果：用户从最小“图片调研”入口配置一个小红书账号、一个目标目录和任务主题；关闭后可恢复。
用户在当前可见网页提交一张候选，右侧确认卡可以保存或跳过。

工程任务：

1. 增加最小 Activity、Sidebar、Workbench Tab 和历史任务投影，不先做高级筛选和徽标；
2. 扩展 WebAffair kind、独立 `imageResearch` payload、schema、migration 和纯 reducer；
3. 实现 `directory-write` capability：绑定 renderer/workspace/任务创建、一次消费、realpath 和 symlink
   重验；任务保存后 IPC 不再接受路径；
4. BrowserManager 增加业务通用 `navigationGeneration`；
5. 主进程从当前账号、View、WebContents、Playwright Page 和页面探针签发 `CandidateObservation`；
6. 增加领域确认卡和 `approve/reject/updateTags` CAS 命令，不复用60秒工具权限确认；
7. 实现 `SaveOperation`：`reserved → fetching → temp-verified → disk-committed → ledger-committed`；
8. 使用同卷 sibling 临时文件、流式上限、格式嗅探、SHA-256 和 no-clobber；
9. 增加只保存 `operationId/path/hash/phase` 的低层 journal，启动时与 WebAffair 对账；
10. 保存来源、创作者公开信息、图片序号、取得方式、平台原图/截图标识和 `rightsStatus: unknown`。
11. 从持久候选直接显示 `saved/skipped/pending/failed` 基础计数；统计不依赖 Agent 文本或下载记录。
12. 受限位图预览缓存设置单项体积、单任务数量、总容量、到期清理和缺失后的重新观察规则。

V1 验收：

- 空白 Tab 不产生历史；任务关闭和重启后可恢复；
- 一次最多一个候选，旧页面/旧候选/重复点击不能保存；
- 跳过不落文件，保存产生一个已核验文件；
- 保存或跳过后基础计数立即变化，重启后可从候选记录重建；
- 候选不是普通 `img/srcURL` 时，已证明的人工降级仍可工作；
- 等待确认、临时写入和 rename 后账本前重启均不丢候选、不重复文件；
- 目录删除、只读、symlink 替换、`ENOSPC`、`EEXIST`、HTML 伪装和链接过期返回可恢复结果。

### V2：公共 WebAffair Runtime 身份

用户结果：无新增图片调研能力。V2 是 Agent 闭环必需的工程准备度。

工程任务：

1. 从文章发布专用链收敛 WebAffair 公共 acquire、完整 runtime bind、tab-lost、startup reconcile、
   cancel 和 sealed execution policy；
2. 公共 binding 固定 Attempt、generation、launch operation、Agent runtime epoch/binding key、
   BrowserTask、Tab、View/WebContents 和 Playwright connection/page generation；
3. 文章发布和图片调研分别保留独立 payload/reducer，只调用公共生命周期命令；
4. 图片 coordinator 只保存可丢弃运行句柄，不持久化任务快照；
5. Agent Panel 按完整 Affair Runtime identity 投影，停止按同 Tab 最近 BrowserTask 猜任务；
6. Affair 的暂停、继续、终止走精确主进程命令，renderer 不直接 cancel BrowserTask 冒充事务终态；
7. WebAffair recovery journal 覆盖所有需要关键恢复的 Affair kind，不只筛选文章发布。

V2 退出门禁：

- generic、article-publishing 历史迁移和现有文章发布回归全绿；
- 旧 generation、旧 owner、旧 Tab 和迟到终态全部幂等 no-op；
- renderer/Coordinator 没有第二状态机；
- startup 能把无运行 owner 的任务收敛为明确中断或待处理，不恢复成假运行。

### V3：Agent逐张闭环

用户结果：用户点击开始后，Agent 在真实小红书中提出一张候选并结束本轮。用户保存或跳过后，main
启动新 generation 继续寻找下一张；同一 Agent 会话保持连续展示。

工程任务：

1. 增加最小图片调研 MCP：读取冻结任务、提交主进程签发的 `observationId`、报告本轮终态；
2. Agent 工具只允许明确账号打开、Browser观察/导航和图片调研命令；不含 shell、任意文件写、
   Cookie、evaluate、网络日志或拦截；
3. `propose` 在 WebAffair mutation queue 原子持久化候选和 `awaiting-decision`；
4. propose 成功后本轮 Agent Run 与 BrowserTask 正常结束，不保留内存等待 Promise；
5. 用户决定和保存完成后，main 才签发下一 generation；未决定时不能继续导航；
6. App重启后可以先处理候选，再创建新 Run；决定不依赖旧 Runtime；
7. 登录、验证码、风控、账号不明和未知页面进入人工接管，交还后重新观察。

V3 验收：

- 真实完成“提出 → 跳过 → 新 generation → 再提出 → 保存 → 新 generation 继续”；
- Agent 候选、网页图片、候选预览和来源页是同一对象；
- Agent/BrowserTask/Tab/CDP 任一中断后不假运行；
- 旧 Agent 迟到候选、迟到终态和重复工具调用不修改当前状态；
- 链接过期只从同一来源和图片序号重新观察，不抓当前页其他图片。

### V4：单账号目标与分类统计

用户结果：已有基础计数上增加动作归类和地点分布；任务达到目标数量后停止，提前结束显示样本不足。

工程任务：

1. 保存动作原始值和用户确认的规范化动作，用户修改后可重算；
2. 候选展示前尽可能计算受限预览指纹；签名 URL 只进入 main-owned 短期 locator；跳过后清理像素；
3. 已保存图片以 SHA-256 在当前 Affair 内去重；不同搜索词命中同一内容只计一次；
4. 如果没有预览字节，界面明确只保证同一来源页/图片序号不立即重复；
5. 统计只计 `ledger-committed` 文件；外部删除或修改显示 `missing/changed`，不篡改历史事实；
6. 达到目标后不再产生 Browser 动作；主动结束保存现有统计。

多账号顺序执行和 CSV/JSON/Markdown 导出移到 V0 之后。

### R1：故障矩阵与真实交付

用户结果：用户可以在真实小红书和真实目录中完成最终十步验收，失败时能继续或得到明确终态。

必须完成：

1. 自动化故障注入覆盖候选 CAS、目录 capability、全部保存阶段、旧 generation 和启动对账；
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
- `src/main/browser/browser-manager.ts`：navigation generation、可信 observation 和 Session 获取边界；
- `src/main/fs/`、`src/main/ipc/dialog-ipc.ts`：一次消费的目录写 capability；
- Activity、Sidebar、WorkbenchContent、Tab Store：最小任务入口与恢复；
- AgentPanel：完整 Affair binding 和候选卡；
- Browser原生菜单/人工提交入口：必须覆盖真实 E0 证明的图片表示方式；
- runtime registry、preload 和 shared IPC inventory：成对注册、校验和释放。

`image-research` 保持独立 reducer。文件 journal 只解决跨文件提交阶段；不得保存第二份候选、决定、
计数或任务终态。

## 6. 必测门禁

### 自动化证据

- 新 Schema/migration 保留 generic、article-publishing 和全部历史；损坏、超限和降级 fail-closed；
- 一次最多一个候选；旧 generation、旧账号、旧页面、重复工具和迟到事件均 no-op；
- App启动对账 `preparing/searching/awaiting-decision/saving`，无 BrowserTask 时不恢复成运行中；
- `directory-write` 覆盖过期、重复消费、跨renderer、任务错配和 symlink 替换；
- 保存故障覆盖批准、临时写入、嗅探、哈希、rename、账本前后、`ENOSPC/EACCES/EEXIST`、redirect、
  HTML伪装、超限、链接过期和重复点击；
- Agent只使用 main-issued observation，工具 allowlist 不含任意文件、网络、Cookie 或 evaluate；
- Agent Panel、工作空间切换、Tab切换和窗口重建不串任务；
- IPC、事件 producer/consumer/disposer 进入现有 inventory 和 AST 门禁；
- 文章发布、普通事务、Browser、Agent Panel 和文件能力回归、受影响 Electron smoke、`pnpm verify` 全绿。

### 真实小红书证据

- 已保存账号真实登录，扫码、验证码和风控由真人处理；
- 执行前网页实际账号与任务账号一致；
- 搜索列表、详情、轮播、图片表示方式、来源页和图片序号已记录；
- 自动候选和不依赖同一失败条件的人工候选各通过一次；
- 网页图片、预览、来源和“在网页中查看”是同一张；
- 跳过不落盘且不立即重复，保存只产生一个文件和一次计数；
- 重复点击、旧卡、旧 Agent、三个保存崩溃窗口不重复文件；
- Agent、BrowserTask、Tab、CDP 中断各一次后安全收敛；
- 链接过期、目录删除、只读和磁盘满有可执行恢复；
- 达到目标后无新 Browser 动作，统计只计真实成功文件；
- 开始前显示研究用途/权利未知，来源记录保留创作者、图片序号和取得方式。

## 7. 止损与不得扩张

- E0 未通过，不施工 V1；
- V1 单图人工闭环未通过，不抽象多平台；
- V2 公共 Runtime 未通过，不接 Agent循环；
- 不建设服务器、云同步、多账号并发、隐藏浏览器、批量采集或全局去重；
- 不把通用工具确认当成持久候选决定；
- 不让 Agent 自报 URL、身份或保存成功；
- 连续60分钟没有用户可验收增量，停止横向重构并回到当前最短闭环；
- 同一小红书自动路径连续失败两次，切换人工降级并汇报，不调延时掩盖失败。

## 8. 当前最短主线

```text
E0 真实小红书证据 + 四项契约
→ V1 单账号单图人工闭环
→ V2 公共 WebAffair Runtime 身份
→ V3 Agent提出一张后结束，用户决定后新代次继续
→ V4 单账号目标与分类统计
→ R1 故障矩阵和真人验收
```
