# Markdown 文章平台发布

状态：CSDN 工程闭环已实现，真实平台验收待完成
最后更新：2026-09-01

## 产品结果

用户在 Studio 的“文章发布”入口选择工作空间内的 Markdown、CSDN 账号和发布字段，保存为持久任务并启动。Studio 打开绑定账号的可见 Browser Tab 和专属 Agent，按固定步骤填写正文、上传图片、保存草稿、发布并核验结果。

关闭 Tab、Agent 中断或 Studio 重启后，任务仍是同一个 WebAffair/Attempt。继续时必须先进入原账号草稿箱找到原 draftId，再从未完成步骤继续，不能使用失效旧 URL 猜页面，也不能静默新建文章。

完整恢复规则见 [article-publishing-restart-recovery.md](article-publishing-restart-recovery.md)，开发与验收状态见 [article-publishing-restart-recovery-development-plan.md](article-publishing-restart-recovery-development-plan.md)。

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

尚未完成的是新版代码在真实 CSDN 账号上的完整中断矩阵验收。因此当前只能称为工程闭环，不能称为真实站点稳定闭环。
