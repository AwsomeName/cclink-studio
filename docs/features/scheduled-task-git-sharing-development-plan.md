# 定时任务 Git 共享开发计划

> 状态：方案提案，尚未实现
>
> 最后更新：2026-08-31
>
> 产品需求：`docs/features/scheduled-task-git-sharing.md`
>
> 当前产品事实源：`docs/features/scheduled-tasks.md`
>
> 相关边界：`docs/architecture.md`、`docs/features/workspace-system.md`、
> `docs/features/git-source-control.md`、`docs/features/manual-git-backup.md`

## 1. 方案结论

实现采用“本机定义与共享定义双位置、单一 `ScheduledTaskService` owner、共享定义 v2 可移植
Schema、Git managed exclude 可迁移策略、目标设备默认无 activation”的最小纵向方案。

建议持久化布局：

```text
<workspace>/.cclink-studio/
├── scheduled-tasks/                  # 现有本机定义，继续 Git ignore
│   └── {taskId}.json
├── shared/
│   └── scheduled-tasks/              # 用户显式共享的可移植定义，允许 Git 跟踪
│       └── {taskId}.json
└── scheduled-task-results/           # 内部结果，继续 Git ignore

<userData>/scheduled-tasks/
├── activations.json                  # 本机启用状态，绝不共享
└── runs/                             # 本机运行账本，绝不共享
```

不直接把现有 `.cclink-studio/scheduled-tasks/` 全量解除 ignore，原因是升级会让已有任务在用户
不知情时进入 Git 候选；独立 `shared/` 路径可以让“随项目共享”保持显式、可诊断和可回滚。

`ScheduledTaskService` 同时读取两个定义位置，但它仍是定义、activation 和运行的唯一领域
owner。Git 领域只拥有 ignore/tracked/unmerged 等仓库事实，不解析任务、不创建 activation、
不决定任务能否运行。

## 2. 当前基线与真实缺口

### 2.1 用户现在能做什么

- 在本地工作空间创建、保存、启用、暂停和重新打开定时任务。
- 在 Studio 主进程存活期间立即运行或按计划运行，并查看本机历史与结果。
- 任务定义保存在工作空间 `.cclink-studio/scheduled-tasks/`。
- activation、运行索引、权限和历史保存在本机 `userData/scheduled-tasks/`。

用户现在还不能：

- 把一个任务显式标记为随项目共享；
- 通过普通 Git 变更、Commit 和 Push 带走任务定义；
- 在另一台电脑不同绝对路径下安全读取同一任务；
- 区分“本机任务”和“来自项目但未在此设备启用的任务”。

### 2.2 当前代码证据

- `src/main/scheduled-task/scheduled-task-service.ts` 把定义写到
  `.cclink-studio/scheduled-tasks/{taskId}.json`。
- 同一服务把该目录和 `.cclink-studio/scheduled-task-results/` 追加到仓库本地
  `.git/info/exclude`。
- `src/main/git-backup/git-client.ts` 的 manual backup managed rules 还会排除整个
  `.cclink-studio/`，并在检测到旧 marker 后直接返回，无法自动演进已有规则。
- `src/shared/scheduled-task/scheduled-task-schema.ts` 的 v1 定义要求
  `workspaceRef: { kind: 'local', path: absolutePath }`。
- `ScheduledTaskService.readDefinition()` 要求持久化 `workspaceRef.path` 与当前 canonical
  workspacePath 完全相等，因此不同电脑路径会失败。
- `src/main/workspace/workspace-state-service.ts` 会为可写本地工作空间建立稳定本机身份；复制
  冲突会 fork identity。该身份适合隔离 activation，不应作为共享定义必须一致的条件。
- 当前 manual Git backup 只做初始化、Commit 和 Push，不提供 Pull/Clone/恢复；本需求不能把
  它描述成完整双向同步。

