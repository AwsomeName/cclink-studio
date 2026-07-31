# 工作空间定时任务开发计划

> 状态：开发中；M8.1 首个纵向切片已实现并通过自动化 App 冒烟，真人验收待执行
> 最后更新：2026-07-29
> 产品事实源：`docs/features/scheduled-tasks.md`
> 架构约束：`docs/architecture.md`
> 本文件负责开发顺序、任务拆解、验证和交付证据；与产品事实源冲突时，以产品事实源
> 为准。

## 1. 计划结论

首版只交付一个最小纵向闭环：

> 用户在当前工作空间创建一个定时任务，保存并在本机启用；CCLink Studio 主进程在
> App 存活期间到点触发本地 Agent，读取声明范围内的工作空间文件，生成指定 Markdown
> 产物；用户从定时任务侧栏和 Tab 查看状态、历史和产物。App 退出后任务不执行，也不
> 遗留系统计划任务、后台 Helper 或 Agent 子进程。

开发顺序必须先形成用户可见闭环，再补齐可靠性。共享契约、存储、状态机和测试基建
属于工程准备度，不能单独报告为产品里程碑完成。

### 1.1 当前进度快照

用户功能进度：

- M8.1 已可在真实 Electron 中完成“打开当前工作空间 → 进入定时任务侧栏 → 新建 Tab
  → 保存并在本机启用 → 暂停 → 重启恢复 → 从侧栏重新打开”。
- 同一任务重复点击会复用逻辑 Tab；未保存草稿不会在重启后伪装成已保存任务。
- 用户仍不能立即运行、到点运行或看到运行历史，因此 M8.2 和首版产品闭环均未完成。

工程准备度：

- 已落地 shared 严格运行时 parser、typed IPC contract、trusted sender、preload API、
  `ScheduledTaskService` 和 runtime 生命周期。
- 定义与本机 activation 分离持久化；definition 原子写入、备份、revision 冲突保护和
  损坏阻断已有测试。
- 单次/每天/工作日/每周的时区下次时间计算已有纯函数测试。
- 自动化 Electron 冒烟已验证定义写盘、启用/暂停、重启恢复和单 Tab 去重。
- `pnpm verify` 已通过，包含 OSS/凭证/Context Action 边界、格式、lint、全量单测和
  生产构建；真人验收尚未在本快照中登记。

M8.1 尚未关闭的产品项：

- 完整任务级 Context Action contribution。
- 跨两个真实工作空间切换的人工验收。
- activation 写盘失败后的部分成功交互文案与恢复流程。
- 本文 5.6 的真人逐项验收记录。

### 1.2 总体里程碑

| 类别     | 阶段   | 用户可见结果                                         | 估算工作量 |
| -------- | ------ | ---------------------------------------------------- | ---------- |
| 工程前置 | E0     | 无新增用户能力；冻结模型、边界和验证方法             | 2–3 人日   |
| 用户功能 | M8.1   | 可以从侧栏创建、保存、打开、启用和暂停定时任务       | 4–6 人日   |
| 用户增量 | M8.2-A | 可以“立即运行”并生成真实 Markdown，看到运行历史      | 4–6 人日   |
| 用户增量 | M8.2-B | App 存活时可以按单次/每日/工作日/每周计划自动运行    | 3–5 人日   |
| 用户功能 | M8.2-C | App 退出后不执行、不遗留；重启后显示错过或有界补执行 | 2–4 人日   |
| 用户功能 | M8.3   | 工作空间切换、并发、失败恢复、通知和诊断形成可靠闭环 | 5–8 人日   |
| 交付验收 | R1     | 全量门禁、真实 App 验收、退出无遗留和文档证据        | 2–4 人日   |

估算以一名熟悉当前 Electron、React、AgentBridge、WorkspaceState 和 Context Action
架构的工程师为口径，总计约 22–36 人日。外部模型服务不稳定、真实长任务观察和人工
验收等待时间不包含在纯工程估算中。

M8.2 只有 A、B、C 全部完成且真人闭环通过后才能标记完成。M8.2-A 或 M8.2-B 单独通过
时，只能描述用户当前已经获得的具体增量，不能宣称首版定时任务完成。

### 1.3 首版范围

首版允许：

- 当前本地工作空间内创建定时任务。
- 单次、每天、工作日和每周计划。
- 明确时区和人类可读的下次运行时间。
- 读取声明范围内的 UTF-8 文本/Markdown 文件。
- 写入用户声明的工作空间输出目录。
- 立即运行、取消、暂停未来调度。
- App 内到点触发。
- 运行历史、产物、失败、错过、中断和跳过状态。
- 工作空间切换后保持正确归属。

首版拒绝：

- Browser、Terminal、Android、Git Push 和数据源工具。
- 删除、覆盖未声明文件和工作空间外写入。
- 系统 Cron、LaunchAgent、Task Scheduler、systemd timer。
- 登录项、托盘常驻、后台 Helper、守护进程和系统唤醒。
- App 退出后的执行承诺。
- 任意 Cron 表达式。
- 浏览器准备、发布和持久化人工确认。
- 云端、官方账号、消息网络或远程 runtime。

## 2. 执行纪律

### 2.1 用户功能优先

