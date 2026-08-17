# Git 状态与提交推送

> 状态：G1-G3、统一操作窗口与“已有 upstream 的显式 Push”已通过自动化真实 App smoke；G4 远程关联/Fetch、G5 收敛待完成
>
> 最后更新：2026-08-17
>
> 开发计划：`docs/features/git-source-control-development-plan.md`
>
> 现有能力：`docs/features/manual-git-backup.md`

## 1. 结论

CCLink Studio 把当前本地工作空间的 Git 状态放在左下角状态栏，而不是新增一个长期占用
Activity Bar 的一级面板。状态栏只展示最常用的分支、变更数量和已知行数变化；点击后向上
展开小型 Git 状态浮层。浮层只负责事实摘要和入口，变更/Diff、提交与 Push 统一进入一个
尺寸稳定的 Git 操作窗口。

现有状态栏中的常驻“Agent 就绪”和活跃 Tab 类型（例如“编辑器”）删除：正常 Agent 状态
没有持续决策价值，异常应在 Agent 面板中显示；活跃 Tab 类型与顶部 Tab 重复。工作空间切换
进度和“本地 · 工作空间名”继续保留。

目标状态栏示例：

```text
⑂ main   ● 25  +1420 -196   本地 · cclink-studio
```

Git 浮层示例：

```text
Git

变更                    25  +1420 -196
仓库                    cclink-studio
分支                    main
上游                    origin/main · 本机已知同步

[提交或推送]
```

这不是完整 Git 客户端。首版只形成“看见状态和 Diff → 明确选择并提交 → 显式 Push”的本地
纵向闭环，不做自动 Pull、Merge、Rebase、Force Push、冲突解决器或分支管理器。

## 2. 用户端到端验收目标

产品目标必须通过以下真人动作验收：

1. 用户在 Studio 打开一个根目录本身就是 Git 仓库的本地工作空间。
2. 左下角立即显示当前分支、去重后的变更文件数和可计算的增删行数。
3. 用户点击 Git 状态，小浮层显示仓库、分支、上游、变更摘要和操作入口。
4. 用户点击“变更”或“提交…”，小浮层关闭，统一 Git 操作窗口打开。
5. 用户在同一窗口看到 staged、unstaged、untracked、conflicted 分组与只读 Diff，选择本次
   文件、填写提交信息，并明确选择“提交”“提交并推送”或“推送已有提交”。
6. 提交成功后状态重新对账；存在上游且本地领先时，主操作变为“推送”。
7. 用户显式点击 Push，成功后 ahead 归零；失败时本地提交保持存在且错误可复制。
8. 切换工作空间后只显示目标工作空间的 Git 状态，旧异步结果不得覆盖新工作空间。
9. 非 Git、本机无 Git、远程工作空间、仓库根位于工作空间外、detached HEAD、冲突和远程
   分叉都有明确降级，且不影响文件、Agent、浏览器、Terminal 和其他本地能力。

只有上述真实 App 闭环和工程门禁同时通过，才能宣称 Git 状态、提交或 Push 对应阶段完成。

## 3. 当前能力与目标能力

### 3.1 用户现在能做什么

- 在本地 Git 根工作空间的左下角看到分支、去重变更文件数和已知增删行数。
- 点击 Git 状态打开向上浮层，查看仓库、分支、upstream 和本机已知 ahead/behind，并手动刷新。
- 从“变更”查看 staged、unstaged、untracked、conflicted 分组，并打开有大小/行数上限的只读
  Diff；二进制、冲突和超限内容明确降级。
- 状态摘要与写操作分层：小浮层只看事实，统一 Git 操作窗口承载变更、Diff、提交和 Push。
- 点关闭或按 Esc 会直接关闭窗口并清理本次提交草稿；刷新后状态变化会停止写操作并要求接受
  最新状态，切换工作空间也会清理旧项目草稿。
- 保留已有 staged 内容，明确勾选要加入的完整 unstaged/untracked 文件，填写正常提交信息并
  commit；文件较多时可以一键全选或取消全选，提交不会自动 Push。
- 对已经配置 upstream、且本机已知未 behind 的当前分支显式 Push；Push 前重新验证 HEAD，
  不使用 force、delete 或任意 refspec。
- 在统一窗口明确选择“提交并推送”，或者只 Push 已有本地提交；两阶段 Push 失败时保留已经
  成功的本地提交并给出持续结果。