因此，“移除一个 ignore 规则”无法形成用户闭环，还必须处理可移植 Schema、旧规则迁移、
目标设备发现、默认暂停、冲突和外部删除。

## 3. 架构边界

### 3.1 能力边界

本功能只负责：

```text
用户显式共享任务
  → ScheduledTaskService 写可移植定义
  → GitWorkspaceService 报告普通文件变化
  → 用户自行 Commit/Push/Clone/Pull
  → 目标 ScheduledTaskService 发现并校验定义
  → 默认创建 disabled 投影
  → 用户显式在目标设备启用
```

不负责自动网络同步、多设备协调、后台运行和远程执行。

### 3.2 状态所有者

| 状态                                | 唯一 owner                                 | 禁止行为                                     |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------- |
| 定义解析、来源、保存、转换          | `ScheduledTaskService`                     | Git service 解析或改写任务 JSON              |
| activation、队列、timer、run        | `ScheduledTaskService`                     | 共享文件携带 enabled/nextRunAt               |
| workspace canonical path/identity   | `WorkspaceStateService`                    | 任务按目录名或 JSON 绝对路径自报身份         |
| Git ignore、tracked、unmerged、HEAD | `GitWorkspaceService` / 收敛后的 Git owner | ScheduledTaskService 自行维护第二份 Git 状态 |
| UI 草稿和投影                       | renderer scheduled-task store              | renderer 决定运行资格或重写外部冲突          |

现有 `ScheduledTaskService.ensureDefinitionExcluded()` 直接编辑 Git metadata，应在本项目中收敛：
任务服务声明“local path 必须忽略、shared path 必须可跟踪”的策略需求；具体 managed block 迁移
和 Git 诊断由 Git owner 执行。Git 不可用时任务服务仍可保存定义，只是共享状态显示明确降级。

### 3.3 生命周期

- 定义 discovery 随 `ScheduledTaskService` 启动、工作空间登记和外部文件变化对账执行。
- App shutdown 先停止 scheduler/认领，再释放 watcher 或轮询资源；不留下 Git、Agent 或任务
  子进程。
- 窗口重建只重建 renderer 投影，不重复注册定义 watcher 或 timer。
- Git Pull 由外部工具完成时，定义变化通过有界 watcher、窗口 focus 刷新或显式刷新进入同一
  `ScheduledTaskService.reconcileDefinitions()`；三条触发不得实现三套 reducer。
- 任务服务启动失败只降级定时任务；Git 诊断失败只降级共享状态，不阻断 App 和本机任务。

### 3.4 权限面与人工确认点

- 新增的 renderer API 只允许查询分享状态、转换 local/shared 和刷新定义。
- main 每次转换重新校验 trusted sender、workspace realpath、task ID、expected revision 和定义
  来源。
- 共享定义第一次在某设备启用时必须有人工确认；普通 Save、Git Pull、Tab restore 和
  `Cmd/Ctrl+S` 不得隐式启用。
- `auto` 权限模式不能跳过 scheduled allowlist 或外来定义确认。
- 共享操作不读取 Git remote 凭证，不触发 CCLink 登录，也不执行 Commit/Push。

## 4. 持久化与 Schema

### 4.1 v2 持久化记录

共享定义必须使用不含设备路径的独立持久化类型。建议不要继续把 runtime
`ScheduledTaskDefinition` 直接等同磁盘 JSON：

```ts
interface ScheduledTaskDefinitionRecordV2 {
  schemaVersion: 2
  id: string
  revision: number
  title: string
  instruction: string
  schedule: ScheduledTaskSchedule
  resources: ScheduledTaskResourceRef[]
  outputPolicy: ScheduledTaskOutputPolicy
  createdAt: number
  updatedAt: number
}

interface ResolvedScheduledTaskDefinition extends ScheduledTaskDefinitionRecordV2 {
  workspaceRef: LocalWorkspaceRef // 只在校验后由 main 注入，不按共享 JSON 信任
  source: 'local' | 'shared'
}
```

