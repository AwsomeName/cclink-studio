# 项目同步效果稿

日期：2026-11-24。状态：用户已确认公司记录和账目也要同步，其余方向待确认；未实现。设计说明与评估见[项目同步产品设计](../../features/project-sync-product-design.md)。数据、账号与设备名为示意。

打开 [sync.html](sync.html)，顶部黄色条逐步演示。URL 参数：`?view=home|setup|running|synced|settings|text|record|binary|deleted|clone|cloned|unlocked|git`、`&theme=light|dark`、`&clean=1`（隐藏演示条）。

| 截图                                       | 内容                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| [home.png](home.png)                       | 公司项目未设置同步：首页卡片与状态栏                     |
| [setup.png](setup.png)                     | 设置同步：同步到哪里、第一次会上传什么（四栏）、同步密码 |
| [running.png](running.png)                 | 首次同步：新建仓库、检查、加密公司记录、上传、核对       |
| [synced.png](synced.png)                   | 日常：上次收到的文件、客户记录和流水，下次时间（浅色）   |
| [settings.png](settings.png)               | 同步位置：仓库、同步密码、最近几次、同步范围             |
| [conflict-text.png](conflict-text.png)     | 文字冲突：两份原文 + 告诉 AI 怎么处理                    |
| [conflict-record.png](conflict-record.png) | 客户记录冲突：按字段并排，人选一份，不交给 AI            |
| [conflict-binary.png](conflict-binary.png) | 表格冲突：选一份或两份都留                               |
| [deleted.png](deleted.png)                 | 另一台电脑大量删除时先暂停                               |
| [clone.png](clone.png)                     | 第二台电脑：从 GitHub 下载项目                           |
| [cloned-company.png](cloned-company.png)   | 下载后的公司首页：输入同步密码解锁公司记录               |
| [unlocked.png](unlocked.png)               | 解锁后：待办与收支和原电脑一致                           |
| [code-project.png](code-project.png)       | 代码项目：由 Git 管理，不自动同步                        |
| [setup-narrow.png](setup-narrow.png)       | 375 宽                                                   |

[verification.json](verification.json)：14 个画面均无横向溢出和脚本错误；交互检查覆盖“不同步时保存不可用”“保存并同步 → 已同步”“未填处理意见或未选记录时继续同步不可用”“输入同步密码 → 已读入公司记录”。只证明效果稿可演示。
