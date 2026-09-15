# 第189天知乎图文验收（进行中）

用户已明确要求继续其他平台。本轮从既定第二站知乎继续，保留小红书第189天任务的自动核验缺口；不修改旧任务，不重复小红书发布。

## 用户验收动作与完成标准

在 Studio 使用 `AIR/2026-09-10/小红书软文.md` 原文和三张原图，选择登记知乎账号，核验当前身份和本篇查重。由 Studio Agent 准备唯一标题草稿，再通过正式文章发布任务上传三图、填写正文、保存、单次提交及公开全文/逐图核验。执行计划的实际动作与失败恢复独立验收；第188天的结果不能代替本篇。

## 边界

- 状态唯一所有者仍为 WebAffair；不手改持久化状态。
- 最终提交必须由 Studio 的正式授权事务完成，Codex 不手工点击网站最终发送。
- 保留源文和三图，本文不扩写技术能力，不作额外版权声明。
- 每个平台单独查重与核验。若账号/验证码阻塞保留明确原因，不重登或重复提交。
- 当前工程基线 0.1.88，保留所有既有未提交修改；本轮不提交、推送或发版。

## 当前事实

Studio 准备会话通过 web_account_open 打开登记知乎账号 `81f36309-c843-49b2-8de9-e283cfd51b37`，Tab `tab-1-1789311311415`。实际页面为 `https://www.zhihu.com/people/zhidfc1e`，昵称深芯智造，看到本人历史文章与草稿入口。准备会话仅授权账号核验、查重和标题草稿；尚无本篇提交证据。

## 2026-09-13 23:15 续接结果

- 账号跨域阻塞已修复：普通账号任务精确允许 `https://www.zhihu.com` 与 `https://zhuanlan.zhihu.com`，不放宽到其他子域、HTTP 或额外端口。相关 7 项测试、类型检查与 ESLint 通过；已在开发应用加载，Agent 实际完成跨域标题草稿操作。
- Studio Agent 创建且在草稿箱重新核验了本篇唯一标题草稿：`2082605515683657119`，编辑地址 `https://zhuanlan.zhihu.com/p/2082605515683657119/edit`。三图与正文尚未写入。证据：`artifacts/article-zhihu-day189-20260913/title-draft.png`。
- 正式 WebAffair：`2d2ae772-425b-4f89-91f6-4b525ae431e5`。已绑定本篇源文、三图、知乎账号及上述原稿；当前 `draft`、generation 0、无 Attempt。两次启动均在 Runtime 获取前被旧小红书任务全局互斥拦截，未提交知乎，也未创建第二篇知乎草稿。
- 根因：`acquireArticlePublishingAttempt` 将所有 `waiting-human` 一律视作全局 Browser/Agent 执行占用。旧小红书第189天任务实际所有当前代 Runtime bindings 都已 terminal，但状态仍等待自动公开核验。
- 修复限定：只有不同账号、当前 Attempt 为 waiting-human、execution 无活跃 Run 引用、当前代 agent-run/browser-task 均有结束证据且所有绑定 terminal 时，才不阻挡另一账号启动。同账号仍互斥，preparing/running/checking-runtime 仍全局互斥，证据不全时仍拒绝。没有修改旧任务持久化数据、结果状态或重复发布保护。
- 工程验证：文章发布状态文件全部 117 项测试通过，包含跨账号等待任务让路、同账号仍阻挡、运行中跨账号仍阻挡、原任务保持原样及另一个任务启动后禁止旧任务并发恢复；`pnpm typecheck` 和受影响文件 ESLint 通过。
- 最后尝试读取真实 Studio 界面时，Computer Use 返回电脑锁屏且无法自动解锁。互斥修复尚未通过重启加载；保留当前应用与任务现场，等待解锁后从同一正式知乎任务继续。不得将测试通过或标题草稿保存计作知乎发布成功。

## 下一次直接续接

解锁后先读取 Studio，确认无活跃运行和草稿已保存，再用官方开发重启脚本加载互斥修复。打开上述正式知乎 WebAffair，使用“开始执行”；不要新建任务或标题草稿。由正式 Studio Agent 完成正文、三图、平台字段、保存及提交，再分别取执行计划与平台公开全文/三图证据。

## 2026-09-13 23:35 真实闭环完成

解锁后确认原会话空闲、草稿已保存，官方重启脚本加载互斥修复（开发 PID 74098）。在原正式任务使用“开始执行”，没有新建事务或草稿。

- 同一 Attempt `ce09b3c2-918a-4f82-9f87-c8a9912a5307`，generation 1；三次图片上传、一次冻结正文写入及一次网站发布点击均由 Studio Agent/有界能力完成。
- 23:33 平台显示“发布成功”，公开地址：`https://zhuanlan.zhihu.com/p/2082605515683657119`。账号深芯智造/zhidfc1e，ID 与原草稿相同。
- 23:35 WebAffair execution/publication 均为 published，Attempt succeeded，8 个主检查点全部 completed；3 个 upload-asset、1 个 save-draft、1 个 publish 副作用均 verified。
- 正文按现行规范化比对为 416 字符，bodyMatchesFrozen=true；8 个原标签保留，三图顺序/位置匹配。公开图 URL 使用对应 v2 图片 hash，三图加载；人工实际页面再次核对全文、封面、陪伴设计效果图及暂停观察真机图。
- 执行计划验收：实际 Agent UI 显示上传、正文、字段、自动保存、提交与公开核验的动作推进、重试与完成。最终计划已取图；其中连接中断仅重试状态回报，证据过期先重新 inspect，缺少 verifying 的完成回报被拒后补齐合法状态顺序。这些恢复未触发重复上传或第二次发布。
- 本次观察到 Agent 状态顺序误用和冗长返回导致额外回报与上下文膨胀；不妨碍本篇闭环，但仍属于效率/稳定性残余问题，不能声称所有平台已稳定。

证据目录 `artifacts/article-zhihu-day189-20260913/`：`publish-success.png`、`public-body.png`、`public-images.png`、`plan-completed.png` 与只读导出的 `final-affair.json`。用户可打开上述公开链接核对全文三图，再在 Studio 文章发布侧栏选择第189天知乎任务检查计划。
