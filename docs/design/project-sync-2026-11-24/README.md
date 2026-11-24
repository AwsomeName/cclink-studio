# 项目同步效果稿

日期：2026-11-24。状态：**待用户确认方向**，未实现。设计说明与评估见[项目同步产品设计](../../features/project-sync-product-design.md)。数据、账号与设备名为示意。

打开 [sync.html](sync.html)，顶部黄色条逐步演示。URL 参数：`?view=home|setup|running|synced|settings|text|binary|deleted|clone|cloned|git`、`&theme=light|dark`、`&clean=1`（隐藏演示条）。

| 截图                                       | 内容                                            |
| ------------------------------------------ | ----------------------------------------------- |
| [home.png](home.png)                       | 公司项目未设置同步：首页卡片与状态栏            |
| [setup.png](setup.png)                     | 设置同步：同步到哪里 + 第一次会上传什么（三栏） |
| [running.png](running.png)                 | 首次同步的真实步骤与进度                        |
| [synced.png](synced.png)                   | 日常：已同步、上次收发内容、下次时间（浅色）    |
| [conflict-text.png](conflict-text.png)     | 文字冲突：两份原文 + 告诉 AI 怎么处理           |
| [conflict-binary.png](conflict-binary.png) | 表格冲突：选一份或两份都留                      |
| [deleted.png](deleted.png)                 | 另一台电脑大量删除时先暂停                      |
| [clone.png](clone.png)                     | 第二台电脑：从 GitHub 下载项目                  |
| [cloned-company.png](cloned-company.png)   | 下载后的公司首页：公司记录在原电脑              |
| [code-project.png](code-project.png)       | 代码项目：由 Git 管理，不自动同步               |
| [setup-narrow.png](setup-narrow.png)       | 375 宽                                          |

[verification.json](verification.json)：11 个画面均无横向溢出和脚本错误；交互检查覆盖“不同步时保存按钮不可用”“保存并同步 → 已同步”“未填处理意见时继续同步不可用”。只证明效果稿可演示。