- 开始每个用户功能阶段前，先写出真实 Studio 中的验收动作。
- 连续开发超过 60 分钟仍未增加可见用户能力时，停止横向扩张并执行偏航检查。
- 一个工程阻塞连续失败两次，停止第三次同类尝试，先汇报替代路径和主线影响。
- 侧栏、Tab 或 mock 页面完成，但真实文件尚不能生成时，不得把 M8.2 记为完成。
- 假时钟测试通过，但 App 退出后仍有残留进程时，不得把 M8.2-C 记为完成。
- `pnpm verify` 通过但真人验收未执行时，只报告工程门禁通过。

### 2.2 架构硬边界

- `ScheduledTaskService` 是定义、设备启用、调度、运行和历史的唯一领域 owner。
- renderer store 只保存可丢弃投影，不参与到期判定和运行终态裁决。
- 调度只使用 App 主进程内一个 nearest-due timer，不为每个任务创建 `setInterval`。
- 调度服务通过统一 runtime registry 启停，并在 Agent runtime 就绪后启动、之前停止。
- 不新增系统调度适配器、后台可执行文件、登录项或安装/卸载脚本。
- 工具调用必须携带 `scheduledTaskId / taskRevision / scheduledRunId / workspaceRef`。
- 工作空间、输出路径和工具 allowlist 必须由主进程硬校验，不能只依赖 Agent prompt。
- 新增 IPC、preload 和持久化字段必须先有 shared contract 与运行时 schema。
- 定时任务侧栏的上下文操作必须接入统一 Context Action System。

### 2.3 每个用户功能里程碑的完成定义

一个用户功能里程碑只有同时满足以下条件才能标记完成：

1. 对应真人端到端验收全部通过。
2. 主进程事实、renderer 投影和重启后恢复一致。
3. 成功、失败、取消和降级都有用户可见结果。
4. 不引入第二状态 owner、生命周期分叉或重复 IPC 契约。
5. 受影响单元、contract、service、UI 和 smoke 测试通过。
6. `pnpm verify` 通过。
7. 验收记录包含提交 SHA、步骤、结果、失败注入和残余风险。
8. 文档只描述当前真实能力，不把后续阶段写成已完成。

## 3. 目标模块与所有权

目标目录可以因实现细节调整，但职责边界必须保持：

```text
src/shared/scheduled-task/
├── scheduled-task-types.ts
├── scheduled-task-schema.ts
├── scheduled-task-contract.ts
└── scheduled-task-errors.ts

src/main/scheduled-task/
├── scheduled-task-service.ts          唯一状态 owner
├── scheduled-task-definition-store.ts 工作空间定义与 revision
├── scheduled-task-local-store.ts      本机启用和运行索引
├── scheduled-task-run-ledger.ts       运行事件与历史投影
├── schedule-calculator.ts             纯时间计算
├── scheduled-task-runner.ts           Agent 执行适配
├── scheduled-task-diagnostics.ts
└── scheduled-task-ipc.ts

src/preload/
└── scheduled-task-api.ts

src/renderer/src/features/scheduled-tasks/
├── scheduled-task-store.ts            主进程 snapshot 投影
├── ScheduledTasksSidebar.tsx
├── ScheduledTaskTab.tsx
├── ScheduledTaskEditor.tsx
├── ScheduledTaskRunHistory.tsx
├── scheduled-task-view-model.ts
└── scheduled-tasks.css

docs/ops/
└── scheduled-tasks-acceptance.md
```

### 3.1 状态所有权

| 状态                       | 唯一事实源                                   | renderer 行为             |
| -------------------------- | -------------------------------------------- | ------------------------- |
| 任务定义和 revision        | `ScheduledTaskService` + definition store    | 编辑草稿，显式保存        |
| 本机启用/暂停              | `ScheduledTaskService` + local store         | 发 command，等待 snapshot |
| 下一次运行                 | `ScheduledTaskService` + schedule calculator | 只展示                    |
| 当前运行                   | `ScheduledTaskService` + runner 事件         | 只展示和发取消 command    |
| 历史与产物                 | `ScheduledTaskRunLedger`，由 Service 协调    | 分页读取和打开产物        |
| Tab 打开、dirty 和当前滚动 | workspace Tab/editor projection              | renderer UI 状态          |
| Agent 真实进程             | 现有 Agent runtime                           | 不伪造运行事实            |

`ScheduledTaskRunLedger` 是 Service 管理的持久化组件，不是第二产品状态 owner。它只能
追加或查询事件，不能自行创建运行、计算终态或重新调度。

### 3.2 首版共享模型

任务定义至少包含：

```ts
interface ScheduledTaskDefinition {
  schemaVersion: 1
  id: string
  workspaceRef: LocalWorkspaceRef
  revision: number
  title: string
  instruction: string
  schedule: ScheduledTaskSchedule
  resources: ScheduledTaskResourceRef[]
  outputPolicy: ScheduledTaskOutputPolicy
  createdAt: number
  updatedAt: number
}
```

本机启用至少包含：

```ts
interface ScheduledTaskActivation {
  taskId: string
  workspaceId: string
  workspaceRef: LocalWorkspaceRef
  enabled: boolean
  catchUpPolicy: {
    mode: 'latest-within-window'
    windowMinutes: 30
  }
  lastEvaluatedAt: number | null
  nextRunAt: number | null
}
```

`workspaceId` 用于验证稳定工作空间身份，`workspaceRef` 保存本机最后确认的路径。工作
空间移动后，只有用户重新打开并由现有 WorkspaceState 身份校验确认是同一工作空间，
才能更新路径；调度器不能按目录名猜测或自动改绑。

