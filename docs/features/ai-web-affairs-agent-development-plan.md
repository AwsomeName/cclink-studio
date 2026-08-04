# AI 网页事务代理人开发管理

> 文档版本：1.5
> 基线状态：项目网站资源 Browser Tab 纠偏实现和自动化门禁已完成，等待真实网站真人
> 验收；同项目事务归属和真实网站代理闭环尚未完成
> 最后更新：2026-08-04
> 产品事实源：`docs/features/ai-web-affairs-agent.md`
> 架构约束：`docs/architecture.md`
> 本文件是计划、里程碑、验收、进度、风险和交付证据的唯一开发管理事实源；与产品
> 事实源冲突时，以产品事实源为准。

## 0. 项目状态

### 0.1 当前结论

用户现在可以在当前本地项目的“网站与账号”中添加任意网站、业务主体和账号；添加后
立即进入实际 Browser Tab，侧栏再次点击会聚焦同一项目资源 Tab。Browser Profile 已从
普通表单隐藏，账号连接由主进程解析稳定 `projectId`，不同项目的查询与创建不会只靠
前端过滤。v1 旧账号会先成为未归属数据，必须由用户明确归入当前项目。

用户现在可以在当前本地项目查看和新建本项目事务；节点更新、流程修订、材料检查、
Attempt、等待计划和 AI/MCP 事务工具都会在主进程按稳定工作空间身份再次校验，不能只凭
`affairId` 跨项目读写。事务资源区和 AI Attempt 复用同一个网站资源 Tab 启动入口。
但这仍不代表真实网页代理闭环已经验收：旧事务 Tab 的失效投影尚待清理，W1 也仍需用户
使用真实网站完成登录、重启、双账号、项目切换和项目移动验收。

当前项目状态：

| 维度         | 当前事实                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| 用户功能进度 | 当前项目可添加任意网站账号并直接打开/聚焦同一 Browser Tab；真实登录待验收 |
| 工程准备度   | WebResource v2、项目 IPC 隔离、迁移、统一启动入口和全量门禁已通过         |
| 当前阶段     | `E0`、`W1` Acceptance；`A1` In Progress；`A2`–`R1` Pending                |
| 当前阻塞     | 无工程阻塞；W1 等待真人验收，A1 仍需旧事务归属出口和真人验收              |
| 下一用户增量 | 为未归属旧事务提供逐项确认归属或只读导出，不按路径自动猜测                |
| 完成声明     | 可声明 W1 实现进入验收；不能声明 W1 Complete、A1–A4 或产品完成            |

### 0.2 里程碑总览

状态只允许使用：

- `Pending`：尚未满足进入条件。
- `Ready`：进入条件已满足，可以开工。
- `In Progress`：正在实施。
- `Acceptance`：实现已结束，正在执行自动化和真人验收。
- `Complete`：真人验收、工程门禁和证据全部完成。
- `Blocked`：同一阻塞已连续三次阻止推进，且无安全替代路径。

| 里程碑 | 名称                   | 状态        | 依赖  | 用户完成后能做什么                       | 验收证据                                      |
| ------ | ---------------------- | ----------- | ----- | ---------------------------------------- | --------------------------------------------- |
| E0     | 项目归属和启动契约纠偏 | Acceptance  | 无    | 无新增用户能力；冻结稳定项目归属与迁移   | 评审记录、contract/schema 测试                |
| W1     | 项目网站资源 Tab 闭环  | Acceptance  | E0    | 添加网站即打开网页，关闭后可恢复同一账号 | `docs/ops/ai-web-affairs-agent-acceptance.md` |
| A1     | 项目事务和三段式 Tab   | In Progress | W1    | 创建本项目事务并复用网站资源 Tab         | 同上                                          |
| A2     | 真实网页节点和人工交接 | Pending     | A1    | AI 使用同一资源 Tab 执行、接管和交还     | 同上                                          |
| A3     | 等待外部和重新检查     | Pending     | A2    | 提交后停止运行，按计划重新检查结果       | 同上                                          |
| A4     | 动态流程和平台增强     | Pending     | A2    | AI 提出流程变更并复用模板/适配器         | 同上                                          |
| R1     | 首版交付验收           | Pending     | W1–A4 | 在真实网站完成端到端网页事务闭环         | Tag、CI、真人验收和残余风险                   |

### 0.3 进度更新原则

- 进度默认先写“用户现在能做什么、还不能做什么”，再写代码、测试和内部完成项。
- 不使用提交数、代码行数、测试数量或主观百分比替代用户功能进度。
- E0 等纯工程阶段必须明确标记“无新增用户能力”。
- 里程碑只有在真人端到端验收、受影响 smoke 和 `pnpm verify` 全部通过后才能设为
  `Complete`。
- Mock、Schema、静态流程图或单元测试通过，只能更新工程准备度。
- 每次状态变化都必须在本文“进度记录”中追加日期、当前能力、验证证据、残余风险和
  下一步。

## 1. 开工结论

不能从批量平台适配器、复杂流程编辑器或后台调度开始。第一条主线按两个连续的用户
闭环推进：

### 闭环一：当前项目网站账号成为可启动网页资源

> 用户在当前项目把一个未预置的网站加入“网站与账号”，点击“添加并打开”后立即进入
> 实际网页 Browser Tab；用户手动登录并确认账号身份。关闭 Tab、重启 Studio、移动项目
> 或再次点击侧栏后，仍能使用同一项目资源和登录环境打开网站；切换项目时列表、Tab 和
> 账号不串用。Browser Profile 是隐藏实现，不是用户表单字段。

### 闭环二：一件事务跨人工交接和重启持续存在

> 用户在当前项目创建事务，只关联本项目网站账号和本地物料，看到三段式事务 Tab 和
> 真实流程；事务资源区、用户侧栏和 AI 执行共用同一资源 Browser Tab 启动逻辑。AI
> 执行一个网页节点，用户接管并交还，AI 重新验证页面后更新节点；关闭 Tab 和重启
> Studio 后，事务、资源、流程、卡点和证据仍然存在。

等待外部、自动复查、动态模板和平台增强只能在这两个闭环通过后继续。

## 2. 当前事实与差距

### 2.1 已有可复用基础

| 当前能力                               | 代码事实                                                 | 本方案用途                   |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| Activity Bar / Sidebar / Workbench Tab | `ActivityBar.tsx`、`Sidebar.tsx`、`WorkbenchContent.tsx` | 新增“事务”，改造“运营”入口   |
| 浏览器 Profile                         | `BrowserManager`、`browser-profile.ts`                   | 隔离不同主体和账号登录态     |
| 登录态脱敏诊断                         | Browser Session diagnostics                              | 生成账号登录状态投影         |
| BrowserTaskRun                         | `BrowserTaskRuntime`                                     | 执行一次有界网页节点         |
| Browser 动作日志                       | `BrowserActionLog`                                       | 节点尝试和证据来源           |
| Agent 运行关联                         | conversation / agentRun / taskRun correlation            | 事务运行归因基础             |
| 用户接管基础                           | BrowserTask pause/resume                                 | 人工接管协议的底层动作       |
| 本地文件和预览                         | `FileService`、Editor、FilePreview                       | 本地物料引用和打开           |
| CredentialService                      | 第三方秘密值唯一 owner                                   | 账号只保存稳定引用           |
| Runtime / ServiceRegistry              | 对称启动和停止                                           | 新服务生命周期               |
| WorkspaceStateService                  | 工作台 Tab 投影恢复                                      | 恢复事务 Tab，不拥有事务事实 |

### 2.2 本轮纠偏后的实现事实

旧 `ProjectOpsService` 继续只读兼容工作空间根目录的 `cclink-accounts.json`。新的
`WebResourceService` 已完成以下纠偏：

- `WebResourceSnapshot v2` 为账号连接增加稳定 `projectId`；主进程根据 `workspaceRef`
  解析项目身份并执行项目级查询、创建、确认和旧数据认领。
- `WebResourcesSidebar` 只读取当前本地项目；全局工作区显示明确降级，不提供全局资源
  中心。
- 添加网站后立即打开实际 Browser Tab；侧栏再次点击按 `projectId + accountId` 聚焦
  复用，不再把静态详情 Tab 当主入口。