- 切换工作空间时丢弃迟到的旧 Git 快照；非 Git、远程或父仓库子目录不显示可操作 Git 状态。
- 状态栏不再常驻显示“Agent 就绪”和活跃 Tab 类型（例如“编辑器”）。
- 状态栏右侧旧“备份到 Git”按钮已移除；G5 完成前侧栏兼容建仓入口仍保留。
- 配置单个 GitHub 账号和 Token。
- 对当前本地工作空间执行现有“备份到 Git”。
- 首次备份时填写完整 HTTPS/SSH 地址，或按名称创建 GitHub 私有仓库。
- 由现有备份流程执行敏感路径预检、`git add --all`、自动提交和非强制 Push。

### 3.2 用户现在还不能做什么

- 从新 Git 入口初始化仓库、填写远程地址、创建 GitHub 私有仓库或设置首次 upstream。
- 在新入口显式 Fetch 并把 ahead/behind 标记为远程最新事实。
- 在 Studio 内执行 Pull、Merge、Rebase、分支管理或冲突解决。
- 完成旧侧栏备份卡片和兼容状态 owner 的 G5 收敛。

现有手动备份文档仍描述 G5 前保留的兼容建仓能力。新入口已经形成“查看 → Diff → 选择 →
commit → 已配置 upstream Push”的纵向闭环，但远程关联、显式 Fetch 和旧入口收敛尚未完成，
不得把当前阶段写成统一 Git 首版全部交付。

## 4. 信息架构

### 4.1 状态栏左侧

目标顺序：

```text
Git 分支与状态 | 当前工作空间 | 浏览器 URL（仅浏览器 Tab）
```

规则：

- 删除常驻 Agent 状态和活跃 Tab 类型。
- 工作空间切换中继续显示有界的切换状态。
- 当前本地工作空间可安全解析为 Git 仓库时显示 Git 段。
- 非 Git 工作空间默认不显示 Git 段，不用“未启用 Git”长期占据状态栏；“初始化 Git”和
  “创建 GitHub 私有备份”保留为工作空间 Context Action 和命令入口，初始化成功后再出现
  Git 状态。
- Git 缺失或仓库暂时不可读时，只有用户打开 Git 设置、执行相关命令或触发相关操作时显示
  可操作错误。
- 旧状态栏“备份到 Git”按钮最终删除，不能与新 Git 状态并列形成两套入口。

### 4.2 Git 状态浮层

Git 状态段可通过鼠标、Enter 或 Space 打开浮层。浮层至少包含：

- 变更：去重文件数、已知增删行数；点击后关闭浮层并打开统一 Git 操作窗口。
- 仓库：仓库根目录名；悬停可见脱敏后的本地路径。
- 分支：当前分支、unborn 或 detached 状态。
- 上游：remote/branch、ahead/behind 和远程状态更新时间。
- 主操作：根据当前状态显示“提交…”“推送”“提交或推送”或禁用原因；点击后进入统一窗口，
  浮层本身不承载提交表单或 Push 进度。
- 次级操作：刷新、复制 Git 诊断；未配置远程时提供“关联远程仓库”。

浮层关闭后不持久化临时选择或错误正文。再次打开时从主进程重新取得事实快照。浮层外部点击
可以关闭浮层，但不能关闭已经打开的 Git 操作窗口或丢弃提交草稿。

### 4.3 统一 Git 操作窗口

统一窗口是一次 Git 决策的人工确认边界，使用 portal/顶层 overlay 呈现，不受状态栏锚点和
小浮层尺寸约束。窗口至少包含：

- 顶部：只读仓库、分支、upstream 和本机已知 ahead/behind；首版不把分支做成可切换下拉。
- “变更”区域：分组文件清单与有界只读 Diff。
- “提交与推送”区域：提交信息、已有 staged 内容、可选择的完整文件和动作按钮。
- 动作：`提交`、条件满足时的 `提交并推送`，以及本地已有 ahead 时的 `推送已有提交`。
- 结果：持续显示成功、失败和两阶段部分成功，不只依赖短时 toast。

窗口背景点击不关闭。Esc/关闭按钮直接关闭并清理本次提交信息和文件选择，不追加二次确认；
Commit 或 Push 执行期间禁止关闭。工作空间切换不能把旧草稿提交到新工作空间；过期 snapshot
必须停止动作并要求用户接受最新状态。