运行记录至少包含：

```ts
interface ScheduledTaskRun {
  id: string
  occurrenceId: string
  taskId: string
  taskRevision: number
  workspaceRef: LocalWorkspaceRef
  trigger: 'run-now' | 'scheduled' | 'catch-up'
  scheduledFor: number | null
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'interrupted'
    | 'missed'
    | 'skipped'
  currentStep: string | null
  startedAt: number | null
  endedAt: number | null
  failure?: ScheduledTaskFailure
  artifacts: ScheduledTaskArtifact[]
}
```

`occurrenceId` 必须对同一任务的同一计划时间稳定，用来阻止重复触发。运行开始前先原子
认领 occurrence 并持久化 `queued`，再调用 Agent。崩溃后看到已认领但没有终态的运行，
只能收束为 `interrupted`，不能静默再次执行并产生重复文件。

### 3.3 错误码

首版至少定义：

- `SCHEDULED_TASK_INVALID`
- `SCHEDULED_TASK_NOT_FOUND`
- `SCHEDULED_TASK_REVISION_CONFLICT`
- `SCHEDULED_TASK_WORKSPACE_UNAVAILABLE`
- `SCHEDULED_TASK_WORKSPACE_READ_ONLY`
- `SCHEDULED_TASK_OUTPUT_OUTSIDE_WORKSPACE`
- `SCHEDULED_TASK_OUTPUT_NOT_ALLOWED`
- `SCHEDULED_TASK_UNSUPPORTED_TOOL`
- `SCHEDULED_TASK_AGENT_UNAVAILABLE`
- `SCHEDULED_TASK_ALREADY_RUNNING`
- `SCHEDULED_TASK_QUEUE_TIMEOUT`
- `SCHEDULED_TASK_CANCELLED`
- `SCHEDULED_TASK_INTERRUPTED`
- `SCHEDULED_TASK_MISSED`
- `SCHEDULED_TASK_STORE_INVALID`
- `SCHEDULED_TASK_STORE_CONFLICT`
- `SCHEDULED_TASK_WRITE_FAILED`

错误跨 IPC 时返回结构化 code、脱敏 message 和可恢复动作，不传递 prompt、文件正文、
凭证、Session ID 或完整绝对路径。

## 4. E0：工程前置与契约冻结

E0 不增加用户功能，不能计入产品进度。

### 4.1 目标

在实现 UI 和调度前固定首版状态、存储、时间、权限、生命周期和验收边界，避免后续用
兼容字段制造第二套模型。

### 4.2 任务拆解

| ID       | 工作项         | 主要产出                                              |
| -------- | -------------- | ----------------------------------------------------- |
| ST-E0-01 | 现状库存       | Activity、Tab、Workspace、Agent、Editor、runtime 清单 |
| ST-E0-02 | shared 类型    | definition、activation、run、artifact、failure        |
| ST-E0-03 | 运行时 parser  | IPC 和持久化严格校验                                  |
| ST-E0-04 | IPC contract   | list/get/create/save/enable/pause/run/cancel/history  |
| ST-E0-05 | 状态转换表     | definition、activation 和 run 的合法转换              |
| ST-E0-06 | 时间规则冻结   | once/daily/weekdays/weekly、时区、宽限窗口            |
| ST-E0-07 | 权限矩阵       | 首版 editor read/write allowlist 与路径约束           |
| ST-E0-08 | 生命周期声明   | App start/stop、窗口重建、退出、休眠恢复              |
| ST-E0-09 | 验收文档初始化 | `docs/ops/scheduled-tasks-acceptance.md` 模板         |

### 4.3 必须冻结的决定

- `ScheduledTaskService` 是唯一 owner。
- 定义存储在 `.cclink-studio/scheduled-tasks/`，并进入仓库本地 exclude。
- 本机启用、运行索引和历史存储在 `userData/scheduled-tasks/`。
- 首版每个工作空间最多 200 个任务。
- 每个任务保留最近 100 次运行；需要处理和最近失败在用户查看前不得被回收。
- 每次保存 revision `+1`，运行固定 definition snapshot。
- 默认补执行窗口 30 分钟，只补最近一次 occurrence。
- 暂停只阻止未来运行，不取消当前运行；当前运行必须单独终止。
- 删除运行中的任务被拒绝，用户必须先终止运行。
- App 退出时停止认领，最多等待 5 秒收束当前运行，之后标记中断并释放。
- 不注册系统服务或系统调度。

### 4.4 E0 退出条件

- 所有 contract 字段都有长度、数量和枚举边界。
- 没有 renderer 自行计算 `nextRunAt` 的计划。
- 没有 per-task `setInterval` 或系统调度适配器设计。
- 工具 allowlist 不包含 Browser、Terminal、Android、Git 或数据源。
- 验收文档能覆盖 App 存活触发、退出不触发和无系统遗留。

### 4.5 失败判定

- E0 超过 3 人日仍没有可冻结的 shared model。
- 为了未来浏览器能力提前引入持久确认框架。
- 把任务定义、运行历史和 Tab snapshot 全部塞进一个 renderer store。
- 为跨重启“可靠执行”引入系统服务或后台 Helper。

出现以上任一项，停止实现并缩回首版 Markdown 闭环。

## 5. M8.1：创建和管理工作空间定时任务

