# Git 状态与提交推送开发计划

> 状态：E0/G1-G3 与 G4 已配置 upstream Push 已通过自动化真实 App smoke；G4 剩余项、G5 与真人验收待完成
>
> 最后更新：2026-08-17
>
> 产品事实源：`docs/features/git-source-control.md`
>
> 当前兼容能力：`docs/features/manual-git-backup.md`
>
> 架构约束：`docs/architecture.md`

## 1. 计划结论

开发按四个用户可验收纵向闭环推进：

1. 用户在左下角看到真实 Git 状态，并能打开浮层。
2. 用户查看变更清单和只读 Diff。
3. 用户明确选择文件、填写信息并完成本地提交。
4. 用户关联远程并显式 Push，旧 Git 备份入口收敛到同一状态所有者。

shared contract、主进程 service、parser、store 和测试基建属于工程准备度，不能单独命名为
产品里程碑。每个阶段必须先执行真实 App 验收，再报告该阶段用户能力完成。

## 2. 当前基线

### 2.1 用户功能进度

- 本地 Git 根工作空间左下角已显示分支、去重变更数和已知增删行数，点击可打开 Git 浮层。
- 浮层已显示仓库、分支、upstream 和本机已知 ahead/behind，并支持刷新、Esc 和焦点恢复。
- 已可查看分组变更和有界只读 Diff，明确选择完整文件、填写信息并安全 commit。
- 已配置 upstream 的分支可显式 Push；有未提交变化时仍可单独 Push 已有本地提交。
- 状态栏已删除常驻 Agent 正常状态和活跃 Tab 类型；非 Git 或越界父仓库不显示 Git 段。
- 用户当前可以使用旧“备份到 Git”执行整工作空间提交和 Push。
- 状态栏右侧旧 Git 备份按钮已删除；“网站与账号”侧栏兼容建仓卡片仍待迁移。
- 新入口尚不能关联首次 remote/upstream 或显式 Fetch；这些仍需 Terminal 或兼容入口。
- 真实 GitHub HTTPS 和 SSH Agent 的现有备份人工验收仍未关闭。

因此 G1-G3 与配置好 upstream 的 Push 自动化真实 App 验收已通过，但尚缺最终提交 SHA 和
真人验收；G4 远程关联/Fetch 与 G5 收敛仍未完成。

### 2.2 工程准备度

- 已有受控 `execFile` Git 执行器、Git 检测、初始化、status、commit、remote 和 Push 基础代码。
- 已有 GitHub 私有建仓客户端、统一明文凭证、`GIT_ASKPASS` 和输出脱敏。
- 已有可信 renderer IPC guard、工作空间 realpath/稳定 ID 和 Git 备份自动化测试。
- 已新增 shared Git snapshot contract、`GitWorkspaceService`、可信 IPC、renderer generation guard
  和 porcelain v2/numstat parser；Git 状态由新 service 单一拥有。
- 新 service 已拥有 snapshot、Diff、commit 和已配置 upstream Push；写操作按仓库串行，使用
  expected revision/HEAD 并在成功或失败后读取真实 Git 重新对账。
- 旧 Git 备份 API 和状态在 G5 前兼容保留，GitHub 建仓/首次关联尚未迁入新 owner。
- 当前工作区存在其他正在进行的用户改动；实现时必须避免覆盖或混入无关修改。

## 3. 总体里程碑

| 类别     | 阶段 | 用户可见结果                                                 | 估算工作量 |
| -------- | ---- | ------------------------------------------------------------ | ---------- |
| 工程前置 | E0   | 无新增用户能力；冻结 contract、Git 命令语义和 fixture        | 1–2 人日   |
| 用户功能 | G1   | 左下角显示分支、变更数、行数；点击查看 Git 浮层              | 3–5 人日   |
| 用户功能 | G2   | 查看分组变更和只读 Diff，二进制/大文件有明确降级             | 3–5 人日   |
| 用户功能 | G3   | 选择完整文件、填写提交信息并安全完成本地 commit              | 4–6 人日   |
| 用户功能 | G4   | 显式 Fetch/Push、关联远程，认证和分叉失败可恢复              | 4–6 人日   |
| 收敛验收 | G5   | 旧备份入口移除、GitHub 建仓能力迁入、真实 HTTPS/SSH 验收关闭 | 3–5 人日   |

