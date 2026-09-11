# Markdown 文章平台发布开发计划

状态：由逐步可观测执行协议修复方案接管
最后更新：2026-09-09

本功能早期计划曾收敛到 [article-publishing-restart-recovery-development-plan.md](article-publishing-restart-recovery-development-plan.md)。2026-09-07 的真实故障证明粗 checkpoint 和长 Agent Prompt 仍形成两个黑盒；当前施工事实源改为
[article-publishing-observable-execution-development-plan.md](article-publishing-observable-execution-development-plan.md)。本文只保留历史阶段顺序，不再用于判断闭环完成。

## 当前增量：掘金三图实际发布

同一文章发布 Tab 已支持选择掘金，当前要求已有原稿 ID，沿用账号 Profile 和 WebAffair。指定三图文章完成实际上传、正文与保存回读、一次提交及公开页逐图核验；重启后只读核验收口，没有重发。
自动新建草稿、平台字段实际修改分支及全部细步骤观测尚未全部验收，具体辅助确认、两项历史观测残余和真实截图见 [掘金验收记录](../testing/article-publishing-juejin-2026-09-09.md)。

## 当前增量：知乎图文纵向验收

复用文章发布 Tab、WebAffair、长 Agent Run 和 Runtime handshake；创建时选择 CSDN 或知乎，一个任务一个平台。
本轮目标是用户指定三图稿实际提交知乎，同时细步骤跟随真实派发与回读变化。没有新增调度框架、第二状态所有者、哈希或旧数据迁移。
已跑通的动作、辅助确认及尚未覆盖的入口见 [知乎图文验收](../testing/article-publishing-zhihu-2026-09-08.md)。
工程测试通过不代替该文档的真人验收记录。

## 阶段 1：最小 CSDN 纵向闭环

- 选择 Markdown 和账号；
- 创建持久任务；
- 打开可见 Browser Tab 和专属 Agent；
- 记录 draftId；
- 填正文、上传图片、填字段、保存草稿、发布、核验公开 URL；
- 所有成功状态必须来自真实网页回读或明确人工确认。

## 阶段 2：中断恢复

- 单一 WebAffair 状态所有者；
- execution generation 和 Runtime identity；
- 账号级 recovery lease；
- 从草稿箱按原 draftId 找回；
- 已完成步骤不倒退；
- 未决上传/保存/发布不重放；
- 图片 URL 变化走人工“存在/缺失”，用户不填地址；
- 发布结果未知按账号和唯一标题查管理页。

## 阶段 3：旧数据切断

- schema v7；
- v1-v6 文章发布任务从主文件、备份和旧恢复日志删除；
- 不做旧文章状态迁移；
- 通用 WebAffair 不受影响。

## 阶段 4：真实 CSDN 验收

- 正常发布一篇含多图文章；
- 在每个网页写入点强制中断并重启；
- 验证从草稿箱找回同一草稿；
- 验证 CSDN 更换图片 URL；
- 验证同名草稿和同名公开文章；
- 验证发布点击后连接中断；
- 留存脱敏日志和最终公开 URL。

只有阶段 4 全部通过，才可声明产品能力完成。阶段 1-3 和自动测试通过只属于工程准备度。
