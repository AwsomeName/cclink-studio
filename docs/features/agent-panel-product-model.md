# Agent Panel 产品模型与推进计划

> 当前产品规格。最后更新：2026-07-29。

## 结论

Agent Panel 是当前工作流的执行控制台，不是全局会话后台，也不是配置页。会话列表统一位于左侧工作区“会话”页，不再占用右侧 Agent Panel 的垂直空间。

工作台定稿为左侧管理、右侧执行：

```text
左侧工作区 / 会话
  搜索 + 新建 + 当前工作空间会话 + 已关闭历史

右侧 Agent Panel / Messages
  高密度 turn 视图，工具调用默认折叠

右侧 Agent Panel / Composer
  输入框 + 图片 + @资源 + /技能 + 发送
```

核心产品规则：

- 用户只理解 Thread / 会话，不理解 `assistant-panel`、`workbench-tab` 这类工程 surface。
- 左侧“会话”视图是会话列表的唯一入口，负责新建、切换、搜索、归档和工作空间级管理。
- 右侧 Agent Panel 只展示当前会话的 Messages 和 Composer，不再重复展示会话列表。
- 中间 Workbench 只打开同一个 Thread 的工作视图，关闭 Tab 不删除 Thread。
- Messages 默认展示结果和可审计摘要，不把每个工具事件铺成大卡片。
- Composer 区域承载下一条消息的上下文：输入、已挂载资源、`@`、`/`、发送。

本文统一使用“工作空间 / workspace”。产品文案、工程字段和持久化归属不再引入
“项目”作为同义领域对象。

## 会话心智

会话事实源是 Thread。

```text
Thread
├─ id
├─ title
├─ workspaceRef | null
├─ status
├─ messages
├─ mountedResources
├─ createdAt / updatedAt / archivedAt
└─ views
   ├─ agent rail current view
   └─ optional workbench tab view
```

Thread 是同一个东西，可以在右侧继续聊，可以在左侧管理，也可以在 Workbench 打开为任务 Tab。

不要把“右侧即时助手会话”和“中间工作会话”做成两种用户概念。工程上可以保留迁移字段，但产品表现必须收敛为同一个 Thread。

## 左侧会话工作区

### 会话列表 / 新建

通过左侧 Activity Bar 的“会话”图标进入，会话列表占用可复用的工作区侧栏宽度，不挤压右侧消息区。

```text
[ 会话                                      + ]
[ 搜索会话                                    ]

● 知乎登录排查          等待确认 · 20 条消息
● 修改文件预览          执行中 · 8 条消息
○ 新会话                刚刚 · 0 条消息

[ 已关闭 3 ]
```

排序规则：

1. 仅显示严格属于当前工作空间的 Thread；全局工作区显示未归档 Thread。
2. 当前与普通 Thread 按 `createdAt desc` 固定展示；`updatedAt` 只用于相对时间，运行或消息更新不得改变列表位置。
3. 已归档 Thread 收在“已关闭”分组，默认折叠。
4. 搜索覆盖标题、摘要、工作空间和运行状态。
5. 点击 Thread 切换右侧 Messages 和 Composer，不自动创建 Workbench Tab。
6. `+` 新建 Thread，绑定当前工作空间并立即显示在右侧。

每行展示：

- 状态点。
- Thread 标题。
- 简短状态或相对时间。
- hover / 更多菜单提供重命名、归档、在 Workbench 打开。

### 状态栏快速切换

状态栏中部显示严格属于当前工作空间、按创建时间倒序排列的最近 5 个未归档 Thread。
每项只显示 Thread 名称，最多 10 个 Unicode 字符；空间不足时继续使用单行省略，不增加
状态栏高度。点击后复用统一的 `agent.openConversation` 命令：右侧 Agent Panel 隐藏时唤出，
已经显示时切换对应 Thread。

状态栏只是 `agent-store` 的只读导航投影，不提供搜索、重命名、归档或删除，不保存第二份
会话状态；完整管理仍只属于左侧“会话”工作区。

## 右侧 Agent Panel 布局

### Messages

Messages 使用高密度 turn 视图。一次 assistant turn 合并展示，不再按 raw event 逐条铺开。

目标形态：

```text
我先确认当前浏览器状态，然后打开知乎登录页。

执行过程  2 个动作
▸ 浏览器导航              成功  1.2s
▸ 读取标签页信息          成功  0.1s

当前页面是知乎登录页。你可以继续告诉我要登录、检查元素，还是提取页面信息。
```

展示规则：

- 用户消息完整展示。
- 助手自然语言结果优先展示。
- 工具调用默认折叠为 timeline row。
- raw MCP 名称、JSON 参数、stdout/stderr 只在展开详情中展示。
- 连续工具事件合并为一个“执行过程”块。
- 连续思考/状态事件合并为摘要，不作为主视觉卡片反复出现。
- 错误和等待确认保持显眼，但仍遵守高密度布局。