“提交并推送”是明确选择的两阶段事务。Commit 成功、Push 失败时，窗口必须显示“本地提交已
保留”，允许重新 Push，不能把两步压成一个含糊失败。

### 4.4 变更清单与 Diff

变更按以下顺序分组：

1. 冲突 `conflicted`
2. 已暂存 `staged`
3. 未暂存 `unstaged`
4. 未跟踪 `untracked`

同一路径同时有 staged 和 unstaged 内容时必须在两个分组中分别表达，不能用一个含糊状态
覆盖部分暂存事实。重命名显示旧路径和新路径；二进制、大文件、子模块和无法解码的文件
显示元数据及降级说明，不把空白 Diff 伪装成“没有变化”。

首版只支持整文件选择，不做行级或 hunk 级暂存。Diff 默认只读，不能从 Diff 视图直接丢弃
文件修改。

## 5. 状态语义

### 5.1 仓库识别与权限边界

- 首版只对本地工作空间启用 Git。
- 只有工作空间解析后的真实根路径与 `git rev-parse --show-toplevel` 返回的仓库根相等时，
  才允许 stage、commit、remote 配置和 Push。
- 如果仓库根是工作空间的父目录，提示“请打开 Git 仓库根目录”，不得借 Git 命令读取或
  修改工作空间边界外的文件。
- 工作空间包含嵌套 Git 仓库时，首版不自动发现或批量管理；只有工作空间根仓库生效。
- 远程工作空间不复用本地 Git IPC。未来若需要，必须由远程 Agent 声明独立能力并重新设计
  权限、协议和状态所有权。

### 5.2 变更计数

- 文件数是 staged、unstaged、untracked、conflicted 路径去重后的数量。
- 增删行数分别汇总 working tree Diff 和 staged Diff 中 Git 能可靠计算的文本行变化。
- 二进制、无法解析的大文件和未计入行数的 untracked 文件仍计入文件数。
- UI 必须把行数称为“已知增删行数”，不能暗示它覆盖所有二进制或未跟踪内容。
- 状态快照必须使用机器可解析的 `-z`/porcelain 输出，不解析本地化的人类文本。

### 5.3 分支和远程状态

- `branch`、`HEAD`、upstream 和 ahead/behind 来自主进程同一次有界仓库快照。
- ahead/behind 默认只代表本机已知 upstream ref，可能落后于真实远程。
- 只有一次显式 Fetch 成功后，才可以显示“刚刚从远程刷新”；离线或 Fetch 失败必须保留
  上一次本地事实并标明刷新失败。
- 打开浮层不默认发起网络请求，避免状态栏成为持续后台联网和凭证提示入口。
- 没有 upstream 时显示“未设置上游”，不得显示“已同步”。

## 6. “提交或推送”状态机

| 当前状态                           | 主操作与结果                                |
| ---------------------------------- | ------------------------------------------- |
| 有冲突                             | 禁用提交和 Push，显示冲突文件数             |
| detached HEAD                      | 禁用快捷提交和 Push，提示先在 Terminal 处理 |
| 有 staged/unstaged/untracked 变更  | 显示“提交…”并打开统一 Git 操作窗口          |
| 工作区干净且本地 ahead > 0         | 显示“推送”                                  |
| 有变更且本地已有未 Push 提交       | 显示“提交或推送”，进入后分别提供提交和 Push |
| 工作区干净且 ahead = 0、behind = 0 | 显示“没有待提交或推送内容”                  |
| 没有 remote/upstream               | 允许本地提交，Push 区域显示“关联远程仓库”   |
| behind > 0 且 ahead = 0            | 不自动 Pull；提示远程有新提交               |
| ahead > 0 且 behind > 0            | 禁止快捷 Push；提示历史已分叉并保留本地提交 |
| Git 缺失、仓库不可读或写操作进行中 | 禁用相关动作并显示稳定错误                  |

“提交或推送”是状态入口，不是一次点击后暗中执行多步写操作的按钮。提交和 Push 都必须让用户
知道即将发生的动作；不会在提交成功后默认自动 Push，除非用户在确认面板中明确选择“提交并
推送”。

## 7. 提交流程

统一 Git 操作窗口的提交区域至少展示：