- Browser Profile 由主进程自动生成并从普通表单隐藏；Tab 保留稳定 `webResourceRef`，
  关闭 Tab 不删除网站账号和本机 Session。
- 登录状态组合用户确认时间与脱敏 Session 诊断，不把 Cookie 启发式直接写成确定身份。
- v1 账号迁移为未归属数据，只有用户明确认领后才写入当前项目。
- 事务资源区和 AI Attempt 已调用同一个 `ensureWebResourceTab`；普通事务 UI 不再展示
  Browser Profile 技术标识。
- `WebAffairSnapshot v3` 为事务增加稳定 `workspaceId`；项目级查询、创建以及全部事务写
  操作都由主进程解析当前 `workspaceRef`，服务层再校验事务归属。
- `web-affairs` MCP 模块从 Agent 会话的 `workspaceKey` 解析稳定身份；没有本地工作空间
  上下文时拒绝读写，不能把模型传入的 `affairId` 当作授权。
- v1/v2 旧事务迁移为未归属数据，不会按路径猜测或自动塞入当前项目。

剩余 A1 结构性问题集中在旧事务的迁移退出：已迁移为未归属的旧事务不会出现在当前
项目列表，其失效工作台 Tab 也会在当前项目事务加载后清理；但用户还不能逐项查看并确认它们
的新归属或只读导出。该迁移出口和真人验收完成前，A1 仍不能进入 `Acceptance`。

### 2.3 缺失能力

- 未归属旧事务的逐项确认归属或只读导出。
- W1 在真实网站上的登录确认、跨重启、双账号隔离、项目切换和项目移动真人验收。
- 事务资源区与 AI Attempt 复用入口后的真人交互验收和失败降级。
- 真实网站上的登录、AI 操作、人工交接、外部等待和结果证据验收。

持久化 `WebAffair`、流程图、三段式事务 Tab、Attempt、证据、外部等待和动态流程等
组件已经存在，属于可复用工程准备度，不再列为“从零缺失”。

## 3. 架构决定

### 3.1 两个领域、两个唯一 owner

### `WebResourceService`

唯一拥有：

- 网站和入口。
- 个人、公司或其他主体的脱敏元数据。
- 属于稳定 `projectId` 的平台账号、角色和备注。
- Browser Profile 绑定。
- 用户最近一次确认账号身份的时间和安全摘要。
- Credential 稳定引用。
- 平台增强能力声明。
- 最近一次登录核验的脱敏投影。

它不拥有 Cookie、密码、事务流程或事务状态。真实 Session 仍由 `BrowserManager`
拥有，秘密值仍由 `CredentialService` 拥有。

### `WebAffairService`

唯一拥有：

- 事务目标、主体和总体状态。
- 必填的稳定 `projectId`。
- 流程版本、节点、依赖和节点状态。
- 同项目网站账号和本地物料引用。
- 卡点、人工交接、尝试和运行关联。
- 证据和外部副作用历史。
- 下一次检查意图和最终结果。

Renderer store 只保存可丢弃投影；`WebAffairRunner`、Agent、BrowserTask 和 Scheduler
都不能建立第二份事务状态。

### 3.2 项目归属与存储作用域

- 用户界面只管理当前项目的网站账号和事务，不提供“全部网站与账号”或全局事务入口。
- 网站账号和事务使用现有 `WorkspaceStateService` 解析出的稳定 `projectId` 作为业务
  归属，不把可移动的项目路径作为唯一身份。
- renderer 只提交当前 `workspaceRef`；主进程解析 `projectId`，并在查询、创建、修改和
  执行时校验归属。仅在 React 中过滤全局 Snapshot 不构成隔离。
- 元数据仍存放在 `userData` 下的独立资源域，不写入 Git 可见项目文件；项目文件只保存
  既有工作区状态和本地物料。
- 网站和主体可以在主进程内部去重，但账号连接必须属于一个项目；普通 UI 不暴露跨项目
  资源集合。
- 新事务必须属于一个本地项目；无法取得稳定 `projectId` 的全局或只读工作区不得创建
  网站账号或事务，并显示明确降级原因。
- 本地物料首版只保存经过校验的文件引用、显示名、媒体类型、大小、修改时间和必要
  哈希，不自动复制原文件。
- 敏感材料不默认进入 Git 可见工作空间。文件缺失、移动或发生变化时，资源状态转为
  失效并要求用户重新确认。
- 存储写入必须串行、原子、可迁移和可备份；损坏时相应能力降级，不能阻断 Studio
  其他模块启动。

WebResource v1 中没有项目归属的账号迁移为“未归属旧数据”，不得自动塞入当前项目。
用户从当前项目执行一次性导入或认领后才写入 `projectId`；已有事务引用可以继续只读
展示，但在归属确认前禁止 AI 执行。旧 `cclink-accounts.json` 从哪个项目发起导入，就
归属哪个项目，并继续保持旧文件只读。

### 3.3 项目网站资源 Browser Tab

Browser Tab 是网站账号资源的可见运行投影，不拥有账号或事务事实。目标关系为：

```text
Project WebAccount
  ├─ projectId
  ├─ website / entryUrl
  └─ browserProfileId
          ↓
Browser Tab
  └─ webResourceRef { projectId, accountId }
```

renderer 建立唯一的 `ensureWebResourceTab` 工作台入口：

1. 主进程根据当前项目和账号返回经过归属校验的启动描述。
2. renderer 查找同 `projectId + accountId` 的已打开主 Tab；存在则激活。
3. 不存在时使用描述中的 URL、Profile 和 workspace 投影创建 Browser Tab，并写入稳定
   `webResourceRef`。
4. 侧栏、事务资源区和 AI Attempt 都调用这一入口，不得各自按 URL 或 Profile 猜测。
5. 关闭 Tab 只删除投影；资源、登录 Session、事务引用和证据保持。
6. 页面衍生 Tab 可以继承资源引用和 Profile，但侧栏默认激活最近的主资源 Tab。

Browser Profile ID 由主进程生成并保存在账号资源中，普通添加表单不暴露该字段。真实
Cookie 仍由 `BrowserManager` 的持久化 Session 拥有；资源服务只保存登录确认时间和
脱敏摘要。事务启动 Attempt 前必须再次校验项目、账号、Session 信号和实际页面身份。

### 3.4 通用页面与动态流程

所有事务共用一个 `WebAffairTab`：

1. 相关资源。
2. 整体流程图。
3. 选中节点详情。

流程不是 React 组件树或 Agent 对话文本，而是主进程持久化数据：

```ts
interface WebAffairFlow {
  version: number
  nodes: WebAffairNode[]
  edges: WebAffairEdge[]
}

interface WebAffairNode {
  id: string
  type: string
  title: string
  status: WebAffairNodeStatus
  executor: 'ai' | 'user' | 'external'
  resourceRefs: string[]
  materialRefs: string[]
  evidenceRefs: string[]
  blocker: WebAffairBlocker | null
  successCriteria: string[]
  availableActions: WebAffairNodeAction[]
}
```

首版流程图支持有向无环图。重试不形成图循环，而是同一节点下追加 Attempt；驳回后
新增补正节点和新依赖。这样历史和副作用不会被循环覆盖。

### 3.5 流程维护责任

| 内容                        | 维护者                        |
| --------------------------- | ----------------------------- |
| 通用事务 Tab 和通用节点详情 | Studio 产品代码               |
| 通用原子节点                | Studio 领域模型               |
| 参考业务模板                | 内置模板或插件                |
| 平台字段和状态增强          | 平台适配器                    |
| 当前事务流程实例            | `WebAffairService`            |
| 流程变更提议                | 用户或 AI                     |
| 重大变更确认                | 用户                          |
| 历史、证据和版本            | `WebAffairService` 只追加保存 |

模板升级不自动改写已有事务。AI 只能直接调整尚未执行、没有外部副作用且不改变主体
和授权范围的节点；其他变化必须展示流程 diff 并由用户确认。

### 3.6 运行关系

```text
WebAffair
  └─ Flow Node
      ├─ Attempt 1
      │   ├─ AgentRun
      │   └─ BrowserTaskRun
      ├─ Human Handoff
      └─ Attempt 2
          ├─ AgentRun
          └─ BrowserTaskRun
```

