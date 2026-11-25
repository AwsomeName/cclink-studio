# ADR 0026：普通项目与公司数据跨电脑同步到 GitHub 私有仓库

- 状态：accepted（2026-11-25 用户确认设计并要求实现）
- 日期：2026-11-25，Asia/Shanghai
- 产品设计：[项目同步产品设计](../features/project-sync-product-design.md)、[效果稿](../design/project-sync-2026-11-24/README.md)
- 关联：[ADR 0003](0003-plaintext-local-credentials.md)（本机凭证文件）、[ADR 0024](0024-personal-company-space-bindings.md)、[ADR 0025](0025-company-decision-records.md)

## 问题

我的空间已有自动双向同步，但普通项目只有一次性单向的手动 Git 备份。公司记录和账目在 `.cclink-studio/` 下的 SQLite 中，现有规则一律禁止进入 Git，且整份二进制文件无法跨电脑合并。此前约束“客户数据只留本机”。

## 决策

1. **同步引擎只有一个**：`GitWorkspaceService.transfer` 新增 `action: 'project-sync'`，与 `diary-sync` 共用 `syncScoped`（原 `syncDiary`），只是同步范围不同。分叉在临时 worktree 合并，主分支只快进，不强推，上传后用 `ls-remote` 核对。
2. **准入**：只对本机项目开放，且文件夹不是 Git 仓库，或是由项目同步建立 / 下载的仓库（本机 `WorkspaceStateService` 段 `project-sync` 有记录）。代码项目继续用左下角 Git；我的空间继续用 `diary-sync`。
3. **只用 GitHub 私有仓库**（2026-11-24 用户决定）：只接受 `https://github.com/<owner>/<repo>(.git)`。设置时、每轮上传前，用已保存的 GitHub 账号查询仓库可见性；不是私有或查不到即暂停，不上传也不接收。
4. **凭证**：沿用设置中已保存的 GitHub 用户名与 Token（`CredentialService`，本机明文文件，`GIT_ASKPASS` 传递），不新增同步密码，不使用系统钥匙串。
5. **范围**：整个项目，减去：单个超过 50 MB 的文件；`findSensitiveFiles` 命中的密钥与凭证文件；`node_modules/`、常见构建输出、`.DS_Store`；`.cclink-studio/` 下除项目设置、共享定时任务和公司同步副本以外的全部内容。被跳过的文件写入 `.git/info/exclude` 的受管块，每轮重算，并在界面列出。已被跟踪的文件变成敏感或超限时暂停。
6. **删除保护**：一轮收到超过 20 个删除时暂停，用户选择“照做”或“不删除，重新上传”。
7. **冲突**：Markdown 等文本冲突沿用 AI 按用户反馈合并；其他文件由用户选“这台的 / 另一台的 / 两份都留”，两份都留时另一份另存为带“（另一台 月-日）”后缀的文件。
8. **公司数据**：`CompanyWorkspaceService`、`CompanyAccountsService` 仍是唯一事实源。每轮同步前把记录导出到 `.cclink-studio/shared/company/`（一条记录一个 JSON，原件按哈希），同步后在一个数据库事务中读入；读入失败整轮回滚、暂停，本机数据不变。同一条记录两边都改时逐条由用户选择，不交给 AI。账目按 `source_key` 与原件哈希去重。副本记录公司 ID 与格式版本，不匹配即暂停。副本不加密；加密留作以后的可选设置。
9. **触发**：进入项目、留在前台每个整点、手动。只同步当前激活的项目。

## 不变量

- 同步失败、离线、未保存 GitHub 账号或仓库变公开时，项目文件、公司首页、账目、Agent、浏览器、终端照常可用。
- 不强推，不改写历史；本机未上传的提交不会被覆盖。
- SQLite 文件、Agent 会话、网站登录、Token、`project.json` 身份永远不进入 Git。
- 同步副本不是第二个事实源：界面只读数据库，副本只用于导出与读入。

## 取代与影响

- 取代“客户数据只留本机”的约束：开启同步后客户与账目记录以明文存于用户自己的 GitHub 私有仓库。客户与售后页的隐私文案在公司数据同步上线的同一版本改为如实说明。
- 客户个人信息因此存放于 GitHub 境外服务器，是否告知客户由用户决定。
- 手动 Git 备份暂时保留；已开启项目同步的项目不再显示手动备份入口。

## 备选方案

- 每个项目复制一套同步器：第二个同步状态所有者，不采用。
- 直接同步 SQLite 文件：两台电脑都写时只能整份覆盖，会静默丢记录，不采用。
- 加密公司副本并要求同步密码：只防 GitHub 侧暴露，代价是每台电脑解锁、忘记即不可恢复；用户 2026-11-24 决定暂不做。

## 验证

`src/main/git/project-sync.test.ts` 用真实 Git 和本地裸仓库模拟两台电脑；公司数据另有导出、读入、冲突、去重、回滚的服务单测。真人验收见 [项目同步验收](../testing/project-sync.md)，用真实 GitHub 私有仓库和第二台 Mac。