最终命名可随现有类型收敛，但必须保持“持久化 record 不带绝对路径、runtime definition 由 main
绑定当前工作空间”这一不变量。

共享定义仍必须满足现有长度、数量、计划、时区、相对路径和输出边界。禁止加入 activation、
权限、运行状态、Git remote、设备 ID、账号或凭证字段。

### 4.2 本机 v1 兼容

- 现有 v1 本机定义继续从旧目录读取，升级时不自动转换、不自动共享。
- 在原工作空间读取 v1 时继续验证原路径，防止旧定义被任意目录接管。
- 用户点击“随项目共享”时，服务读取并校验 v1，生成去路径的 v2 shared record，原子写入
  shared 位置；写后读取和 hash 校验成功后，再移除或归档旧 local 文件。
- 转换保留 task ID、createdAt、业务内容和单调 revision；转换本身形成新 revision，避免 B
  把来源变化误认为相同 snapshot。
- shared → local 时生成当前 canonical path 的兼容本机 record；若施工期间能让 local 也使用
  v2 record，应统一采用 v2 并只在 runtime 注入路径，减少长期双 Schema。
- 不支持或损坏的旧版本不得被空定义覆盖。

### 4.3 来源冲突

同一 task ID 只允许存在一个定义来源：

| local | shared               | 结果                                                   |
| ----- | -------------------- | ------------------------------------------------------ |
| 有    | 无                   | 正常本机任务                                           |
| 无    | 有                   | 正常共享任务；新设备默认 disabled                      |
| 有    | 有                   | `SCHEDULED_TASK_SOURCE_CONFLICT`，禁止保存、启用和调度 |
| 无    | 无，但 activation 有 | orphaned/disabled，禁止调度并保留历史                  |

不得采用 shared wins、local wins 或 mtime wins。

### 4.4 原子转换

local/shared 转换使用同一个主进程 mutation queue，并执行：

1. 重新读取源定义和 expected revision；
2. 验证目标不存在且 task ID 唯一；
3. 在目标目录写临时文件；
4. fsync/rename 后重新读取、parse 并校验内容 hash；
5. 写转换 journal 或可恢复 marker；
6. 删除或归档源定义；
7. 清理 journal；
8. 重新对账并发 change event。

若第 4 步前失败，保留源；第 4 步后删除源失败，进入显式 source conflict 并依赖 journal 恢复，
不能让两份定义同时进入 scheduler。

## 5. Git managed exclude 方案

### 5.1 目标规则

Studio 自有 managed block 应从“排除整个 `.cclink-studio/`”迁移为“精确排除本机状态，只允许
shared scheduled task 定义成为普通候选”。概念规则如下，最终必须用真实 Git fixture 验证：

```gitignore
# BEGIN CCLink Studio managed excludes v2
.cclink-studio/*
!.cclink-studio/shared/
.cclink-studio/shared/*
!.cclink-studio/shared/scheduled-tasks/
.cclink-studio/shared/scheduled-tasks/*
!.cclink-studio/shared/scheduled-tasks/*.json
node_modules/
dist/
build/
out/
.cache/
.env
.env.*
*.pem
*.key
*.p12
*.pfx
# END CCLink Studio managed excludes v2
```

必须用 `git check-ignore -v` 和 `git ls-files --others --exclude-standard` 验证父目录重包含规则；
不能只凭字符串测试认为 negation 生效。只有通过文件名和内容 parser 的 `{taskId}.json` 可以成为
候选，原子写入产生的 `.bak`、`.tmp`、转换 journal、子目录及其他文件必须继续被忽略。

### 5.2 旧规则迁移

当前存在至少两类 Studio 自有规则：

- `# CCLink Studio manual backup` 后的 `.cclink-studio/`；
- `# CCLink Studio scheduled task data` 后的
  `/.cclink-studio/scheduled-tasks/` 和
  `/.cclink-studio/scheduled-task-results/`。