总计约 18–29 人日，按一名熟悉当前 Electron、Workspace、Context Action、凭证和 Git 备份代码
的工程师估算。真实远程、网络故障和 SSH/GitHub 人工验收等待时间不计入纯工程时间。

G1-G4 可以分别交付具体用户增量；只有 G5 完成且真人验收通过后，才能宣称统一 Git 首版完成。

## 4. 执行纪律

### 4.1 用户功能优先

- 每阶段编码前先在真实 Studio 中写出并执行对应验收动作。
- 连续开发超过 60 分钟仍没有新增可见用户能力时，停止扩张并执行偏航检查。
- 同一阻塞连续失败两次时触发止损，汇报替代路径，不继续深挖无用户增量的基础设施。
- 只完成 service、contract、mock 或测试时只能报告工程准备度，不能报告用户功能完成。
- G1 没有准确显示真实仓库状态时，不进入 commit；G3 没有保留 index 意图时，不进入 Push。

### 4.2 架构硬边界

- `GitWorkspaceService` 是仓库状态和 Git 操作的唯一主进程 owner。
- `GitBackupService` 降为 GitHub 建仓、凭证解析和兼容迁移编排，不维护第二份仓库状态。
- renderer store 只保存带 workspace key/revision 的可丢弃投影和表单草稿。
- 新 IPC 先进入 shared contract 和主进程运行时 parser，preload 不硬编码重复通道名。
- main 在每次写操作前重新验证 workspace realpath、Git root、HEAD/revision 和精确路径。
- Git root 位于工作空间外时禁止写操作；远程工作空间不进入本地 Git service。
- 同一仓库写操作串行化；完成或失败后必须从真实仓库重新对账。
- Git 右键与状态操作接入统一 Command/Context Action System。
- 不新增系统钥匙串、后台守护进程、自动同步或启动阻塞。

### 4.3 每个用户里程碑完成定义

1. 对应真人端到端验收全部通过。
2. 成功、空状态、失败、过期结果和能力降级都有用户可见结果。
3. 工作空间切换后没有跨工作空间 Git 状态或写操作。
4. 不引入第二状态 owner、生命周期分叉、重复 IPC 契约或权限扩张。
5. 受影响 service、contract、UI、store 和 smoke 测试通过。
6. `pnpm verify` 或受影响 smoke 通过。
7. 验收记录包含提交 SHA、真实动作、结果、失败注入和残余风险。

## 5. 目标模块与所有权

建议代码落点：

```text
src/shared/git/
├── git-types.ts
├── git-contract.ts
├── git-errors.ts
└── git-parsers.ts

src/main/git/
├── git-workspace-service.ts
├── git-status-reader.ts
├── git-diff-reader.ts
├── git-operation-queue.ts
├── git-diagnostics.ts
└── git-ipc.ts

src/main/git-backup/
├── git-backup-service.ts       # 兼容编排，不再拥有仓库状态
├── github-client.ts
└── git-backup-project-store.ts # 迁移期兼容绑定

src/preload/
└── git-api.ts

src/renderer/src/features/git/
├── git-store.ts
├── GitStatusBarItem.tsx
├── GitStatusPopover.tsx
├── GitChangesList.tsx
├── GitDiffView.tsx
├── GitCommitDialog.tsx
├── git-view-model.ts
└── git.css

docs/ops/
└── git-source-control-acceptance.md
```

最终文件可以按实现调整，但状态 owner、执行队列、GitHub 兼容编排和 renderer 投影不得混成
第二个巨型 `GitBackupService` 或 `StatusBar` 组件。

### 5.1 状态所有权