`BrowserTaskRun.correlation` 后续增加 `affairId / nodeId / attemptId`。BrowserTask
仍是当前进程内的一次运行；事务服务只保存其稳定关联、终态和必要证据，不把已消失的
运行恢复成 `running`。

## 4. 目标模块

目录名可以在实现中微调，但状态所有权不得变化：

```text
src/shared/web-resources/
├── web-resource-types.ts
├── web-resource-schema.ts
├── web-resource-contract.ts
└── web-resource-errors.ts

src/main/web-resources/
├── web-resource-service.ts
├── web-resource-store.ts
├── project-ops-migration.ts
├── web-resource-diagnostics.ts
└── web-resource-ipc.ts

src/renderer/src/features/web-resources/
├── WebResourcesSidebar.tsx
├── WebResourceActions.tsx
├── web-resource-tab.ts
├── web-resource-view-model.ts
└── web-resources.css

src/shared/web-affairs/
├── web-affair-types.ts
├── web-affair-schema.ts
├── web-affair-contract.ts
└── web-affair-errors.ts

src/main/web-affairs/
├── web-affair-service.ts
├── web-affair-store.ts
├── web-affair-runner.ts
├── web-affair-transition.ts
├── web-affair-evidence.ts
├── web-affair-diagnostics.ts
└── web-affair-ipc.ts

src/renderer/src/features/web-affairs/
├── web-affair-store.ts
├── WebAffairsSidebar.tsx
├── WebAffairTab.tsx
├── AffairResources.tsx
├── AffairFlowGraph.tsx
├── AffairNodeDetail.tsx
└── web-affairs.css

docs/ops/
└── ai-web-affairs-agent-acceptance.md
```

Preload 不另造手写字符串 API；shared contract、main handler 和 preload 暴露继续使用
项目现有单一契约源和 trusted renderer guard。

## 5. 开发阶段

估算以一名熟悉当前 Electron、React、Browser 和 Agent 架构的工程师为口径，并基于
现有 A1–A4 工程组件继续修正。真实网站人工审核等待不计入纯工程时间。

| 类别     | 阶段 | 当前状态    | 用户可见结果                                      | 剩余估算   |
| -------- | ---- | ----------- | ------------------------------------------------- | ---------- |
| 工程前置 | E0   | Acceptance  | 无新增能力；稳定项目归属、资源 Tab 和迁移契约冻结 | <0.5 人日  |
| 用户功能 | W1   | Acceptance  | 添加网站即打开网页，关闭/重启后可恢复同一账号     | 0.5–1 人日 |
| 用户功能 | A1   | In Progress | 本项目事务只引用并直接打开本项目网站资源 Tab      | 1–2 人日   |
| 用户增量 | A2   | Pending     | AI 复用同一资源 Tab，支持接管、交还和重新验证     | 2–3 人日   |
| 用户增量 | A3   | Pending     | 等待外部、错过检查、重新检查形成真实闭环          | 1–2 人日   |
| 用户增量 | A4   | Pending     | 动态流程和模板在真实页面中完成降级验收            | 1–2 人日   |
| 交付验收 | R1   | Pending     | 全量门禁、真实网站纵向验收和失败注入证据          | 1–2 人日   |

W1 工程实现已完成，剩余是真实网站和双账号真人验收；项目事务归属与引用链仍需
1.5–2.5 个工程日。推进到 R1 真实端到端候选预计总剩余 8–13 个工程日，外部审核自然
等待另计。估算假设不新增跨项目共享账号、云端常驻执行和批量平台适配器。

### 5.1 E0：项目归属和资源启动契约纠偏

工程任务：

- `WebResourceSnapshot` 升级到 v2，账号增加稳定 `projectId` 和登录确认摘要。
- 新增主进程项目解析、项目范围查询、创建、登录确认和安全移除契约。
- Browser Tab 增加 `webResourceRef { projectId, accountId }`，定义主 Tab、衍生 Tab、关闭
  和恢复语义。
- 冻结 `resolveLaunch + ensureWebResourceTab` 边界：主进程校验并返回启动描述，renderer
  只负责激活或创建工作台投影。
- 新事务增加必填 `projectId`；创建、修改和 Attempt 启动必须校验账号同项目。
- 定义 v1 未归属账号、旧事务引用和 `cclink-accounts.json` 的非破坏迁移规则。

退出条件：

- contract、schema、项目解析、Tab 引用和迁移方案完成评审。
- 没有把 Cookie、密码、验证码或材料正文放入 renderer snapshot。
- 没有新增第二 Browser Profile、Credential、Project 或 Workspace owner。
- 不依赖 renderer 过滤实现项目隔离，不用项目路径替代稳定 `projectId`。

E0 只有工程准备度，不是产品里程碑。

### 5.2 W1：项目网站账号与资源 Browser Tab 闭环

真人验收：

1. Activity Bar 保持“网站与账号”和兼容的内部 `operations` ID。
2. 侧栏只显示当前项目，并呈现“添加网站与账号 + 简洁资源列表”。
3. 用户添加一个未预置网站、主体和账号，普通表单不出现 Browser Profile。
4. 点击“添加并打开”后立即出现绑定的实际 Browser Tab，侧栏显示“待登录”。
5. 用户在网页中登录并确认账号身份，侧栏显示“已登录”。
6. 关闭 Tab 后点击同一侧栏资源，激活或创建同 `projectId + accountId` 的主 Tab；连续
   点击不重复创建。
7. 完全退出并重启 Studio后，资源仍在，使用原登录 Session 重新打开正确网页。
8. 同网站两个账号使用不同 Session，切换项目后资源和 Tab 不串用。
9. 移动项目目录后通过稳定 `projectId` 恢复；复制为新项目时不得继承原项目归属。
10. 旧配置只在用户确认后导入当前项目，旧文件和 Profile 不被删除或改写。

实施顺序：

1. WebResource v2、稳定项目解析、范围查询和迁移。
2. Browser Tab `webResourceRef` 与统一 `ensureWebResourceTab`。
3. 侧栏“添加并打开”、简洁资源行、登录确认和行尾管理动作。
4. Profile 自动生成、Session diagnostics 与登录状态组合投影。
5. 旧 ProjectOps 平台显式导入和当前全局 v1 数据认领。

W1 不实现事务、AI 规划或后台跟踪。

### 5.3 A1：持久事务与三段式 Tab

真人验收：

1. Activity Bar 新增“事务”按钮。
2. 侧栏显示连续事务列表，状态只作为每条事务的属性。
3. 用户在当前项目创建事务，只能选择本项目主体、网站账号和本地物料。
4. 用户添加五个节点和依赖，形成线性或一个并行分支。
5. 事务 Tab 同时显示相关资源、整体流程和选中节点详情。
6. 点击不同节点，详情切换到对应办理状态和节点资源；点击网站账号直接激活或创建 W1
   的资源 Browser Tab。
7. 用户修改未执行节点；已完成节点和历史不能被删除。
8. 关闭事务 Tab 后重新打开，数据不丢失。
9. 切换项目后事务列表立即隔离；重启 Studio 后流程、节点状态和资源引用恢复。
10. 删除或修改本地材料后，资源显示失效而不是继续假装可用。

首版允许用户手工创建和更新节点。AI 尚未执行真实网页时，不得宣称“代理人已经接管”。

### 5.4 A2：真实网页节点与人工交接

真人验收使用一个由用户选择、允许自动化且风险可控的真实网站，不把平台名称硬编码
为产品条件：

1. 用户从一个 Ready 节点点击“交给 AI”。
2. 主进程校验事务、项目和账号归属；Runner 复用 W1 的资源 Tab 启动描述，激活或创建
   Browser Tab、AgentRun 和 BrowserTaskRun。
3. UI 显示当前节点、运行关联和可见网页现场。
4. AI 完成一个低风险填写或查询动作并验证后置条件。
5. 用户点击“接管网页”，BrowserTask 暂停，AI 不再继续点击。
6. 用户完成扫码、验证码或页面操作后点击“交还 AI”。
7. AI 重新读取 URL、资源引用、账号身份和页面状态，不沿用旧假设。
8. 验证成功后节点追加人工结果证据并继续；验证失败则保持需要用户处理。
9. 最终提交由产品级确认卡拦截，确认卡显示主体、账号、URL、字段和文件。
10. 关闭 Tab、Agent 失败或 App 重启后，不产生假运行和重复提交。