迁移器必须：

1. 读取真实 `git rev-parse --git-path info/exclude`；
2. 只识别 Studio 自有 marker 和精确旧规则，不删除相似的用户规则；
3. 备份原文件或采用原子替换；
4. 写入带 begin/end 和版本号的新 managed block；
5. 保留 block 外的顺序、注释和用户规则；
6. 重复执行幂等；
7. 写入失败时不改变任务定义的安全状态，并返回可诊断错误；
8. 用 `git check-ignore -v` 确认 shared file 是否仍被用户 `.gitignore`、global excludes 或其他
   高优先级规则忽略。

如果用户自己的规则仍排除 `.cclink-studio/`，Studio 不得静默改写 `.gitignore`，也不应默认
`git add -f` 绕过用户意图。UI 应显示“共享定义仍被你的 Git 规则忽略”，提供精确来源和手动
修复说明；任务仍可在本机安全使用。

### 5.3 敏感文件预检

现有 Git 预检必须把 shared task JSON 视为普通候选，同时新增有界内容检查：

- 文件必须通过 scheduled-task v2 parser；
- 超长、二进制、符号链接和 schema 不匹配时阻止自动备份；
- 对明显 secret pattern 只作为阻断式安全网，不能声称证明“不含秘密”；
- 错误和日志只报告 task ID/路径，不输出 instruction 正文或疑似 secret；
- 用户通过外部 Git CLI 仍可自行提交，Studio 只对自己的 Commit/backup 操作负责。

## 6. 定义 discovery 与对账

新增一个由 `ScheduledTaskService` 唯一调用的 `reconcileDefinitions(workspacePath, trigger)`：

```text
读取 local/shared 目录项
  → 拒绝 symlink、非 JSON、非法文件名和越界 realpath
  → 分别 parse v1/v2
  → 按 task ID 建立来源索引
  → 标记 source conflict / parse conflict / unsupported
  → 与上次 definition index 对比
  → 新 shared 定义投影为 activation absent/disabled
  → 修改定义使旧 draft 过期
  → 删除定义使 activation orphaned/disabled
  → 重算 nearest-due timer
  → 发一条领域 changed event
```

触发来源至少包括 `startup`、`workspace-open`、`window-focus`、`explicit-refresh`、
`filesystem-change` 和 `after-save`，但 trigger 只用于诊断；所有状态变化必须走同一 reducer。

首版 watcher 可以有界 debounce，并在错误时退化为 focus/显式刷新。不得为了 Git 共享引入全局
目录 watcher 平台或让 renderer 自己读取 `.cclink-studio`。

### 6.1 外部修改

- 打开的 Tab 保存 `loadedRevision` 和 `loadedContentHash`。
- 外部内容变化且 Tab clean：刷新投影并提示“任务已从项目更新”。
- 外部内容变化且 Tab dirty：保留草稿，显示 diff/重新加载/保留草稿选择；首版可不提供自动
  合并，但 Save 必须失败而非覆盖。
- revision 没变但 hash 变化同样视为外部修改，防止两个设备都从 revision N 写出 N+1。
- 外部定义正在运行时变化：当前 run 继续固定旧 snapshot；未来 run 只在新定义合法且当前设备
  activation 仍有效时使用新 revision。

### 6.2 删除和恢复

- 定义删除不取消已经开始的 run，但立即阻止未来 run。
- activation 进入 `orphaned` 或等价显式状态并持久化，不能只在内存过滤。
- 文件重新出现时不恢复 enabled；用户必须重新启用。
- 历史按 task ID 保留并标记 definition missing，避免删除后出现无法解释的运行记录。

## 7. UI 与命令

建议新增或扩展统一 command：

