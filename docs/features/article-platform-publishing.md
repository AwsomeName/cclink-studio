# Markdown 文章平台发布

状态：无图文章公开闭环已完成；用户指定三图文章已自动提交并逐图核验，但 CSDN 审核未通过，不能声明已公开
最后更新：2026-09-08

## 产品结果

用户在 Studio 的“文章发布”入口选择工作空间内的 Markdown、CSDN 账号和发布字段，保存为持久任务并启动。Studio 打开绑定账号的可见 Browser Tab 和专属 Agent，按固定步骤填写正文、上传图片、保存草稿、发布并核验结果。

关闭 Tab、Agent 中断或 Studio 重启后，任务仍是同一个 WebAffair/Attempt。继续时必须先进入原账号草稿箱找到原 draftId，再从未完成步骤继续，不能使用失效旧 URL 猜页面，也不能静默新建文章。

完整恢复规则见 [article-publishing-restart-recovery.md](article-publishing-restart-recovery.md)，开发与验收状态见 [article-publishing-restart-recovery-development-plan.md](article-publishing-restart-recovery-development-plan.md)。

执行计划现在将原有 8 个业务 checkpoint 展开为由真实执行驱动的细项，展示条件、动作、回读、失败原因和下一步；
checkpoint 继续承担原有执行门禁。完整要求见
[article-publishing-observable-execution-protocol.md](article-publishing-observable-execution-protocol.md)，
施工事实源见
[article-publishing-observable-execution-development-plan.md](article-publishing-observable-execution-development-plan.md)。

## 用户入口

- Activity Bar：文章发布；
- Sidebar：按状态显示当前工作空间的发布历史；
- 专用 Tab：新建配置、已保存配置、图片状态、步骤状态、Runtime 操作和恢复入口；
- Browser Tab：Agent 唯一可写的可见网页现场；
- Agent Panel：当前 Attempt 的执行者和过程记录。

## 核心边界

- `WebAffairService` 是发布状态唯一所有者；
- `ArticlePublishingService` 只做发布编排和 Runtime 生命周期；
- `CsdnPublishingAdapter` 只识别当前网页事实与唯一控件；
- `BrowserTaskRuntime` 管理账号租约、recovery lease 和 BrowserTask；
- renderer 不直接修改业务状态或网页；
- Agent 不能读取 Cookie、Token、密码或验证码，不能使用隐藏页面；
- 法律/版权声明、验证码、扫码、人脸、付款、账号权限和未知页面必须转人工。

## 持久状态

发布任务记录：

- Markdown 路径、大小、修改时间；
- Studio 账号 ID、网站 ID 和真实 CSDN 账号；
- 标题、摘要、标签、分类和封面资产 ID；
- 图片资产 ID、来源路径、正文位置、上传状态、平台 URL 和人工确认结果；
- 固定 checkpoints；
- 上传、保存、发布的 side-effect key 与状态；
- Attempt、执行代次、Runtime 绑定；
- draftId、当前草稿 URL、标题和保存核验时间；
- 发布状态与公开 URL。

正文和图片的完成度由步骤状态、资产状态和真实网页回读决定，不使用内容指纹作为第二套真相。

## 失败与恢复

- 源 Markdown 或本地图片的大小/修改时间变化：停止旧任务，要求按当前文件新建；
- 账号、draftId、标题或保存状态不一致：停止写入；
- 图片 URL 变化：已完成图片不倒退；未决图片让用户目视选择“存在/缺失”，不填写 URL；
- 上传或保存结果未知：先核对，不直接重放；
- 发布结果未知：只查文章管理页，不再次发布；
- 多个同名公开文章：人工选择；
- Runtime 身份变化：旧写入许可立即失效。

## 当前完成度

独立入口、持久任务、受控 Browser/Agent、草稿锚点、账号级恢复互斥、草稿箱找回、未决副作用防重放、图片人工确认、旧文章任务删除和自动测试已经落地。

业务细步骤事实由 WebAffair 持久拥有，账号/原稿、正文、逐图、平台字段、保存和发布都接入观测。
正文→重启恢复→摘要→保存已在真实 Electron/CSDN 运行，见
[2026-09-08 验收记录](../testing/article-publishing-plan-acceptance-2026-09-08.md)。
用户随后明确授权公开提交。同一原稿已完成自动正文、摘要、标签、保存、一次发布和公开结果核验，
见 [真实发布闭环记录](../testing/article-publishing-public-closure-2026-09-08.md)。
用户随后指定的三图文章已完成真实逐张上传、同稿中断恢复、格式化正文及位置核验、字段保存和一次自动提交；平台实际“审核未通过”，作者页可读、匿名 404，最后步骤显示平台卡点，未重发。见 [三图与审核结果验收](../testing/article-publishing-images-2026-09-08.md)。
复杂分类/封面和完整中断矩阵尚未真人验收；不能把单篇执行扩大为所有场景已通过。