| 状态                       | 唯一事实源                       | renderer 行为             |
| -------------------------- | -------------------------------- | ------------------------- |
| repo root、HEAD、branch    | 本机 Git + `GitWorkspaceService` | 只展示                    |
| index、working tree、冲突  | 本机 Git + `GitWorkspaceService` | 只展示并发有界 command    |
| Diff                       | `GitWorkspaceService` 按需读取   | 短期缓存，可随时丢弃      |
| active Git operation       | `GitWorkspaceService`            | 展示 busy，不自行判断终态 |
| GitHub Token               | `CredentialService`              | 不读取明文                |
| GitHub username            | `SettingsService`                | 设置草稿                  |
| popover、选择、commit 草稿 | renderer `git-store`             | 可丢弃，不写入工作空间    |

## 6. E0：工程前置，不计产品进度

### 6.1 目标

冻结 Git snapshot、Diff、写操作 revision、错误和 fixture，避免 G1-G4 各自解析不同 Git 输出。

### 6.2 任务

- 盘点并复用 `GitExecutor`、`GitClient`、GitHub client、凭证和工作空间验证。
- 定义 shared `GitRepositorySnapshot`、`GitChangeEntry`、`GitDiffResult`、操作输入与错误码。
- 选定 porcelain v2 `-z`、numstat、raw diff、branch/upstream 和 ahead/behind 的机器格式。
- 定义 snapshot revision，至少固定 repo root、HEAD OID、index fingerprint 和 workspace key。
- 建立 fixture：clean、untracked、staged、同文件 staged+unstaged、rename、binary、conflict、
  detached、unborn、ahead、behind、diverged、parent repo、路径含空格和非 ASCII。
- 把 Git IPC 迁入 shared contract，保持旧备份 API 兼容，不在 E0 删除旧 UI。

### 6.3 工程退出条件

- parser 对所有 fixture 有确定输出，路径使用 NUL 分隔并覆盖特殊字符。
- root 越界、非法路径、超长 message 和过期 revision 在 main 拒绝。
- Git 不可用只返回 Git 能力降级，不影响 App runtime 启动。
- E0 完成时明确报告“无新增用户能力”。

## 7. G1：状态栏与 Git 浮层

### 7.1 用户验收动作

1. 打开一个真实 clean Git 仓库，左下角显示当前分支和 `0` 个变更。
2. 新建、修改、删除文件，重新聚焦 Studio 或点击刷新，数量和已知行数正确更新。
3. 点击状态段，浮层显示仓库、分支、upstream 和本机已知 ahead/behind。
4. 切换到另一个工作空间，旧仓库异步返回不能覆盖新状态。
5. 打开非 Git、远程工作空间和父目录仓库子文件夹，状态栏不伪装成可操作仓库。
6. 确认左下角不再显示常驻“Agent 就绪”和“编辑器”。

### 7.2 实现任务

- 实现只读 repository snapshot 和合并的刷新请求。
- 在 Status Bar 拆出独立 `GitStatusBarItem`，删除 Agent/active-tab 常驻项。
- 实现键盘可达、焦点可恢复的向上浮层。
- 变更时通过窗口 focus、显式 refresh 和 Git 写操作结果触发对账；首版不加全目录 watcher。
- 保留 Agent 面板内错误、toast 和诊断，删除状态栏不删除 Agent 故障语义。
- 为状态栏 Git item 注册复制状态和复制诊断 Context Action。

### 7.3 验证

- parser/service/store generation 单元测试。
- Status Bar/Popover 渲染、键盘、空状态和错误状态组件测试。
- Electron smoke 使用两个真实临时仓库验证切换和计数。
- 当前真实仓库人工对照 `git status` 与 `git diff --numstat`。

### 7.4 当前结果（2026-08-17）

- shared contract、parser、service、preload、renderer store、状态栏和浮层已落地。
- parser/service/store/Status Bar 测试已通过。
- Electron UI smoke 16/16 通过；真实当前仓库显示分支、变化和已知行数，浮层和
  Esc 关闭路径通过，且“Agent 就绪”“编辑器”不再出现。
- 尚未形成最终 commit SHA，也未由真人逐项执行 7.1 全部边界样本，因此记录为“G1 自动化
  真实 App 验收通过”，不提前声明 G1 最终关闭。