### 5.1 用户结果

用户现在可以：

- 点击 Activity Bar 的“定时任务”。
- 在当前工作空间看到定时任务侧栏。
- 新建并在独立 Tab 编辑任务。
- 显式保存、在此设备启用、暂停和重新打开任务。
- 看到下次运行时间和不支持能力提示。

用户此时还不能：

- 立即运行 Agent。
- 到点自动生成文件。
- 依赖运行历史判断任务是否真正执行。

### 5.2 最小交互

1. 当前没有本地工作空间时，侧栏显示“先打开本地工作空间”，禁用新建。
2. 点击 `+` 打开 `scheduled-task` Tab 草稿。
3. Tab 填写名称、指令、计划、资源和输出目录。
4. 保存前展示结构化摘要和首版 allowlist。
5. “保存”只保存定义。
6. “保存并在此设备启用”保存定义并写本机 activation。
7. 关闭 Tab 后，侧栏任务仍存在。
8. 再次点击任务激活同一个逻辑 Tab。

### 5.3 工程任务

| ID       | 工作项                 | 主要落点与完成检查                                          |
| -------- | ---------------------- | ----------------------------------------------------------- |
| ST-M1-01 | Definition Store       | 原子写、备份、revision、冲突和损坏保护                      |
| ST-M1-02 | Local Activation Store | enabled、catch-up、nextRunAt；无运行逻辑                    |
| ST-M1-03 | Service CRUD           | create/save/list/get/enable/pause；唯一 owner               |
| ST-M1-04 | IPC/preload            | shared contract、trusted sender、参数和 workspace 校验      |
| ST-M1-05 | Activity 入口          | 新 ActivityPanel、时钟图标、命令注册                        |
| ST-M1-06 | Sidebar                | 当前工作空间过滤、分组、空状态、搜索                        |
| ST-M1-07 | ScheduledTask Tab      | 表单、dirty、显式保存、revision 冲突                        |
| ST-M1-08 | Tab 恢复               | workspaceRef 和 taskId 恢复；缺失任务显示可操作错误         |
| ST-M1-09 | Context Actions        | open/enable/pause/delete/copy diagnostics 统一 contribution |
| ST-M1-10 | 本机 exclude           | 只更新 `.git/info/exclude`，不修改 `.gitignore`             |

### 5.4 UI 规则

- Activity Bar 徽标在 M8.1 只显示配置错误和不可用，不伪造运行数量。
- 侧栏只显示当前工作空间任务。
- 已启用任务修改后显示 dirty，但未来调度仍引用最近保存 revision。
- 有 dirty 时禁用“立即运行”；M8.1 中该按钮整体显示“即将支持”或暂不出现。
- 保存失败后保留 Tab 草稿，不用空值覆盖磁盘定义。
- activation 保存失败时，定义可以已保存，但 UI 必须明确显示“未在此设备启用”。

### 5.5 自动化验证

- Definition schema 正反 fixture。
- task ID、标题、指令、资源数量和输出路径边界。
- revision 冲突和外部修改拒绝。
- 临时文件、rename 和备份恢复。
- 工作空间不可写、目录缺失和 metadata 冲突。
- IPC 非可信 sender、非法 workspaceRef 和多余字段拒绝。
- Tab hydrate、重复打开、dirty 和保存失败。
- 侧栏只投影当前工作空间。
- command/contribution/inventory 门禁。

### 5.6 真人验收

1. 打开一个真实可写工作空间。
2. 点击时钟图标，确认侧栏为空。
3. 新建每天 09:00 的 Markdown 周报任务。
4. 保存但不启用，确认侧栏显示“未启用”。
5. 在此设备启用，确认下次运行时间可见。
6. 修改任务但不保存，关闭并重新打开前确认 dirty 提示。
7. 保存后关闭 Tab，再从侧栏打开。
8. 重启 Studio，确认任务、revision 和启用状态仍正确。
9. 打开另一个工作空间，确认侧栏不显示原任务。

### 5.7 完成声明

M8.1 完成时只能声明：

> 用户可以在当前工作空间创建、保存、启用、暂停和重新打开定时任务资源。

不能声明任务已经会运行。

## 6. M8.2-A：立即运行并生成真实 Markdown

### 6.1 用户结果

用户现在可以在保存任务后点击“立即运行”，看到真实 Agent 执行状态，并在工作空间中
得到一个经过写后校验的 Markdown 文件。任务 Tab 能显示本次运行、错误和产物入口。

### 6.2 纵向实现顺序

第一批必须直接跑通：

```text
任务 Tab
  → 立即运行
  → 主进程创建 ScheduledTaskRun
  → 固定 task revision 与 workspace
  → AgentBridge 执行专用 conversation/run
  → editor 只读/受限写入
  → 文件写后读取校验
  → run completed
  → Tab 打开产物
```

不得先花多日实现通用队列、浏览器恢复或任意 recurrence，再回来补真实文件。

### 6.3 工程任务

