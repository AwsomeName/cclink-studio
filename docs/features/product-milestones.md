# Historical: 产品与架构里程碑

> 当前状态：历史里程碑记录，不再作为 CCLink Studio 当前路线事实源。
>
> 本文包含大量迁移前的 Remote、CCLink、subscription、sync、DeepInk 命名和商业能力里程碑。当前阶段计划以 `../architecture.md`、`../development.md`、`../cclink-studio-boundary-and-migration.md` 和后续新的 CCLink Studio roadmap 为准。

# DeepInk 产品与架构里程碑

> 状态：里程碑验收稿
> 最后更新：2026-07-15
> 关联文档：`docs/features/product-experience-pages.md`、`docs/features/ui-entry-migration-audit.md`、`docs/features/remote-error-model.md`、`docs/features/remote-codex-workspace-plan.md`、`docs/features/founder-operations-workbench.md`、`docs/features/local-first-identity.md`、`docs/features/project-operations-assistant.md`、`docs/features/agent-diagnostic-log.md`、`docs/features/hardware-workspace.md`、`docs/features/cad-conversion-plugins.md`、`docs/features/data-sources.md`、`docs/features/data-sources-development-plan.md`

## 结论

当前迁移不再用“继续优化”描述，而拆成可验收里程碑：

```text
M0 产品骨架定稿
M0.5 本地优先身份
M1 入口清理
M2 工作空间模型统一
M3 Tab 与工作现场统一
M4 会话模型统一
M5 远程能力闭环
M6 Terminal 与执行权限
M7 项目内运营助手
M8 硬件工作区与生产助手
M9 本机 Claude Code Agent 开源底座
M10 数据源与远程资料接入
```

当前判断：

- **M0 基本完成**：产品骨架已经明确为“工作空间 + Tab + 设置 + 右侧即时助手”。
- **M0.5 已实现，待人工体验验收**：本地身份、未登录进入工作台、workspace owner 和云能力门控已完成第一版。
- **M1 基本完成**：Activity Bar 已收敛，CCLink / Android / 同步配置不再作为一级日常入口。
- **M2 已打底**：本地/远程工作空间平铺，远程 transport 已从 CCLink 中解耦。
- **M3 部分完成**：Markdown、Browser、Android、Conversation、Remote File 和 Terminal 已进入 Tab 体系；Terminal 已有受控命令入口，但真实执行未接入。
- **M4 第一段完成**：会话已有即时助手会话 / 工作会话两类 surface，但生命周期还没收口。
- **M5 只完成 CCLink 设备发现链路**：能同步服务器不等于远程工作空间闭环完成。
- **M6 第一版受控执行已可测，M6.1 本地 PTY 链路已打通**：Terminal 已有 Tab、权限、审计、本地 `node-pty + xterm.js`、CCLink 单命令远程执行和输出事件；远程 PTY、Direct Remote 尚未完成。
- **M7 已实现到 M7.6 第一版，待人工验收**：项目内运营助手以“项目文档 + `deepink-accounts.json` + 文案会话 + 平台操作会话 + 发布记录 + 一键复制诊断日志”为第一版，不做独立运营平台。真实知乎/公众号测试前，还需要跑真实失败样本验收。
- **M8 规划完成，部分底座已实现**：硬件工作区以 AI 眼镜 FPC 外形改版为核心真实需求，主线调整为“读取/渲染相关文件 → 按用户要求修改副本 → 对比检查”；生产包检查底座已实现；STL/3MF 已进入内置模型预览；STEP/STP 作为可选 CAD 转换插件推进；嘉立创报价后移为后续生产闭环。
- **M9 已完成开源底座迁移，待人工体验验收**：Agent runtime、MCP ToolHost 和本机 Claude Code 后端已回收到本仓库。
- **M10 进入规划**：数据源作为新增内容入口，先支持 Elasticsearch 只读查询、结果 Tab、Agent 挂载和 MCP 只读工具，不做数据库管理器。

## 2026-07-14 优先级重排：先服务真实项目运营

新的近期目标不是继续泛化“全能 AI 桌面”，而是让 DeepInk 支持创始人自己的真实项目：

- CCLink 上线、内测、宣发、账号备注、站点运营和评论反馈维护。
- 在项目目录内保存平台入口、账号备注和浏览器 profile 配置。
- Markdown 文案生产，并通过浏览器提交到对应平台。
- AI 眼镜、硬件 PCB、游戏资产等项目的资料整理和网页操作。
- 多个远程服务器项目的调试、维护、日志查看和受控执行。

优先级调整：

| 能力                            | 新优先级 | 原因                                                                                                |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| 远程项目支持                    | P0       | 这是当前最急的真实需求；需要远程工作空间、远程文件、远程 Terminal / Agent 执行闭环                  |
| 项目内运营助手                  | P0       | 直接服务 CCLink 上线、内测、宣发和平台维护；第一版只做项目文件、Markdown、浏览器 profile 和确认提交 |
| 硬件工作区与生产助手            | P0/P1    | 直接服务 AI 眼镜 FPC 外形改版；先做 Gerber/FPC 渲染、标注、低风险外形修改副本和对比检查             |
| 本地优先身份                    | P0 前置  | 不登录也必须进入工作台并恢复本机工作现场；登录只解锁云能力                                          |
| 平台浏览器 Profile              | P0/P1    | 平台登录态要能按项目配置复用；不做密码库和全自动登录                                                |
| 数据源与远程资料接入            | P0/P1    | 本地写作和运营需要直接使用远程采集项目里的 ES/数据库资料；第一版只读查询并挂载给 Agent              |
| Android 真机连接                | P2       | 只保留用户自有手机 USB / Wi-Fi 连接，不再推进模拟器或云手机                                         |
| IM / 记忆 / 云盘 / 垂直行业集成 | P2+      | 重要但不应抢近期可用闭环                                                                            |

Android 新决策：

- 不再推进本地 Android 模拟器。
- 不再考虑云手机。
- 现有 Android 代码进入抽离、封存、可选能力状态。
- 后续只考虑用户自己的真实手机，通过 USB 或 Wi-Fi ADB 连接。

新的近期验收主线：

1. **远程项目维护闭环**：添加远程工作空间、浏览文件、打开文件、打开远程 Terminal、执行受控命令、错误可定位。
2. **项目内运营闭环**：Markdown 写文案、项目内保存平台账号配置、浏览器保持登录态、Agent 可见操作网页、提交内容、保存发布结果和反馈。
3. **本地工作台恢复闭环**：未登录也能进入工作台，重启后恢复本机工作现场，登录/登出不清本地状态。

拷问：

如果 DeepInk 不能帮你完成一次真实 CCLink 宣发，或者不能维护一个真实远程项目，那么它还没有达到“可用”。Android、IM、云盘、记忆系统都可以晚一点；远程项目和浏览器文案流不能再晚。

补一刀：如果不登录就不能进入工作台，DeepInk 也还没有达到桌面软件的基本可用。登录应该解锁云能力，而不是拦截本地工作。

## M0：产品骨架定稿

### 解决什么问题

避免 Activity Bar、Sidebar、Workbench Tabs、Settings、右侧 Agent Panel 继续混着承担职责。

### 方案

DeepInk 的第一层产品骨架固定为：

```text
工作空间：组织归属
Tab：承载工作现场
Settings：管理账号、连接、设备、诊断
右侧 Agent Panel：即时助手、确认、轻量协作
```

用户侧不再引入 `Space`、`Workbench`、`远程 Agent 面板` 这类额外概念。

### 验收标准

- 产品文档清楚说明：工作空间是主入口，Tab 是工作现场，Settings 管系统配置。
- Remote、CCLink、Codex、Terminal 的关系清楚：Remote 是位置，CCLink 是 transport，Codex 是执行后端，Terminal 是 Tab。
- 后续新增功能时，能回答“它属于工作空间、Tab、Settings、右侧助手中的哪一个”。

### 当前状态

基本完成。核心规则已写入 `docs/features/product-experience-pages.md`。

### 拷问

如果一个新能力无法归入工作空间、Tab、Settings、右侧助手或资料内容入口，优先怀疑产品模型，而不是立刻新增一个 Activity Bar 入口。

## M0.5：本地优先身份

### 解决什么问题

DeepInk 现在仍是“未登录只显示 LoginPage”。这导致本地工作台、工作现场恢复、Markdown 草稿、本地 Terminal 和浏览器状态都被云登录挡住。

这不符合桌面工作台心智。用户第一次打开 App，应该立即进入本机工作现场；登录只影响云同步、订阅、CCLink/TIM、跨设备和好友协作。

### 方案

新增本地身份作为产品底座：

```text
LocalIdentity
├─ localId: local_xxx
├─ deviceId
├─ deviceName
├─ createdAt
├─ updatedAt
└─ boundCloudUserId?
```

运行时始终存在 `localIdentity`，登录后额外存在 `cloudIdentity`：

```text
EffectiveIdentity = LocalIdentity + optional CloudIdentity
```

工作台状态按本地身份和工作空间归属恢复：

```text
ownerKey = local:${localId}
workspaceKey = null | localPath | cclink://... | direct://...
```

阶段拆分：

1. `L1 本地身份服务`：主进程生成/读取 `userData/local-identity.json`，暴露 IPC。
2. `L2 登录守卫重构`：未登录也进入 `MainLayout`；登录页变成可选入口。
3. `L3 状态恢复接入身份`：旧 workspace state 迁移到当前 local identity，未登录重启可恢复。
4. `L4 云能力门控`：CCLink、同步、订阅等需要 cloud session；登出不清本地工作台。

详见 `docs/features/local-first-identity.md`。

### 验收标准