## 8. G2：变更清单与只读 Diff

### 8.1 用户验收动作

1. 点击“变更”，看到 conflicted、staged、unstaged、untracked 分组。
2. 同一文件同时 staged+unstaged 时在两组分别显示。
3. 点击文本文件看到对应工作区或 staged Diff。
4. 点击 rename、binary、大文件、删除文件和 untracked 文件得到正确 Diff 或明确降级。
5. 切换文件和工作空间时，迟到 Diff 不覆盖当前内容。

### 8.2 实现任务

- 实现按 change identity 获取 staged/unstaged/untracked Diff 的有界 API。
- 限制单 Diff 字节数、总行数和渲染时间；大文件返回结构化 truncation。
- 复用现有 Workbench Tab/预览容器，不为 Git 复制第二套 Tab 状态 owner。
- Diff 只读；不提供 discard/reset。
- 路径、状态图标、增删行数和 rename label 使用统一 view model。

### 8.3 验证

- 文本、CRLF、非 UTF-8、binary、rename、删除、untracked 和超限 fixture 测试。
- Diff IPC 越界、过期 revision 和工作空间切换测试。
- UI smoke 覆盖从左下角进入清单并打开真实 Diff。

### 8.4 当前结果（2026-08-17）

- staged/unstaged/untracked/conflicted 分组和 rename 旧路径已进入 snapshot；同一路径可以在
  staged 与 unstaged 两组分别出现。
- tracked Diff 使用有界 `git diff`，untracked 使用工作空间根内真实路径读取；二进制、冲突、
  越界、过期、4000 行或 256 KiB 上限均有结构化降级。
- Electron smoke 已从左下角进入真实变更清单并选择文件展示 Diff。

## 9. G3：可控本地提交

### 9.1 用户验收动作

1. 在包含 staged、unstaged 和 untracked 的仓库打开提交面板。
2. 看到本次提交文件清单、数量和提交信息输入框。
3. 保留已有 staged 内容，只选择指定完整文件加入本次提交。
4. 完成提交后 `git show --stat HEAD` 只包含用户确认的内容。
5. identity 缺失、敏感文件、过期状态、并发操作和 hook 失败时不伪称成功。
6. 取消或失败后已有 staged 意图仍然存在。

### 9.2 实现任务

- 实现 path-level stage/unstage 和 commit command，所有路径使用参数数组与 `--` 分隔。
- 写操作携带 expected revision；过期时要求刷新和重新确认。
- 检测部分 staged 文件，默认只提交 staged 部分，禁止“全选”暗中扩张。
- 正常 commit 使用用户 Git identity；缺失时提供可复制的配置提示。
- 复用并加强敏感文件检查；覆盖 staged blob 与新加入候选路径。
- 提交成功/失败后重新读取 snapshot，不由 renderer 乐观修改 HEAD 或计数。
- 同仓库写操作进入单一 operation queue，窗口关闭不启动新操作。
- 状态浮层只保留事实摘要；提交表单迁入统一 Git 操作窗口，不随浮层外部点击卸载。
- 操作窗口统一承载变更/Diff、提交、提交并推送和推送已有提交；不拆成多个连续弹窗。
- 提交草稿按 workspace/revision 隔离；脏草稿关闭需确认，写操作执行中禁止关闭。
- 两阶段结果必须区分“Commit 失败”“Commit 成功但 Push 失败”和“Commit/Push 全部成功”。

### 9.3 验证

- 真实临时仓库验证精确提交内容、partial staged 保留、空提交、hook 失败和并发拒绝。
- 敏感文件、Shell 注入路径、非 ASCII 路径和 stale revision 测试。
- Electron smoke 完成“查看 → 选择 → 填信息 → commit → 状态归零/更新”。

### 9.4 当前结果（2026-08-17）

- 提交表单保留已有 staged 内容；unstaged/untracked 默认不选，只有用户勾选的完整路径进入
  `git add -- <paths>`，partial staged 未勾选时只提交原 index 内容。