| ID        | 工作项                | 主要落点与完成检查                                 |
| --------- | --------------------- | -------------------------------------------------- |
| ST-M2A-01 | Run Ledger            | queued/running/terminal event 原子关联             |
| ST-M2A-02 | occurrence 认领       | `run-now` 唯一 occurrence，不重复创建              |
| ST-M2A-03 | Agent 事件订阅        | AgentBridge 提供受控 listener，不轮询 renderer     |
| ST-M2A-04 | 专用运行 correlation  | task/revision/run/workspace/conversation 全链固定  |
| ST-M2A-05 | Scheduled Tool Policy | 只允许 editor read/list/write/append 的受限子集    |
| ST-M2A-06 | 路径硬校验            | 读取限定 workspace；写入限定声明输出目录           |
| ST-M2A-07 | Artifact 校验         | 写后读取、UTF-8、路径、大小和内容摘要              |
| ST-M2A-08 | 取消                  | 用户取消 Agent，run 收束为 cancelled               |
| ST-M2A-09 | Run History UI        | 当前步骤、终态、失败摘要、产物入口                 |
| ST-M2A-10 | 不支持能力拒绝        | Browser/Terminal/Android/Git/DataSource 结构化拒绝 |

### 6.4 权限策略

首版定时运行必须拥有独立 origin：

```text
origin: scheduled-task
taskId
taskRevision
runId
workspaceRef
readRoots
writeRoots
allowedTools
```

判定顺序：

1. origin 缺失或 correlation 不完整，拒绝。
2. 工具不在 scheduled allowlist，拒绝。
3. 文件路径不在工作空间，拒绝。
4. 写入路径不在声明输出目录，拒绝。
5. 参数、内容大小或文件类型越界，拒绝。
6. 全部通过后才执行工具。

全局 `auto`、`categorized` 或 `strict` 模式不能扩大 scheduled allowlist。

### 6.5 自动化验证

- “立即运行”固定保存 revision，不读取 dirty 草稿。
- Agent 成功、失败、取消、超时和异常退出。
- 运行事件乱序、重复 complete 和迟到 stream。
- 路径穿越、符号链接逃逸、工作空间外绝对路径。
- 写入未声明目录。
- 二进制、超大文件和非 UTF-8。
- Browser、Terminal、Android、Git、DataSource 工具拒绝。
- 同一任务重复点击“立即运行”只接受一个实例。
- 文件写后校验失败时 run 失败，不伪造 artifact。
- renderer 重载后从主进程恢复当前运行与历史。

### 6.6 真人验收

1. 创建并保存一个读取 `README.md`、输出 `docs/generated/scheduled-summary.md` 的任务。
2. 点击“立即运行”。
3. 确认 Tab 显示排队、运行和当前步骤。
4. 等待完成并打开真实 Markdown 产物。
5. 确认运行历史记录 task revision、耗时和产物。
6. 把输出目录改为工作空间外路径，确认保存或运行被拒绝。
7. 在任务内容中要求运行 Terminal，确认显示“不支持”，没有命令执行。
8. 启动长任务并取消，确认 run 为 cancelled，Agent 不再输出。

### 6.7 完成声明

M8.2-A 完成时可以声明：

> 用户可以立即运行已保存的定时任务定义，并在工作空间获得受限的 Markdown 产物。

仍不能声明到点自动运行已经完成。

## 7. M8.2-B：App 存活期间到点自动运行

### 7.1 用户结果

用户可以设置单次、每天、工作日或每周计划。只要 CCLink Studio 主进程存活，任务会在
到期后由 App 统一触发，不要求定时任务 Tab 保持打开。

### 7.2 调度模型

只维护一个 nearest-due timer：

```text
加载全部本机 activation
  → 计算最近 nextRunAt
  → 设置一个有界 setTimeout
  → 到点重新读取并原子认领所有 due occurrence
  → 创建有界队列
  → 重新计算最近 nextRunAt
```

禁止：

- 每个任务一个 `setInterval`。
- renderer timer。
- 系统 scheduler。
- timer 回调直接修改 renderer store。
- 未持久化 occurrence 就启动 Agent。

### 7.3 工程任务

| ID        | 工作项              | 主要落点与完成检查                             |
| --------- | ------------------- | ---------------------------------------------- |
| ST-M2B-01 | Schedule Calculator | once/daily/weekdays/weekly + timezone          |
| ST-M2B-02 | Next Due Controller | 单一 timer、重新装配、长延时切片               |
| ST-M2B-03 | Runtime 注册        | Agent 后启动、Agent 前停止、失败独立降级       |
| ST-M2B-04 | Due Claim           | occurrence 原子认领、重复回调幂等              |
| ST-M2B-05 | 有界队列            | 全局一个 scheduled run，同工作空间不重叠       |
| ST-M2B-06 | 时间变化            | resume、系统时间/时区变化后重新计算            |
| ST-M2B-07 | Pause/Save 重装配   | activation/revision 变化后重算，不影响当前运行 |
| ST-M2B-08 | 状态徽标            | 全局运行数量，当前工作空间侧栏局部投影         |

### 7.4 时间语义

- 定时任务保存 IANA timezone，例如 `Asia/Shanghai`。
- `nextRunAt` 是派生值，不是用户定义的替代事实。
- 同一 wall-clock occurrence 只执行一次。
- 夏令时重复小时只认领一次 occurrence。
- 夏令时不存在的本地时间移动到该日下一个有效时刻，并在历史中标注 adjusted。
- App 休眠期间 timer 不保证触发；恢复后进入 M8.2-C 的宽限对账。
- 超过平台单次 timer 最大安全区间时，只设置中间唤醒点并重新计算，不创建多个 timer。

### 7.5 自动化验证