| Command                                  | 用户文案       | 行为                                           |
| ---------------------------------------- | -------------- | ---------------------------------------------- |
| `scheduledTask.shareWithWorkspace`       | 随项目共享     | local → shared 原子转换                        |
| `scheduledTask.stopSharingWithWorkspace` | 停止随项目共享 | shared → local 原子转换并形成 Git 删除         |
| `scheduledTask.refreshDefinitions`       | 刷新项目任务   | 触发 main 对账，不自行读文件                   |
| `scheduledTask.enableLocal`              | 在此设备启用   | 复用现有 activation 命令并增加外来定义确认     |
| `scheduledTask.copyShareDiagnostics`     | 复制共享诊断   | 输出脱敏来源、Schema、Git ignore/conflict 状态 |

命令必须接入统一 Command/Context Action System；不得在侧栏新增独立右键菜单实现。

侧栏与 Tab 至少区分：

- 不随 Git 共享；
- 随项目共享；
- 来自项目、未在此设备启用；
- 定义有外部更新；
- 定义冲突；
- 定义已移除、保留本机历史；
- Git 不可用或仍被用户规则忽略。

Git 状态和 Commit UI 继续由 `GitWorkspaceService` 投影。定时任务 Tab 可以显示“在 Git 中有
变化”，但不能自己猜 staged/tracked/HEAD，也不能直接执行 Git。

## 8. 分阶段施工

### 8.1 E0：冻结 contract，不计产品进度（1–2 人日）

完成：

- v2 persisted record、resolved runtime definition 和 source/conflict/error schema；
- local/shared 目录、转换 journal、activation orphaned 语义；
- managed exclude v2 输入输出 fixture；
- 双工作空间、不同绝对路径和隔离 userData 的验收 harness；
- 明确本需求不需要改变调度 owner 或增加云端 owner。若实现要改变这些边界，先提交 ADR。

退出条件：contract 和迁移 fixture 能回答所有未知字段、损坏、重复 ID、外部删除和旧 v1 情况。
E0 完成时只能报告工程准备度，无新增用户能力。

### 8.2 S1：最小双机纵向闭环（5–8 人日）

用户结果：A 可以共享一个任务，B 经真实 Git 往返看到它但默认暂停，B 手动启用后可以立即运行。

按纵向顺序实现：

1. v2 shared record 的写入、读取和当前 workspace rebind；
2. local → shared 显式转换和 UI；
3. managed exclude v2 使真实 `git status` 看见 shared file；
4. B discovery 和默认 disabled；
5. B 的启用确认和一次真实立即运行；
6. 两个隔离 userData/不同绝对路径的 Electron smoke。

不得先扩张到自动 Pull、完整 watcher 平台或运行历史同步。

### 8.3 S2：旧数据迁移与 Git 兼容（3–5 人日）

用户结果：已有任务保持本机私有，用户可以显式共享；旧项目 Git exclude 安全升级且用户规则
不丢失。

实现：

- v1 local 兼容与转换；
- manual backup 旧 marker、scheduled-task 旧 marker 和新 managed block 的幂等迁移；
- 用户 `.gitignore`/global excludes 阻挡时的诊断；
- 非 Git、Git 不可用、worktree、`.git` pointer 和路径含空格/中文；
- shared → local 转换和 Git deletion 提示。

### 8.4 S3：外部变化、冲突与删除收敛（3–5 人日）

用户结果：A 修改或删除、A/B 并发修改、Pull 冲突不会让 B 静默覆盖或继续执行孤立任务。

实现：

- 单一 definition reconcile；
- revision + content hash 乐观并发；
- dirty draft 外部更新处理；
- source conflict、Git conflict/malformed JSON 隔离；
- orphaned activation 与文件重新出现不自动启用；
- focus/显式刷新/有界 watcher 触发和生命周期清理。

### 8.5 S4：验收和文档收敛（2–3 人日）

