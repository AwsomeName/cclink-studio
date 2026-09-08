# 执行计划细化：2026-09-08 实施与真实验收

后续用户指定三图文章的执行与平台审核结果见 [三图验收记录](article-publishing-images-2026-09-08.md)。以下保留此前无图验收的事实与当时边界。

本记录对应尚未获得公开发布授权的第一阶段。用户随后授权的实际提交与结果核验已经完成，当前最终结果见 [公开发布闭环记录](article-publishing-public-closure-2026-09-08.md)。

用户现在能展开业务细步骤，看到谁做什么、进入条件、实际证据、完成条件、等待/失败原因和允许的下一步。
正文、同稿恢复、摘要及保存已在真实 Electron/CSDN 跑通；多图、复杂平台字段、完整故障矩阵及公开发布尚未实测。

## 范围与事实源

- 基线 HEAD：`3ccda35f733ab4efb86baabc48189f9098f3a332`，版本 `0.1.87`，以保留原有修改的工作区运行。
- 没有提交、发版、旧数据迁移、新 operation 账本、claim/report MCP、短 Run 调度或内容/图片/证据哈希。
- WebAffair 是唯一进度所有者。细项最新结果折叠在现有 `checkpoints[].details`，真实编排、Browser 工具派发及适配器回读提交结果。
- UI 不把粗 checkpoint、Agent 自述、时间流逝或工具返回当成正文/图片/保存/发布核验成功。
- 完成的业务记录保留；当前现场复核失败另列。代次/launch/current callback 不符及取消后的观测拒绝提交。

## 细项与真实入口

| 用户可见动作 | 执行入口与证据 |
| --- | --- |
| 解析账号/Profile、取得 Tab、打开新编辑器 | ArticlePublishingService 的真实资源解析与导航 |
| 新稿标题、建稿短正文、首次保存、锚点核验 | 既有 Browser MCP / initial-draft 副作用及保存响应、管理页复核 |
| 管理页找原稿、原账号、唯一 draftId、打开及四项复核 | CsdnDraftRecoveryCoordinator；打开完成必须在 editor probe 确认原 ID 后记录 |
| Runtime 绑定、当前页面、正文区域 | 既有 Runtime handshake 和 inspect；具体 Task/View/Page、selector/iframe、账号/ID/标题/保存状态 |
| 每张本地图片检查、上传、核验 | 既有资产状态、上传副作用和页面对应图片/人工确认；展示路径、资产 ID、正文位置 |
| 正文写入与正文回读 | Browser MCP completeMutation 与实际正文/服务端保存回读 |
| 标题、摘要、标签、分类、封面读取/写入/核验 | 受支持唯一控件、冻结字段对比；已配置但不可读取的字段等待处理 |
| 保存派发、保存核验 | 保存/自动保存副作用与原账号、draftId、标题、明确 saved；自动保存已确认时不强制重复点击 |
| 发布前复核、发布派发、发布结果核验 | 既有一次性授权、Browser 返回与可信 publication 完成入口；未知只核验 |

## 真实任务与操作

- 平台账号：`csdn:weixin_36388257`；Studio 账号：`ff3592e8-517a-443d-a674-58105f7bc06b`。
- 复用已有登录/Profile，没有重新登录。
- 标题：`Studio 细步骤验收 20260908-1227`。
- 本地测试稿：`/Users/apple/Desktop/chat-cc/cclink-promotion/studio-plan-acceptance-20260908.md`，无图片，明确禁止公开发布。
- Affair：`bacb22f0-bee5-404a-86f7-8efc5827c116`；Attempt：`e45b8588-20e4-47e0-a88e-4e52abde83c9`。
- 原稿 ID：`164598985`。

测试驱动通过真实 renderer 的既有 createTask API 建任务，通过产品按钮启动、打开计划、分离网页和终止。
按钮部分使用 Computer Use，部分使用 Playwright 执行按钮事件；没有手改 WebAffair 状态或注入成功数据。
执行器为真实本地 Agent，网页为真实 CSDN Electron WebContentsView。