- 单次、每天、工作日和每周的正常计算。
- 月末、年末、闰日。
- IANA timezone 无效。
- DST 不存在时间和重复时间。
- timer 早到、晚到、重复回调。
- 保存、暂停、启用和删除后的重新装配。
- 同一 occurrence 并发 claim。
- 多任务同一时刻到期的稳定排序。
- Agent 忙时进入有界队列，不抢占用户任务。
- scheduler 初始化失败只降级定时任务能力，不阻断 App 启动。

### 7.6 真人验收

1. 创建一个 3 分钟后运行的单次任务。
2. 关闭任务 Tab，但保持 Studio 主窗口存活。
3. 切换到其他 Tab，确认到点后自动运行。
4. 从 Activity Bar 徽标进入任务侧栏。
5. 打开任务并确认 scheduled trigger、计划时间、实际时间和产物。
6. 创建两个同一时间到期的任务，确认串行执行且没有重复产物。
7. 暂停一个任务，确认到点后不运行并留下可理解状态。

### 7.7 完成声明

M8.2-B 完成时可以声明：

> CCLink Studio 存活期间，已启用任务可以按计划自动生成 Markdown。

此时仍需 M8.2-C 证明退出、错过和无系统遗留。

## 8. M8.2-C：退出、错过和无系统遗留

### 8.1 用户结果

用户关闭 CCLink Studio 后，定时任务停止工作，不占用系统后台资源。重新打开时，用户
能看到明确的错过、中断或有界补执行状态。

### 8.2 退出协议

App `will-quit` 开始后：

1. `ScheduledTaskService` 进入 `stopping`。
2. 清除唯一 timer。
3. 拒绝新建 scheduled run。
4. 取消仍在队列中的运行并记录取消原因。
5. 请求终止正在执行的 Agent run。
6. 最多等待 5 秒收束。
7. 未完成运行写入 `interrupted`。
8. flush definition/local store/run ledger。
9. 释放 listener、timer 和内存索引。
10. Agent runtime 随后停止，不能留下子进程。

正常退出和崩溃都不能在下次启动时把旧 `running` 直接恢复成运行中。

### 8.3 错过策略

| 场景                   | 默认行为                                       |
| ---------------------- | ---------------------------------------------- |
| 单次任务错过           | 标记 missed，用户选择立即运行或跳过            |
| 重复任务 30 分钟内恢复 | 只补最近一次，trigger=`catch-up`               |
| 重复任务超过 30 分钟   | 记录最近一次 missed，计算下一个未来 occurrence |
| 退出期间错过多个周期   | 不重放全部周期                                 |
| 上次运行 interrupted   | 不自动重试，用户明确重试                       |
| 工作空间不可用         | needs-attention，不改绑其他路径                |

### 8.4 工程任务

| ID        | 工作项            | 主要落点与完成检查                        |
| --------- | ----------------- | ----------------------------------------- |
| ST-M2C-01 | Stop Protocol     | timer、queue、runner、ledger 对称清理     |
| ST-M2C-02 | Startup Reconcile | running/queued/missed/nextRunAt 真实对账  |
| ST-M2C-03 | Catch-up          | 30 分钟窗口、最近一次、无批量重放         |
| ST-M2C-04 | Crash Recovery    | 未收束运行转 interrupted                  |
| ST-M2C-05 | Exit Smoke        | 无 child、Helper、登录项、系统计划任务    |
| ST-M2C-06 | UI 状态           | missed/interrupted/skipped 和立即运行入口 |

### 8.5 自动化验证

- timer 到期前正常退出。
- Agent 正在运行时正常退出。
- stop 期间新任务到期。
- stop flush 失败。
- 强制终止后重启。
- queued/running/terminal 事件写入不同断点。
- 宽限窗口边界 29:59、30:00、30:01。
- 多个错过周期只补最近一次。
- 重启不产生重复 occurrence。
- scheduler stop 幂等。

### 8.6 真人验收

1. 创建一个 3 分钟后运行的任务。
2. 在到点前退出 Studio。
3. 等待超过计划时间，确认没有生成文件。
4. 确认没有 CCLink Studio Agent 子进程继续运行。
5. 重新打开 Studio。
6. 确认任务显示 missed 或符合宽限策略的 catch-up。
7. 创建并立即运行一个长任务，在运行中退出 Studio。
8. 重启后确认旧运行是 interrupted，不显示假 running。
9. 检查系统没有新增计划任务、登录项、Helper 或守护进程。

### 8.7 M8.2 完成声明

M8.2-A、B、C 全部通过后才可以声明：

> 用户可以在 CCLink Studio 存活期间创建并运行工作空间定时任务，按计划生成 Markdown；
> App 退出后任务不执行、不遗留后台调度，重启后状态可判断。

## 9. M8.3：工作空间切换、失败恢复与诊断

### 9.1 用户结果

用户可以在任务运行时切换工作空间，任务不串工作空间、不抢焦点；失败、不可用、排队、
错过和产物都能从全局徽标、当前工作空间侧栏和任务 Tab 正确定位。

### 9.2 工程任务

