# 微博由 Studio Agent 执行：真实准备验收与提交缺口

## 用户功能进度

用户可以在文章发布 Tab 选择“微博图文”、已有账号、目标 UID 和 Markdown，启动 Studio Agent 处理正文和图片。当前已验收的是准备及细计划；尚未验收 Studio 的实际微博提交闭环。

- 源稿：`/Users/apple/Desktop/研发日记/2026-09-09/小红书软文.md`
- 标题：做AI眼镜第188天，它开始看懂我的世界。
- 账号：新浪 / 深芯智造，UID 5961101548。
- 任务：`d5fd5ffd-2247-4f57-828a-902bd4da42d4`。
- Attempt：`3972ecd1-432d-46d9-9b7e-c9b27d081ef8`。
- 本次只准备：`composer.allowPublish=false`。这篇文章已在11:47被 Codex 人工发布，本次没有再次发送。

## 真人复核动作及已观察结果

1. 在 Studio 文章发布侧栏打开这条微博任务。配置显示无平台草稿编号、微博临时编辑现场。
2. 打开执行计划。34项细动作区分 Studio 核验与 Agent 写入，每张图片单列。账号/Profile、Tab、Runtime、真实 UID、上传控件、正文区域都有实际证据。
3. 查看第一张图片的上传及核验。早期 selector 不符导致派发前拒绝，文件没有上传。修复后在同一 Attempt 续跑，仅主进程确认无已派发记录、完整图库仍缺图才允许第一次实际上传，旧账号步骤保留完成。
4. 查看三张图片。01首篇封面、02导航场景、03城市漫游均已由 Studio Agent 上传，主进程逐次观察唯一新增且加载成功的微博图片后确认。
5. 打开网页。正文424字符（平台计数399）、三张图集可见；主进程核验冻结全文与逐图一致。Codex 本轮仅操作 Studio 的配置、启动及查看界面，没有直接填写平台或上传图片。
6. 发布检查仍等待，实际发送步骤未派发，公开结果未验收。此处不以准备成功充当发布成功。

真实截图：

- `artifacts/article-weibo-agent-20260911/upload-preflight-blocked.jpeg`
- `artifacts/article-weibo-agent-20260911/fine-plan-blocked.jpeg`：派发前失败具体卡点。
- `artifacts/article-weibo-agent-20260911/studio-prepared.jpeg`：Studio Agent 填写的正文及三张图片。
- `artifacts/article-weibo-agent-20260911/fine-plan-prepared.jpeg`：真实细步骤，首图上传与主进程回读分开。
- `artifacts/article-weibo-agent-20260911/body-and-gallery-verified.jpeg`：正文及三图核验完成。

截图中收尾后的“已中断”和管理页恢复通用提示是本次观察到的缺陷。源码已修复：已交接为 waiting-human 且租约结束的 Agent/Browser 终态事件不再覆盖卡点；微博不再建议从不存在的管理页草稿恢复。修改后的这两个行为只有针对性测试，未重新跑 Electron 终态验收；旧持久状态未迁移。

## 工程准备度与尚未验收

沿用 current operation、transition、长 Agent Run、Runtime handshake 和既有副作用保护。WebAffair 拥有细步骤状态，UI只读。没有新增 operation 账本、claim/report MCP、短 Run 调度、内容/图片哈希或数据迁移。

提交代码已接到现有 MCP 浏览器动作派发链路：新建时明确选择单次提交；准备模式在策略及 owner 两层禁止提交；点击前重新核验 UID、全文、逐图、公开设置及 Runtime；仅与冻结正文和逐图平台标识完全匹配的本次请求可提供回执。回执只记录作品地址，不能直接宣称发布。公开页作者、作品 ID、全文和逐图仍须通过；超时、不匹配或页面丢失保留未知，不重复发送。

自动化测试覆盖未授权、错误账号、过期代次、未派发回执、错误正文/图集、无关响应、重复请求、上传阶段不启动提交观察器、交接卡点不被收尾覆盖，以及原有平台保护。TypeScript、针对性 ESLint 已通过。五个主线测试文件170项通过；最后补充显式提交选项及收尾断言后三文件142项通过，Playwright三平台相关测试另已通过。

**未完成：** 新提交链路没有真实微博请求验收；公开页适配没有本次实际发布结果验收；准备页丢失不能自动恢复。当前没有重启应用以免丢失已准备的临时现场，后加的提交代码与收尾修复尚未加载到当前主进程。收到新稿后需重启开发应用加载，再从正常 Studio 入口执行完整提交及恢复验收。不能把自动测试通过写成发布完成。