时间为北京时间：

1. **12:27，G1**：实际标题/短正文填入，首次保存返回 `164598985`，随后从管理页核验。切回计划导致 View 隐藏，后续 inspect 被原有可见性保护拒绝。保留保护，补具体原因并增加复用既有分离窗口命令的“网页独立窗口”入口。
2. **12:34，G2**：重启后从管理页找回同一账号、同一 draftId；账号/ID/标题/saved 分别通过。独立网页窗口保持可见。
3. **12:35:15**：真实完整正文填写工具返回；UI 显示写入完成，但核验仍在等待。正文回读为 202 字符，保存状态 unknown，未标成功。
4. **12:36:27**：实际编辑器与平台草稿读回一致、saved，正文核验完成。
5. **12:39，G3**：再次重启，仍为同一 Attempt/原稿；正文完成记录和证据保留，从剩余字段继续。G2 临近重启的摘要副作用先对账，不盲目重放。
6. **12:40:27–12:41:31**：摘要真实填写返回，随后回读与冻结摘要一致。
7. **12:42:38**：保存 checkpoint 由可信适配器确认；显式保存按钮无需重复点击。
8. **发布前停止**：现存终止 Runtime 入口取消任务。最终前六个 checkpoint 完成，publish / verify-publication pending，无 publish 副作用，publication 未开始。测试期间另有仅允许草稿保存请求的测试侧保护，无公开发布请求被观察到；结束后清理。
9. 最终代码重新启动 Electron，取消状态及上述真实证据保持。最终适配器代码另在同一真实页面只读运行：原账号、原 ID、正文 202 字符、标题、摘要、saved 均读到。最后补充的即时字段回读和具体拒绝动作诊断经自动测试；没有重新运行一整条新发布任务。

## 界面证据

截图均来自真实 Electron，不是 mock 或静态页面。

- [写入已返回、正文保存核验仍等待](../../artifacts/article-plan-20260908/03-body-verifying.png)，[当时主进程事实](../../artifacts/article-plan-20260908/03-body-verifying.json)。此为开发中截图；当时未补充的“下一步”兜底文案已在最终版修正。
- [正文回读已保存](../../artifacts/article-plan-20260908/04-body-saved.png)。
- [最终版重启后的保存核验及未发布状态](../../artifacts/article-plan-20260908/07-final-electron-save.png)。
- [最终主进程快照](../../artifacts/article-plan-20260908/05-final-state.json)。
- [最终适配器真实只读结果](../../artifacts/article-plan-20260908/06-final-adapter-readonly.json)。

真人复核已有结果：启动 Studio → 打开 `cclink-promotion` 工作空间 → 文章发布 → 选择上述标题 → 展开“填写完整正文/核验正文/核验摘要/核验保存结果”。应看到原 draftId、具体回读和证据时间；发布仍无执行证据，任务已终止不能再派发。
若要重跑变化过程，需要另建只用于草稿的测试任务，保留网页可见，在公开发布前使用终止入口；当前应用没有单独的“仅草稿”执行模式，不能无人值守放任其走到发布。

## 工程检查与未通过项

- 11 个受影响测试文件，207 个测试通过：文章发布 service/policy/adapter/recovery/integration、WebAffair 状态、Browser/WebAffair MCP、Playwright 派发、执行计划 UI helper。
- TypeScript node/web、受影响 ESLint、Prettier 与 `git diff --check` 通过。
- 未执行全量 `pnpm verify`；本次以相关测试和上述真实 Electron 运行验证改动。
- 多图上传、图片人工对账、已配置标签/分类/封面复杂控件未在真实站点验收。适配器无法可靠读取时会卡在具体字段，不伪造成功。
- 完整取消/页面改代/失败/未知发布矩阵只有针对性自动门禁，不能声明所有真实故障场景已通过。
- 未公开发布，也没有核验真实公开 URL。若继续验收发布，必须另行明确授权上述账号、具体文章和单次公开提交；当前测试稿明确禁止发布。