| ID       | 工作项                 | 主要落点与完成检查                              |
| -------- | ---------------------- | ----------------------------------------------- |
| ST-M3-01 | Workspace Correlation  | task/run/Agent/artifact 全链 workspaceRef 固定  |
| ST-M3-02 | Transition Projection  | 切换只改变可见投影，不改后台运行 owner          |
| ST-M3-03 | 全局徽标               | 全部工作空间运行/失败/待处理数量                |
| ST-M3-04 | 其他工作空间入口       | “其他工作空间 N 项”受控切换和定位               |
| ST-M3-05 | 并发协调               | 用户 Agent 优先，scheduled 全局单并发、有界排队 |
| ST-M3-06 | Workspace Failure      | 移动、删除、只读、metadata 损坏和恢复           |
| ST-M3-07 | Store Compaction       | 历史上限、原子压缩、损坏保护                    |
| ST-M3-08 | Diagnostics            | 脱敏 snapshot、correlation、错误分类和复制      |
| ST-M3-09 | Notification           | 完成/失败/错过；不抢焦点、不自动切换            |
| ST-M3-10 | Capability Degradation | scheduler/Agent/editor 任一失败不阻断无关能力   |

### 9.3 并发规则

- 交互式用户 Agent 优先。
- 首版全局最多一个 scheduled run。
- 用户 Agent 开始时不强杀 scheduled run；新 scheduled run 停止认领并排队。
- 同一任务禁止重叠。
- 队列默认最大等待 30 分钟；超过后记录 `skipped` 和 `queue_timeout`。
- 排队期间任务被暂停或 revision 更新时，旧 queued run 取消，不自动换成新 revision。
- 工作空间切换不改变正在运行任务的 workspaceRef、输出目录或 Agent correlation。

### 9.4 诊断要求

诊断至少报告：

- Scheduler capability：ready/degraded/unavailable/failed。
- App runtime generation 和 scheduler start time。
- 已加载任务数量、启用数量和最近 nextRunAt。
- 当前 timer 是否存在及目标时间，不输出 Node timer 内部值。
- 当前 run 的 taskId、revision、runId、workspace 摘要和 currentStep。
- correlation 状态：matched/incomplete/mismatch。
- 最近失败 code 和脱敏 message。
- store 版本、最后 flush、备份恢复和 compaction 状态。
- 是否检测到不应存在的系统调度配置；正常必须为 none。

不得输出：

- 完整 Agent instruction。
- 文件正文。
- Cookie、Token、Session ID、验证码和凭证。
- 用户目录完整绝对路径；只输出脱敏工作空间标签和稳定引用。

### 9.5 自动化验证

- A 运行时切到 B，再切回 A。
- B 侧栏不显示 A 任务。
- A 的文件只写入 A 声明目录。
- 用户 Agent 与 scheduled run 竞争。
- 排队超时、暂停、删除和 revision 更新。
- 工作空间移动、删除、只读和 metadata 损坏。
- run ledger 达到上限后的 compaction。
- renderer 重载和窗口重建。
- scheduler capability 失败但文件、Browser、Terminal 和普通 Agent 仍可用。
- 诊断脱敏和 correlation mismatch。

### 9.6 真人验收

1. 在工作空间 A 创建一个持续至少 30 秒的任务。
2. 运行后切换到工作空间 B。
3. 确认 B 侧栏没有 A 的任务，当前 Tab 和焦点不被后台任务抢走。
4. 等待 A 任务完成，再切回 A。
5. 确认 A 的运行历史、产物和 workspace correlation 正确。
6. 在 A 运行时启动一个用户 Agent 任务，确认不会产生第二个 scheduled run。
7. 模拟输出目录只读，确认任务失败但 Studio 其他能力仍正常。
8. 复制诊断，确认能定位失败且没有 prompt、正文和凭证。

## 10. R1：首版交付验收

R1 是交付验收，不新增功能。

### 10.1 自动化门禁

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm verify`
- 新增 scheduled-task contract/service/UI tests
- 受影响的 workspace transition、Agent、Editor、Context Action tests
- App start/stop 和无残留 smoke

### 10.2 真人验收矩阵

| 编号 | 场景             | 必须结果                                    |
| ---- | ---------------- | ------------------------------------------- |
| H1   | 创建、保存、重开 | 同一任务、revision、启用和下次运行时间一致  |
| H2   | 立即运行         | 生成真实 Markdown，历史和产物可打开         |
| H3   | App 存活到点执行 | 不打开任务 Tab 也按时触发                   |
| H4   | App 退出         | 到点不执行，无文件、无后台子进程和系统调度  |
| H5   | 重启与错过       | missed/catch-up/interrupted 真实且不重复    |
| H6   | 工作空间切换     | 不串任务、不串输出、不抢焦点                |
| H7   | 并发与取消       | 全局单 scheduled run，取消后无迟到输出      |
| H8   | 权限边界         | 工作空间外写入和未开放工具被拒绝            |
| H9   | 失败降级         | Agent/目录/store 失败不阻断 Studio 无关能力 |
| H10  | 诊断             | 可定位 correlation 和失败，默认脱敏         |

### 10.3 交付证据

在 `docs/ops/scheduled-tasks-acceptance.md` 记录：

```text
版本 / 日期 / 操作者
源提交 SHA / 系统版本 / 架构
工作空间标签 / 任务 ID / revision / run ID
自动化命令与结果
真人步骤与结果
失败注入与恢复结果
App 退出后的进程和系统调度检查
脱敏截图或诊断摘要
残余风险和是否允许交付
```

证据不得包含完整绝对路径、Agent prompt、文件正文、Cookie、Token、Session ID 或
第三方凭证。

## 11. PR 与提交切片

建议串行切片：

| PR  | 范围                          | 产品进度说明                 |
| --- | ----------------------------- | ---------------------------- |
| PR0 | E0 shared contract 和测试骨架 | 工程准备度，不增加用户能力   |
| PR1 | M8.1 侧栏、Tab、存储和启用    | 用户可以创建和管理资源       |
| PR2 | M8.2-A 立即运行和 Markdown    | 用户可以手动验证真实产物     |
| PR3 | M8.2-B App 内调度             | App 存活时可以到点执行       |
| PR4 | M8.2-C 退出、错过和无遗留     | 首版核心承诺闭环             |
| PR5 | M8.3 切换、失败恢复和诊断     | 达到可靠交付状态             |
| PR6 | R1 验收修复与证据             | 只修验收发现的问题，不扩功能 |

约束：

- 每个 PR 原则上只改变一个产品增量或一个工程前置边界。
- 超过约 800 行有效逻辑时按同一里程碑内部串行拆分，但不能同时维护两套 owner。
- PR1 之后每个 PR 必须附“用户现在能做什么、还不能做什么”。
- 不在 PR3 顺手加入系统 scheduler。
- 不在 PR4 顺手加入托盘和登录项。
- 不在 PR5 顺手加入 Browser 或 Terminal。

## 12. 依赖和关键路径

```text
E0 contracts
  └─ M8.1 resource + UI
      └─ M8.2-A immediate real run
          └─ M8.2-B in-App scheduling
              └─ M8.2-C exit/missed/no residue
                  └─ M8.3 workspace/recovery/diagnostics
                      └─ R1