- 提交信息输入框。
- staged、unstaged 和 untracked 文件分组。
- 本次将提交的文件数和可计算行数。
- “提交”、可选“提交并推送”和“推送已有提交”按钮。

规则：

- 正常源码管理提交使用仓库或用户现有 Git identity；缺失时停止并提示配置，不借用
  `CCLink Studio Backup <backup@cclink.local>` 身份。
- 已有 staged 内容是用户意图，不能被刷新、取消对话框或失败流程静默清空。
- 首版允许按完整路径选择 unstaged/untracked 文件；不得用 Shell 字符串拼接路径。
- “全选”只批量改变可提交完整文件的显式选择，不改写已有 staged 列表；再次点击“取消全选”
  回到零选择，之后仍可逐文件调整。
- 同一文件存在部分 staged 内容时，默认只提交已有 staged 内容；把未暂存部分一起加入必须
  明确选择。“全选”本身属于显式整批选择，界面必须保留“部分暂存”标记，让用户知道该文件
  的未暂存部分也会被加入。
- 空提交默认禁止；提交信息为空时不能提交。
- 提交前继续执行现有敏感路径检查。发现敏感候选时阻止提交，不提供“忽略并继续”。
- 提交失败后重新读取 Git 事实，不用 renderer 猜测 index 或 HEAD 是否变化。

首版不提供“丢弃全部”“恢复文件”或 `reset --hard`。未来增加任何丢弃操作都必须独立确认
精确路径，并优先提供可恢复方案。

## 8. Push 与远程关联

- Push 只由用户显式触发。
- 首版只 Push 当前 HEAD 到明确显示的 upstream/目标分支，不 Force Push、不删除远程 ref。
- 没有 remote 时可以输入完整 HTTPS/SSH 地址，或复用现有 GitHub 账号按名称创建私有仓库。
- GitHub HTTPS 可以复用统一 `CredentialService` 中的 `git:github` Token 和受控
  `GIT_ASKPASS`；SSH 继续使用用户本机 SSH Agent，不读取或托管私钥。
- 认证、离线、non-fast-forward、远程分叉或大文件拒绝时保留本地提交，返回脱敏错误。
- Push 成功后重新读取 HEAD、upstream 和 ahead/behind；不能只把 renderer 数字减一。
- Pull、Merge、Rebase、冲突解决和 Force Push 留给 Terminal，首版只给出可复制诊断。

## 9. 与现有手动备份的收敛关系

现有 `GitBackupService`、GitHub 建仓、凭证和受控 Git 执行代码可以复用，但不能继续作为新增
源码管理状态的第二事实源。

目标收敛方式：

- 新增主进程 `GitWorkspaceService`，拥有仓库识别、状态快照、Diff、stage、commit、remote
  和 Push 操作事实。
- `GitBackupService` 只保留“按工作空间名创建 GitHub 私有仓库”、凭证解析和兼容迁移编排，
  通过 `GitWorkspaceService` 执行 Git 操作。
- renderer 只保留一个 Git 状态投影；旧 `git-backup-store` 不得和新 Git store 各自轮询同一
  仓库。
- 旧状态栏“备份到 Git”和“网站与账号”中的 GitHub 备份卡片在新闭环完成后删除。
- 非 Git 工作空间仍可通过工作空间 Context Action 或命令面板触发“初始化 Git”与“创建
  GitHub 私有备份”，不能因删除旧卡片丢失现有建仓能力。
- GitHub 账号、Token 管理和既有工作空间远程绑定继续兼容，不强迫用户重新配置。
- 旧“一键备份当前全部变更”若保留，只能作为提交确认面板中的简化模式，必须展示文件清单
  和动作摘要，不能绕过新安全规则。

## 10. 状态所有权、生命周期与 IPC

### 10.1 唯一状态所有者

| 状态                             | 唯一事实源                                  |
| -------------------------------- | ------------------------------------------- |
| 仓库根、HEAD、分支、index、变更  | 本机 Git，由 `GitWorkspaceService` 有界读取 |
| 正在执行的 Git 操作和最后错误    | `GitWorkspaceService`                       |
| GitHub Token                     | `CredentialService`                         |
| GitHub 账号                      | `SettingsService`                           |
| 工作空间远程绑定兼容数据         | Git 领域持久化组件，由 Git 服务协调         |
| 浮层开关                         | renderer 组件，可丢弃                       |
| 操作窗口、临时选择和提交信息草稿 | renderer Git store，按工作空间隔离          |

