# Markdown 文章平台发布开发计划

状态：当前计划
最后更新：2026-09-01

本功能的主开发计划已经收敛到 [article-publishing-restart-recovery-development-plan.md](article-publishing-restart-recovery-development-plan.md)。本文只保留阶段顺序，避免维护两套冲突方案。

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