- 更新 `docs/features/scheduled-tasks.md` 当前事实源；
- 更新 Git 文档中的 `.cclink-studio` ignore 事实；
- 扩展 `docs/ops/scheduled-tasks-acceptance.md`；
- 记录真实双设备或隔离系统用户验收、Git remote 往返、冲突和删除证据；
- `pnpm verify` 或受影响 smoke 通过后，才允许声明用户闭环完成。

总计约 13–23 人日，由熟悉 Workspace、Scheduled Tasks、Git 和 Electron 生命周期的单人估算；
真实双机、远程 Git 和人工故障注入等待时间不计入纯编码时间。

## 9. 验证矩阵

### 9.1 Schema 与存储

- v1 local 正常读取，不自动共享。
- v1 不同路径不能被旧逻辑误接管；显式分享后生成无绝对路径 v2。
- v2 unknown field、超长内容、非法时区、绝对资源路径、`..` 和内部 ID/文件名不一致拒绝。
- local/shared 重复 ID 阻止调度。
- 原子转换在每个 I/O 失败点至少保留一份可读取定义。
- ENOSPC、EACCES、损坏主文件和有效备份不被空状态覆盖。

### 9.2 Git exclude 与仓库

- 新仓库、已有旧 manual marker、已有旧 scheduled marker、两个 marker 同时存在。
- 用户 block 前后有自定义注释和规则，迁移后字节顺序不被无关改写。
- 重复迁移幂等，不累计 marker。
- `.gitignore` 排除 `.cclink-studio/` 时明确诊断，不静默 force-add。
- worktree `.git` 文件和 common dir 的 `info/exclude` 定位正确。
- `git check-ignore -v` 证明 local、state、results 仍忽略，shared definitions 可见。
- manual backup 敏感预检可以检查 shared task，但日志不输出正文。

### 9.3 目标设备安全

- B userData 完全为空时看到 shared X，activation absent/disabled，timer 不认领。
- B 已有同 task ID 的孤立 activation 时仍不自动启用外来定义。
- 全局 auto、角色切换、Tab restore、窗口重建、App restart 和 Git Pull 都不能启用 X。
- B 明确启用后才生成 nextRunAt；暂停只影响 B。
- A/B 同时启用分别运行，UI 明确重复风险且不声称全局去重。

### 9.4 外部变化

- clean Tab 收到 revision 更新后刷新。
- dirty Tab 收到更新后保留草稿并拒绝 Save。
- 相同 revision 不同 hash 拒绝覆盖。
- JSON conflict markers 只让该任务 conflict，不应让其他合法任务全部消失或运行时崩溃。
- shared 文件删除使 activation orphaned/disabled；重现后不自动 enabled。
- 删除发生在 run 前、排队中、运行中和完成落盘前的行为分别有确定结果。

### 9.5 真实 App

至少使用两个不同绝对路径、两个隔离 `userData` 和一个真实 bare remote：

1. A 创建 local X，确认 Git 看不到。
2. A 共享 X，确认 Git 只看见 shared definition，不含 activation/runs/results/state。
3. A Commit/Push，B Clone/Open，确认 X 可见且 disabled。
4. B 启用并立即运行，确认 A 本机状态不变化。
5. A 修改并 Push，B Pull，验证 clean/dirty 两种 Tab。
6. A 删除并 Push，B Pull，验证 orphaned 和不再调度。
7. A/B 制造 Git conflict，验证 fail closed，解决后可恢复但不自动启用。
8. 退出两端 Studio，确认没有系统计划任务、Helper 或残留进程。

自动化隔离环境通过后，仍需要真人在两台独立电脑或等价隔离系统用户上复核路径、Git 凭证、
UI 文案和定时触发。

## 10. 错误模型和诊断码

建议至少提供：