```

关键路径是：

1. 工作空间资源能稳定保存和恢复。
2. 已保存 revision 能立即生成真实文件。
3. 同一 runner 被 App 内 scheduler 触发。
4. 退出与重启不重复、不假运行、不留子进程。
5. 工作空间切换和失败恢复不破坏归属。

如果 M8.2-A 的真实 Markdown 仍未跑通，不允许进入 M8.2-B 调度开发。调度一个尚不可靠
的 runner 只会把失败定时化。

## 13. 风险、止损和降级

| 风险                         | 早期信号                                | 止损/降级                                  |
| ---------------------------- | --------------------------------------- | ------------------------------------------ |
| AgentBridge 无法稳定订阅终态 | 依赖轮询或 renderer 才知道完成          | 先增加最小 main listener，不做 scheduler   |
| Editor 路径边界不足          | Agent 可写 workspace 外文件             | 停止 M8.2，先实现 run-scoped policy        |
| Store 设计膨胀               | 同时引入数据库、迁移框架和通用队列      | 回到 JSON + JSONL + 有界 compaction        |
| 时间计算失控                 | 为 Cron/DST 引入大范围通用调度平台      | 只保留四种计划，时间计算封装为纯模块       |
| 退出无法有界                 | `will-quit` 长时间卡住或留下 Agent      | 固定 5 秒上限，未完成一律 interrupted      |
| 工作空间切换串任务           | 输出跟随当前 UI workspace               | 停止并修 correlation，不用取消掩盖归属问题 |
| UI 先行过久                  | 侧栏和 Tab 完成但真实文件一直不能生成   | 立即切到 M8.2-A 纵向闭环                   |
| 范围扩张到 Browser           | 开始设计持久确认和页面恢复              | 移回后续阶段，不占用首版关键路径           |
| 试图使用系统 scheduler       | 出现 LaunchAgent/cron/helper 代码或脚本 | 立即删除并复审，无 ADR 不得继续            |

### 13.1 60 分钟偏航检查

每 60 分钟固定回答：

1. 用户在真实 App 中新增了什么能力？
2. 这个能力是否能由用户亲手验证？
3. 当前还不能做什么？
4. 过去一小时是否只增加了测试、Schema、重构或抽象？
5. 下一小时交付哪个可见结果？

如果连续两次回答“没有新增用户能力”，停止当前横向工作，优先恢复最近一个未闭环的用户
动作。

## 14. `/grilling`

结论先说：首版成败不取决于时间表达式有多强，而取决于用户能否看到一个工作空间任务
在 App 存活时真实生成文件，并在 App 退出后确定它没有运行、没有遗留。

实施期间必须持续拷问：

1. 当前阶段结束后，用户究竟能多做哪一个动作？
2. 调度器是否只有一个主进程 owner 和一个 nearest-due timer？
3. App 退出后是否还有任何定时任务相关进程或系统注册？
4. 运行是否固定 task revision、workspaceRef 和输出目录，而不是读取当前 UI 状态？
5. Agent 请求工作空间外路径时，宿主能否硬拒绝？
6. 同一 occurrence 在 timer 重复回调或重启后是否可能执行两次？
7. renderer 重载后，运行事实是否仍能从主进程恢复？
8. 用户切换工作空间是否会改变后台任务归属或焦点？
9. 一次失败是否会阻断文件、Browser、Terminal 或普通 Agent 启动？
10. 是否为了未来 Browser、云端或后台常驻提前扩大了首版权限和生命周期？
11. `pnpm verify` 通过之外，真人是否真的完成了 H1–H10？
12. 当前汇报是否把 PR、测试数、代码量或内部状态包装成产品进度？

最该优先验证的是 M8.2-A：用真实 Agent 读取当前工作空间文件并写出一个受限 Markdown。
如果这个闭环不可靠，继续开发调度、时区、通知或诊断都只是在扩大失败面。
