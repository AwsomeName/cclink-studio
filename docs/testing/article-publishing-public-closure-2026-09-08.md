# CSDN 自动提交及结果核验：真实闭环

后续用户指定三图文章的执行与平台审核结果见 [三图验收记录](article-publishing-images-2026-09-08.md)。以下保留此前无图验收的事实与当时边界。

2026-09-08，用户明确授权将草稿 164598985 改为可公开的验收文章，并完成一次提交与结果核验。

结论：这篇无图文章已经完成真实闭环。Studio 持久状态为 published，Attempt 为 succeeded，八个业务 checkpoint 全部 completed，唯一 publish/final 副作用为 verified。未登录访问返回 HTTP 200，标题与三个正文小节均匹配。

- 公开文章：https://blog.csdn.net/weixin_36388257/article/details/164598985
- 标题：Studio 细步骤验收 20260908-1227
- 平台账号：csdn:weixin_36388257
- 最终 Affair：d58c5fab-9f6a-42bb-bae7-8d3dc4008414
- Attempt：dd2ef462-e933-43ae-9d98-a39441bde48f
- 发布派发：北京时间 13:30:20；平台返回“发布成功！正在审核中”。
- 最终持久核验完成：北京时间 13:42:09。公开页面已可匿名访问，并非只看成功页或保存草稿。

## 实际路径

1. 旧任务已终止、旧内容冻结。通过新增的“按当前文件修订原稿”入口重新冻结可公开正文、摘要和标签，保留旧记录；新修订只能绑定同工作空间、同账号同标题且不存在未知动作或发布记录的原稿。禁止创建冲突的并行修订。
2. main 从管理页找回 164598985，核验原账号、标题、编号和保存状态。没有重新登录，没有重新建平台草稿。
3. Studio Agent 自动填写正文、摘要与“软件测试”标签。标签路径为打开控件→填写冻结值→在唯一输入框 Enter→回读文章字段；搜索框文字不算标签完成。实际正文回读为 395 字符。
4. Agent 点击保存，实际回读 saved 后派发一次发布。成功页返回原稿对应的公开文章链接。
5. 首次运行把旧 manual-only 恢复策略误解为必须人工确认，未自动收尾。修正只读核验指令和后续任务策略，并通过产品“核验发布结果”入口继续同一个 Attempt。
6. 真实管理页的公开链接文字是“浏览”，标题位于同一文章行的专用标题节点；已按该行及文章编号关联。导航后的页面外壳先于异步列表出现，现有有界只读等待同时覆盖列表和公开文章标题就绪。
7. 第 4 代 Runtime 只读打开真实公开页面，两次 inspect 核对账号、标题和 URL。Agent 通过既有 checkpoint 与 web_affair_finish_attempt 回报；WebAffair 完成状态转换并对账原发布副作用。没有再次保存、编辑或发布。

## 界面与事实证据

- [真实正文写入后等待保存](../../artifacts/article-plan-20260908/08-public-revision-body-verifying.png)
- [真实标签核验](../../artifacts/article-plan-20260908/09-real-tag-verified.png)
- [CSDN 提交成功页](../../artifacts/article-plan-20260908/10-csdn-submission-result.png)
- [真实管理页解析结果](../../artifacts/article-plan-20260908/11-published-management-probe.json)
- [最终 published/succeeded 主进程快照](../../artifacts/article-plan-20260908/12-published-final-affair.json)
- [真实公开文章](../../artifacts/article-plan-20260908/13-public-article.png)
- [未登录公开访问结果](../../artifacts/article-plan-20260908/14-anonymous-public-check.json)
- [最终版重启后的执行计划](../../artifacts/article-plan-20260908/15-final-published-plan.png)

真人复核：打开 Studio 的 cclink-promotion 工作空间→文章发布→选择已发布的同名任务→展开“核验平台公开结果”；应看到公开 URL、匹配证据和已发布状态。再在未登录浏览器打开上方公开链接，应读到标题与正文。

## 工程验证与边界

12 个受影响测试文件、225 个测试通过，包含实际可见 inspect 应计入已有 BrowserTask 操作记录、隐藏页面不计入、冻结标签提交、修订隔离、取消已中断运行、列表延迟加载及未知发布不重放。node/web 类型检查、受影响 lint、格式与 diff 检查通过；没有运行全量 verify。

最终只读 Agent Run 曾被通用 BrowserTask 门禁误报“没有可验证操作”：领域 inspect 当时没有计入已有 BrowserTask 日志。已补真实、当前、可见且通过校验的 inspect 记录，保留原门禁及历史错误消息，没有手改已发生的运行历史。此最后补丁通过自动测试；实际发布成功和 WebAffair 收尾发生在该提示修复之前。

本次为无图文章，未验证多图上传、复杂分类/封面和所有站点异常场景。没有提交代码、发版或修改云服务/Agent 项目。