- 无 token、无网络、未配置 `DEEPINK_API_URL` 时仍能进入主工作台。
- 首次启动生成稳定 `localId`，重启后不变。
- 未登录打开 Tab、Markdown 草稿、浏览器页、本地工作空间后，重启能恢复。
- 登录成功不覆盖本地工作现场。
- 登出只清云 token、CCLink identity 和云能力状态，不清 tabs/drafts/workspace state。
- CCLink、订阅、云同步等云能力入口在未登录时提示登录，而不是让主工作台不可用。

### 当前状态

L1-L4 已实现，进入人工体验验收：

- 主进程已生成/读取 `userData/local-identity.json`，并通过 `window.deepink.identity.getLocalIdentity()` 暴露。
- `App.tsx` 已移除云登录硬守卫，未登录也进入 `MainLayout`。
- `WorkspaceStateSnapshot.ownerKey` 已接入 `local:${localId}`，并兼容旧无 owner 快照。
- 设置页账户区已区分“本机身份”和“DeepInk 账号”，CCLink 云能力在未登录时提示登录并禁用关键操作。
- 验证：`pnpm test -- --run`、`pnpm build`、`git diff --check` 均通过。

### 拷问

如果这一步不做，后续所有“恢复工作现场”“运营账号环境”“本地项目维护”都会依赖登录状态，产品会被云账号绑架。先把本地身份打稳，再做账号绑定和云同步。

## M1：入口清理

### 解决什么问题

左侧入口像调试台：CCLink、Android、同步、远程 Agent、文件、会话都挤在一起，用户分不清“工作内容”和“系统配置”。

### 方案

Activity Bar 收敛为工作内容入口和设置入口：

```text
工作空间 / 搜索 / 浏览器 / 数据源 / 设置
```

其中：

- 工作空间承载本地/远程工作空间、文件、会话、草稿、未归档。
- 浏览器作为网页内容库保留。
- 数据源作为资料入口保留，用于连接远程 ES/数据库、执行只读查询、打开查询结果 Tab，并把结果挂载给 Agent。
- 设置承载账号、同步、远程连接、Android、诊断、模型后端。
- CCLink 不再是一级入口，只是 `设置 > 远程连接` 中的一种连接通道。
- Android 管理不再是一级入口，Android 运行态只是一个 Tab。

### 验收标准

- Activity Bar 没有 CCLink、远程 Agent、Android 管理、同步配置入口；数据源入口只承载查询和资料浏览，不承载敏感凭证管理。
- Settings 左侧没有“远程 Agent”作为产品名，统一叫“远程连接”。
- 工作空间面板只展示工作内容，不展示账号导入、配对、缓存清理。
- Status Bar 只显示轻量状态，不变成第二个设置页。

### 当前状态

基本完成。仍需人工体验验收工作空间 Sidebar 是否视觉上仍显得拥挤。

### 拷问

如果用户说“左侧还是乱”，不要马上恢复入口，而要检查工作空间 Sidebar 内部层级、折叠策略和视觉权重。数据源能成为一级入口，是因为它是资料内容入口；这不代表每个连接配置都可以升到 Activity Bar。

## M2：工作空间模型统一

### 解决什么问题

远程工作空间不能被 CCLink 绑死。用户可能通过公网 IP、内网 IP、VPN、SSH、远端 Agent、CCLink 等多种方式进入远程目录。

### 方案

本地和远程都叫工作空间，只用 badge 和元信息区分：

```text
[本地] GAME
[本地] DeepInk
[远程 · CCLink] supermicro /data/research
[远程 · 直连] Mac mini /Users/app/project-a
```

远程工作空间字段中必须有 `transport`：

```text
transport: local | direct | cclink
```

### 验收标准

- 本地和远程工作空间平铺展示，不新增“服务器”一级目录。
- CCLink 只是 transport，不是 remote 的同义词。
- 增加 Direct Remote 时，不需要重写工作空间列表、Tab 归属和状态恢复。
- 工作空间切换时，文件树、会话、Tab 集合跟随当前工作空间切换。

### 当前状态

模型已打底；真实 Direct Remote 协议未实现。

### 拷问

“能看到三台服务器”只说明设备发现成功，不说明远程工作空间完成。真正的闭环是：文件、会话、执行、状态、错误定位都归入同一个工作空间模型。

## M3：Tab 与工作现场统一

### 解决什么问题

过去 `+`、浏览器图标、Android、Markdown、会话各自为政，用户不知道“我要新开一个东西”到底去哪里。

### 方案

所有可恢复的工作现场都进入 Tab：

```text
Markdown
Browser
Android
Conversation
Remote File
Settings
Preview
Terminal（模型已进入，执行闭环后续）
```

Tab 栏 `+` 是“新建 Tab 菜单”，不是“新建 Markdown”。

### 验收标准

- `+` 可新建 Markdown、浏览器页、Android 页、工作会话。
- 浏览器图标可以作为高频快捷入口保留，但不是唯一入口。
- Android 是 Tab 能力，不是 Activity Bar 内容库。
- Word / PPT / Terminal 不做假 Tab；没有闭环前最多标记为规划中。
- 切换工作空间时，Tab 集合跟着切换。

### 当前状态

部分完成。`conversation`、`remote-file` 和 `terminal` 已进入 Tab 类型；其中 `terminal` 已有受控命令入口和权限/审计内核，但未接真实执行。

### 拷问

不要把“菜单里能点出来”当完成。每个 Tab 都必须回答：归属哪个工作空间、如何恢复、关闭是否删除、错误如何展示。

## M4：会话模型统一

### 解决什么问题

右侧 Agent 会话、工作空间会话、远程会话、CCLink 会话容易混成四种东西，实际应该是同一个 conversation 模型的不同运行位置和展示形态。

### 方案

会话按项目归属组织。只要当前有激活项目，新会话就挂靠当前项目；没有激活项目时，新会话挂靠默认项目 / 未归档。

会话展示形态分为两类：

```text
即时助手会话：右侧 Agent Panel，属于当前项目，轻量协作
工作会话：Workbench conversation Tab，归属工作空间，可恢复、可长期保存
```

底层字段方向：

```text
conversation
├─ surface: assistant-panel | workbench-tab
├─ workspaceRef / projectRef
├─ runtime
│  ├─ location: local | remote
│  ├─ transport: local | direct | cclink
│  └─ backend: deepink-agent | codex | claude-code | custom
└─ sessionId / messages / artifacts / status
```

会话入口布局：

```text
左侧 Activity Bar「会话」视图：当前项目会话 / 未归档 / 已归档历史
右侧 Agent Panel：当前对话 / 待确认操作 / 资源挂载 / 输入区
```

会话列表不再放在右侧 Agent Panel 内部。右侧只服务当前对话；历史和会话切换统一进入左侧侧栏。

输入增强规则：

```text
/ 挂 Skill
@ 挂资源：项目文件、文档 Tab、浏览器 Tab、Android/设备 Tab、任务产物等
```

会话顶端展示当前会话已挂载资源横列；输入区底部选择 Agent 框架、模型和推理模式。Skill、模型、Provider、API Key、默认模式等长期配置全部进入设置页。

### 验收标准

- 有激活项目时，新会话创建当前项目即时助手会话，不自动占用主工作区 Tab。
- 无激活项目时，新会话创建默认项目 / 未归档即时助手会话。
- 左侧“会话”视图能展示当前项目激活会话、未归档会话和已归档历史。
- 右侧 Agent Panel 不再出现会话历史列表。
- 会话顶端展示已挂载资源横列。
- 输入框 `/` 能挂 Skill。
- 输入框 `@` 能挂资源。
- 输入区底部能选择 Agent 框架、模型、推理模式。
- Skill、模型、Provider 等长期配置不出现在 Agent Panel 中，只在设置页。
- 工作空间里的“新建工作会话”创建 `conversation` Tab。
- 远程会话不叫 CCLink 会话，只显示运行位置和连接通道。
- 关闭工作会话 Tab 只关闭视图，不删除会话；删除必须是显式动作。
- 隐藏右侧面板、切换布局、关闭某个 Tab，不导致消息流丢失。

### 当前状态

第三段推进中。已有 `surface/runtime` 字段和 `conversation` Tab；本地工作会话与 CCLink 远程会话已共用 `ConversationShell` 页面外壳，并新增 `resolveConversationTab` 统一解析 Tab 运行目标。会话 store 已补 `archivedAt` 生命周期字段，以及归档、恢复、删除三个显式动作。远程会话发送失败不再被 store 吞掉，provider 会返回失败并让页面展示错误；缺失会话已返回结构化 `execution-backend` 错误。旧 `cclink` Tab 兼容字段仍在，说明模型尚未完全收口。

### 拷问

会话统一不能只验“能发消息”。还要验：归属、恢复、关闭、删除、重启后恢复、右侧面板隐藏后的流式消息。

## M5：远程能力闭环

### 解决什么问题

当前远程主要靠 CCLink，且刚跑通账号同步和服务器发现。产品上还没有形成完整远程工作空间能力。

M5 的详细拆解以 `docs/features/remote-codex-workspace-plan.md` 为准：Remote 是 DeepInk 付费工作空间能力，DeepInk 主项目负责 Remote 工作台，private-serv 控制账号和 entitlement，chatcc-agent 作为唯一远端 runtime，CCLink 是首发 transport，Direct 是后续 transport。

### 方案

把远程能力拆成 provider：

```text
Remote Workspace
├─ provider: cclink
└─ provider: direct
```

文件、会话、Terminal、状态、错误都走统一 workspace runtime。

### 验收标准