实现重点：

- `WebAffairRunner` 只编排一次 Attempt，不读取 renderer 当前活跃 workspace 猜测项目。
- 侧栏、事务资源区和 AI Attempt 复用统一资源 Tab 启动语义。
- Browser correlation 增加 affair/node/attempt 关联。
- 人工接管是显式状态转换，不是普通 pause 文案。
- 建立副作用 key，提交前检查同节点同版本是否已经发生。
- 证据至少保存来源、观察时间、安全摘要和关联 ID。

### 5.5 A3：等待外部和重新检查

真人验收：

1. 已提交节点进入 `reviewing / waiting-external`，当前运行结束。
2. 事务显示下一次检查时间，不显示 Agent 正在后台运行。
3. App 存活时到期创建一次新 Attempt 查询状态。
4. App 退出期间不执行；重启后显示错过并按明确策略补查或等待用户。
5. 状态未变化时有界安排下一次检查。
6. 出现驳回时保存官方原文并新增补正节点。
7. 出现通过时保存结果证据并推进后续节点。

首版复用统一 ScheduledTask 唤醒能力时，ScheduledTask 只能发送
`wake affairId/nodeId`，不能保存节点状态或审核结果。

### 5.6 A4：动态流程、模板和平台增强

- 提供通用原子节点 catalog。
- 提供版本化业务模板，但模板不拥有事务实例。
- AI 根据实际页面提出流程 diff。
- 用户确认改变主体、账号、授权范围、不可逆动作和重大依赖的变更。
- 已执行节点保持不可变，补正通过新增节点表达。
- 高频平台适配器只补充入口、字段、状态识别和证据提取。
- 适配器失效时降级通用网页代理或人工步骤。

## 6. 当前施工批次

现有 A1–A4 组件保留，主线先修正资源入口，再向下接回事务；不得继续扩张模板或平台
适配器。

### Batch C0：契约、项目归属和迁移

- `WebResourceSnapshot v2`、账号 `projectId`、登录确认摘要和 v1 兼容解析。
- 主进程通过 `WorkspaceStateService` 解析稳定项目 ID，不信任 renderer 自报项目 ID。
- 项目范围 IPC、未归属旧数据认领和旧 ProjectOps 导入规则。
- contract、schema、service、IPC 和迁移测试。

退出结果只有工程准备度；用户界面尚无新增能力。

### Batch C1：侧栏资源直接打开 Browser Tab

- “网站与账号”侧栏只读取当前项目，呈现“添加网站与账号 + 简洁资源列表”。
- 添加表单隐藏 Browser Profile，主进程自动生成隔离 Profile。
- 点击“添加并打开”立即创建资源 Browser Tab。
- Browser Tab 保存 `webResourceRef`；统一 `ensureWebResourceTab` 实现激活、创建和去重。
- 登录完成确认、组合状态投影、重新登录和诊断入口。
- 关闭 Tab、重启、项目移动、项目切换和同站双账号 smoke。

Batch C1 完成真人验收即关闭 W1，这是下一条必须先产生的用户能力。

### Batch C2：事务只引用并复用本项目资源 Tab

- 事务侧栏和新建表单只查询当前项目。
- 事务资源区点击网站账号复用 `ensureWebResourceTab`。
- `WebAffairService` 在创建、修订和启动 Attempt 时校验 `projectId`。
- `WebAffairNodeActions` 不再读取当前激活 workspace 猜测执行项目。
- 旧事务继续只读；未归属账号完成认领前阻止执行。
- 跨项目拒绝、切换项目、重启恢复和历史不可变测试。

Batch C2 完成真人验收即关闭 A1。

### Batch C3：真实 AI—人工—AI 纵向闭环

- 选择一个允许自动化、低风险且不会产生不可逆副作用的真实网站。
- AI 使用与侧栏相同的资源 Tab 完成一次查询或可撤销填写。
- 用户接管、交还，AI 重新观察后继续。
- 登录失效、Tab 关闭、Agent 失败和 App 重启均形成明确事务状态。
- 最终外部动作继续由产品确认卡拦截。

Batch C3 完成真人验收即关闭 A2；之后才继续 A3、A4 和 R1。

2026-07-31 的一次性 W1 真人登录延期仍保留为历史决策，但已被 2026-08-04 产品纠偏
收口：它只解释已有 A1–A4 工程组件为何提前存在，不再允许跳过 C1、C2 直接进入产品
验收或自动提交。

## 7. 验证与质量门禁

### 自动化

- shared schema 和 contract 测试。
- service 原子写、备份恢复、迁移和并发写测试。
- IPC trusted sender、参数边界和错误结构测试。
- 稳定 `projectId` 解析、项目移动/复制、跨项目查询和写入拒绝测试。
- `webResourceRef`、资源主 Tab 去重、关闭和恢复测试。
- Profile 隔离和登录状态投影测试。
- 流程 transition、依赖、不可变历史和版本测试。
- Affair / AgentRun / BrowserTaskRun 关联测试。
- 接管、交还、Tab 关闭、Agent 失败和重启 reconcile 测试。
- 副作用去重和最终人工确认测试。
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm verify`
- 受影响的 Browser、credential、workspace、context-action smoke。

### 真人验收

- 未预置真实网站。
- 添加网站后立即打开实际网页，关闭后由侧栏重新打开同一资源 Tab。
- 当前项目切换、项目移动和项目复制的资源归属。
- 两个主体或账号的 Profile 隔离。
- 手动登录和重启恢复。
- 本地材料打开、变化和失效。
- 事务创建、流程选择和节点详情。
- AI 执行、人工接管和交还。
- 最终提交确认。
- 外部等待、重启和补查。
- 真实申请号、回执或其他可验证结果。

Mock、fixture、单元测试或静态流程图通过，只能证明对应工程门禁，不能证明产品闭环。

## 8. 失败降级

| 失败                 | 用户可见结果                     | 禁止行为             |
| -------------------- | -------------------------------- | -------------------- |
| WebResource 存储损坏 | 资源能力降级，提供备份恢复和诊断 | 阻断 Studio 启动     |
| 项目 ID 无法解析     | 禁用添加并说明项目不可持久归属   | 用当前路径猜测归属   |
| 跨项目资源请求       | 主进程拒绝并保留当前项目现场     | 仅靠前端隐藏         |
| 旧配置不合法         | 指出字段并保留原文件             | 静默丢弃或覆盖       |
| 登录状态未知         | 显示待核验并要求打开网站         | 猜测已登录           |
| 主体或账号不匹配     | 阻止当前节点并要求重新绑定       | 使用当前 Cookie 继续 |
| 本地材料丢失或变化   | 标记失效并重新确认               | 上传旧路径或旧摘要   |
| Browser Tab 关闭     | Attempt 中断或转人工，事务保留   | 删除节点或事务       |
| 资源 Tab 引用失效    | 从账号资源重建或要求重新绑定     | 复用当前任意网页     |
| Agent 崩溃           | Attempt 失败，事务可继续         | 恢复成假运行         |
| App 在等待期退出     | 记录错过检查                     | 声称仍在后台跟踪     |
| 页面无法验证提交结果 | 等待验证或人工复核               | 标记完成             |
| 平台适配器失效       | 降级通用代理或人工步骤           | 丢失事务状态         |

## 9. `/grilling`

开工前和每个阶段退出前必须回答：

1. 侧栏点击是否仍先进入静态账号详情而不是实际网页？如果是，W1 未完成。
2. 添加网站后是否立即产生带稳定资源引用的 Browser Tab？如果不是，W1 未完成。
3. 项目隔离是否只有 renderer 过滤？如果是，立即停止，主进程必须校验 `projectId`。
4. 两个公司登录同一网站时，能否明确看到并隔离两个 Session？不能则停止自动提交。
5. 事务和 AI 是否复用侧栏同一资源 Tab 启动语义？各自按 URL/Profile 打开则 A1 未完成。
6. 事务 Tab 是否只是 renderer mock？主进程持久化、重启恢复未通过则 A1 未完成。
7. 流程图是否拥有第二份节点状态？必须只渲染 `WebAffairService` 投影。
8. AI 是否能删除已经提交的节点？不能，只能追加补正和历史。
9. 交还 AI 后是否重新观察页面？没有重新观察证据则不得继续。
10. 等待审核时是否仍显示运行中？必须结束当前运行。
11. 证据不足时是否仍能完成？不能。
12. 当前 Batch 是否产生了用户可验收能力？连续 60 分钟没有则执行偏航检查。
13. 是否为了扩平台提前开发模板市场？第一条真实纵向闭环未通过前不得扩张。

## 10. 里程碑管理

### 10.1 Definition of Ready

里程碑进入 `In Progress` 前必须满足：

1. 上一依赖里程碑已经 `Complete`，或有经过记录的并行开发理由。
2. 用户可执行的端到端验收步骤已经写入本文。
3. 能力边界、失败降级、状态所有者、生命周期和权限面已经明确。
4. 涉及的 shared contract、持久化版本和迁移策略已经评审。
5. 已识别真人验收所需的网站、账号、材料和风险。
6. 不依赖未授权的官方账号、云服务、生产 API 或商业版实现。
7. 当前工作树的无关修改已经识别，不会被覆盖。

### 10.2 Definition of Done

里程碑进入 `Complete` 必须同时满足：

1. 本文对应真人验收步骤全部通过。
2. 成功、失败、取消、重启和降级路径都有用户可见结果。
3. 主进程事实、renderer 投影和重启恢复一致。
4. 没有第二状态 owner、生命周期分叉、重复 IPC 契约或权限扩张。
5. 受影响的 contract、service、UI、迁移和 smoke 测试通过。
6. `pnpm verify` 通过。
7. `docs/ops/ai-web-affairs-agent-acceptance.md` 记录提交 SHA、环境、步骤、结果和截图
   或其他证据引用。
8. 当前文档的里程碑状态、当前能力、风险和下一步已经更新。
9. 残余风险已明确，不使用“后续优化”掩盖未完成的验收项。

### 10.3 里程碑退出证据

| 里程碑 | 必需的真人证据                              | 必需的工程证据                                       |
| ------ | ------------------------------------------- | ---------------------------------------------------- |
| E0     | 无用户验收；需要架构评审结论                | contract/schema、迁移、生命周期和权限评审            |
| W1     | 添加即打开、侧栏重开、双账号、项目切换/移动 | project scope、资源 Tab、迁移、Session 隔离测试      |
| A1     | 本项目事务、资源 Tab 复用、流程和重启恢复   | project guard、affair 持久化、Tab 恢复和资源失效测试 |
| A2     | 真实网站 AI 执行、接管、交还、重观察和确认  | launch、correlation、handoff、side-effect、reconcile |
| A3     | 等待、App退出、错过检查、补查和结果变化     | wake-up、missed、restart、bounded retry 测试         |
| A4     | 流程 diff、重大变更确认、模板降级           | flow version、不可变历史、adapter fallback 测试      |
| R1     | 一件真实事务从创建到可验证结果              | 全量CI、`pnpm verify`、发布候选和残余风险            |

## 11. 进度汇报

### 11.1 固定汇报格式

每次阶段汇报按以下顺序更新，不能只报内部任务：

```text
用户现在能做什么：
- ...