- 空信息、空 index、冲突、detached、过期 revision、敏感路径、缺失 identity 和并发操作会
  停止提交；不注入备份专用 identity，commit hook 正常执行。
- Electron smoke 在临时真实仓库中只提交 `tracked.txt`，确认未选择的 untracked 文件仍存在，
  且提交成功后未自动联网。
- 交互容器仍需从状态浮层内嵌表单迁移到统一 Git 操作窗口；迁移完成前，外部点击导致草稿
  卸载是已知产品缺口，不能视为最终交互关闭。

## 10. G4：Fetch、Push 与远程关联

### 10.1 用户验收动作

1. clean 且 ahead 的仓库显示“推送”，点击后远程收到当前提交。
2. 没有 remote 时可以填写完整 HTTPS/SSH 地址并建立明确 upstream。
3. 使用 GitHub 名称模式创建私有仓库并完成首次 Push。
4. 显式 Fetch 后显示刷新时间和真实 ahead/behind。
5. 认证失败、离线、non-fast-forward、behind、diverged 和大文件拒绝时本地提交仍存在。
6. 未选择“提交并推送”时，commit 成功后不自动联网。

### 10.2 实现任务

- 实现有界 Fetch/Push/remote/upstream command；禁止 force、delete 和任意 refspec。
- 复用 GitHub Token `GIT_ASKPASS` 和 SSH Agent，不向 renderer 暴露凭证。
- Fetch 只有显式操作触发；snapshot 记录本机 ref 与最后成功 Fetch 时间。
- Push 前再次验证 HEAD、branch、upstream、ahead/behind 和 operation revision。
- non-fast-forward、认证、网络和远程分叉返回稳定错误及脱敏诊断。
- “提交并推送”作为两阶段事务展示：commit 成功但 Push 失败时明确显示本地提交已保留。
- Push 进度和结果留在统一 Git 操作窗口，不只通过 toast 表达。

### 10.3 验证

- 本地 bare remote 覆盖 push、ahead、behind、diverged、non-fast-forward 和重试。
- HTTPS askpass、SSH fixture、Token/URL/stderr 脱敏测试。
- 真实 GitHub HTTPS 与真实 SSH Agent 人工验收，结果记录到 acceptance 文档。

### 10.4 当前结果（2026-08-17）

- 已完成配置好 upstream 的当前 HEAD 显式 Push；使用参数数组和固定
  `HEAD:refs/heads/<upstream branch>`，不提供 force、delete 或任意 refspec。
- GitHub HTTPS 可在 main 内复用现有 `GIT_ASKPASS` Token，SSH/本地 remote 继续交给用户环境；
  renderer 不读取凭证。
- Electron smoke 使用本地 bare remote 验证 commit 后 ahead=1、显式 Push 后 ahead=0、远端
  HEAD 等于确认的本地提交，且未提交文件不妨碍 Push 已有提交。
- 尚未实现显式 Fetch、首次 remote/upstream 关联和 GitHub 名称建仓迁移；真实 HTTPS、SSH、
  认证失败、离线和 non-fast-forward 人工验收也未关闭，因此 G4 仍是部分完成。

## 11. G5：旧备份收敛与完整验收

### 11.1 用户验收动作

1. Git 工作空间用户只从左下角 Git 入口完成“查看 → 提交 → 关联 GitHub → Push”。
2. 已配置旧 Git 备份的用户升级后继续识别账号、Token、remote 和最后绑定，不重复配置。
3. 状态栏不再出现右侧“备份到 Git”，网站与账号侧栏不再出现 GitHub 备份卡片。
4. 需要“一次提交全部变更”的用户仍必须看到文件清单和动作摘要。
5. 重启、移动工作空间和复制工作空间后，仓库状态与兼容绑定符合 Workspace ID 规则。
6. 非 Git 工作空间可以通过工作空间 Context Action 或命令面板初始化 Git、创建 GitHub 私有
   备份；完成后左下角出现 Git 状态。

### 11.2 实现任务