- CCLink 同步到的服务器能作为远程工作空间出现。
- 远程文件树可读，远程文件可打开为只读 Tab。
- 远程会话可打开为工作会话 Tab。
- 出错能定位到：账号、transport、远端 Agent、文件 provider、执行后端中的哪一层。
- Direct Remote 接入时不新增独立 Activity Bar，不改变工作空间主模型。
- 远程错误遵循 `docs/features/remote-error-model.md`，错误码描述失败语义，context 描述发生现场。

### 当前状态

CCLink 设备发现与服务器同步链路已阶段性可用；CCLink 服务器工作区已能稳定映射为远程工作空间引用；远程文件链路已有结构化错误码；Direct Remote 未做；远程 Terminal 未做。

## 2026-07-12 M5 远程工作空间映射收口记录

### 已确认

- 新增 `remote-workspaces` 工具层，把 CCLink 的 `server.workspaces` 平铺为 DeepInk 的远程工作空间引用。
- 远程工作空间 key 由 `transport + endpointId + workspaceId` 生成；服务器显示名变化只影响来源文案，不影响工作空间 key。
- 远程会话列表按当前远程工作空间过滤，并按更新时间倒序展示。
- 远程会话归档仍是 DeepInk 本地视图覆盖：不会污染未归档列表，也不会删除远端历史。
- Sidebar 不再内联拼装 CCLink 工作空间映射，改为消费同一套工具函数。

### 仍未完成

- 这一步只证明“服务器工作区 → 远程工作空间引用”稳定，不证明远程文件、远程会话、远程执行已经形成闭环。
- 远程错误归因还很粗：账号、实时 transport、远端 Agent、文件 provider、执行后端的错误边界还没有统一展示。
- Direct Remote 还没有 provider；当前远程工作空间仍主要依赖 CCLink。

### 拷问

如果远端 Agent 离线、文件 provider 未接入、账号过期同时发生，用户看到的不能只是一句“失败”。M5 下一步必须把远程错误分层，否则远程工作空间只是一个漂亮入口。

## 2026-07-12 M5 远程错误归因第一版

### 已确认

- 新增 `remote-error` 分类层，把远程错误分为账号、实时链路、远端 Agent、远程工作空间、文件 Provider、执行后端、未知来源。
- 远程文件树错误、远程目录展开错误、远程只读文件 Tab 错误、CCLink 远程会话错误都接入 `RemoteErrorNotice`。
- 错误展示不再只有原始 message，而是包含来源标签、原始错误和下一步建议。
- 已补分类测试，覆盖账号、transport、远端 Agent、工作空间、文件 provider 和会话默认执行后端。

### 仍未完成

- 这一步已覆盖 renderer 展示层，但主进程结构化错误码还只打通远程文件链路。
- 多层同时失败时仍只能展示一个主要来源；后续需要所有 provider 返回 `layer/code/retryable/context`。
- 远程错误还没有统一写入诊断日志或运维台。

### 拷问

如果错误来源只靠字符串匹配，长期一定会脆。下一步应该把 conversation provider、request router、未来 direct provider 的错误结果升级为结构化错误，而不是继续堆正则。

## 2026-07-12 M5 远程文件结构化错误收口记录

### 已确认

- `CclinkFileTreeResult` 与 `CclinkFileReadResult` 新增 `remoteError`，包含 `layer/code/message/retryable/context`。
- CCLink 远程文件服务已把 transport 不可用、远端设备不存在、设备离线、工作空间缺失、文件 provider 响应异常归入结构化错误。
- request router 已保留远端协议错误类型，远端返回 `cc_type: error` 时不会再被文件服务误判为实时链路不可用。
- renderer 的 `RemoteErrorNotice` 优先消费主进程 `remoteError`，没有结构化错误时才退回字符串分类。
- 远程文件树、远程目录展开、远程只读文件 Tab 都可以显示更明确的错误来源和下一步动作。

### 仍未完成

- 远程 conversation provider 已修掉“store 吞错误导致 provider 假成功”的问题；缺失会话已升级为结构化 `remoteError`。
- 远程 conversation provider 还没有全量结构化错误，实时发送链路接 TIM 后仍要继续验证真实拒绝和权限失败。
- request router 的 timeout、transport 发送失败、协议不兼容、非预期响应已进入结构化错误码表，但还没有形成正式协议文档。
- Direct Remote 未接入，当前结构化错误只证明 CCLink 文件 provider 的第一段闭环。

### 拷问

“错误可定位”不能只靠 UI 展示得更漂亮。真正的完成标准是：用户报一张截图时，我们能从 `layer + code + context` 直接判断是账号、链路、远端 Agent、文件 provider 还是执行后端，而不是继续翻三天缓存和云函数。

## 2026-07-12 M5 远程会话消息错误收口记录

### 已确认

- 抽出共享 `remote-error` 类型，CCLink IPC 与 ChatCC 消息模型共用同一套 `layer/code/message/retryable/context`。
- `ChatccSystemMessage` 可携带 `remoteError`，远端错误不再只能显示在 Tab 顶部，也能沉淀到会话历史消息里。
- `stream_end(error)` 写入 `REMOTE_STREAM_ERROR`，归为 `execution-backend`。
- 会话内 `cc_type: error` 写入远端 `error_type`，默认归为 `execution-backend`。
- 远程会话气泡遇到带 `remoteError` 的 system 消息时，直接渲染 `RemoteErrorNotice`。

### 仍未完成

- 实时发送链路真正接 TIM transport 后，还需要把 send request timeout、远端拒绝、权限确认失败都升级为结构化错误。
- 当前 `cc_type: error` 默认归为 `execution-backend`，未来如果远端能明确返回账号、workspace、file-provider 层级，应直接透传 layer。
- 远程会话消息还没有统一到本地 Agent 的 `AgentMessage / ContentBlock` 结构。

### 拷问

会话里的错误必须能“留案底”。如果错误只存在顶部 toast 或 store.error，用户刷新、切 Tab、重启之后就丢证据。远程能力越复杂，越不能把失败当即时提示处理。

## 2026-07-12 M5 实时链路错误码收口记录

### 已确认

- request router 新增带 `remoteError` 的 `CclinkRequestLayerError` 基类。
- transport 未连接返回 `REMOTE_TRANSPORT_UNAVAILABLE`，归为 `transport`。
- transport 发送失败返回 `REMOTE_TRANSPORT_SEND_FAILED`，归为 `transport`。
- request 超时返回 `REMOTE_REQUEST_TIMEOUT`，归为 `transport`。
- 协议版本不兼容返回 `REMOTE_PROTOCOL_INCOMPATIBLE`，归为 `remote-agent`，不可重试。
- 非预期响应类型返回 `REMOTE_UNEXPECTED_RESPONSE`，归为 `remote-agent`。
- 文件服务会合并 request router 的 `remoteError` 与文件上下文，保留 `serverId/workspaceId/path/operation`。

### 仍未完成

- 这只是本地 request router 的错误码表，远端 agent 还不能主动携带 `layer`。
- 权限确认失败、取消生成、远端会话不存在等业务错误仍需要继续补协议级错误码。
- Direct Remote 未来需要复用 `REMOTE_*` 通用语义码，再通过 `context.transport` 区分 direct / cclink。

### 拷问

错误码不能只是“给 UI 好看”。它必须服务排障：同一张截图应该能判断是链路发不出去、远端协议旧、远端返回错类型，还是文件 provider 自己失败。

## 2026-07-12 M5 通用远程错误码收口记录

### 已确认

- 新增共享 `REMOTE_ERROR_CODE`，作为 CCLink 与未来 Direct Remote 共用的错误码来源。
- request router 不再产生 `CCLINK_*` 错误码，改为 `REMOTE_TRANSPORT_UNAVAILABLE`、`REMOTE_TRANSPORT_SEND_FAILED`、`REMOTE_REQUEST_TIMEOUT`、`REMOTE_PROTOCOL_INCOMPATIBLE`、`REMOTE_UNEXPECTED_RESPONSE`。
- CCLink 文件服务、远程会话缺失、流式错误默认值都改为消费共享错误码常量。
- CCLink 仍可以作为 transport 名出现在类名、日志和 context 里，但错误码语义不再绑定 CCLink。

### 仍未完成

- DeepInk 侧已声明并兼容接收 `layer/code/context`；目前多数远端错误仍通过旧 `error_type` 兼容。
- 还需要 chatcc-agent 真正发出 `layer/code/context`，让远端也参与错误分层。
- Direct Remote 接入前，还要检查 UI 文案是否仍把 “remote” 默认为 CCLink。

### 拷问

如果错误码还带产品实现名，后续每接一个 transport 都会复制一套错误。真正稳定的模型应该是：错误码描述“失败语义”，context 描述“哪个 transport / 哪台设备 / 哪个工作空间”。

## 2026-07-12 M5 远程错误模型文档记录

### 已确认

- 新增 `docs/features/remote-error-model.md`，正式定义 `RemoteError` 的 `layer/code/message/retryable/context`。
- 明确 `code` 描述失败语义，`context` 描述发生现场。
- 明确 CCLink、Direct Remote、未来远程 Terminal 必须复用 `REMOTE_*` 通用错误码。
- 明确 provider 责任边界：transport、remote-agent/protocol、workspace、file-provider、execution-backend 分层处理。

### 仍未完成

- DeepInk 侧已沉淀远端 Agent 协议改造说明；chatcc-agent 还没有实际返回 `layer/code/context`。
- 设置页诊断入口还没有按 `RemoteError` 建立统一日志索引。
- 远程 Terminal 的权限拒绝、命令失败、进程退出还没有套进该模型。

### 拷问

文档不是完成本身。后续每新增一个远程 provider，都必须先回答：它产生的错误属于哪个 layer，用哪个通用 code，context 能否让我们复现问题。

## 2026-07-12 M5 远端错误协议兼容记录