工具标题必须产品化：

```text
mcp__cclink_studio__browser_navigate      -> 浏览器导航
mcp__cclink_studio__browser_get_tab_info  -> 读取标签页信息
fs_read_file                              -> 读取文件
terminal_run                              -> 运行命令
```

### Composer / 已挂载资源

Composer 是下一条消息的上下文区，已挂载资源必须靠近输入框。

```text
已挂载资源
@ 当前浏览器 Tab   @ README.md   @ 当前工作空间

[ 图片预览 ] [ 输入框                                  ]
[图片] [@资源] [/技能] [权限模式] [发送]
```

规则：

- `@` 挂资源：工作空间文件、打开 Tab、浏览器、Android/设备、任务产物、数据源记录等。
- 图片通过选择、粘贴或拖入添加，并作为模型原生视觉内容块随当前消息发送。
- 支持 PNG、JPEG、GIF 和 WebP；每次最多 5 张、单张最多 5MB。
- 图片正文只属于当前待发送消息，不写入工作空间和会话持久化快照；发送失败时保留以便重试，发送成功后立即从 Composer 清除。
- 历史用户消息只记录图片名称、类型和大小，不持久化 Base64 正文。
- `/` 挂 Skill：当前消息或当前会话要使用的流程能力。
- 资源 chip 可移除；资源过多时横向滚动或显示 `+N`。
- Agent 框架、模型、推理模式属于执行选择，可以在输入区底部以紧凑控件出现。
- Skill、模型、Provider、API Key、默认模式等长期配置只放设置页。

## 左侧与 Workbench 分工

左侧“会话”视图是 Thread Center：

- 完整历史。
- 搜索和过滤。
- 当前工作空间、未归档、已归档。
- 批量或长期管理。
- 打开到 Workbench 的入口。

右侧 Agent Panel 不承担 Thread Center，只显示当前 Thread 的 Messages 和 Composer。

Workbench 是 Thread 的深度工作视图：

- 打开同一个 Thread 的任务 Tab。
- 适合长任务、代码修改、浏览器自动化、文件编辑。
- 关闭 Tab 只是关闭视图，不关闭 Thread。

## 推进里程碑

| 里程碑                                  | 当前状态                                         |
| --------------------------------------- | ------------------------------------------------ |
| M1 统一 Thread 产品模型                 | 已实现                                           |
| M2 左侧会话工作区 / 新建                | 已实现                                           |
| M3 Messages 高密度 turn 视图            | 已实现                                           |
| M4 Composer / 已挂载资源                | 已实现，已补图片输入                             |
| M5 左侧 Thread Center 与 Workbench 联动 | 已实现                                           |
| M6 回归、迁移和视觉密度验收             | 自动化已覆盖；真实应用集中验收仍需随发布候选执行 |

### M1：统一 Thread 产品模型

目标：

- 收敛当前 `assistant-panel` / `workbench-tab` 的用户心智，建立 Thread 作为会话事实源。
- 明确右侧、左侧、Workbench 都是同一个 Thread 的不同视图。

方案：

- 梳理 `AgentConversationState`、Tab conversation 引用和 workspace snapshot 的字段含义。
- 保留必要兼容字段，但新增或抽象 presentation model，让 UI 不再按 surface 解释“会话类型”。
- 更新新建、切换、归档、恢复、Workbench 打开逻辑，使它们围绕同一个 Thread ID 运转。
- 左侧列表点击默认激活右侧 Thread；“在 Workbench 打开”作为显式动作。

验收标准：

- 右侧新建 Thread 后，左侧当前工作空间能看到同一个 Thread。
- 左侧点击 Thread 只切换右侧当前 Thread，不自动打开 Workbench Tab。
- 显式“在 Workbench 打开”后，中间 Tab 引用同一个 Thread ID。
- 关闭 Workbench Tab 不删除、不归档 Thread。
- 已有 workspace snapshot 能迁移或兼容恢复，不丢现有会话。

### M2：左侧会话工作区 / 新建

目标：

- 将会话切换和新建统一收口到左侧工作区“会话”页。
- 右侧 Agent Panel 只保留当前会话内容，释放纵向空间。

方案：

- 启用 `sessions` Activity 和既有 `SessionsSidebarView`。
- 复用 `getWorkspaceConversationGroups`，保持当前工作空间、未绑定和已关闭分组。
- `+` 新建 Thread 并绑定当前工作空间；无工作空间时进入未归档。
- 删除 Agent Panel 的 Quick Switcher、展开状态和独立宽度拖拽状态。

验收标准：