- `GitBackupService` 改为兼容编排并调用 `GitWorkspaceService`。
- 迁移 renderer `git-backup-store` 到唯一 Git store，删除重复 load/busy/error 状态。
- 删除旧状态栏备份按钮、旧全局对话框和运营侧栏备份卡片。
- 注册“初始化 Git”和“创建 GitHub 私有备份”统一命令及工作空间 Context Action，保持非
  Git 工作空间的现有建仓入口。
- 将 GitHub 账号和 Token 设置重命名为 Git/GitHub 远程配置，但保持凭证 ID 兼容。
- 读取旧 `projects.json/projectId`，按 Workspace 迁移规则双读、单写目标格式；没有完整迁移
  设计前不机械重命名磁盘字段。
- 补统一 Git 诊断、Context Action、开发文档和真实验收记录。

### 11.3 完整退出门禁

- G1-G5 真人验收全部通过。
- 当前工作区和全新 detached worktree 的 `pnpm verify` 通过。
- 受影响 UI smoke、standalone smoke 和精确 SHA 远端 CI 通过。
- 真实 GitHub HTTPS、真实 SSH Agent、离线、认证失败和远程分叉结果有记录。
- 安装包中 Git 缺失时 Studio 正常启动，其他本地能力完整可用。
- Token、带凭证 URL、Diff/文件正文和提交信息不进入诊断或日志。

## 12. 测试矩阵

| 维度     | 必测样本                                                                 |
| -------- | ------------------------------------------------------------------------ |
| 仓库     | clean、unborn、detached、parent root、nested、worktree、bare remote      |
| 变更     | add、modify、delete、rename、untracked、binary、partial staged、conflict |
| 路径     | 空格、中文、换行、短横线前缀、符号链接、工作空间外                       |
| 分支     | 无 upstream、ahead、behind、diverged、upstream 删除                      |
| 写操作   | stale revision、并发、hook 失败、identity 缺失、磁盘只读                 |
| 远程     | HTTPS、SSH、认证失败、离线、超时、non-fast-forward、大文件拒绝           |
| 生命周期 | 启动、窗口重建、工作空间切换、操作中切换、退出                           |
| 安全     | Token 脱敏、URL 脱敏、敏感文件、Shell 注入、越界 repo root               |

## 13. 风险与止损点

| 风险                                  | 止损条件与替代路径                                            |
| ------------------------------------- | ------------------------------------------------------------- |
| porcelain/parser 兼容耗时超过两次失败 | 固定最低 Git 版本和 fixture，先交付支持矩阵，不写脆弱文本解析 |
| partial staged 难以安全保留           | G3 首版只允许 commit staged，暂缓自动 stage unstaged          |
| Diff 大文件拖垮 renderer              | 降低硬上限并显示外部/Terminal 查看提示，不扩建流式 Diff 引擎  |
| 远程认证差异扩张                      | 保留 HTTPS GitHub + 本机 SSH 两条已知路径，其他 remote 仅诊断 |
| 旧备份迁移影响现有用户                | G5 前保留旧入口兼容，不在 G1-G4 提前删除持久化数据            |
| 当前脏工作区与实现冲突                | 独立提交精确文件，避免格式化或覆盖无关在途改动                |

## 14. /grilling

结论：计划必须先证明“读到的 Git 状态可信”，再开放写操作。状态栏 UI 做出来但计数、repo root
或 upstream 语义不可靠，不算 G1 完成。

最危险的扩张是为了模仿完整 Codex/GitHub 界面，把比较分支、PR、Pull、冲突解决和分支管理一起
带入首版。这些能力没有进入当前用户闭环，应保持在范围外。

最容易掩盖的失败是 commit 成功、Push 失败。产品必须明确显示“本地提交已保留”，不能把两步
压成一个失败 toast，也不能重试时再创建重复提交。

如果 G3 的 partial staged 保护无法在计划时间内可靠完成，应退回“只提交已 staged 内容”，
而不是用 `git add --all` 换取表面闭环。

下一步执行顺序是 E0 → G1。E0 只报告工程准备度；首个可报告的用户能力是 G1 在真实 App 中
完成状态栏、浮层、切换隔离和非 Git 降级验收。