### 已确认

- `ChatccErrorMessage` 已支持 `layer/code/retryable/context`，不再只依赖旧字段 `error_type`。
- DeepInk 主进程处理 `cc_type: error` 时优先保留远端给出的结构化错误字段。
- 旧版 `error_type` 仍兼容：默认归为 `execution-backend`，`code = error_type || REMOTE_AGENT_ERROR`。
- 本地会自动合并接收现场 `serverId/sessionId/requestId`，远端只需要提供真正业务现场，例如 `workspaceId/path/operation`。
- 已补测试覆盖新版结构化错误，验证 `workspace` 层错误不会被降级成通用执行后端错误。

### 仍未完成

- chatcc-agent 远端实现还需要真正发出新版 `layer/code/retryable/context`，否则 DeepInk 只能继续兼容旧 `error_type`。
- 已新增 `docs/features/chatcc-agent-structured-error-protocol.md`，可直接转交给 chat-cc 会话作为改造说明。
- 协议版本号暂未升级；当前是“可选字段兼容”，不是强制远端升级。
- Direct Remote provider 尚未接入，未来也必须复用同一套协议语义。

### 拷问

这次修的是“本地能不能接住结构化错误”，不是“远端已经会发”。下一步如果 chatcc-agent 仍只返回字符串，DeepInk 不应该再猜，而应该推动远端补协议字段。

### M5 总拷问

不要把 CCLink 运维排障当成产品体验。运维台可以存在，但日常产品必须表现为“我打开了一个远程工作空间”。

## M6：Terminal 与执行权限

### 解决什么问题

Terminal 是高风险执行能力。没有权限模型就直接接 shell，会制造安全洞和不可解释的远程副作用。

### 方案

先定义 Terminal Tab 的产品和权限模型，再接真实 shell：

```text
Terminal Tab
├─ workspaceRef
├─ runtime: local | remote
├─ transport: local | direct | cclink
├─ permissionPolicy
├─ auditLog
└─ process/session lifecycle
```

### 验收标准

- Terminal 是当前工作空间下的 Tab，不是全局入口。
- 本地 Terminal 和远程 Terminal 只差 runtime，不差入口模型。
- 危险命令有确认、权限策略或审计记录。
- 远程 Terminal 不继承本机宽权限。
- 关闭 Terminal Tab 的语义明确：关闭视图、结束进程、还是后台保留。

### 当前状态

第一版模型已开始落地：

- 新增 `docs/features/terminal-tab-model.md`，定义 Terminal Tab 的 runtime、权限策略、关闭策略、审计事件和错误模型。
- 新增 `src/shared/terminal.ts`，把 Terminal 工作现场建模为 `TerminalTabRef`。
- 新增 `src/main/terminal/terminal-audit-store.ts`，本地持久化 Terminal 审计事件。
- 新增 `src/main/terminal/terminal-session-state.ts`，提供 Terminal session 状态机，拦截非法生命周期迁移。
- 新增 `src/main/terminal/terminal-session-registry.ts`，提供主进程内存 session 登记、查询、状态迁移和移除边界。
- 新增 `src/main/terminal/terminal-command-orchestrator.ts`，把命令提交前的权限判定、确认请求、审计写入、session 状态迁移和 execution adapter 派发串成可测试闭环；执行后端成功接收时返回 `execution: started`。
- 新增 `src/main/terminal/terminal-execution-adapter.ts`，定义未来本地 shell、远程 shell、Codex/custom backend 的统一执行适配器接口。
- 新增 `src/main/terminal/terminal-local-shell-adapter.ts`，用本地 shell 子进程执行本地 Terminal 命令。
- 新增 `src/main/terminal/terminal-cclink-execution-adapter.ts`，通过 CCLink `terminal_command/terminal_output` 执行远程单命令。
- 新增 `src/main/terminal/terminal-composite-execution-adapter.ts`，按 runtime 路由 local / cclink 执行后端。
- 新增 `src/main/terminal/terminal-noop-execution-adapter.ts`，保留不会执行 shell 的 no-op backend，用于未接后端的结构化错误测试。
- 新增 `src/main/terminal/terminal-permission.ts`，提供命令风险分类和 `allow/confirm/deny` 权限判定。
- 新增 `src/main/terminal/terminal-confirmation-service.ts`，提供 Terminal 命令确认请求、60 秒超时拒绝、窗口销毁拒绝、发送失败拒绝和审计写入。
- 新增 `src/main/ipc/terminal-ipc.ts`、`src/shared/ipc/terminal.ts`、preload `terminal` API，把 Terminal 确认请求/响应、审计查询/清理接入 IPC 边界。
- 新增 `src/renderer/src/stores/terminal-store.ts` 和 `use-terminal-events.ts`，前端可接收并缓存 Terminal 待确认命令。
- 新增 `src/renderer/src/components/agent-panel/TerminalConfirmationCards.tsx`，在 Agent 面板消息流展示 Terminal 命令确认卡片。
- 新增 `src/renderer/src/utils/terminal-confirmation.ts`，集中维护 Terminal 风险/来源/运行位置/超时显示。
- 新增 `src/renderer/src/utils/terminal-tab.ts`，集中生成本地 / 远程 / 未归档工作空间的 Terminal Tab 占位 runtime 和权限策略。
- 新增 `src/renderer/src/utils/terminal-lifecycle.ts`，把 Terminal 创建、关闭、终止语义通过受限 IPC 写入审计。
- 新增 `src/renderer/src/utils/terminal-command.ts`，把 Terminal Tab 的用户命令提交到受限 IPC，并在恢复后的 session 缺失时重新登记生命周期后重试一次。
- `terminal:recordLifecycleEvent` 已接入 `TerminalSessionRegistry`：`created` 带 runtime 时登记 session，`closed` 移除 session，`terminated` 对可迁移 session 收口到 `exited` 后移除。
- `terminal:listSessions` 已提供只读 session 快照查询，用于设置页诊断 Registry 与 Tab 生命周期是否对齐。
- `terminal:submitCommand` 已提供受限提交 IPC，输入会先做 actor、命令和权限策略规整；权限通过后会触达 composite execution adapter，把输出、退出和错误事件推给 renderer，并写入审计。
- `terminal:executionEvent` 已通过 preload 暴露给 renderer，Terminal Tab 输出面板可显示 stdout/stderr/system/error。
- `src/renderer/src/utils/close-tab.ts` 已识别 Terminal 活跃状态与 `closePolicy`；活跃 Terminal 关闭前需要确认结束进程或只关闭视图。
- 设置页 `Agent` 分组新增 `Terminal 审计`，可查看当前 Terminal session 快照、最近 30 条审计事件、刷新和清空全部审计。
- `TabType` 已新增 `terminal`，`Tab` 已新增 `terminal?: TerminalTabRef`。
- Workbench 新建菜单已提供 `Terminal` 项；Terminal Tab 已有受控命令入口和输出面板，避免创建或快照恢复后出现空白工作区。
- Tab store 已支持 Terminal Tab 快照恢复，能保留 `workspaceRef/runtime/permissionPolicy/closePolicy/auditLogId`。
- Terminal 审计测试已覆盖写入、重载、按 session/workspace 过滤、limit 和清理。
- Terminal 权限测试已覆盖只读、写入、网络、破坏、提权、unknown、allowlist/denylist 和四种策略模式。
- Terminal 确认服务测试已覆盖请求结构、允许/拒绝、超时、窗口销毁、发送失败、服务销毁和审计失败不阻塞确认。
- Terminal IPC / 前端状态测试已覆盖确认结果回传、受限命令提交、session 快照查询、审计查询/清理、生命周期事件同步 registry、未命中 pending、队列添加、去重和移除。
- Terminal UI 辅助测试已覆盖风险/来源标签、运行位置和超时显示。
- Terminal 命令提交辅助测试已覆盖正常提交、空命令拦截、恢复后 session 缺失时重新登记并重试。
- Terminal 本地 PTY adapter 测试已覆盖启动、输出事件、写入、resize、终止和远程 runtime 拒绝。
- Terminal 本地 shell adapter 仍保留测试覆盖，作为非 PTY 降级参考。
- Terminal CCLink 远程 adapter 测试已覆盖 `terminal_command`、`terminal_output` 和远端离线结构化错误。
- Terminal session 状态测试已覆盖创建、`idle -> starting -> running -> blocked -> running -> exited` 生命周期、终态拦截、重复登记、未知 session 和移除清理。
- Terminal 执行编排测试已覆盖低风险命令直通、风险命令确认、确认拒绝、只读策略拒绝、缺失/忙碌 session 拒绝、adapter start/write 派发失败审计；adapter 成功时返回 `execution: started`，失败时返回 `execution: not-started`。
- Terminal no-op 执行适配器测试已覆盖 start/write/resize/terminate 的结构化错误、事件派发和监听取消。

本地 PTY 已接入，Direct Remote 和远程 PTY 仍未接。当前能创建受控 Terminal Tab、用 xterm.js 操作本地 shell、从现有命令提交链路进入权限/确认/审计/执行、通过 CCLink 发送远程单命令、查看只读 session 诊断与最小审计入口、确认活跃 Terminal 关闭语义，并在主进程内用状态机、Registry、执行编排器和 adapter 约束 session/命令生命周期。

### 拷问

Terminal 不应该作为“顺手加个 Tab 类型”实现。它是权限系统、远程执行、审计、进程生命周期的交汇点。

## M7：项目内运营助手

### 解决什么问题

DeepInk 需要先服务真实项目的宣发、上线、内测和账号运营，但第一版不能做成复杂的社媒管理平台。

用户真正需要的是：