renderer 不能持久化 Git 运行事实，也不能通过文件监听推断 commit 或 Push 是否成功。

### 10.2 生命周期

- Git 服务作为可选主进程能力注册；Git 缺失或单仓库失败只降级 Git。
- 工作空间切换后，renderer 以 generation/workspace key 丢弃过期结果。
- 第一版采用显式刷新、窗口重新聚焦和受 Git 操作驱动的对账，不新增全目录文件监听器。
- 同一仓库同一时刻只允许一个写操作；读快照可以合并和取消过期请求。
- 窗口重建后从主进程和真实 Git 仓库重新 hydrate，不恢复“正在提交”假状态。
- 操作窗口背景点击不关闭；Esc/关闭按钮直接关闭并清理草稿，写操作执行中禁止关闭。
- 工作空间切换时操作窗口不得把旧 workspace/revision 的草稿投射到新项目。

### 10.3 IPC 与命令

- Git API 必须进入 shared typed contract 和运行时 parser，main/preload 不重复维护通道名。
- renderer 只能传工作空间引用、预期 revision/HEAD、精确路径和有界文本。
- main 必须重新解析工作空间、仓库根和路径边界，不能信任 renderer 快照。
- 刷新、打开变更、提交、Push、复制诊断等用户操作注册为统一命令；右键动作接入 Context
  Action System，不新增独立菜单实现。

## 11. 失败降级与诊断

至少区分：

- `GIT_NOT_FOUND`
- `NOT_A_REPOSITORY`
- `REPOSITORY_OUTSIDE_WORKSPACE`
- `REPOSITORY_BUSY`
- `STALE_REPOSITORY_STATE`
- `IDENTITY_NOT_CONFIGURED`
- `MERGE_CONFLICT`
- `DETACHED_HEAD`
- `REMOTE_NOT_CONFIGURED`
- `AUTHENTICATION_FAILED`
- `REMOTE_CONFLICT`
- `NETWORK_ERROR`
- `SENSITIVE_FILES`
- `GIT_COMMAND_FAILED`

诊断可包含工作空间引用、仓库根摘要、HEAD、分支、upstream、ahead/behind、变更计数、操作
阶段、退出码和脱敏 stderr。诊断不得包含 Token、Authorization Header、带凭证 URL、文件
正文、Diff 正文、提交信息草稿或 SSH 私钥路径内容。

## 12. 明确不做

首版不做：

- 自动 Commit、自动 Push、退出时同步或定时同步。
- 自动 Pull、Merge、Rebase、Cherry-pick、Reset 或 Force Push。
- 分支创建、切换、删除和图形提交历史。
- PR 状态、比较分支、代码评审和 GitHub Issues。
- 行级/hunk 级暂存、冲突编辑器和 blame。
- Git LFS、子模块和嵌套仓库管理器。
- 远程工作空间 Git、CCLink 云 Git 或 CCLink 账号与 GitHub 绑定。
- 工作空间根之外的仓库写入。

## 13. /grilling

结论：左下角应成为 Git 状态事实入口，不应只是把原来的“一键备份”从右侧搬到左侧。

最容易被误判的假设是“当前分支显示出来就代表远程状态准确”。没有成功 Fetch 时，ahead/
behind 只是本机已知 ref；UI 必须诚实表达更新时间，不能把缓存状态包装成网络事实。

最危险的失败路径是提交界面为了简单再次执行无预览 `git add --all`，或在工作空间位于更大
仓库子目录时越界提交父目录内容。提交文件清单、已有 staged 意图、仓库根边界和敏感路径
检查都是第一版门槛。

Agent 正常状态和“编辑器”标签可以删除，但 Agent 连接失败不能因此变成不可诊断；异常仍需
在 Agent 面板、toast 和统一诊断中可见。

当前最该补齐的失败验证是 Commit 成功/Push 失败的部分成功路径。统一操作窗口关闭保持单步，
不为可重新填写的临时草稿增加二次确认。完成后再补齐 G4 的显式 Fetch、远程关联和真实
HTTPS/SSH 失败验收；旧建仓入口不能重新成为 Git 状态事实源。
