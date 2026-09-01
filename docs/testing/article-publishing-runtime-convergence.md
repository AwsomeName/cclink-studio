# 文章发布中断恢复测试清单

状态：工程测试清单
日期：2026-09-01

## 自动测试

- 新任务使用 schema v7 保存并重载；
- v1-v6 文章发布任务在加载时删除，通用 WebAffair 保留；
- 旧文章任务不会从 `.bak` 或旧 recovery journal 回流；
- 同账号 recovery lease 只能有一个 owner；
- 草稿核验成功后 recovery lease 原子转交 BrowserTask；
- 账号、draftId、标题或保存状态不符时不启动 Agent；
- Runtime 代次、Tab、WebContents 或 Playwright Page 身份不符时拒绝写入；
- 已完成 checkpoint 和已上传图片在恢复时不倒退；
- `result-unknown` 上传在人工确认前不能重放；
- 人工确认“图片存在”后状态为 `uploaded`；确认“图片缺失”后允许新上传尝试；
- 发布动作派发后结果未知时只能查文章管理页，不能再次发布；
- 公开文章 ID 与草稿 ID 不同，但账号和唯一标题一致时可确认发布；
- 多个同名草稿或公开文章时停止自动选择。

## 真实 CSDN 验收矩阵

每组都要在正式 Electron `WebContentsView`、真实登录账号和可见网页中执行：

| 中断点 | 重启后的预期 |
| --- | --- |
| 尚未打开编辑器 | 从第一步开始 |
| 已打开并取得 draftId | 从草稿箱重新打开原草稿 |
| 正文填写中 | 已完成步骤不倒退，从未完成步骤继续 |
| 图片上传前 | 继续上传 |
| 图片上传后、读回前 | 停止并显示人工“存在/缺失”选择 |
| CSDN 更换图片 URL | 已确认图片保持完成；未决图片由用户目视确认 |
| 保存草稿派发后 | 先读回同账号、同草稿和保存状态，不直接重放 |
| 发布点击后、结果未读回 | 只查文章管理页，不再次点击发布 |
| Studio 完全退出后重启 | 使用持久状态和草稿箱恢复，不依赖旧 Tab/URL |

## 人工图片确认

1. Studio 显示具体文件名和 Markdown 引用位置。
2. 用户在旁边可见的 CSDN 编辑器中查看对应图片。
3. 用户点击“网页里有这张图”或“网页里没有，重新上传”。
4. 用户不复制、不粘贴、不填写任何图片地址。
5. 继续任务后观察已确认图片被跳过，缺失图片只上传一次。

## 诊断证据

失败报告至少包含：affairId、attemptId、executionGeneration、launchOperationId、账号 ID、draftId、当前步骤、资产 ID、sideEffect key、Tab ID、WebContents ID、Playwright connection/page generation、当前 URL、页面保存状态和 recovery lease owner。

自动测试通过只代表工程门禁。只有上述真实 CSDN 矩阵通过，才可声明产品闭环完成。