```text
在项目目录里写文案、保存平台信息、打开平台页面、让 Agent 填内容、发布前确认、结果写回项目文档。
```

工作区仍然是项目目录。平台不是工作区，平台只是项目里的配置；会话负责完成文案或网页操作任务。

### 方案

项目目录约定：

```text
项目目录
├─ README.md
├─ docs/
│  ├─ 宣发方案.md
│  ├─ 公众号首发稿.md
│  ├─ 知乎版本.md
│  └─ 发布记录.md
└─ deepink-accounts.json
```

`deepink-accounts.json` 只保存平台入口和账号备注，不存密码：

```json
{
  "version": 1,
  "platforms": [
    {
      "id": "wechat-mp",
      "name": "微信公众号",
      "url": "https://mp.weixin.qq.com",
      "account": "DeepInk",
      "notes": "扫码登录；发布前必须人工确认。",
      "browserProfile": "wechat-mp"
    }
  ]
}
```

密码、Token、恢复码等秘密信息不进入项目可见文件；后续如果接入密码能力，只在文件里保存加密凭据引用。

会话拆成两类任务形态：

- **文案会话**：读取项目资料，写/改 Markdown，产物保存到项目文件。
- **平台操作会话**：读取平台配置和文案文件，打开浏览器 profile，填表、上传、截图，提交前确认。

详见 `docs/features/project-operations-assistant.md`。

### 阶段拆分

1. `M7.1 项目账号配置文件`
2. `M7.2 文案会话写入项目文档`
3. `M7.3 平台浏览器 Profile`
4. `M7.4 平台操作会话`
5. `M7.5 发布记录`
6. `M7.6 Agent 诊断日志与一键复制调试包`（D0-D3 已落地，D4/D5 后续）

### M7.1：项目账号配置文件

目标：让项目目录声明平台入口和账号备注。

方案：

- 定义 `deepink-accounts.json` schema。
- 提供读取和校验工具。
- 在当前工作空间上下文中暴露平台列表。
- 缺失文件时给出可创建的模板。

验收：

- 能读取 `id/name/url/account/notes/browserProfile`。
- JSON 错误能定位字段和路径。
- 缺少配置时不影响普通项目使用。
- 不存密码，不要求用户先接入密码库。

### M7.2：文案会话写入项目文档

目标：让 Agent 根据当前项目资料生成和改写 Markdown 文案。

方案：

- 文案会话读取 README、docs、发布记录等项目资料。
- 复用现有 Markdown 编辑器和 editor MCP 工具写入文件。
- 用户指定目标路径，例如 `docs/公众号首发稿.md`。

验收：

- 能根据项目资料生成一篇宣发稿。
- 能把同一稿件改写成不同平台版本。
- 所有产物都落在当前项目目录。
- 关闭和重启后文案仍能从项目文件恢复。

### M7.3：平台浏览器 Profile

目标：让平台登录态跟平台配置关联。

方案：

- `browserProfile` 映射到独立浏览器持久化上下文。
- 打开平台时按 profile 恢复 Cookie 和站点状态。
- UI 显示当前页面使用的 profile。

验收：

- 微信公众号和知乎可以使用不同 profile。
- 手动登录后，重启 DeepInk 仍能恢复登录态。
- 同一项目内不同平台不会串 Cookie。
- 未登录时清楚提示用户手动登录，不尝试绕过验证码或 2FA。

### M7.4：平台操作会话

目标：让 Agent 打开平台并把项目文案填到网页中。

方案：

- Agent 读取 `deepink-accounts.json`。
- Agent 读取目标 Markdown 文件。
- Browser tab 使用对应 profile 打开平台。
- Agent 可见地填标题、正文、素材和必要字段。
- 高风险动作走确认卡片。

验收：

- 能打开配置中的平台 URL。
- 能把指定 Markdown 填入页面编辑器。
- 发布、提交、删除、修改资料前必须确认。
- 失败时保留页面现场、错误说明和下一步建议。

### M7.5：发布记录

目标：把运营结果写回项目文件。

方案：

- 发布成功或用户标记成功后，追加 `docs/发布记录.md`。
- 记录平台、账号备注、文案文件、URL、时间、状态和备注。
- 取消、失败和待审核也能记录。

验收：

- 同一文案多平台发布能形成多条记录。
- 发布失败或取消不会丢失上下文。
- 后续打开项目能看到历史发布记录。

### M7.6：Agent 诊断日志与一键复制调试包

目标：让真实平台登录、投稿、上传失败时可以快速排障。

方案：

- 右侧 Agent 面板增加“复制诊断日志”按钮。
- 诊断包汇总当前会话、浏览器 tab、URL/title、browserProfile、Agent 工具调用、浏览器任务状态、动作日志、下载记录和最近页面错误。
- 诊断包默认输出 Markdown，方便用户直接粘贴给开发者或 Agent。
- password、token、cookie、验证码、手机号、邮箱等敏感内容必须脱敏。
- 第一版只复制当前任务，不做云端日志上传。

验收：

- 知乎登录失败后，一键复制的诊断包能判断当前停在哪个 URL、用了哪个 profile、最近失败工具是什么。
- 微信公众号投稿失败后，诊断包能判断是否卡在 iframe/contenteditable/上传/权限确认。
- 无浏览器 tab、无任务、无下载时也能生成可读诊断包，而不是报错。
- 诊断包不能包含完整 cookie、token、密码、验证码。

详见 `docs/features/agent-diagnostic-log.md`。

### 当前状态

M7.1-M7.5 已实现，进入人工验收：

- 新增 `src/main/project-ops/project-ops-service.ts` 和 IPC，支持项目账号配置、文案草稿、发布记录。
- preload 暴露 `window.deepink.projectOps`。
- 工作空间侧栏新增“项目运营”区。
- 可创建 `deepink-accounts.json` 模板。
- 兼容读取旧 `.deepink/accounts.json`，但新建和文档约定统一使用项目根目录可见文件。
- 可按平台创建文案草稿和文案工作会话。
- 可按平台打开浏览器并创建平台操作会话。
- 浏览器 Tab 支持 `browserProfile`，主进程使用独立持久化 partition 隔离平台登录态。
- 可追加 `docs/发布记录.md`。
- 验证：`pnpm test -- --run`、`pnpm build` 通过。

缺口：

- 平台操作会话第一版是“创建会话并预填明确任务”，不是全自动发布流水线。
- 发布确认依赖 Agent 执行过程中的权限/确认语义和用户人工判断；尚未做平台级专用确认卡片。
- 还没有评论定时维护，只支持打开页面后由会话读取、总结和写回。
- 一键复制诊断日志已落地第一版，已包含 console/network/page summary；真实知乎/公众号验收还需要收集失败样本，确认诊断包是否足够定位。

### 拷问

如果 M7 做成“账号管理器”，会立刻进入密码、2FA、风控和合规深水区，拖慢真实宣发。

如果 M7 做成“社媒运营平台”，会绕开 DeepInk 已有的浏览器和 Markdown 优势，重复造壳。

第一版只验收一件事：能不能在一个真实项目里写一篇文案、打开一个真实平台、填好内容、确认提交、把结果写回项目文档。

## M8：硬件工作区与生产助手

### 解决什么问题

DeepInk 需要支持 AI 眼镜这类真实硬件项目：项目目录里同时存在原理图、PCB/FPC 生产文件、BOM、坐标文件、结构件、固件、datasheet 和打样记录。

FPC 外形改版是 M8 的核心真实需求。用户当前没有其他硬件工程师支持，因此第一闭环不是“写说明书给别人”，也不是“先去嘉立创下单”，而是：

```text
打开硬件项目目录
→ 识别生产文件
→ 渲染 FPC/Gerber 外形和关键区域
→ 用户用自然语言或图上标注表达改形状需求
→ AI 修改文件副本或新版本目录
→ 展示修改前后对比和风险
→ 重新检查新版生产包
```

### 方案

硬件能力作为工作空间内的能力视图出现，不新增 Activity Bar 顶层入口。

第一版新增 `docs/features/hardware-workspace.md` 中定义的硬件领域模块：

```text
src/main/hardware/
├─ hardware-project-detector.ts
├─ hardware-artifact-index.ts
├─ production-package-service.ts
├─ bom-parser.ts
├─ centroid-parser.ts
├─ gerber-package-inspector.ts
├─ hardware-order-record-service.ts
└─ types.ts
```

配套新增：

- `src/main/ipc/hardware-ipc.ts`
- `src/shared/ipc/hardware.ts`
- `src/main/mcp/modules/hardware/index.ts`
- `src/renderer/src/features/hardware/`
- `src/renderer/src/components/hardware/`
- `src/renderer/src/stores/hardware-store.ts`

职责边界：

- `hardware/` 负责本地文件识别、解析、生产检查和订单记录。
- 浏览器自动化仍由 browser MCP 执行。
- 嘉立创提交订单、付款、修改地址、接受高风险 DFM 必须确认。
- 没有 PCB 源工程时，不把 Gerber 编辑伪装成可靠改板。

### 阶段拆分

1. `M8.0 生产包理解底座`
2. `M8.1 Gerber 层识别与文件预览`
3. `M8.2 FPC 外形渲染`
4. `M8.3 关键区域识别与保护`
5. `M8.3.5 结构件约束接入`
6. `M8.4 用户标注与自然语言意图`
7. `M8.5 低风险外形修改副本`
8. `M8.6 修改前后对比与生产检查`
9. `M8.7 源工程路径与更高风险修改`

详见 `docs/features/fpc-shape-change-assistant.md`。

### M8.0：生产包理解底座

目标：打开 AI 眼镜项目目录后，DeepInk 能识别 Gerber、BOM、坐标、结构件、datasheet 和源工程。

验收：