用户还不能做什么：
- ...

当前里程碑：
- ID / 状态 / 已持续时间

本次用户能力增量：
- ...

工程准备度：
- contract / service / UI / migration / tests

验证结果：
- 自动化：
- 真人：

阻塞和风险：
- ...

下一步：
- 下一条可以真人验收的动作
```

### 11.2 汇报触发条件

- 每个里程碑开始、进入验收、完成或阻塞时。
- 持续开发每 60 分钟至少一次用户能力增量检查。
- 单项前置工作超过 60 分钟时。
- 同一阻塞连续失败两次时，第三次尝试前先执行止损评审。
- 计划、主体、权限、存储或首条真实验收网站发生变化时。

### 11.3 状态更新规则

- `Pending -> Ready`：依赖完成，DoR 满足。
- `Ready -> In Progress`：有真实实现工作开始。
- `In Progress -> Acceptance`：代码实现和自动化门禁完成，等待真人验收。
- `Acceptance -> Complete`：DoD 和退出证据全部满足。
- 任意状态到 `Blocked`：同一阻塞连续三次，且无法通过安全替代路径继续。
- 验收失败回到 `In Progress`，不能保留 `Complete` 或用“基本完成”描述。

## 12. 风险台账

| ID   | 风险                                            | 影响   | 可能性 | 当前控制                                     | 状态 |
| ---- | ----------------------------------------------- | ------ | ------ | -------------------------------------------- | ---- |
| R-01 | “网站与账号”仍演变成预置平台白名单              | 高     | 中     | W1 强制未预置网站真人验收                    | Open |
| R-02 | 两个公司复用错误 Profile 或账号                 | 极高   | 中     | 显式主体绑定、Profile 隔离、提交前复核       | Open |
| R-03 | WebAffair 与 renderer/Runner 出现第二状态 owner | 高     | 中     | 主进程唯一 owner、command + snapshot 契约    | Open |
| R-04 | AI 重写已提交节点或重复提交                     | 极高   | 中     | 不可变历史、Attempt、side-effect key         | Open |
| R-05 | 交还 AI 后沿用旧页面假设                        | 高     | 中     | 强制重新观察 URL、Profile 和页面证据         | Open |
| R-06 | 敏感材料、Cookie 或凭证进入日志和状态快照       | 极高   | 低到中 | 稳定引用、脱敏投影、Credential/Browser owner | Open |
| R-07 | 等待外部时保持假运行或声称 App 外持续跟踪       | 高     | 中     | 运行结束、missed 状态、明确本地边界          | Open |
| R-08 | 先扩模板/适配器导致主线长期没有真实闭环         | 高     | 高     | A2 前禁止模板市场和批量平台扩张              | Open |
| R-09 | 旧运营配置迁移破坏文件或登录态                  | 高     | 中     | 双读、单写新格式、不自动删除、回滚验收       | Open |
| R-10 | 真实网站页面变化导致自动化不稳定                | 中到高 | 高     | 观察—动作—验证、语义重定位、人工降级         | Open |
| R-11 | 只在 renderer 过滤导致 IPC/AI 跨项目访问        | 极高   | 中     | 主进程解析并校验稳定 projectId               | Open |
| R-12 | 项目移动或复制后资源归属错误                    | 高     | 中     | 复用项目 Manifest ID 和复制分叉规则          | Open |
| R-13 | 侧栏、事务和 AI 各自创建不同网页 Tab            | 高     | 高     | 统一资源启动描述和 ensureWebResourceTab      | Open |
| R-14 | Cookie 启发式被误报为确定账号身份               | 极高   | 中     | 用户确认、Session 信号和执行前页面复核       | Open |

风险只有在对应控制经过自动化和真人验证后才能改为 `Mitigated`；不能因为已经写了
设计文档就关闭。

## 13. 决策记录

本文只记录不需要 ADR 的产品和实施决定；违反 `docs/architecture.md` 的决定必须在
`docs/decisions/` 单独提交 ADR。

| 日期       | ID   | 决定                                        | 原因                                       | 状态     |
| ---------- | ---- | ------------------------------------------- | ------------------------------------------ | -------- |
| 2026-07-31 | D-01 | 当前“运营”演进为“网站与账号”                | 网站和登录资源不应受预置平台限制           | Accepted |
| 2026-07-31 | D-02 | 新增独立“事务”Activity Bar 和事务 Tab       | 资源管理与具体事务生命周期必须分离         | Accepted |
| 2026-07-31 | D-03 | 事务侧栏使用连续列表，状态不是一级目录      | 用户先定位事务，再查看状态                 | Accepted |
| 2026-07-31 | D-04 | 事务 Tab 固定为资源、流程图、节点详情三段式 | 不同事务共用页面，差异由流程数据驱动       | Accepted |
| 2026-07-31 | D-05 | 流程实例由 `WebAffairService` 唯一拥有      | 防止模板、Agent或renderer成为第二事实源    | Accepted |
| 2026-07-31 | D-06 | 首批先交付任意网站资源闭环                  | 事务执行前必须可靠确定主体、账号和Profile  | Accepted |
| 2026-07-31 | D-07 | 首版流程使用DAG，重试放在Attempt中          | 防止流程循环覆盖历史和副作用               | Accepted |
| 2026-07-31 | D-08 | W1 真人登录验收一次性延期，先推进手工 A1    | 用户明确授权；A1 不产生网页外部副作用      | Accepted |
| 2026-08-04 | D-09 | “网站与账号”只管理当前项目                  | 用户心智明确，避免全局资源库和项目归属黑盒 | Accepted |
| 2026-08-04 | D-10 | 侧栏资源主要点击直接打开实际 Browser Tab    | 网站账号必须是可执行资源，不是静态详情     | Accepted |
| 2026-08-04 | D-11 | 事务和 AI 复用侧栏同一资源 Tab 启动语义     | 防止 URL、Profile 和当前 Tab 猜测导致串号  | Accepted |
| 2026-08-04 | D-12 | 项目归属保存稳定 projectId                  | 项目移动不失联，复制项目不继承原归属       | Accepted |
| 2026-08-04 | D-13 | 撤回 W1–A4 的产品 Acceptance 状态           | 历史门禁只证明工程组件，没有通过新产品闭环 | Accepted |

## 14. 进度记录

进度记录只追加，不覆盖历史描述。历史条目中的 `Acceptance` 等状态只表示当时口径；
当前有效状态只看 0.1、0.2 和最新一条进度记录。

### 2026-07-31 · 管理基线建立

用户现在能做什么：

- 仍只能使用现有轻量运营入口、浏览器、Profile 和 Agent 基础能力。
- 还不能添加通用网站资源，也不能创建持久网页事务。

本次完成：

- 确认“网站与账号 + 事务”双入口产品结构。
- 确认事务侧栏为连续事务列表。
- 确认事务 Tab 为相关资源、整体流程和节点详情三段式。
- 确认通用页面、动态流程和唯一状态 owner。
- 形成 E0、W1、A1–A4、R1 里程碑、验收、风险和开发批次。

验证：

- 产品文档和开发管理文档已建立交叉引用。
- Markdown Prettier 和 `git diff --check` 通过。
- 尚未运行功能测试，因为没有功能代码变更。

当前状态：

- E0：Ready。
- W1–R1：Pending。

下一步：

- 启动 E0，冻结 WebResource contract、存储版本、迁移规则和服务生命周期。

### 2026-07-31 · WebResource 首条纵向切片

用户现在能做什么：

- Activity Bar 中原“运营”入口已显示为“网站与账号”，内部仍沿用兼容的
  `operations` ID。
- 可以录入未预置的网站、个人/公司等业务主体、账号标签和独立 Browser Profile。
- 可以从列表查看网站、主体、账号、Profile 和脱敏登录诊断，并用对应 Profile 打开
  网站。
- 还不能创建事务；W1 的真实登录、重启恢复、双 Profile、旧配置迁移和资源详情 Tab
  尚未完成人工验收。

本次完成：

- 新增 `WebResourceSnapshot` v1、严格输入 Schema、结构化错误和单一 IPC contract。
- 新增 `WebResourceService` 唯一元数据 owner；文件位于 `userData/web-resources/`，
  采用串行原子写入、有效主文件备份和损坏恢复。
- 主文件和备份同时损坏时保留故障现场并降级服务，不回退空库覆盖原数据。
- Cookie、密码和验证码不进入资源快照；Browser Profile 与 Cookie 继续由
  `BrowserManager` 持有。
- 服务启动失败时降级为结构化不可用状态，不阻断工作台其他本地能力。
- W1 在 E0 尚未全部退出前并行进入 `In Progress`，理由是用最小 UI 切片验证
  WebResource 契约；WebAffair contract 和旧配置迁移仍留在 E0/W1 主线。

验证：

- WebResource contract、并发持久化、重复账号、备份恢复、可信 IPC 和 preload
  定向测试：22 项通过。
- 全量 `pnpm test`：190 个测试文件、1102 项测试通过。
- `pnpm smoke:ui`：7/7 通过；包含未预置网站录入、主体/Profile 可见和 renderer
  reload 后恢复。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
- 完整 `pnpm verify` 通过，包含 OSS、凭证、上下文操作、发布、格式、lint、全量测试
  和生产构建门禁。
- 尚未执行真人登录/应用重启验收，因此 E0、W1 均不得标记 `Complete`。

当前状态：

- E0：In Progress。
- W1：In Progress。
- A1–R1：Pending。

下一步：

- 补旧 `cclink-accounts.json` 导入和资源详情 Tab。
- 用一个未预置网站、两个 Profile 执行登录、重启和隔离验收。

### 2026-07-31 · W1 自动化验收完成

用户现在能做什么：

- 在“网站与账号”侧栏录入未预置的网站、业务主体、账号标签和独立 Browser Profile。
- 点击任意账号进入资源详情 Tab，查看网站、主体、账号、Profile、Session Partition、
  Cookie 数量、可能的登录 Cookie 和最近核验时间，再以绑定 Profile 打开网站。
- 对当前本地项目显式导入 `cclink-accounts.json`；重复导入会跳过已有账号，旧文件和
  Browser Profile 不会被删除或改写。
- 应用重启后，已保存的网站、主体和账号资源仍能恢复。
- 还不能创建或执行“事务”；真实网站登录态跨重启和两个真实账号不串用仍待真人验收。

本次完成：

- 新增通用网站账号资源详情 Tab；列表点击不再直接跳入浏览器黑盒。
- 详情页展示资源归属和脱敏 Session 诊断，提供“核验登录”和“打开网站”操作。
- 新增当前项目旧配置的只读、显式、幂等导入；导入前要求用户指定业务主体。
- 导入沿用现有 `ProjectOpsService` 工作区路径白名单，输入使用严格 IPC contract；失败
  返回有界错误，部分成功后允许安全重试。
- 补齐资源详情 Tab 的工作台恢复、去重和 Agent 可见资源投影。
- 修正侧栏 Flex 所有权，避免工作区面板在恢复后覆盖侧栏点击区域。

验证：

- `pnpm smoke:ui`：7/7 通过；通过真实 UI 创建两个账号资源、打开两个资源详情、验证
  Session Partition 不同、重启 Electron 后验证两个资源仍存在。
- 项目配置导入测试覆盖连续执行两次：首次导入，第二次全部跳过；Profile ID 保持不变。
- 全量 `pnpm test`：190 个测试文件、1106 项测试通过。
- 完整 `pnpm verify` 通过；包含 OSS/凭证/上下文操作/发布边界、格式、Lint、全量测试、
  TypeScript 和生产构建。
- 真人验收尚未执行；证据和步骤见
  `docs/ops/ai-web-affairs-agent-acceptance.md`。

当前状态：

- E0：In Progress；`WebAffair` contract 尚未冻结。
- W1：Acceptance；实现和自动化门禁完成，等待真人登录验收。
- A1–R1：Pending。

残余风险：

- Session Partition 不同只证明浏览器隔离容器不同，不等价于真实网站一定不会通过设备
  指纹、SSO 或跨域授权关联账号。
- Cookie 名称启发式只能投影“可能已登录”，不能代替页面内账号身份核对。
- 项目配置导入已由自动化证明不改写源文件路径，但仍需在真实旧项目上核对文件哈希和
  导入后展示。

下一步：

- 用户选择一个允许测试、风险可控的真实网站和两个测试账号，按 W1 验收手册完成登录、
  重启和账号隔离验收。
- W1 通过前不启动自动提交；通过后启动 A1，交付“事务”Activity Bar、连续事务列表和
  三段式事务 Tab 的最小持久闭环。

### 2026-07-31 · W1 验收延期并交付 A1 第一纵向切片

用户现在能做什么：

- Activity Bar 已新增独立“事务”入口，侧栏按连续列表展示事务，状态只显示在事务名称旁，
  没有把状态做成一级目录。
- 用户可以创建事务，填写名称和最终目标，选择业务主体、一个或多个网站账号、多个本地
  材料引用，并用每行一个步骤快速生成线性流程。
- 通用事务 Tab 已包含“相关资源、整体流程、节点办理情况”三个区域；点击流程节点会显示
  该节点的状态、责任人、账号、材料、成功判据、结果说明和时间线。
- 用户可以人工更新节点状态；标记完成必须填写结果说明，完成节点进入不可修改终态；
  上游完成后，依赖它的下游节点自动从阻塞变为待处理。
- 关闭或重启 Studio 后，事务、流程、节点状态、材料引用和追加事件仍然存在。
- 还不能修改流程结构、诊断材料文件变化、让 AI 执行节点、进行人工接管/交还或等待外部
  后自动复查。

本次完成：

- 新增 `WebAffairSnapshot` v1、严格 Schema、结构化错误和单一 IPC contract。
- 新增主进程 `WebAffairService` 唯一事务 owner，以及串行、原子、备份恢复的
  `WebAffairStore`；默认文件位于 `userData/web-affairs/web-affairs.json`。
- 流程以持久 `nodes + edges` 表达，创建入口首版生成线性 DAG；加载时拒绝重复 ID、
  失效引用、自循环和有向环。
- 状态转换由主进程单一定义，Renderer 只消费每个节点的 `availableTransitions`，不建立
  第二套状态机。
- 事务服务初始化失败时返回结构化降级状态，不阻断网站账号、浏览器和其他本地能力。
- 新增事务 Activity Bar、连续侧栏列表、创建表单、三段式事务 Tab、资源跳转和时间线。

验证：

- 定向 contract、service、IPC、preload、Tab 和 Activity Store：6 个测试文件、66 项
  测试通过。
- `pnpm smoke:ui`：8/8 通过；通过 UI 创建五节点事务、打开三段式 Tab、完成第一节点、
  验证第二节点自动解锁，并在 Electron 重启后验证事务和现场恢复。
- 完整 `pnpm verify` 通过：193 个测试文件、1118 项测试，以及 OSS/凭证/上下文操作/
  发布边界、格式、Lint、类型检查和生产构建全部通过。
- 已在 1440×920、Agent 面板展开的实际桌面布局下检查三段式 Tab；资源卡、流程和节点
  详情无覆盖。
- W1 真人登录验收未执行；用户本次只批准延期，未批准删除或视为通过。

当前状态：

- E0：In Progress；Attempt/Evidence/Runner 等后续契约仍待冻结。
- W1：Acceptance（Deferred）；真人登录、重启登录态和真实账号不串用待补测。
- A1：In Progress；第一纵向切片已通过自动化，完整 A1 验收未完成。
- A2–R1：Pending。

残余风险：

- 材料目前只保存用户选择的绝对路径和显示名，不读取正文，也尚未检测文件被移动、删除或
  修改。
- 创建时只能生成线性流程；尚不能增删未执行节点、编辑依赖或形成并行分支。
- 节点进度目前由用户人工更新，不能据此声称 AI 已接管事务。
- W1 真实登录隔离风险仍然存在，进入 A2 真实网页执行前必须补回验收。

下一步：

- 完成 A1 的流程结构编辑和材料有效性诊断，覆盖未执行节点可改、终态历史不可删和并行
  依赖。
- 补充 A1 真人创建/编辑/重启验收；A2 开始前补回 W1 真人登录验收。

### 2026-07-31 · A1–A4 工程纵向路径进入验收

用户现在能做什么：

- 检查事务材料是否可用、丢失或在加入后发生变化；缺失或变化材料会阻止 AI Attempt。
- 编辑未执行节点、责任人和依赖，形成并行 DAG；已完成节点、已有 Attempt 的节点及其
  历史依赖不能删除或覆盖。
- 从 Ready 节点打开绑定账号和 Profile 的浏览器现场，创建独立 Agent 会话、AgentRun、
  BrowserTaskRun 和持久 Attempt，并在诊断关联中记录 affair/node/attempt ID。
- 随时接管网页并暂停 BrowserTask；交还时必须填写人工操作后的现场说明，AI 重新读取
  URL 和页面状态后才能继续。
- 在最终确认卡中查看主体、账号、URL、成功判据和文件；同节点同流程版本的最终动作使用
  副作用 Key 去重。最终确认节点没有产品级确认时不能成功结束。
- 让节点结束当前运行并进入外部等待；到期显示需要新检查，应用退出期间显示错过，不
  伪装为后台运行；状态不变时有界退避，驳回时追加补正节点。
- 使用版本化原子节点目录和通用网页事务模板；AI 可以通过 `web-affairs` MCP 工具读取
  事务、记录结果、完成检查和提出流程 diff，流程 diff 必须由用户确认后才能应用。
- 平台增强目录当前只有通用网页适配器；专用适配器失效或不存在时明确降级到通用网页
  代理或人工步骤，不把平台适配器变成事务 owner。

本次完成：

- `WebAffairSnapshot` 从 v1 迁移到 v2，新增材料指纹、Attempt、Evidence、WaitPlan、
  FlowProposal、模板引用和递增流程版本；v1 数据迁移不删除事务或历史节点。
- `WebAffairService` 继续是唯一状态 owner；BrowserTask、AgentRun、Profile 和模板只保存
  自身事实或关联 ID。renderer 通过安全变更事件刷新投影，不维护第二状态机。
- 建立启动对账：`preparing/running-ai/verifying` Attempt 在应用重启后进入
  `interrupted`，对应节点进入 `waiting-human`，避免假运行和重复提交。
- 新增材料检查、流程修订、Attempt 启动/绑定/接管/交还/确认/结束、等待计划、检查结果、
  流程建议和用户决定的严格 IPC contract 与 preload API。
- 新增 A1 流程编辑器、A2 执行与交接区、A3 外部等待区、A4 模板及流程建议确认区；修复
  流程编辑器展开后覆盖节点面板的布局问题。
- 修正 UI smoke 在 Electron 重启时读取旧 CDP 端口的问题，使测试能识别日志追加和覆盖
  两种启动方式。

验证：

- A1–A4 范围测试：5 个文件、19 项通过；范围 ESLint 和目标文件 Prettier 检查通过。
- 当前工作树完整 `pnpm verify` 通过：199 个测试文件、1155 项测试全部通过；OSS、凭证、
  上下文操作、发布、格式、Lint、类型检查和生产构建门禁全部通过。
- `node scripts/ui-smoke.mjs`：10/10 通过；除角色中心、资源和事务恢复外，验证 A2 执行前
  核验卡、A3 等待区、A4 模板、流程编辑器和流程 diff 确认。
- 自动化没有执行真实网站最终提交，也没有绕过验证码、风控或平台条款。

当前状态：

- E0：Acceptance；v2 契约、迁移和单一 owner 已实现，等待最终架构/真人退出证据。
- W1：Acceptance（Deferred）；真实登录、重启登录态和页面账号不串用仍待补测。
- A1：Acceptance；工程和 UI smoke 通过，材料变化与流程编辑仍待真人操作验收。
- A2：Acceptance；执行、接管、交还、重新观察、确认和重启对账已实现，真实网站 AI
  运行待验收。
- A3：Acceptance；等待、错过、有界退避、通过/驳回分支已实现，真实外部状态变化和
  跨时间验收待执行。
- A4：Acceptance；catalog、模板、AI diff、确认、不可变历史和通用降级已实现，真实
  页面触发的 diff 和适配器失效待验收。
- R1：Pending。

残余风险：

- A2 的 Agent 后端、真实账号权限、验证码和页面风控只能在用户选择的网站现场验证。
- 当前调度是本地进程存活时的有界到期标记；App 退出期间不会运行，重启后只显示错过并
  等待补查，符合本地产品边界但尚未经过跨天真人验收。
- 通用适配器已经提供降级路径，但还没有任何高频网站专用识别增强；不能据此声称特定
  政务或应用商店平台已经专项适配。
- W1 一次性豁免没有扩展到真实网页执行；任何真实 A2 操作前仍必须先完成 W1。

下一步：

- 用户选择一个允许自动化、风险可控、不会产生不可逆业务后果的真实网站和两个测试
  账号，先完成 W1，再执行 A1–A4 验收手册。
- 真人验收未完成前，保持 A1–A4 为 `Acceptance`，不得改为 `Complete`。

### 2026-08-04 · 项目网站资源 Tab 产品纠偏

用户现在能做什么：

- 仍可使用已有全局网站账号、资源详情、Browser Profile 和事务工程 UI。
- 仍可操作既有流程、Attempt、人工交接、等待和流程 diff 组件。

用户还不能做什么：

- 不能让“网站与账号”只显示和管理当前项目。
- 不能在侧栏添加网站后立即打开带稳定项目资源引用的实际 Browser Tab。
- 不能保证关闭、重启、移动项目后由侧栏恢复同一资源 Tab，也不能证明跨项目不串用。
- 事务和 AI 还没有复用侧栏同一资源启动语义，真实网站闭环不可验收。

本次完成：

- 产品事实源确认“网站与账号”只管理当前项目，不提供全局资源中心入口。
- 确认侧栏资源主要点击直接打开或激活实际 Browser Tab，详情管理降为行尾动作。
- 确认添加网站必须形成“创建资源—立即打开网页—人工登录—确认身份”的连续交互。
- 确认 Browser Tab 保存稳定资源引用，但只作为可关闭、可恢复的运行投影。
- 确认事务资源区和 AI Attempt 必须复用侧栏相同的资源启动语义。
- 完成实现可行性评估：现有 WebResource、Browser Session、Tab、WebAffair 和 Attempt
  基础可复用；主要缺口是项目归属、IPC 隔离、Tab 引用、统一启动和安全迁移。

状态纠正：

- E0：In Progress；重新冻结稳定 `projectId`、WebResource v2、资源 Tab 和迁移契约。
- W1：In Progress；已有任意网站和 Session 基础，确认后的项目资源 Tab 闭环未实现。
- A1–A4：Pending；已有工程组件保留，但必须在 W1、A1 新归属和启动链上重新接入并验收。
- R1：Pending。

历史证据处理：

- 2026-07-31 的自动化、UI smoke 和 `pnpm verify` 结果继续保留，证明当时提交的工程门禁。
- 原进度记录中的 `Acceptance` 是当时口径，不能覆盖本次状态纠正，也不能作为当前产品
  验收证据。

下一步：

- 先完成 Batch C0 契约和迁移，再实现 Batch C1“添加网站即打开资源 Browser Tab”。
- C1 未完成真人验收前，不继续扩张模板、平台适配器或自动提交能力。

### 2026-08-04 · E0/W1 实现进入验收

用户现在能做什么：

- 在当前本地项目添加任意网站、业务主体和账号，添加后立即打开实际 Browser Tab。
- 关闭或离开网页后，从“网站与账号”侧栏再次点击同一行，聚焦或重建同一项目账号的
  Browser Tab；重复点击不制造重复主 Tab。
- 切换项目时只查询该项目的网站账号；旧 v1 账号不会自动归入任意项目，可由用户明确
  认领。
- 在事务资源区点击账号、或由 AI 启动事务节点时，均复用同一资源 Tab 启动入口。

用户还不能做什么：

- 还没有在真实登录网站完成双账号、重启、项目切换和项目移动的真人验收，因此不能把
  W1 标记为 `Complete`。
- 事务集合仍是全局事实源，缺少主进程稳定 `projectId` 和账号同项目校验；A1 仍为
  `Pending`，现有事务 UI 不能代表本项目事务闭环。
- AI 在真实网站上的验证码、风控、人工接管、最终提交和外部等待仍未验收。

本次完成：

- 发布 `WebResourceSnapshot v2`，账号连接带稳定 `projectId`，由主进程根据当前
  `workspaceRef` 解析和强制隔离。
- 创建、查询、登录确认、v1 认领和旧项目配置导入全部经过项目归属校验；Browser
  Profile 改为主进程自动生成，普通表单不再暴露该实现概念。
- Browser Tab 增加稳定 `webResourceRef { projectId, accountId }`；侧栏、事务资源区、
  旧详情兼容页和 AI Attempt 统一调用 `ensureWebResourceTab`。
- UI smoke 更新为真实新交互：当前项目添加未预置网站、直接打开 Browser Tab、重复点击
  聚焦复用、应用重启后资源仍存在。

验证证据：

- `pnpm smoke:ui`：10/10 通过。
- `pnpm verify`：通过；202 个测试文件、1171 个测试通过，lint、格式、开源边界、凭证
  边界、上下文操作边界、release 验证、类型检查和生产构建均通过。
- 首轮 `pnpm verify` 曾有一个无关的本地 Git push 测试超过 5 秒；单测复核 1.0 秒通过，
  完整门禁复跑时 2.6 秒通过，未修改该测试或放宽门禁。

当前状态：

- E0：`Acceptance`；契约、迁移、生命周期和权限面实现完成，等待退出评审。
- W1：`Acceptance`；实现和自动化完成，等待真实网站真人验收。
- A1–R1：`Pending`。

下一步：

- 先按验收手册完成 W1 真实网站、两个测试账号、重启、项目切换和项目移动验收。
- 工程主线进入 A1：为 WebAffair 增加必填稳定 `projectId`、v3 迁移、项目级 IPC 查询和
  同项目资源校验；在此之前不扩张平台适配器或自动提交。

### 2026-08-04 · A1 当前工作空间事务第一纵向切片

用户现在能做什么：

- “事务”侧栏只查询当前本地工作空间，新建事务只会出现在创建它的工作空间。
- 新事务只能关联当前工作空间的网站账号；主进程拒绝跨工作空间账号引用。
- 切换工作空间后，旧工作空间事务不会继续显示；旧 v1/v2 事务迁移为未归属并明确提示，
  不会静默塞入当前工作空间或继续执行。

本次工程实现：

- `WebAffairSnapshot` 升级为 v3，新增稳定 `workspaceId`；这里遵守架构宪法的新命名，
  底层暂由兼容方法 `getLocalProjectId` 解析同一个稳定身份。
- `getSnapshot` 和 `createAffair` IPC 必须携带 `workspaceRef`，主进程解析稳定身份后才调用
  `getProjectSnapshot` 或创建事务。
- 创建事务同时校验主体、账号以及账号的稳定工作空间归属。
- v1/v2 事务只迁移为 `workspaceId: null`；侧栏显示未归属数量，后续必须逐项确认迁移。

验证证据：

- WebAffair service/IPC/MCP、统一 IPC 契约和失效 Tab 投影定向测试：5 个文件、30 项通过。
- `pnpm smoke:ui`：10/10 通过，覆盖新建当前工作空间事务和重启恢复。
- `pnpm verify`：通过；203 个测试文件、1176 项测试、lint、格式、开源/凭证/上下文操作
  边界、release 验证、类型检查和生产构建均通过。

当前状态与残余风险：

- A1：`In Progress`，已形成“项目级列表—创建—账号校验—修改/执行校验—打开”的用户切片。
- 更新节点、修订流程、材料检查、Attempt、等待计划与流程建议全部增加
  `workspaceRef`；主进程解析稳定身份后，服务层拒绝不属于当前工作空间的事务。
- MCP 事务工具已改为使用 Agent 会话的 `workspaceKey`；缺少本地工作空间时返回
  `WORKSPACE_REQUIRED`，读取也不再扫描全局事务集合。
- 当前项目事务加载后，会关闭不存在于该项目 Snapshot 的旧事务 Tab；有效 Tab 和其他
  项目 Tab 不会被误关闭。
- 仍需为未归属旧事务提供显式的逐项确认归属或只读导出；这不能由路径启发式自动代替。

## 15. 变更控制

- 产品目标、用户心智和最终验收变化：先更新
  `docs/features/ai-web-affairs-agent.md`，再同步本文。
- 开发顺序、代码落点、估算、状态和风险变化：更新本文并追加进度记录。
- 架构宪法例外：先提交 ADR，未批准前不得实现。
- 已 `Complete` 里程碑的验收标准发生实质变化：重新打开为 `In Progress` 或新增
  后续里程碑，不能静默修改历史证据。
- 新增平台适配器不得改变通用流程和资源模型；需要例外时先评审是否形成第二状态 owner。