- 左侧 Activity Bar 可打开“会话”工作区，支持搜索、新建、切换和已关闭历史。
- 点击任一 Thread 立即切换右侧 Messages 和 Composer。
- 新建 Thread 后右侧立刻切到新 Thread，并出现在左侧列表。
- 右侧与居中 Agent Panel 均不再渲染第二份会话列表。
- 关闭左侧侧栏不影响当前会话继续运行。

### M3：Messages 高密度 turn 视图

目标：

- 降低消息流噪声，把工具调用、思考过程、状态事件合并为可审计但不抢主视觉的 turn。
- 让用户优先看到“结果、执行摘要、下一步”。

方案：

- 新增 `ConversationTurnViewModel`，将 raw messages / content blocks / tool events 聚合为 turn。
- 工具调用默认渲染为折叠 timeline row。
- 对 MCP/raw tool name 做产品化标题映射。
- 连续工具事件合并为“执行过程 N 个动作”。
- 详情展开后再显示 JSON 参数、原始工具名、输出和错误。
- 等待确认和失败状态保留高可见度。

验收标准：

- 浏览器导航、读取标签页信息等工具调用默认只占一行摘要。
- 展开工具 row 能看到 raw tool name、参数和结果。
- 一个 assistant turn 不再被拆成多张“思考过程”大卡片。
- 错误工具调用能在摘要行明确显示失败原因。
- 既有诊断日志仍能获取完整 raw event，不因 UI 折叠丢审计数据。

### M4：Composer / 已挂载资源

目标：

- 把已挂载资源移到输入区附近，明确它们是下一条消息上下文。
- 统一 `@资源`、`/技能`、发送和执行选项的位置。

方案：

- 将 MountedResourceBar 移到 Composer 区域顶部。
- 保留资源 chip 的移除能力，资源过多时横向滚动或折叠为 `+N`。
- Composer toolbar 保留 `@`、`/`、权限模式、发送。
- 输入框聚焦时，资源和技能候选菜单贴近 Composer 弹出。

验收标准：

- 已挂载资源不再占据消息历史上方的诊断行。
- 添加或移除资源后，当前 Thread 的 Composer 立即反映。
- `@` 可以挂文件、Tab、浏览器、工作空间资源。
- `/` 可以挂 Skill。
- 发送消息时携带当前 Composer 中的资源和 Skill 上下文。

### M5：左侧 Thread Center 与 Workbench 联动

目标：

- 左侧保留完整管理能力，右侧专注当前会话。
- Workbench 只作为 Thread 的深度视图，不制造第二套会话。

方案：

- 左侧按当前工作空间、未归档、已归档组织 Thread。
- 搜索、过滤、归档、恢复、删除放在左侧。
- 行内或右键提供“在 Workbench 打开”。
- Workbench Tab title、归档状态、关闭行为都引用 Thread 事实源。

验收标准：

- 左侧能搜索当前工作空间、未归档、已归档 Thread。
- 左侧归档 Thread 后，如果当前正在查看，右侧切换到合理 fallback。
- Workbench 打开的 Thread 与右侧切换到同一 Thread 时消息一致。
- 删除 Thread 前有确认；删除后相关 Workbench Tab 被关闭或进入明确不可用状态。

### M6：回归、迁移和视觉密度验收

目标：

- 确保新会话模型不会破坏本地启动、Agent 流式、工具确认和 workspace 恢复。
- 确保右侧视觉密度明显提升。

方案：

- 补齐 store/view-model 单元测试。
- 补齐 workspace snapshot 恢复测试。
- 用 Playwright 或本地手测覆盖左侧会话工作区、Messages 折叠、Composer 资源挂载。
- 更新本地 smoke check。

验收标准：

- `pnpm typecheck` 通过。
- Agent store、conversation view-model、workspace restore 相关测试通过。
- `pnpm dev` 可独立启动，不要求官方账号、云端 runtime 或生产 API。
- 缺少 adb 时应用仍可启动，Android 能力只降级。
- 右侧同一屏能看到更多有效 assistant 结果，工具详情默认不铺满消息流。

## /grilling

结论：这次重构的成败不在按钮位置，而在是否真正收敛为 Thread。

必须主动拷问：

1. 是否又在 Agent Panel 中复制出第二个会话列表？
2. 是否仍然让用户理解 `assistant-panel` / `workbench-tab`？
3. 是否只是把工具卡片缩小，而没有把 raw event 聚合成 turn？
4. 是否隐藏了审计信息，导致工具调用不可追踪？
5. 是否把官方账号、消息网络、订阅、额度或生产 API 带回 OSS 默认路径？
6. 是否破坏了独立启动、本地 Agent、本地工作空间、浏览器、Terminal 和 Android 降级能力？

下一步最该做的是完成 M6 发布候选真人验收，并把仍残留在代码和持久化字段中的
`project*` 兼容命名迁移到 `workspace*`。在这两项完成前，不能因为 UI 已经可用就
宣称会话模型和工作空间命名已经彻底收口。