- 能识别常见硬件产物类型。
- 能生成“硬件项目摘要”。
- 能明确标记“缺少源工程，不能可靠改板”。
- 扫描失败不影响普通文件树。

### M8.1：Gerber 层识别与文件预览

目标：让用户和 AI 知道 Gerber zip 内有哪些层，哪些可能是外形层、铜层、钻孔层。

验收：

- 能列出 Gerber zip 内所有文件。
- 能给出外形层、铜层、钻孔层候选和置信度。
- 无法识别外形层时，提示用户人工选择，不盲改。

### M8.2：FPC 外形渲染

目标：让用户能看见 FPC 外形、关键层和边界尺寸。

验收：

- 能渲染真实 FPC 项目的外形层。
- 能开关外形、铜层、钻孔层。
- 能显示边界盒和尺寸线索。
- 渲染失败时说明不支持的 Gerber 命令或层文件。

### M8.3：关键区域识别与保护

目标：识别连接器、焊盘、钻孔等不能随便动的区域，为 AI 修改提供安全底线。

验收：

- 能在图上标出连接器/焊盘/钻孔候选。
- 用户能手动标记固定区域。
- 触碰固定区域的修改会升级为高风险。

### M8.3.5：结构件约束接入

目标：让光机、镜腿、连接件等结构件成为 FPC 改版的机械约束来源。

方案：

- STL/3MF 继续作为默认内置模型预览能力。
- STEP/STP 不默认打包转换器，而是接入 `docs/features/cad-conversion-plugins.md` 定义的可选 CAD 转换插件。
- 第一阶段优先绑定本机 FreeCAD，后续再做托管下载和 OpenCascade 实验后端。
- AI 使用结构件前必须确认装配坐标、对齐点或参考尺寸；没有坐标时只能作为视觉参考。

验收：

- 当前 AI 眼镜目录能识别 STEP、STL、3MF 结构件。
- STL/3MF 可直接渲染。
- STEP 未启用插件时提示需要 CAD 转换插件。
- 配置本机 FreeCAD 后，STEP 能转换成可预览 mesh 并缓存。
- Agent 能读取结构件预览状态和基础尺寸元数据。
- AI 在缺少装配对齐关系时会追问，而不是直接判断干涉。

### M8.4：用户标注与自然语言意图

目标：把“这里缩短 5mm”“尾巴往右伸”转成结构化修改意图。

验收：

- 用户能在图上框选/点选/画箭头。
- AI 能生成 `FpcShapeEditIntent`。
- 缺尺寸时 AI 会追问，不会瞎填。

### M8.5：低风险外形修改副本

目标：AI 能真的生成修改后的文件副本，而不是只写说明书。

验收：

- 能修改机械外形层或 DXF 副本。
- 输出到 `hardware/edits/`。
- 原始文件不被覆盖。
- 修改后能重新渲染和重新检查。

### M8.6：修改前后对比与生产检查

目标：让用户看到 AI 改了哪里，以及新版文件是否还完整。

验收：

- 能叠加显示旧版/新版外形差异。
- 能列出改动文件。
- 能检查 BOM/坐标/位号数量是否异常。
- 能生成 `hardware/edits/.../edit-report.md`。

### M8.7：源工程路径与更高风险修改

目标：支持更复杂修改，例如源工程外形修改、移动连接器或改走线，但必须进入更严格风险模式。

验收：

- KiCad 源工程优先支持读取和副本修改。
- 修改前后有 diff。
- 没有源工程时，不把高风险电气修改伪装成安全执行。

### 后续：生产包检查报告

目标：对下单前最关键的 Gerber/BOM/坐标文件做结构化检查。

验收：

- 能解析 csv、tsv、xlsx 形式的 BOM 和坐标文件。
- 能检查 BOM 与坐标位号一致性。
- 能检查 Gerber zip 是否包含基础层文件和钻孔文件。
- 报告能区分 `ready`、`quote-only`、`blocked`。
- 风险项能定位到文件、位号和下一步动作。

### 后续：硬件报告 UI 与 Agent 工具

目标：用户和 Agent 都能看懂同一份报告。

验收：

- 工作空间中出现硬件摘要入口。
- 主工作区能打开生产包报告 Tab。
- 能预览 BOM 和坐标文件。
- Agent 能调用 `hardware_scan_project` 和 `hardware_inspect_production_package`。
- 报告可保存为项目 Markdown。

### 后续：嘉立创报价助手

目标：把检查通过或可报价的生产包带到嘉立创报价页。

验收：

- 支持 `deepink-hardware.json` 声明嘉立创入口和浏览器 profile。
- 能打开嘉立创并保持项目级登录态。
- 能上传 Gerber zip、BOM、坐标文件。
- 能根据报告预填草稿参数。
- 能截图报价并写入 `hardware/orders/*.md`。
- 提交订单、付款、地址确认前必须确认。

### 后续：调试助手

目标：基于故障现象、测量值、照片和项目文件生成排查树。

验收：

- 能记录“不开机 / USB 不识别 / 摄像头无图 / FPC 接触不良”等调试问题。
- 输出包含假设、测量点、期望值、异常解释和下一步。
- 没有测量数据时明确标记为假设。
- 涉及电池、高压、激光、射频和佩戴安全时提示人工专业确认。

### 拷问

如果 M8 只能生成说明书或报价记录，它就没有打中 FPC 改形状这个真实需求。

如果 M8 一上来盲改 Gerber，风险会先于价值爆炸。正确路径是先渲染、再标注、再改副本、再对比检查。

如果硬件能力新增顶层入口，而不是作为工作空间视图出现，DeepInk 的产品骨架会重新变乱。

## M10：数据源与远程资料接入

### 解决什么问题

本地写作和运营项目需要使用远程数据采集项目里的资料。远程数据已经在 Elasticsearch 或数据库中，并且每天更新；如果每次都手动导出、下载或让 Agent 猜上下文，DeepInk 不能真正成为工作入口。

### 方案

新增数据源系统，第一版只做 Elasticsearch 只读接入：

```text
数据源 Activity
├─ 连接列表
├─ Index / Collection
├─ Saved Queries
└─ 最近查询

主工作区 Tab
├─ 查询编辑器
├─ 结果表格
├─ JSON 详情
└─ 挂载给 Agent

Agent
├─ @ 挂载数据源、查询结果、单条记录
└─ MCP 只读工具 search / get_record / run_saved_query
```

凭证不写入项目文件。项目或工作空间只保存非敏感配置、Saved Queries 和字段映射；密码、API Key、token 进入本机 safeStorage / Keychain。

第一版不做写入、删除、索引管理、mapping 编辑、ES 集群监控或 ETL。详细方案见 `docs/features/data-sources.md`，开发执行按 `docs/features/data-sources-development-plan.md`。

### 验收标准

- Activity Bar 有数据源入口，但只承担资料浏览和查询，不承担敏感凭证管理。
- 能新增一个 ES 只读连接，测试连接，列出 index。
- 能打开数据源查询 Tab，执行 DSL 查询，查看表格和 JSON 详情。
- 查询结果能保存为快照，并作为 Agent context chip 挂载。
- Agent 能通过只读 MCP 工具搜索、读取单条记录和运行 Saved Query。
- 首次让 Agent 读取某数据源时需要用户确认。
- 明文凭证不会出现在工作空间文件、settings、日志、查询快照或 MCP 响应中。
- 查询和工具响应有条数、字节数和超时限制。
- 生成文章时能追溯到 sourceId、recordId、sourceUrl、collectedAt/publishedAt。

### 当前状态

规划完成，尚未实现。第一步应先做主进程 `DataSourceService`、凭证存储和 ES adapter，再接 UI。

### 拷问

如果这一步做成数据库管理器，就会拖慢写作闭环；如果凭证进入项目文件，就会制造安全事故。M10 的价值不是“能连数据库”，而是“远程采集资料能被本地文章和 Agent 可信地引用”。

## 推进顺序

当前最合理顺序：

1. **先验收 M0.5**：确认未登录工作台、本机身份、工作现场恢复没有阻塞。
2. **并行推进 M7、M8、M10 与 M5/M6**：M7 服务宣发运营；M8 服务 AI 眼镜硬件生产；M10 服务远程采集数据写作；M5/M6 服务远程项目维护。
3. **M7 先打真实任务闭环**：项目配置、Markdown 文案、浏览器 profile、提交确认、发布记录。
4. **M8 先打 FPC 改形状闭环**：Gerber 层识别、FPC 外形渲染、图上标注、低风险外形修改副本、修改前后对比。
5. **M10 先打 ES 只读查询闭环**：连接、查询、结果 Tab、Agent 挂载、MCP 只读工具。
6. **M5/M6 继续补远程闭环**：Direct Remote、完整 PTY、远程错误和执行体验。

暂时不做：

- 不新增远程 Agent 面板。
- 不新增 CCLink Activity Bar。
- 不把 Android 管理恢复成一级入口。
- 不继续推进本地 Android 模拟器。
- 不继续推进云手机。
- 不先做 Terminal 真 shell。
- 不把 Word/PPT 做成无闭环假 Tab。
- 不把项目运营做成独立社媒管理平台。
- 不把数据源做成数据库管理器或 Kibana 替代品。
- 不在第一版做数据源写入、删除、索引管理和 ETL。
- 不把硬件工作区做成 EDA 替代品。
- 不自动改板、自动提交订单或自动付款。
- 不做密码库和全自动登录。

## 2026-07-11 代码级验收记录

本轮先推进 **M1 / M2 / M3 的代码级验收**，不继续盲目加功能。

### 已确认