| code                                       | 用户含义                    | 恢复动作                           |
| ------------------------------------------ | --------------------------- | ---------------------------------- |
| `SCHEDULED_TASK_SHARED_SCHEMA_UNSUPPORTED` | 项目任务版本不支持          | 升级 Studio 或恢复兼容文件         |
| `SCHEDULED_TASK_SOURCE_CONFLICT`           | 本机和共享位置存在同 ID     | 检查两份定义并选择保留来源         |
| `SCHEDULED_TASK_EXTERNAL_MODIFIED`         | 打开后被 Git/外部程序修改   | 重新加载或保留草稿另存             |
| `SCHEDULED_TASK_SHARED_CONFLICT`           | 文件含 Git 冲突或损坏       | 先解决项目文件冲突                 |
| `SCHEDULED_TASK_DEFINITION_REMOVED`        | 共享定义已移除              | 查看历史或重新创建，不自动启用     |
| `SCHEDULED_TASK_SHARE_GIT_IGNORED`         | 用户 Git 规则仍忽略共享定义 | 查看 `check-ignore` 来源并手动调整 |
| `SCHEDULED_TASK_SHARE_MIGRATION_FAILED`    | local/shared 转换未完成     | 根据 journal 恢复，保留源定义      |

错误不得携带 instruction 正文、凭证、Git remote 中的认证信息或不必要的完整绝对路径。

## 11. 回滚与兼容

- 未完成 S1 前不删除 v1 reader 和旧目录。
- 新版本写 v2 shared 定义后，旧版 Studio 应把它视为不支持而不是删除或覆盖。
- 若发布后需要回滚，shared 文件仍是普通项目数据；回滚版本不得自动执行，用户可升级后恢复。
- managed exclude 迁移应备份原内容并支持重复运行；回滚不能重新写回会遮蔽已 tracked shared
  文件的旧大范围规则。
- 已提交到 Git 的共享任务删除必须由用户明确形成 Git deletion；卸载 Studio 不删除项目文件。
- activation store 加入 orphaned 等字段时使用版本化迁移，旧备份损坏不得静默重建为空。

## 12. ADR 判断

本方案不改变“Studio 本地优先、免登录、`ScheduledTaskService` 单一 owner、App 退出不调度、
activation 与运行事实本机保存”的架构宪法，原则上可以作为现有定时任务能力的持久化演进，
无需为了施工本身制造例外 ADR。

出现以下任一变化时必须暂停实现并先提交 ADR：

- 把 activation、权限或历史同步到 Git/云端；
- 引入新的跨设备调度 owner、租约或 exactly-once；
- 让 Git service 解析和修改任务领域状态；
- 让任务共享依赖 CCLink 登录或远程服务；
- 引入后台 Helper、系统调度或 Studio 退出后的执行；
- 默认自动共享所有已有任务，改变既有用户的隐私边界。

## 13. 止损条件

- 为了 S1 开始实现自动 Pull/Merge：立即停止，回到用户显式 Git 往返。
- 为了多设备重复问题设计 Git lock 或云端租约：从本项目移出，另立需求。
- 同一阻塞在 managed exclude 或路径迁移上连续失败两次：先交付显式导出/导入替代路径并评估
  是否值得继续占用主线。
- 连续开发超过 60 分钟仍未增加“A 共享 → B 看见但暂停”的可验收能力：停止横向重构并做
  偏航检查。
- 只有 parser、migration 或 mock 测试通过时，只能报告工程准备度，不能报告用户功能进度。

## 14. 完成声明模板

只有第 9 节真实 App 与真人验收通过后，才能写：

> 用户现在可以在 A 电脑把一个定时任务显式设为随项目共享，通过自己的 Git 流程带到 B；
> B 打开项目后能看到任务但默认不执行，查看并明确启用后才在 B 本机调度。启用状态、权限和
> 历史不跨设备同步，多设备同时启用仍可能重复运行。

在此之前必须准确写明：用户当前能完成到哪一步、还不能完成哪一步，以及对应工程门禁和残余
风险，不能用 Schema、测试数量或内部阶段编号代替产品进度。