- Activity Bar 类型已收敛为 `files | search | browser`，设置通过底部按钮打开。
- 设置页已有 `远程连接`、`设备 / Android`、`同步` 等承接配置入口。
- Tab 类型已有 `conversation` 和 `remote-file`，旧 `cclink` 类型仍作为历史快照兼容保留。
- 会话字段已有 `surface` 和 `runtime`，可表达即时助手会话与工作会话、本地与远程、local/direct/cclink transport。
- 相关测试通过：
  - `src/renderer/src/stores/tab-store.test.ts`
  - `src/renderer/src/stores/agent-store.test.ts`
  - `src/renderer/src/utils/workspace-state.test.ts`
  - `src/renderer/src/stores/ui-store.test.ts`

### 当前缺口

- M1 还需要人工体验验收：工作空间 Sidebar 是否仍显得拥挤、层级是否清楚。
- M2 还缺 Direct Remote provider，只是数据模型预留完成。
- M3 还缺 Terminal Tab 类型与生命周期定义。
- M4 仍有旧 `cclink` Tab 兼容字段，说明会话模型还没完全收口。
- 本地工作会话与 CCLink 远程会话已共用 `ConversationShell`，但消息协议、发送链路和错误归因仍是两套 provider。

### 下一步原则

继续推进 **M4 会话模型统一**，先收 UI 外壳、关闭/删除语义和恢复语义，再进入 Terminal 真 shell。

## 2026-07-11 M4 会话外壳收口记录

### 已确认

- 新增 `ConversationShell`，统一工作会话 Tab 的标题、运行信息、状态 badge、错误区、消息区和输入区骨架。
- 本地工作会话 `WorkbenchAgentConversation` 已接入公共外壳，保留原 DeepInk Agent 发送、中止和流式展示逻辑。
- CCLink 远程会话 `CclinkConversation` 已接入公共外壳，保留原服务器加载、消息加载和本地发送逻辑。
- 新增 `resolveConversationTab`，让 Workbench 只解析“会话 Tab 目标”，不再在主内容区散落 local/cclink 判断。
- `remote/direct` 会话当前会明确显示“不支持”，避免用户误以为会话丢失。
- 新增 `ConversationMessageRenderer`，右侧即时助手和本地工作会话共用同一套消息块渲染，不再从 `AgentPanel` 反向导入 `ContentBlockRenderer`。
- 新增 `ConversationRuntimeAdapter` 元信息层，本地 Agent、CCLink、unsupported 会话的标题、chips、badge、状态开始统一生成。
- 新增 `ConversationRuntimeProvider` 动作层第一版，本地 Agent 与 CCLink 的 `load / send / abort` 开始拥有统一调用边界。
- `closeTabWithDraftPolicy` 已显式识别会话 Tab，关闭本地工作会话和旧 CCLink 会话只关闭视图，不删除会话数据。
- `pnpm typecheck` 通过。

### 仍未完成

- `ConversationRuntimeProvider` 当前只覆盖本地 Agent 与 CCLink 的基础动作；尚未覆盖 restore、archive/delete、权限确认和远程错误归因。
- CCLink 远程会话仍使用 `ChatccMessage` 气泡渲染，尚未统一到 `AgentMessage / ContentBlock` 消息结构。
- 关闭工作会话 Tab 的“不删除会话”已有代码测试；但删除、归档、恢复入口还没有完整产品语义。
- 旧 `cclink` Tab 类型仍保留兼容，不能立刻删，否则可能破坏历史快照恢复。
- Direct Remote 会话已有模型表达，但 Workbench 运行通道尚未接入。

### 拷问

这一步只证明“会话页面骨架开始统一”，不证明“会话系统已经统一”。真正的统一还要继续回答：同一个工作会话从哪里恢复、谁负责持久化消息、远程断线时状态归谁、关闭 Tab 是否影响后台任务。

## 2026-07-12 M4 会话生命周期收口记录

### 已确认

- `AgentConversationState` 新增 `archivedAt`，会话从“只有存在/不存在”升级为“可见 / 已归档 / 已删除”三态。
- 新增 `archiveConversation`、`restoreArchivedConversation`、`deleteConversation`；关闭 Tab 仍只关闭视图，删除才真正移除历史数据。
- 归档当前活跃会话时，会自动切到其他未归档会话；如果没有可见会话，会创建一个新的即时助手会话兜底，避免主状态悬空。
- 左侧会话视图和工作空间侧栏默认过滤已归档会话，防止归档会话继续混入当前工作列表。
- 工作空间快照恢复时会跳过已归档 active 会话；如果历史快照全是归档会话，会创建新的默认会话承接入口。
- 左侧会话视图的会话关闭语义是“归档会话”，已归档列表内的删除才会真正清除本地会话。
- 已归档的本地工作会话即使仍有 Workbench Tab 打开，也会进入只读状态；必须先恢复，才能继续发送消息。
- 已补启动恢复组合测试，证明工作会话 Tab 与对应本地会话数据可从同一工作空间快照中一起恢复。
- 会话历史口径已调整为左侧 Activity Bar 的“会话”视图：展示当前项目激活会话、未归档会话和已归档历史。
- 右侧 Agent Panel 不再作为全局历史中心，只承载当前对话和确认操作。
- CCLink 远程会话新增 DeepInk 本地归档覆盖层：归档只影响当前桌面端侧栏显示，不删除远端历史；恢复后可重新显示和打开。
- Agent 流式事件写入已从 `AgentPanel` 挂载状态中解耦；即使右侧面板隐藏，后端 stream / complete / error 事件仍会写入对应会话。

### 仍未完成

- 归档、恢复、删除已有左侧会话视图最小入口，但尚未设计成完整历史管理页；不能把“能点恢复”当作“用户能稳定管理历史”。
- `closeConversation` 仍作为旧的移除语义保留，用于兼容旧调用和测试；后续要评估是否改名或彻底迁移到 `deleteConversation`。
- CCLink 远程会话已有本地视图归档，但仍没有统一到 `AgentConversationState`；它还依赖 ChatCC session 数据源。
- 重启后“已归档历史在哪里恢复”目前只在左侧会话视图里出现，工作空间级历史页还没有。
- 当前只读归档态只覆盖本地 Agent 工作会话；远程会话只是侧栏本地归档，还没有会话 Tab 只读恢复态。

### 拷问

归档不是垃圾桶，删除也不是关闭。下一步必须明确：用户在哪里看到已归档会话、工作空间会话删除是否需要二次确认、远程会话归档到底是 DeepInk 本地行为还是远程 Agent 行为。

## 2026-07-14 M4 左侧会话视图增强记录

### 已确认

- 左侧 Activity Bar 的“会话”视图已作为会话历史主入口，右侧 Agent Panel 不再展示会话列表。
- 本地工作会话列表新增摘要行，显示当前工作空间打开会话、运行中会话和已关闭历史数量。
- 本地工作会话新增筛选：全部、当前项目、未绑定、运行中、已关闭。
- 已关闭历史默认折叠，避免历史会话继续挤占当前工作空间列表。
- 已关闭本地会话提供显式删除入口；删除前二次确认，删除才真正移除本地历史。
- 本地会话侧栏组件和工作空间会话分组逻辑已抽离到 `src/renderer/src/features/agent-conversations/local-session-sidebar.tsx`，`Sidebar.tsx` 只保留面板路由职责。
- 远程会话侧栏组件已抽离到 `src/renderer/src/features/agent-conversations/remote-session-sidebar.tsx`，并补上搜索、摘要和已归档历史折叠。
- 本地与远程会话侧栏共用 `src/renderer/src/features/agent-conversations/session-sidebar-primitives.tsx`，统一分组、行、操作按钮和相对时间展示。
- 已补 store 测试，覆盖删除已归档历史会话不切走当前活跃会话。
- 已补会话分组测试，覆盖当前项目、未绑定、已关闭工作会话的左侧侧栏分组规则。
- 已补远程会话搜索测试，覆盖按名称、路径、状态和服务器过滤。
- 已补会话侧栏 primitive 测试，覆盖相对时间格式，避免本地/远程时间展示漂移。

### 仍未完成

- 远程会话列表已有搜索、摘要和归档折叠，但没有删除语义；远端历史是否可删必须由远端协议明确后再做。
- 左侧会话视图还没有键盘快捷键、右键菜单、批量清理、重命名入口。
- 当前 UI 已能表达“当前项目 / 未绑定 / 已关闭”，但仍需要真实窗口走查文字密度和 hover 操作可见性。

### 拷问

这一步不是“会话管理完成”，只是把最右侧历史列表撤掉后，补上左侧入口的最小管理能力。下一步如果继续堆按钮，会再次变乱；应该先人工验收：新建、打开、关闭、恢复、删除五步是否不用解释也能完成。

## 2026-07-12 M1-M3 基础验收记录

### 已确认

- Activity Bar 已收敛为工作空间、搜索、浏览器、设置；CCLink、Android、同步、账号相关入口迁入设置页。M10 规划新增的数据源入口属于资料内容入口，不恢复配置类入口膨胀。
- 设置页已提供账户、远程连接、设备、同步等分组；CCLink 只作为远程连接通道配置，不再作为左侧一级工作入口。
- 工作空间面板平铺本地和远程工作空间；远程来源通过 `workspaceRefSourceLabel` 作为标识显示，不新增“服务器”目录层。
- 激活工作空间时，会保存当前工作空间的运行态，并恢复目标工作空间的 Tab、浏览器、草稿和工作会话快照。
- 设置页属于全局 Tab：切换工作空间时保留设置页，项目 Tab 在其后切换；这是刻意保留的例外，不算工作空间 Tab 泄漏。
- Tab 栏 `+` 已作为新建 Tab 菜单，可新建 Markdown 草稿、浏览器页、Android 页和工作会话；Word/PPT 仍显示规划中且禁用。
- 工作会话 Tab 的 Shell 已展示工作空间来源、运行位置、transport、backend 和状态 badge。

### 仍未完成

- 当前验收是代码级和结构级；还需要一次真实 UI 走查，确认侧栏层级、文字密度和激活态是否足够清楚。
- 浏览器侧栏仍是书签/历史占位，保存能力还没有真正闭环。
- 远程工作空间已能平铺出现，但 Direct Remote 还没接入，不能把 CCLink 跑通等同于完整远程能力。

### 拷问

如果用户看不懂“当前工作空间”和“未归档”的关系，代码模型再正确也没用。下一轮不要继续加入口，先用真实窗口验证：工作空间列表是否清楚、切换是否可感知、远程错误是否能解释。

## 阶段验收清单

### M1 / M2 / M3 验收

- [x] Activity Bar 已清理为工作空间、搜索、浏览器、设置，配置类入口不再堆到左侧。
- [ ] M10 数据源入口接入后，Activity Bar 为工作空间、搜索、浏览器、数据源、设置，且数据源只承载资料浏览和只读查询。
- [x] 设置页中能找到远程连接、同步、Android、账号相关配置。
- [x] 工作空间面板能平铺展示本地和远程工作空间。
- [x] 远程工作空间以 badge 展示来源，不新增“服务器”一级目录。
- [x] 激活工作空间后，文件树、会话、Tab 集合都跟随当前工作空间。
- [x] Tab 栏 `+` 能新建 Markdown、浏览器、Android、工作会话。
- [x] 右侧即时助手会话不会自动混入当前工作空间会话列表。
- [x] 工作会话 Tab 能显示工作空间、运行位置、transport、backend、状态。

### M4 验收

- [x] 即时助手会话和工作会话文案清楚区分。
- [x] 工作空间侧栏只展示当前工作空间的工作会话。
- [x] “打开为工作会话”不会让用户误以为右侧原会话丢失。
- [x] 关闭工作会话 Tab 不删除会话。
- [x] 本地会话 store 已区分归档、恢复和删除语义。
- [x] 左侧会话视图的关闭语义是归档而不是删除，并提供已归档恢复入口。
- [x] 已归档本地工作会话 Tab 只读展示，恢复后才能继续发送。
- [x] 重启后本地工作会话 Tab 与会话数据仍可恢复。
- [x] CCLink 远程会话支持 DeepInk 本地归档/恢复，不误删远端历史。
- [x] 隐藏右侧 Agent Panel 不影响消息流。

### M5 / M6 验收

- [x] CCLink 服务器能稳定映射为远程工作空间。
- [x] 远程文件树、远程文件 Tab、远程会话 Tab 都能解释错误来源。
- [ ] Direct Remote 接入不改变工作空间主结构。
- [x] Terminal Tab 有明确权限、审计和关闭语义。
- [x] Terminal 有本地审计持久化内核。
- [x] Terminal 有命令风险分类和权限判定器。
- [x] Terminal 有权限确认 UI 和审计可视化入口。
- [x] Terminal 能从 Activity Bar Terminal 面板和工作区 Tab 菜单创建受控 Tab。
- [x] Terminal 能从 Tab 内提交命令到权限、确认和审计链路。
- [x] Terminal 活跃 Tab 关闭会按 `closePolicy` 二次确认，并支持关闭视图保留进程。
- [x] Terminal 创建/关闭/终止语义能写入审计链路。
- [x] Terminal 有 no-op 执行适配器和结构化“未接入 backend”错误。
- [x] Terminal 本地工作空间可执行受控本地 shell 命令并显示输出。
- [x] Terminal CCLink 远程工作空间可通过 `terminal_command/terminal_output` 执行单命令并显示输出。
- [x] 本地 Terminal PTY、resize、基础交互式程序支持。
- [x] 本地 Terminal session 可持久记录 workspace/cwd/status/命令/output buffer。
- [x] 本地 Terminal 关闭视图保留进程后，可从 Terminal 面板恢复活 session。
- [x] 已退出或重启降级的 Terminal session 可打开只读记录，并从同目录新建 Terminal。
- [ ] 远程 Terminal PTY、持久 session 和跨端恢复。
- [ ] Direct Remote Terminal provider。

### M7 验收

- [x] 当前项目可读取 `deepink-accounts.json`。
- [x] 缺少项目账号配置时，能给出最小模板建议。
- [x] 文案会话能根据项目资料生成 Markdown 并保存到项目目录。
- [x] 文案会话能把同一稿件改写为不同平台版本。
- [x] 平台配置能声明并使用 `browserProfile`。
- [x] 不同平台 profile 登录态互不串扰，重启后可恢复。
- [x] 平台操作会话能读取平台配置和目标 Markdown。
- [x] Agent 能打开平台页面并把 Markdown 填入网页编辑器。
- [x] 发布、提交、删除、修改账号资料前必须确认。
- [x] 发布成功、失败、取消都能追加到 `docs/发布记录.md`。
- [x] 第一版不存密码，不做全自动登录，不做独立社媒管理后台。
- [x] Agent 面板可一键复制当前会话诊断日志。
- [x] 诊断日志包含会话、浏览器、任务、工具调用、页面错误和下载摘要。
- [x] 诊断日志默认脱敏 password/token/cookie/验证码/API key。
- [ ] 知乎登录和微信公众号投稿失败样本能通过诊断日志定位下一步排查方向。

### M8 验收：硬件工作区与生产助手

- [ ] 当前 AI 眼镜项目目录能被识别为硬件项目。
- [ ] 能识别 Gerber zip、BOM、坐标文件、结构件、datasheet 和源工程。
- [ ] 缺少源工程时能明确提示“只能做生产检查，不能可靠改板”。
- [ ] 能生成生产包检查报告。
- [ ] 报告能检查 BOM 和坐标位号一致性。
- [ ] 报告能检查 Gerber zip 基础结构和钻孔文件。
- [ ] 报告能区分 `ready`、`quote-only`、`blocked`。
- [ ] 工作空间中能打开硬件摘要和生产报告 Tab。
- [ ] Agent 能调用硬件 MCP 工具读取项目摘要和生产检查报告。
- [ ] 能识别 Gerber 外形层、铜层和钻孔层候选。
- [ ] 能渲染 FPC 外形预览。
- [ ] 能识别 STEP、STL、3MF 结构件。
- [ ] STL/3MF 能直接渲染。
- [ ] STEP/STP 未启用插件时能提示需要 CAD 转换插件。
- [ ] 配置本机 FreeCAD 后，STEP/STP 能转换成可预览 mesh。
- [ ] Agent 能读取结构件预览状态和基础尺寸元数据。（已接入 CAD 后端/模型支持/缓存状态/metadata inspect MCP；真实 STEP 样本与装配对齐待验收）
- [ ] Agent 能准备 FPC 改形状上下文包，列出外形候选、结构约束、缺失对齐问题和下一步建议。（只读上下文已接入，侧栏“改形状”入口已接入，真实项目待验收）
- [ ] 能在图上标注修改区域和固定区域。
- [ ] 能把自然语言改版要求转成结构化 `FpcShapeEditIntent`。
- [ ] 能对低风险外形区域生成修改文件副本，不覆盖原文件。
- [ ] 能展示旧版/新版外形差异和修改报告。
- [ ] 调试助手能基于故障现象、测量值和项目文件生成排查树。
- [ ] KiCad 改板试点必须写入新版本目录，并在用户确认前不改源文件。

### M9 验收：本机 Claude Code Agent 开源底座

- [x] DeepInk 运行代码不再依赖 `core-agent` 或 `../coreAgent`。
- [x] `package.json` 和 `pnpm-lock.yaml` 已移除 `file:../coreAgent`。
- [x] `tsconfig.node.json` 和 `electron.vite.config.ts` 已移除 `../coreAgent/dist` alias。
- [x] Agent runtime、scope、MCP ToolHost、LocalClaudeCodeBackend 已回收到本仓库。
- [x] 第一版 Agent 后端收敛为 `local-claude-code`，HTTP API 不再伪装成完整工具 Agent。
- [x] 设置页 Agent 区显示本机 Claude Code 引擎、CLI 路径、检测按钮、状态、权限模式和预算。
- [x] 主进程支持检测常见 Claude Code 路径和 shell PATH，并允许手动配置路径。
- [x] Claude Code 检测有确定性单测覆盖。
- [ ] 仍需人工验收：从 Finder 启动 App 后检测 PATH、手动填写路径、真实 Claude Code 登录状态和浏览器工具调用。

### M10 验收：数据源与远程资料接入

- [ ] 架构和功能文档明确数据源是资料入口，不是数据库管理器。
- [ ] 主进程有 `DataSourceService`、凭证存储、审计日志和 Elasticsearch adapter。
- [ ] Renderer 只能通过 preload 白名单调用数据源 IPC，不能直接访问数据库凭证。
- [ ] 能创建 ES 只读连接、测试连接、列出 index。
- [ ] 能打开数据源查询 Tab，执行 DSL 查询并展示表格/JSON 详情。
- [ ] 查询结果能生成快照并挂载给 Agent。
- [ ] MCP 注册 `data_source.list_sources`、`data_source.list_collections`、`data_source.search`、`data_source.get_record`、`data_source.run_saved_query`。
- [ ] Agent 首次读取某个数据源或 Saved Query 需要用户确认。
- [ ] 查询结果和 MCP 响应有条数、字节数、raw 字段和超时限制。
- [ ] 明文凭证不会出现在工作空间配置、settings、日志、查询快照和 MCP 响应中。
- [ ] 真实 ES 全链路验收通过：连接、查询、挂载、Agent 总结、来源追溯。
