# AI 网页事务代理人开发管理

> 文档版本：1.8
> 基线状态：网站账号新建流程已重新冻结为“先进入真实网页并登录、后保存到当前项目”；
> W1-A–W1-C 与 A1–A4 的既定实现已结束并进入统一 Acceptance；全量工程门禁和统一 UI
> 冒烟已通过，真实账号、项目隔离、AI—人工交接和外部复查仍需按验收手册完成真人验证
> 最后更新：2026-08-05
> 产品事实源：`docs/features/ai-web-affairs-agent.md`
> 架构约束：`docs/architecture.md`
> 本文件是计划、里程碑、验收、进度、风险和交付证据的唯一开发管理事实源；与产品
> 事实源冲突时，以产品事实源为准。

## 0. 项目状态

### 0.1 当前结论

用户现在可以在当前本地项目点击“添加网站与账号”，不填写前置资料表，直接进入使用
独立临时 Profile 的实际 Browser Tab；完成网页登录后只填写一个账号名称，即可把当前
Tab 原地保存为项目网站账号，并从侧栏重新打开同一登录环境。侧栏旧完整表单已经删除。

网站账号链已经覆盖未保存关闭、保存失败原地重试、幂等保存、疑似重复的两个明确分支、
同站双账号独立登录环境、遗留草稿启动清理、项目隔离和统一主进程启动解析。侧栏、事务
资源区、账号详情和 AI Attempt 都只按当前工作空间和正式账号 ID 调用
`resolveLaunch`，不再自行拼装 URL 或 Profile。

用户现在可以在当前本地项目查看和新建本项目事务；节点更新、流程修订、材料检查、
Attempt、等待计划和 AI/MCP 事务工具都会在主进程按稳定工作空间身份再次校验，不能只凭
`affairId` 跨项目读写。事务资源区和 AI Attempt 复用同一个网站资源 Tab 启动入口。
未归属旧事务会以独立待处理列表显示，用户需逐项二次确认；主进程会在落库前重新校验主体和
账号属于当前项目。但这仍不代表真实网页代理闭环已经验收：W1 和 A1 仍需按验收手册完成真实网站、
项目切换、重启、本地材料变化和旧事务归属验收。

事务侧栏现在只保留当前项目事务列表和“新建事务”入口。点击新建会打开工作区草稿 Tab；
主体、账号、材料、模板和结构化初始流程均在该 Tab 管理，创建成功后原 Tab 转为正式事务
Tab。旧的侧栏内联表单已删除，并由 UI smoke 明确禁止回流。

事务链已经在新资源入口上回归：事务草稿和三段式 Tab、流程版本、材料失效、AI Attempt、
人工接管/交还、最终动作确认、外部等待/到期/错过/复查 Attempt、驳回补正和流程 diff
均继续由 `WebAffairService` 持久化。AI 启动失败会结束本次 Attempt，不留下假运行；进入
外部等待会结束当前运行，到期或错过后才允许创建新的检查 Attempt。

以上是实现完成度，不是真人产品完成度。真实账号身份、登录恢复、项目移动/复制、真实
网页 AI—人工—AI 交接、实际时间经过和结果证据尚待本轮统一验收，因此所有里程碑最多
进入 `Acceptance`，不能标记 `Complete`。

当前项目状态：

| 维度         | 当前事实                                                      |
| ------------ | ------------------------------------------------------------- |
| 用户功能进度 | W1-A–W1-C、A1–A4 的既定 UI 与端到端操作入口均已实现           |
| 工程准备度   | 唯一 owner、草稿清理、统一启动、Attempt/等待/流程 diff 已收口 |
| 当前阶段     | W1-A–W1-C、A1–A4、R1 均为 `Acceptance`                        |
| 当前阻塞     | 无工程阻塞；尚缺真实网站真人端到端验收                        |
| 下一用户增量 | 按验收手册完成真实账号、项目隔离和真实网页纵向验收            |
| 完成声明     | 只能声明既定实现结束并进入验收；不能声明任何里程碑 `Complete` |

### 0.2 里程碑总览

状态只允许使用：

- `Pending`：尚未满足进入条件。
- `Ready`：进入条件已满足，可以开工。
- `In Progress`：正在实施。
- `Acceptance`：实现已结束，正在执行自动化和真人验收。
- `Complete`：真人验收、工程门禁和证据全部完成。
- `Blocked`：同一阻塞已连续三次阻止推进，且无安全替代路径。

| 里程碑 | 名称                   | 状态       | 依赖    | 用户完成后能做什么                          | 验收证据                                      |
| ------ | ---------------------- | ---------- | ------- | ------------------------------------------- | --------------------------------------------- |
| W1-A   | 单账号新建与保存闭环   | Acceptance | 无      | 不填资料表完成登录、保存、侧栏重开同一账号  | `docs/ops/ai-web-affairs-agent-acceptance.md` |
| W1-B   | 失败恢复与多账号稳定性 | Acceptance | W1-A    | 取消/失败可恢复；同站多账号和重启不串不丢   | 同上                                          |
| W1-C   | 项目隔离和 AI 调用     | Acceptance | W1-B    | 项目切换/移动/复制不串；AI 打开准确正式资源 | 同上                                          |
| A1     | 项目事务和三段式 Tab   | Acceptance | W1-C    | 创建本项目事务并复用已保存网站资源 Tab      | 同上                                          |
| A2     | 真实网页节点和人工交接 | Acceptance | A1      | AI 使用同一资源 Tab 执行、接管和交还        | 同上                                          |
| A3     | 等待外部和重新检查     | Acceptance | A2      | 提交后停止运行，按计划重新检查结果          | 同上                                          |
| A4     | 动态流程和平台增强     | Acceptance | A2      | AI 提出流程变更并复用模板/适配器            | 同上                                          |
| R1     | 首版交付验收           | Acceptance | W1-A–A4 | 在真实网站完成端到端网页事务闭环            | Tag、CI、真人验收和残余风险                   |

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

### 闭环一：从真实网页登录现场保存项目网站账号

> 用户在当前项目点击“添加网站与账号”后，不填写前置资料表，立即进入使用临时隔离
> 环境的实际 Browser Tab。用户输入网址并完成登录，只确认一个侧栏显示名称，即把当前
> 网页和登录环境保存到当前项目；当前 Tab 原地成为资源 Tab。关闭 Tab、重启 Studio、
> 移动项目或再次点击侧栏后仍能恢复；同站多账号、项目切换和 AI 调用均不串用。

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

### 2.2 当前可复用工程事实

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
- 侧栏、事务资源区、账号详情和 AI Attempt 已调用同一个
  `resolveAndOpenWebResourceTab`；它先请求主进程 `resolveLaunch`，普通事务 UI 不再展示
  Browser Profile 技术标识。
- `WebAffairSnapshot v3` 为事务增加稳定 `workspaceId`；项目级查询、创建以及全部事务写
  操作都由主进程解析当前 `workspaceRef`，服务层再校验事务归属。
- `web-affairs` MCP 模块从 Agent 会话的 `workspaceKey` 解析稳定身份；没有本地工作空间
  上下文时拒绝读写，不能把模型传入的 `affairId` 当作授权。
- v1/v2 旧事务迁移为未归属数据，不会按路径猜测或自动塞入当前项目。

A1 结构性问题已收口：已迁移为未归属的旧事务不会出现在当前项目列表，其失效工作台 Tab
会被清理；事务侧栏单独列出待归属项，用户逐项二次确认后，主进程重新校验当前项目的主体与账号
归属，不通过则保留原数据。旧的网站账号新建表单已经退出主路径，新建只走“先登录、后保存”。

### 2.3 剩余验收缺口

- 重复账号、跨重启、双账号隔离、项目切换、项目移动和 AI 精确调用的真人验收。
- 事务资源区与 AI Attempt 复用入口后的真人交互、登录失效和失败降级验收。
- 真实网站上的登录、AI 操作、人工交接、外部等待和结果证据验收。

上述是外部真实性和时间经过证据缺口，不是继续扩张表单、Store、流程模型或平台白名单的
理由。验收失败时只修对应失败链路，不能额外设计。

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

Browser Profile ID 由主进程生成并保存在账号资源中，新建流程不暴露该字段。真实
Cookie 仍由 `BrowserManager` 的持久化 Session 拥有；资源服务只保存登录确认时间和
脱敏摘要。事务启动 Attempt 前必须再次校验项目、账号、Session 信号和实际页面身份。

### 3.4 W1 冻结的唯一交互链

本轮只允许实现以下链路，不得在开发中改回表单、向导或账号详情页：

```text
当前项目“网站与账号”侧栏
  └─ 点击“添加网站与账号”
      └─ beginDraft(workspaceRef)
          ├─ 主进程解析 projectId
          ├─ 创建 draftId 和临时隔离 Profile
          └─ 工作区立即打开实际 Browser Tab
              ├─ 用户输入 URL
              ├─ 用户完成登录、扫码、验证码或 2FA
              └─ 点击“登录完成，保存到当前项目”
                  └─ 只确认侧栏显示名称
                      └─ saveDraft(draftId, tabId, displayName)
                          ├─ 主进程反查实际 URL、页面标题和 Profile
                          ├─ 校验 Tab、项目、草稿和 Profile 一致
                          ├─ 原子写入正式网站账号资源
                          ├─ 当前 Tab 原地换成 webResourceRef
                          └─ 侧栏刷新并出现正式资源行
```

用户关闭未保存 Tab 时走取消链：

```text
关闭未保存 Browser Tab
  └─ cancelDraft(draftId, tabId)
      ├─ 不写正式资源
      ├─ 不出现在侧栏、事务选择器或 AI 资源中
      └─ 临时 Profile 进入有界清理
```

正式资源的侧栏重开、事务引用和 AI 调用只走同一条启动链：

```text
侧栏点击 / 事务资源点击 / AI 请求打开账号
  └─ resolveLaunch(workspaceRef, accountId)
      ├─ 主进程解析当前 projectId
      ├─ 校验 accountId 属于当前项目
      └─ 返回可信 entryUrl + browserProfileId + webResourceRef
          └─ ensureWebResourceTab
              ├─ 已存在同 projectId + accountId 主 Tab → 激活
              └─ 不存在 → 用可信描述重建 Browser Tab
```

创建过程中不允许出现第二条“先保存网站资料再登录”的兼容主路径。旧资源只需要继续
可读、可打开，不需要保留旧创建表单。

### 3.5 W1 状态所有者和调用边界

| 状态或数据                          | 唯一 owner                    | 允许的投影或调用方                    | 禁止行为                               |
| ----------------------------------- | ----------------------------- | ------------------------------------- | -------------------------------------- |
| 稳定 `projectId`                    | `WorkspaceStateService`       | WebResource IPC 只提交 `workspaceRef` | renderer 自报或用路径猜项目 ID         |
| 临时资源生命周期和清理账本          | `WebResourceService`          | Browser Tab 显示 draft 状态           | Tab store 建立第二份可持久草稿事实     |
| 正式网站账号资源和 Profile 绑定     | `WebResourceService`          | 侧栏、事务和 AI 读取项目范围 Snapshot | 登录前写入正式资源                     |
| Browser View、当前 URL 和页面标题   | `BrowserManager`              | 保存命令由主进程反查                  | renderer 把 URL 或标题作为可信保存输入 |
| Cookie、localStorage 和真实 Session | Electron 持久 Session         | BrowserManager 通过 Profile 使用      | 复制到项目文件、资源 Snapshot 或日志   |
| 密码、Token 等显式秘密值            | `CredentialService`（如使用） | 本轮新建流程不新增凭证录入            | 为本功能新增密码表单或明文存储         |
| 工作区 Browser Tab                  | renderer `tab-store`          | 保存 draft/ref 的可丢弃工作台投影     | Tab 关闭时删除正式资源                 |
| 事务节点状态                        | `WebAffairService`            | 只保存正式网站账号资源 ID             | 引用 draftId、URL 或当前活跃 Tab       |

关键主进程命令冻结为：

```ts
beginDraft({ workspaceRef })
  -> { draftId, profileId, workspaceRef }

saveDraft({ workspaceRef, draftId, tabId, displayName })
  -> { website, account, webResourceRef }

cancelDraft({ workspaceRef, draftId, tabId })
  -> { cleanup: 'completed' | 'scheduled' }

resolveLaunch({ workspaceRef, accountId })
  -> { entryUrl, browserProfileId, webResourceRef, title }
```

`profileId` 只供 Browser Tab 内部绑定，不能进入任何用户输入。`saveDraft` 不接收 URL、
网站名称、项目 ID、登录状态或 Profile ID；这些字段全部从主进程当前事实反查。

### 3.6 W1 数据模型和生命周期

临时数据只保存完成清理和原子转正所需的最少元数据，不保存页面正文或秘密值：

```ts
interface WebResourceDraftRecord {
  draftId: string
  projectId: string
  workspaceKey: string
  browserProfileId: string
  tabId: string | null
  state: 'open' | 'saving' | 'cleanup-pending'
  createdAt: string
  updatedAt: string
}
```

正式资源继续由 `WebResourceService` 持久化，至少包含稳定 `accountId`、`projectId`、
自动取得的网站名称、入口 URL、侧栏显示名称、`browserProfileId` 和用户确认时间。真实
Cookie 与 Session 不进入资源文件。

目标存储位置和恢复责任：

| 数据                                 | 目标位置                                              | 是否包含秘密 | 恢复/清理责任                           |
| ------------------------------------ | ----------------------------------------------------- | ------------ | --------------------------------------- |
| 项目稳定身份                         | 项目 `.cclink-studio/project.json` 的既有 `projectId` | 否           | `WorkspaceStateService` 解析移动/复制   |
| 正式网站账号元数据                   | `{userData}/web-resources/web-resources.json`         | 否           | `WebResourceStore` 原子写与备份恢复     |
| 未保存 draft 清理账本                | `{userData}/web-resources/web-resource-drafts.json`   | 否           | `WebResourceService` 启动对账和清理     |
| 临时或正式 Profile 的 Cookie/Session | Electron `persist:` Session 分区                      | 是           | `BrowserManager` 使用，draft 取消时清理 |
| Browser Tab 的 draft/正式引用        | 工作空间 Tab 可丢弃投影；draft 不允许跨重启恢复       | 否           | renderer 恢复正式引用，丢弃 draft       |
| 密码、验证码、2FA 内容               | 本轮不采集、不写资源文件                              | 是           | 只由用户在实际网页处理                  |

draft 清理账本使用权限受限的本地文件，只记录 draft、项目、Profile、Tab 和时间，不记录 URL、
页面标题、Cookie 值、用户名或页面正文。正式资源元数据仍不写入 Git 可见项目文件；项目移动靠
稳定 `projectId` 恢复，项目复制产生新 ID 后不能继承原账号。

生命周期表：

| 阶段             | 持久事实                                | 用户看到什么                      | 失败或退出处理                           |
| ---------------- | --------------------------------------- | --------------------------------- | ---------------------------------------- |
| 开始新建         | 写入无秘密值 draft 清理记录             | 实际 Browser Tab、未保存标识      | 创建失败不打开假 Tab，显示可重试错误     |
| 浏览和登录       | draft 仍为 `open`；Session 写入临时分区 | 正常网页、保存按钮                | 不写正式资源；用户可继续或关闭           |
| 保存中           | draft 为 `saving`                       | 同一 Tab 显示保存中，不重复提交   | 写入失败回到 `open`，保留网页和登录现场  |
| 保存成功         | 原子新增正式资源并删除 draft 记录       | 当前 Tab 原地转正式，侧栏新增一行 | 资源写入和转正不可出现一半成功           |
| 主动关闭未保存   | draft 转 `cleanup-pending`              | Tab 关闭，侧栏无新增              | 清理失败留待下次启动重试，不伪装已完成   |
| App 异常退出     | 清理账本保留 draft/Profile 引用         | 下次启动不恢复成正式资源          | 启动对账并清理陈旧 Profile；失败进入诊断 |
| 正式资源关闭 Tab | 正式资源与 Session 保留                 | 侧栏资源仍存在                    | 再次点击通过 `resolveLaunch` 重建        |
| 登录失效         | 正式资源保留，登录状态变为需重新登录    | 同一资源可重新打开并人工登录      | AI 暂停；不得新建或猜测另一个账号        |

保存必须串行并具有幂等键；同一个 `draftId` 重复保存只能返回同一结果或明确终态，不能创建两个
正式账号。资源落库成功但 renderer 更新失败时，重载项目 Snapshot 必须能恢复正式资源；
renderer 显示成功但资源未落库则属于门禁失败。

正常关闭 draft 时，renderer 必须在销毁 Browser View 前发送 `cancelDraft`；即使清理调用失败，
主进程也先把记录置为 `cleanup-pending`，再允许关闭 Tab。窗口强退、进程崩溃或来不及发送时，
下次启动只依赖清理账本对账，不依赖 renderer Tab 快照猜测。

### 3.7 W1 UI 状态和最小输入

侧栏始终只有添加入口、当前项目资源列表、状态刷新和必要行尾动作。点击添加后侧栏不变化，
工作区出现实际 Browser Tab：

```text
┌ 未保存的网站账号 · 当前项目：woniu-forward ───────────────┐
│ [地址栏：输入或粘贴网站地址]         [登录完成，保存到当前项目] │
│                                                            │
│                     实际网页内容                            │
└────────────────────────────────────────────────────────────┘
```

点击保存只出现一个最小确认浮层：

```text
保存到当前项目
网站：Apple Developer              （只读，系统取得）
地址：developer.apple.com          （只读，系统取得）
显示名称：[张三公司管理员       ]  （唯一可编辑字段）

[取消] [保存]
```

“取消”只关闭确认浮层并保留网页登录现场；关闭 Browser Tab 才取消整次新建。没有检测到
登录 Cookie 也不能强制阻止保存，因为不同网站登录信号不同；按钮文案和用户点击代表其已
完成登录确认，资源状态仍可结合 Session 诊断显示“待确认/已登录/需重新登录”。

### 3.8 通用页面与动态流程

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

### 3.9 流程维护责任

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

### 3.10 运行关系

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
├── web-resource-draft-types.ts
└── web-resource-errors.ts

src/main/web-resources/
├── web-resource-service.ts
├── web-resource-store.ts
├── web-resource-draft-registry.ts
├── project-ops-migration.ts
├── web-resource-diagnostics.ts
└── web-resource-ipc.ts

src/renderer/src/features/web-resources/
├── WebResourcesSidebar.tsx
├── web-resource-events.ts
├── web-resource-tab.ts
└── web-resource-view-model.ts

src/renderer/src/components/workbench/
└── BrowserToolbar.tsx

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

以上文件名是施工落点，不构成必须拆出新 service 的授权。`web-resource-draft-registry.ts`
只能作为 `WebResourceService` 内部组件，不能拥有第二份正式资源状态；若现有文件内聚更
清晰，可以留在 `web-resource-service.ts`，但契约、生命周期和测试责任不能省略。

## 5. 开发阶段

估算以一名熟悉当前 Electron、React、Browser 和 Agent 架构的工程师为口径，并基于
现有 A1–A4 工程组件继续修正。真实网站人工审核等待不计入纯工程时间。

| 类别     | 阶段 | 当前状态    | 用户可见结果                                   | 剩余估算   |
| -------- | ---- | ----------- | ---------------------------------------------- | ---------- |
| 用户功能 | W1-A | Acceptance  | 不填资料表完成登录、单字段保存并从侧栏重新打开 | 真人验收   |
| 用户功能 | W1-B | Pending     | 取消/失败可恢复；疑似重复、双账号和重启稳定    | 1–1.5 人日 |
| 用户功能 | W1-C | Pending     | 项目切换/移动/复制隔离和 AI 精确打开           | 1–1.5 人日 |
| 用户功能 | A1   | In Progress | 事务在新资源链上选择并打开本项目网站账号       | 0.5–1 人日 |
| 用户增量 | A2   | Pending     | AI 复用同一资源 Tab，支持接管、交还和重新验证  | 2–3 人日   |
| 用户增量 | A3   | Pending     | 等待外部、错过检查、重新检查形成真实闭环       | 1–2 人日   |
| 用户增量 | A4   | Pending     | 动态流程和模板在真实页面中完成降级验收         | 1–2 人日   |
| 交付验收 | R1   | Pending     | 全量门禁、真实网站纵向验收和失败注入证据       | 1–2 人日   |

完成 W1-A–W1-C 并让 A1 重新进入真人验收，预计还需 3–5 个工程日。推进到 R1 真实端到端
候选预计总剩余 9–14 个工程日，外部审核自然等待另计。估算假设不新增跨项目共享账号、云端
常驻执行和批量平台适配器。

### 5.0 D0：临时登录现场契约门禁

目标：在 UI 开工前冻结唯一命令链、状态 owner、清理策略和测试接口。D0 没有新增用户
能力，不得作为 W1-A 完成度。

方案与架构：

- 在 shared 单一契约源定义 `beginDraft / saveDraft / cancelDraft / resolveLaunch`。
- `WebResourceService` 维护 draft 清理账本和正式资源转换；`BrowserManager` 提供实际
  Tab 的 URL、标题、Profile 和 Session 事实；`WorkspaceStateService` 解析项目。
- `saveDraft` 只接受 `workspaceRef + draftId + tabId + displayName`，其他字段由主进程
  反查；保存和转正使用同一串行写事务。
- 定义启动时对账：未转正 draft 不恢复成正式资源，陈旧临时 Profile 重试清理。

文档任务：

- 本文记录目标契约、状态 owner、数据生命周期、里程碑和禁止项。
- `docs/features/ai-web-affairs-agent.md` 只记录用户产品流程，不提前声称代码已实现。
- `docs/ops/ai-web-affairs-agent-acceptance.md` 同步 W1-A–W1-C 真人步骤和失败标准。
- D3 完成后再把实际稳定 owner、IPC 和恢复事实同步到 `docs/architecture.md`；未实现前
  不把目标设计写成当前架构事实。

工程验收：

- contract/schema 覆盖合法输入、越权项目、伪造 Tab、重复保存和重复取消。
- 评审证明没有第二 WebResource/Profile/Tab owner，没有新增敏感字段或 renderer 信任面。
- D0 退出记录列出实际代码落点、迁移需求和未决问题；存在未决生命周期分叉时不得进入
  W1-A 实现。

### 5.1 W1-A：单账号新建与保存闭环

目标：用户不填写前置资料表，从点击添加开始，在同一个实际 Browser Tab 完成导航、登录、
单字段确认和保存；随后关闭 Tab，仍可从侧栏重新打开同一登录账号。

产品方案：

- 删除侧栏内联创建表单；侧栏始终保持添加入口和当前项目资源列表。
- 点击添加调用 `beginDraft`，成功后打开带“未保存的网站账号”标识的 Browser Tab。
- Browser 地址栏和网页现场保持现有交互；扫码、验证码、2FA 由用户在网页内完成。
- 点击“登录完成，保存到当前项目”后只确认“显示名称”；网站、地址和项目只读展示。
- 保存成功后当前 Tab 原地转正式资源，侧栏新增一行；关闭后从侧栏用同一 Session 重开。

架构与数据生命周期：

- 主进程先解析当前 `projectId`，再生成 `draftId` 和临时 `browserProfileId`；失败时不
  创建 renderer 假 Tab。
- Tab 只保存 `webResourceDraftRef { draftId }` 投影；draft 不进入正式资源 Snapshot。
- 事务选择器、Agent 资源投影和 MCP 工具必须过滤所有 draft。
- `saveDraft` 由主进程反查当前 Tab 的 URL、标题和 Profile，再原子创建正式资源并返回
  `webResourceRef`；renderer 只做同一 Tab 的投影转换和侧栏刷新。
- 正式资源与 Profile 独立于 Tab；关闭正式 Tab 不删除资源或 Session。

文档修正：

- 删除产品、验收和开发文档中所有当前有效的“先填表”“创建正式资源后再登录”口径；
  历史进度记录保留但明确标为历史。
- 产品和验收文档必须同时展示一个字段保存、同 Tab 转正和侧栏重开；当前状态只能写
  W1-A `Acceptance` 或更低。

验收方案：

- 自动化：begin/save contract、Profile 唯一性、Tab draft/正式投影、实际 Tab 反查、项目
  守卫、侧栏无表单、保存浮层单字段、资源和 AI 选择器无 draft 测试。
- UI smoke：点击添加后出现实际 `.browser-toolbar`，侧栏 `.web-resources-form` 数量为 0；
  保存后 Tab 数不变、侧栏新增一行、draft 引用消失、正式引用存在。
- 真人：在一个未预置网站完成导航、登录、单字段保存、关闭正式 Tab 和侧栏重开。
- 退出条件：上述自动化、`pnpm verify` 和真人步骤通过，才能把 W1-A 标为 `Complete`。

本里程碑禁止：增加第二个输入字段、账号编辑、导入改版、平台识别、AI 登录、主体/角色
管理或事务流程改造。

### 5.2 W1-B：失败恢复与多账号稳定性

目标：用户取消、保存失败、重复点击、疑似重复、应用异常退出或添加同站第二个账号时，
资源和登录环境不丢失、不重复、不串用。

产品方案：

- 关闭未保存 Tab 不产生资源；确认浮层“取消”只回到同一网页登录现场。
- 保存失败保留页面、Session 和显示名称，允许原地重试。
- 疑似重复只给两个动作：“打开已有账号”和“作为另一个账号保存”。
- 同一网站第二个账号重新走 W1-A，并自动获得不同 Profile。
- App 重启后正式资源和 Session 可恢复；残留 draft 不恢复成正式资源并进入清理对账。

架构与数据生命周期：

- 同一个 `draftId` 保存具有幂等结果；正式资源写入、draft 删除和 Profile 转正不可出现
  可见的半完成状态。
- 主进程落库成功、renderer 更新失败时，以项目 Snapshot 为准恢复正式资源；反向情况
  不允许发生。
- `cancelDraft` 把未保存记录转为 `cleanup-pending`；启动对账重试清理陈旧临时 Profile。
- 重复检测在同项目正式资源范围内执行，选择另存时保留当前独立 Profile。

文档修正：

- 产品文档只补充取消、重试和重复分支，不增加主流程字段或页面。
- 验收手册记录关闭未保存、保存失败、浮层取消、重复保存、疑似重复、双账号和重启。
- 开发管理文档更新实际清理/幂等策略和残余风险，不得提前写 W1-C 已完成。

验收方案：

- 自动化：cancel 清理、启动对账、幂等保存、原子失败、renderer 恢复、重复检测、双
  Profile 和重启恢复测试。
- UI smoke：关闭 draft 无资源；注入一次保存失败后原 Tab 可重试；同站两个资源使用不同
  Profile；重启后两项仍可打开。
- 真人：依次执行取消、失败重试、疑似重复、同站第二账号和重启恢复。
- 退出条件：W1-A 已 Complete，上述分支和 `pnpm verify` 全部通过，W1-B 才能 Complete。

本里程碑禁止：增加主体、账号角色、登录提示、密码、Cookie、Profile、网站 URL 或平台
模板字段；禁止另开资源详情 Tab、保存后再开第二个 Browser Tab。

### 5.3 W1-C：项目隔离和 AI 调用

目标：已保存资源在项目切换、移动和复制场景中不串用，并成为事务和 AI 唯一可调用的
网站账号入口。

产品方案：

- 侧栏点击正式资源直接激活或重建同一主 Browser Tab；连续点击不重复创建。
- 事务资源区和 AI 只展示当前项目正式资源；登录失效时打开同一资源并暂停等待人工登录。
- 项目移动保持资源，项目副本不继承；切换项目不显示、不激活其他项目资源。

架构与数据生命周期：

- 所有入口统一调用主进程 `resolveLaunch({ workspaceRef, accountId })`，主进程校验
  `projectId` 后返回 URL、Profile 和稳定 `webResourceRef`。
- renderer `ensureWebResourceTab` 只按返回的 `projectId + accountId` 去重和创建投影，
  不能接受侧栏、事务或 AI 拼装的描述对象。
- 正式 Profile 和资源独立于 Tab；项目切换只改变可见投影，不能改变资源归属。登录失效
  只改变状态，不自动创建新资源或新 Profile。
- 旧表单创建的正式资源保持可读可开；不迁移未保存草稿，不改写旧配置文件。

文档修正：

- `docs/architecture.md` 在实际代码和恢复测试通过后同步 `resolveLaunch`、draft 清理账本、
  owner 和生命周期当前事实。
- 产品文档和验收手册补充项目切换/移动/复制、登录失效和 AI 精确打开的结果。
- 开发管理文档记录 W1-A–W1-C 的真实证据；旧 smoke 和历史 Acceptance 不得复用。

验收方案：

- 自动化：resolveLaunch 项目守卫、Tab 去重、项目切换/移动/复制、登录失效、事务和 Agent
  资源过滤与启动测试。
- UI smoke：切换项目后不显示或激活其他项目资源；AI 发起“打开该网站账号”只激活指定
  正式资源 Tab。
- 真人：两个真实测试账号、两个本地项目，逐项执行验收手册 W1 第 11–14 步。
- 退出条件：W1-A、W1-B 已 Complete，本节全部真实与自动化证据通过，才允许 W1-C
  Complete 和 A1 重新进入 Acceptance。

本里程碑禁止：让 AI 自动填写密码、绕过验证码、自动确认页面身份、执行事务业务动作，
或为特定平台增加适配器；这里只证明 AI 能准确打开已保存资源并在失效时停下。

### 5.4 A1：持久事务与三段式 Tab

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

### 5.5 A2：真实网页节点与人工交接

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

### 5.6 A3：等待外部和重新检查

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

### 5.7 A4：动态流程、模板和平台增强

- 提供通用原子节点 catalog。
- 提供版本化业务模板，但模板不拥有事务实例。
- AI 根据实际页面提出流程 diff。
- 用户确认改变主体、账号、授权范围、不可逆动作和重大依赖的变更。
- 已执行节点保持不可变，补正通过新增节点表达。
- 高频平台适配器只补充入口、字段、状态识别和证据提取。
- 适配器失效时降级通用网页代理或人工步骤。

## 6. 当前施工批次

现有项目隔离、资源存储、Browser Profile、Tab 引用和 A1–A4 组件保留。施工只围绕已确认
的新建纵向闭环，不扩张平台字段、主体资料表或适配器。

### 6.1 本轮范围冻结与禁止额外设计

| 区域     | 本轮唯一允许                                      | 明确禁止                                                          |
| -------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| 侧栏     | 添加按钮、当前项目资源列表、已有刷新/行尾兼容动作 | 内联表单、向导、分组资源中心、全局账号中心                        |
| 新建入口 | 直接打开实际 Browser Tab                          | 先开编辑器 Tab、账号详情 Tab、Modal 多步骤表单                    |
| 用户输入 | 保存时一个“显示名称”字段                          | 主体、角色、登录提示、网站名、URL、密码、Cookie、Profile 字段     |
| 网页现场 | 现有地址栏、实际页面、保存按钮和未保存标识        | 新造网页登录页、模拟网页登录、平台专用登录组件                    |
| 网站支持 | 任意可访问 URL                                    | 预置网站白名单、平台模板市场、Apple/阿里云等硬编码分支            |
| 账号隔离 | 每次新建自动分配独立临时 Profile                  | 默认复用其他项目或其他账号 Profile、让用户选择技术 Profile        |
| 登录判断 | 用户点击确认 + 脱敏 Session 诊断                  | 自动宣称真实账号身份、读取或保存密码、绕过验证码/2FA              |
| 正式资源 | 当前项目资源、稳定 accountId 和 Profile 绑定      | 登录前创建正式资源、把 draft 暴露给事务/AI                        |
| AI       | 按正式资源 ID 打开正确 Tab，失效时暂停            | 自动登录、填写业务表单、提交业务、按 URL/当前 Tab 猜账号          |
| 事务     | D3 只回归已有资源选择和打开链                     | 修改事务 UI、流程模型、模板、节点状态或人工交接设计               |
| 旧数据   | 继续可读、可打开；旧导入保持兼容                  | 重做导入 UI、批量迁移、删除旧文件、重新分配既有 Profile           |
| 架构     | 扩展现有 WebResource/Browser/Workspace/Tab owner  | 新建第二资源 Store、第二 Profile owner、第二 Tab 生命周期         |
| 文档     | 同步目标、实际状态、验收证据和残余风险            | 把待实现方案写成当前事实、用旧 smoke 证明新流程、删除历史纠偏记录 |

执行约束：

1. 新增任何字段、按钮、页面、service、store、IPC 或持久化文件前，PR 描述必须指出它对应的
   W1-A、W1-B 或 W1-C 验收步骤；无法对应则不进入本轮。
2. 需求存在歧义时默认不增加交互和数据；不得用“以后可能需要”扩张当前实现。
3. 实现发现必须改变一个字段输入、Tab 类型、owner、权限面或用户确认点时，立即停止该
   分支，先更新产品事实源并取得用户确认，不能在代码中先斩后奏。
4. D0–D4 期间不得并行扩张平台适配器、事务模板、账号详情中心或自动登录。
5. 重构只允许覆盖完成当前链路所需的最小代码面；无关重构单独排期，不得计入里程碑。

### 6.2 文档修正矩阵

| 文档                                                     | D0/W1-A                                      | W1-B                                           | W1-C                                                 |
| -------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `docs/features/ai-web-affairs-agent.md`                  | 冻结无表单、一个字段保存和同 Tab 转正        | 记录取消、失败、重复、多账号和重启结果         | 记录项目隔离和 AI 精确打开的最终产品事实             |
| `docs/features/ai-web-affairs-agent-development-plan.md` | 记录 owner、契约、生命周期、批次和实际状态   | 记录清理、幂等、恢复、迁移和验证结果           | 更新风险、剩余里程碑和 W1/A1 状态                    |
| `docs/ops/ai-web-affairs-agent-acceptance.md`            | 增加无表单、临时 Tab、最小确认和侧栏重开步骤 | 增加取消、失败重试、重复账号、双账号和重启步骤 | 增加项目切换/移动/复制和 AI 调用证据                 |
| `docs/architecture.md`                                   | 不提前写成当前事实；只检查是否违反架构宪法   | 不提前声明稳定；保存实际 owner/生命周期证据    | 代码与恢复验收通过后同步最终 owner、IPC 和持久化事实 |
| 历史进度记录                                             | 保留旧表单和旧 Acceptance 记录并标明当时口径 | 追加当前证据，不覆盖旧记录                     | 追加最终纠偏结论，不把历史测试重新包装为新验收       |

每个里程碑进入 `Acceptance` 前，上表对应文档必须完成；文档缺失和代码缺失同样阻止状态前进。

### Batch D0：临时登录现场契约（工程准备度）

- 定义未保存 Browser Tab 的 `webResourceDraftRef`、临时 Profile 生命周期和关闭清理。
- 定义“保存当前 Tab”主进程契约：输入只包含当前工作空间、Tab 引用和显示名称；URL、
  Profile 和登录信号由主进程根据实际 Tab 解析，不能由 renderer 自报。
- 定义重复资源检测、保存并发、失败重试和临时 Profile 转正式 Profile 的原子边界。
- 定义正式资源 `resolveLaunch`：主进程校验当前项目和资源归属后返回启动描述。

D0 只证明契约可实现，不能算 W1-A 用户功能。

### Batch D1：点击添加即进入实际 Browser Tab

- 删除侧栏网站账号创建表单；侧栏只保留添加入口和当前项目资源列表。
- 点击添加创建实际 Browser Tab 和临时隔离 Profile，地址栏立即可用。
- Browser 顶部显示“未保存的网站账号”以及“保存到当前项目”。
- 未保存 Tab 不进入资源 Snapshot、事务选择器或 AI 工具；关闭时触发临时环境清理。
- UI smoke 明确断言侧栏不存在创建表单。

D1 是 W1-A 的内部工程检查点；只打开网页但不能保存时，没有独立产品里程碑可关闭。

### Batch D2：登录后最小确认并原地保存

- 用户登录后点击“保存到当前项目”，只显示一个可自动预填的侧栏名称字段。
- 主进程从当前 Browser Tab 解析 URL、网站名称、项目和 Profile，原子创建资源绑定。
- 保存成功后同一 Tab 由临时引用转为稳定 `webResourceRef`，侧栏通过资源变更事件刷新。
- 保存失败保留登录现场并允许重试；取消不污染侧栏；疑似重复提供两个明确选择。
- 补充保存并发、关闭竞态、临时 Profile 清理和重复账号测试。

D1 与 D2 合并通过 W1-A 的自动化和真人验收后，才能关闭 W1-A。

### Batch D3：失败恢复、多账号和重启

- 覆盖未保存关闭、清理失败重试、保存失败原地重试和 renderer 转正失败恢复。
- 覆盖幂等保存、疑似重复的两个明确分支和同站双账号独立 Profile。
- 覆盖正式资源和 Session 的应用重启恢复，以及陈旧 draft/Profile 启动对账。
- 旧表单创建数据保持兼容；旧配置导入继续只读且显式执行。

D3 完成自动化和真人验收后关闭 W1-B。

### Batch D4：项目隔离和统一 AI 启动

- 侧栏、事务资源区和 AI 统一调用经过主进程校验的 `resolveLaunch`。
- 覆盖正式 Tab 去重、项目切换、项目移动和项目副本隔离。
- 覆盖登录失效暂停和使用同一正式资源重新登录。
- 在新的资源 ID 和启动链上回归事务选择、事务资源点击和 AI 打开资源。
- 实际代码与恢复测试通过后同步 `docs/architecture.md` 当前事实。

D4 完成真人验收后关闭 W1-C，并允许 A1 重新进入 Acceptance。

### Batch D5：真实 AI—人工—AI 纵向闭环

- 选择一个允许自动化、低风险且不会产生不可逆副作用的真实网站。
- AI 使用与侧栏相同的资源 Tab 完成一次查询或可撤销填写。
- 用户接管、交还，AI 重新观察后继续。
- 登录失效、Tab 关闭、Agent 失败和 App 重启均形成明确事务状态。
- 最终外部动作继续由产品确认卡拦截。

Batch D5 完成真人验收即关闭 A2；之后才继续 A3、A4 和 R1。

2026-07-31 的一次性 W1 真人登录延期仍保留为历史决策，但已被 2026-08-04 产品纠偏
收口：它只解释已有 A1–A4 工程组件为何提前存在，不再允许跳过 D1–D4 直接进入产品
验收或自动提交。此前 C0–C3 记录保留为历史实现证据，但不再作为当前施工批次。

## 7. 验证与质量门禁

### 自动化

- draft shared schema 和四个命令的 contract 测试。
- begin/save/cancel 的串行写、幂等、关闭竞态、保存失败和启动清理对账测试。
- IPC trusted sender、伪造 Tab、跨项目、参数边界和错误结构测试。
- 稳定 `projectId` 解析、项目移动/复制、跨项目查询和写入拒绝测试。
- `webResourceDraftRef -> webResourceRef` 原地转换、资源主 Tab 去重、关闭和恢复测试。
- 临时/正式 Profile 隔离、取消清理和登录状态投影测试。
- 侧栏无表单、保存浮层只有一个可编辑字段、事务和 AI 不暴露 draft 的组件测试。
- `resolveLaunch` 被侧栏、事务和 AI 共用且主进程执行项目守卫的集成测试。
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
- 点击添加后无表单，立即进入实际网页；登录前侧栏无资源。
- 保存时只确认显示名称，当前 Tab 原地转正式并由侧栏重新打开。
- 未保存关闭、保存失败重试和疑似重复账号分支。
- 当前项目切换、项目移动和项目复制的资源归属。
- 同一网站两个账号的 Profile 隔离。
- 手动登录和重启恢复。
- 事务和 AI 只打开指定正式资源，登录失效时停下。
- 本地材料打开、变化和失效。
- 事务创建、流程选择和节点详情。
- AI 执行、人工接管和交还。
- 最终提交确认。
- 外部等待、重启和补查。
- 真实申请号、回执或其他可验证结果。

Mock、fixture、单元测试或静态流程图通过，只能证明对应工程门禁，不能证明产品闭环。

## 8. 失败降级

| 失败                        | 用户可见结果                             | 禁止行为                            |
| --------------------------- | ---------------------------------------- | ----------------------------------- |
| 项目 ID 无法解析            | 不打开 draft，说明当前项目无法持久归属   | 先开假 Tab 或用路径猜 projectId     |
| beginDraft 创建失败         | 侧栏保持原状并允许重试                   | 创建无 Profile 的 Browser Tab       |
| 未保存 Tab 被关闭           | 不新增资源；清理完成或排队               | 留下侧栏行或让 AI 继续引用          |
| 临时 Profile 清理失败       | 不打扰主流程，进入诊断并在启动时重试     | 报成已转正或静默永久泄漏            |
| 保存时 URL 无效/仍为空白页  | 保留 Tab，提示先打开目标网站             | 保存空资源或要求填写第二张资料表    |
| 保存时项目/Tab/Profile 不符 | 主进程拒绝，保留当前网页并提示重新开始   | 信任 renderer 自报字段              |
| 正式资源写入失败            | 关闭保存中，保留登录现场和显示名称可重试 | 关闭 Tab、丢 Session 或显示保存成功 |
| renderer 转正失败           | 重载项目 Snapshot 恢复正式资源           | 再次创建第二个账号                  |
| 疑似重复资源                | 选择打开已有或作为另一账号保存           | 静默覆盖或共用 Profile              |
| App 在 draft 期间异常退出   | 下次启动不恢复假资源，并执行清理对账     | 把 draft 恢复成正式资源             |
| WebResource 存储损坏        | 资源能力降级，提供备份恢复和诊断         | 阻断 Studio 启动                    |
| 跨项目正式资源请求          | 主进程拒绝并保留当前项目现场             | 仅靠前端隐藏                        |
| 登录状态未知或失效          | 显示待核验/需重新登录，AI 暂停           | 猜测已登录或切换到其他账号          |
| Browser Tab 关闭            | 正式资源和事务保留；需要时可重建         | 删除正式资源、节点或事务            |
| 资源 Tab 引用失效           | 从正式账号资源重建或要求重新绑定         | 复用当前任意网页                    |
| 旧配置不合法                | 指出字段并保留原文件                     | 静默丢弃、覆盖或借机重做导入        |

## 9. `/grilling`

开工前和每个阶段退出前必须回答：

1. 点击添加是否出现任何前置资料表单？如果是，立即停止，W1-A 未按产品契约实现。
2. 点击添加是否立即进入实际 Browser Tab 和临时隔离 Profile？如果不是，W1-A 未完成。
3. 登录前是否已经写入正式资源、出现在侧栏或可被 AI 选择？如果是，生命周期错误。
4. 保存是否只有显示名称一个可编辑字段？多一个字段都必须说明对应哪条已确认验收。
5. URL、网站名称、项目和 Profile 是否由主进程从实际 Tab 反查？信任 renderer 则停止。
6. 保存成功是否保持同一个 Tab 并原地转正式引用？新开详情或第二 Browser Tab 均不通过。
7. 保存失败是否保留网页登录现场？丢失 Session 或关闭 Tab 均不通过。
8. 未保存关闭或 App 崩溃后，draft/Profile 是否有明确清理和重启对账？没有则不能验收。
9. 项目隔离是否只有 renderer 过滤？如果是，主进程必须补 `projectId` 校验。
10. 两个账号登录同一网站时是否隔离两个 Session？不能则 W1-C 未完成。
11. 事务和 AI 是否只复用正式资源的 `resolveLaunch`？按 URL/Profile/当前 Tab 猜测则失败。
12. 是否增加了主体、角色、登录提示、平台适配器、详情中心或自动登录？有则先撤出本轮。
13. 当前 Batch 是否产生用户可验收能力？连续 60 分钟没有则执行偏航检查。
14. 文档是否把待实现方案写成已完成事实，或继续引用旧 smoke 证明新流程？有则不得交付。

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
8. 每个拟新增字段、按钮、页面、service、store、IPC 和持久化文件都已映射到明确验收
   步骤；“以后可能需要”不构成开工理由。
9. 对应文档已经区分目标状态和当前事实，没有把设计方案提前写成已实现。

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
10. 代码 diff 没有出现 6.1 禁止项；如因事实需要扩大范围，已有新的用户确认和计划记录。
11. 6.2 文档矩阵中属于当前里程碑的修正全部完成，旧证据没有被当作新流程证据。

### 10.3 里程碑退出证据

| 里程碑 | 必需的真人证据                                      | 必需的工程证据                                             |
| ------ | --------------------------------------------------- | ---------------------------------------------------------- |
| D0     | 无用户验收；需要 owner、权限和生命周期评审结论      | 四命令 contract/schema、draft 清理、原子保存和权限评审     |
| W1-A   | 无表单进网页、一个字段保存、同 Tab 转正并由侧栏重开 | begin/save、actual Tab 反查、项目守卫、Tab 转换和 UI smoke |
| W1-B   | 取消、失败重试、重复分支、同站双账号和重启恢复      | cancel/对账、幂等/原子失败、Profile 隔离和恢复测试         |
| W1-C   | 项目切换/移动/复制、AI 精确打开和登录失效暂停       | resolveLaunch、项目隔离、资源过滤和统一调用测试            |
| A1     | 本项目事务、资源 Tab 复用、流程和重启恢复           | project guard、affair 持久化、Tab 恢复和资源失效测试       |
| A2     | 真实网站 AI 执行、接管、交还、重观察和确认          | launch、correlation、handoff、side-effect、reconcile       |
| A3     | 等待、App退出、错过检查、补查和结果变化             | wake-up、missed、restart、bounded retry 测试               |
| A4     | 流程 diff、重大变更确认、模板降级                   | flow version、不可变历史、adapter fallback 测试            |
| R1     | 一件真实事务从创建到可验证结果                      | 全量CI、`pnpm verify`、发布候选和残余风险                  |

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
| R-13 | 侧栏、事务和 AI 各自创建不同网页 Tab            | 高     | 高     | 统一 resolveLaunch 和资源 Tab 打开入口       | Open |
| R-14 | Cookie 启发式被误报为确定账号身份               | 极高   | 中     | 用户确认、Session 信号和执行前页面复核       | Open |
| R-15 | 未保存 Tab 或临时 Profile 泄漏为正式资源        | 高     | 中     | draft 引用、原子保存、关闭清理和重启对账     | Open |
| R-16 | 保存时 renderer 伪造 URL、Profile 或项目归属    | 极高   | 中     | 主进程从实际 Tab 解析并校验，不信任自报字段  | Open |
| R-17 | 顺手增加字段、详情页或平台逻辑导致新建流程反弹  | 高     | 高     | 6.1 禁止清单、验收映射和变更前用户确认       | Open |

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
| 2026-08-05 | D-14 | 网站账号新建采用“先登录、后保存”            | 用户先获得真实网页现场，只确认必要账号名称 | Accepted |
| 2026-08-05 | D-15 | D0–D4 禁止额外字段、页面和平台逻辑          | 保证先交付唯一纵向闭环，不再边做边改产品   | Accepted |

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

- 旧事务归属收口的 contract/service/IPC/preload 与统一 IPC 契约定向测试：5 个文件、34 项通过。
- `pnpm smoke:ui`：10/10 通过，覆盖新建当前工作空间事务和重启恢复。
- `pnpm verify`：通过；203 个测试文件、1179 项测试、lint、格式、开源/凭证/上下文操作
  边界、release 验证、类型检查和生产构建均通过。

当前状态与残余风险：

- A1：`Acceptance`；实现已结束，等待真人项目切换、重启、材料变化与旧事务归属验收。
- 更新节点、修订流程、材料检查、Attempt、等待计划与流程建议全部增加
  `workspaceRef`；主进程解析稳定身份后，服务层拒绝不属于当前工作空间的事务。
- MCP 事务工具已改为使用 Agent 会话的 `workspaceKey`；缺少本地工作空间时返回
  `WORKSPACE_REQUIRED`，读取也不再扫描全局事务集合。
- 当前项目事务加载后，会关闭不存在于该项目 Snapshot 的旧事务 Tab；有效 Tab 和其他
  项目 Tab 不会被误关闭。
- 事务侧栏显示未归属旧事务的名称、目标、原工作空间提示和账号数量；用户逐项二次确认，
  账号未先归入当前项目时明确拒绝且不改写旧事务。

### 2026-08-05 · 事务创建入口按产品契约纠偏

用户现在能做什么：

- “事务”侧栏只展示当前项目事务列表、状态、进度摘要和“新建事务”入口，不再被完整
  创建表单占据。
- 点击“新建事务”后，工作区打开独立草稿事务 Tab；用户在中间区域填写目标、选择主体、
  账号和材料，并通过结构化步骤列表确认初始流程。
- 切换其他 Tab 再返回时，未创建的草稿输入仍由当前工作区 Tab 投影保留；同一项目重复
  点击“新建事务”只激活已有草稿。
- 创建成功后，草稿 Tab 原地绑定主进程持久事务并转为三段式事务 Tab，侧栏通过同一事务
  变更事件刷新列表。

发现与纠偏：

- 产品事实源自 2026-07-31 起已要求事务侧栏为连续列表，但同日第一纵向切片把完整创建
  表单放入侧栏；后续 UI smoke 又按该实现定位 `.web-affairs-form`，形成“测试保护错误
  UI”的门禁缺口。
- 发现该冲突后，A1 不再沿用原 Acceptance 结论；本轮删除侧栏表单、完成草稿 Tab 与门禁
  后重新进入 `Acceptance`。真人验收未执行，因此仍不是 `Complete`。

验证证据：

- 定向测试：事务草稿、Tab 去重/原地绑定和失效事务对账共 35 项通过。
- `pnpm smoke:ui`：10/10 通过；新增断言侧栏不存在创建表单，点击新建后必须出现工作区
  草稿 Tab，并继续覆盖创建、节点推进和重启恢复。
- `pnpm verify`：通过；204 个测试文件、1187 项测试、格式、Lint、类型检查和生产构建均
  通过。

当前状态与残余风险：

- A1：`Acceptance`；实现与工程门禁已完成，等待真人核对实际布局、项目切换、材料变化、
  重启恢复和旧事务归属。
- A2–A4：`Pending`；已有组件和旧 smoke 不能替代真实网站 AI—人工交接、外部等待和动态
  流程验收。
- 未创建草稿属于 renderer 工作区 Tab 投影，不是第二份持久事务；正式事务仍只由主进程
  `WebAffairService` 创建和拥有。

### 2026-08-05 · 网站账号新建流程重新冻结

用户现在能做什么、还不能做什么：

- 当前版本仍能通过旧表单创建项目网站账号并打开网页，但这不是最新确认的产品流程。
- 用户还不能点击添加后直接进入临时隔离 Browser Tab，也不能在完成真实登录后只确认
  一个显示名称并把当前 Tab 保存为项目资源。

本次产品决定：

- “网站与账号”只负责当前项目网站账号资源；侧栏固定为添加入口和简洁列表。
- 点击添加立即进入实际 Browser Tab，不预填网站、主体、角色或登录提示表单。
- 项目、网站名称、URL、Profile 和登录信号由系统从当前上下文取得；用户只确认侧栏
  显示名称。
- 保存成功后当前 Tab 原地绑定正式资源；未保存 Tab 不进入侧栏，不得被事务或 AI 调用，
  关闭时清理临时环境。

里程碑调整：

- W1 拆为 W1-A“单账号新建与保存闭环”、W1-B“失败恢复与多账号稳定性”、W1-C
  “项目隔离和 AI 调用”。
- W1-A 为 `Ready`；W1-B、W1-C 为 `Pending`；A1 保留已有工程成果但退回
  `In Progress`，必须在新资源链上回归。
- 当前施工批次改为 D0–D4；旧 C0–C3 仅作为历史实现证据，不再代表当前产品完成度。

验收影响：

- 原 UI smoke 保护的是旧表单流程，只能作为历史工程证据。
- 新门禁必须断言侧栏无创建表单、添加后出现实际临时 Browser Tab、登录前无侧栏资源、
  保存只确认名称、当前 Tab 原地绑定、取消清理以及 AI 不能调用临时 Tab。

### 2026-08-05 · W1 详细实施规格和范围门禁

用户现在能做什么、还不能做什么：

- 本次只完成计划与文档冻结，没有新增应用功能；用户仍不能使用“先登录、后保存”的目标
  流程。
- 开发团队现在可以按 D0、W1-A、W1-B、W1-C 的明确输入、状态 owner、生命周期、失败
  路径和验收步骤开工，不再依赖口头补充。

本次完成：

- 写明从侧栏点击、beginDraft、实际网页登录、单字段确认、saveDraft、Tab 原地转正、侧栏
  刷新到 resolveLaunch/AI 调用的完整链路。
- 冻结 `WebResourceService`、`BrowserManager`、`WorkspaceStateService`、Tab store 和
  `WebAffairService` 的状态所有权与信任边界。
- 定义 draft 清理账本、临时 Profile、原子转正、失败重试、App 异常退出对账和正式资源
  重建的全生命周期。
- 为 D0 和 W1-A–W1-C 分别补齐目标、产品方案、架构、数据变化、文档修正、自动化、真人
  验收、退出条件和阶段禁止项。
- 增加统一禁止清单：本轮不得增加主体、角色、登录提示、账号详情中心、平台适配器、自动
  登录、第二资源 Store 或无关重构。
- 验收手册增加里程碑列，14 个 W1 真人步骤可以直接归因到 W1-A、W1-B 或 W1-C。

状态：

- D0 是下一施工动作，只产生工程准备度。
- W1-A 保持 `Ready`；代码工作开始后才可改为 `In Progress`。
- W1-B、W1-C 保持 `Pending`；A1 保持 `In Progress`，等待新资源链回归。

### 2026-08-05 · W1-A 实现结束并进入 Acceptance

用户现在能做什么、还不能做什么：

- 用户现在可以在当前项目点击“添加网站与账号”，直接进入真实 Browser Tab；完成手动
  登录后只填写一个账号名称，即可把当前 Tab 原地保存为项目资源，并由侧栏再次打开。
- 用户关闭未保存 Tab 时，主进程会先销毁对应 Browser View 并清理隔离 Profile；应用
  启动时也会对账未完成草稿。
- 用户还不能把 W1-A 视为已验收：尚未在一个真实需登录网站完成真人步骤 1–6；疑似
  重复、双账号、清理失败重试和完整重启分支仍属于 W1-B。

本次实现：

- 新增 `beginDraft / saveDraft / cancelDraft / resolveLaunch` 单一 shared 契约；保存输入只有
  `workspaceRef + draftId + tabId + displayName`，URL、标题和 Profile 由主进程读取。
- `WebResourceService` 成为草稿账本和正式资源转换 owner；草稿记录持久化在本机
  `web-resources/web-resource-drafts.json`，不进入项目资源或事务/AI 选择器。
- 侧栏完整创建表单已经删除；BrowserToolbar 提供“登录完成，保存到当前项目”和唯一
  “账号名称”字段；保存后 `webResourceDraftRef` 在原 Tab 转为 `webResourceRef`。
- 侧栏正式资源点击已改为先调用主进程 `resolveLaunch`，不再使用 renderer 自报的 URL
  和 Profile 启动网页。
- 没有增加主体、角色、登录提示、平台模板、账号详情页或特定网站逻辑。

验证证据：

- W1-A 定向测试 6 个文件、60 项通过。
- `pnpm verify` 通过：205 个测试文件、1195 项测试全部通过，并完成 Lint、类型检查和生产
  构建等全量工程门禁。
- `pnpm smoke:ui` 10/10；新 smoke 实际走过无侧栏表单、非预置网站、单字段保存、同 Tab
  转正、侧栏重开和应用重启。
- 1440×920 可见布局复核通过；工具栏保存按钮和单字段确认均可见，没有新增页面。

状态与下一步：

- D0 工程门禁和 D1/D2 实现完成；W1-A 从 `Ready` 进入 `Acceptance`，不标记
  `Complete`。
- 下一步由用户完成真实网站真人验收；随后进入 W1-B 的失败恢复、疑似重复、双账号和
  重启稳定性。

### 2026-08-05 · W1-B–A4 实现收口并通过统一自动门禁

用户现在能做什么、还不能做什么：

- 用户可以把任意非预置网站保存为当前项目的网站账号；保存失败可原地重试，疑似重复时
  明确选择打开已有账号或作为另一个账号保存，同站多个账号使用不同登录环境。
- 侧栏、事务资源区、账号兼容详情和 AI Attempt 都通过主进程按当前项目解析同一个正式
  资源，并打开或聚焦同一个资源 Browser Tab；renderer 不再自行拼装 URL 或 Profile。
- 用户可以在事务 Tab 推进结构化流程，交给 AI、人工接管和交还，进入外部等待，并在到期
  或错过后开始一次新的复查；复查结果和官方响应会成为证据，流程 diff 必须明确接受或
  拒绝。
- 用户还不能把任何里程碑视为 `Complete`：真实账号身份、登录态重启恢复、项目移动和
  复制、真实网页 AI—人工—AI 交接、实际等待时间和外部结果仍需真人执行。

本次实现：

- W1-B 收口保存幂等、清理失败账本和启动对账、疑似重复双分支，以及同站双账号的独立
  Profile；重复保存不再递增正式资源版本或创建第二资源。
- W1-C 删除 renderer 可自行组装资源启动参数的旧入口；所有调用统一为
  `resolveLaunch({ workspaceRef, accountId })`，由主进程校验项目归属并返回权威启动描述。
- A2 在 Agent、Browser Task 或绑定失败时显式结束 Attempt；人工接管、交还、重新观察、
  最终确认和重启对账保持单一生命周期。
- A3 进入外部等待时结束当前 Attempt；到期或错过后创建真实检查 Attempt，记录未变化、
  通过、驳回和补正所需的官方响应证据，不再使用伪造 Profile。
- A4 回归原子流程目录、通用模板/适配器、AI 流程 diff 的明确接受/拒绝和不可变历史。
- 未新增主体、角色、登录提示、账号详情中心、平台白名单、自动登录、第二资源 Store 或
  第二事务状态 owner。

验证证据：

- 最新工作树 `pnpm verify` 通过：OSS 边界、凭证边界、统一上下文操作、发布测试、格式、
  Lint、类型检查和生产构建均通过；205 个测试文件、1199 项测试全部通过。
- `pnpm smoke:ui` 通过 11/11：覆盖非预置网站项目资源、直接 Browser Tab 启动与重启
  持久化、五节点事务与进度，以及 A2–A4 交接、等待、模板和流程 diff 控件。
- UI smoke 首次因旧烟测运行时没有产出新的 CDP 端口而在产品检查前失败；显式重启独立
  烟测运行时后重新执行通过。失败记录没有被包装成产品通过。

状态与下一步：

- W1-A–W1-C、A1–A4 和 R1 均保持 `Acceptance`；实现与自动化收口，但没有真人证据，
  因此不标记 `Complete`。
- 下一步只执行 `docs/ops/ai-web-affairs-agent-acceptance.md` 第 3–7 节的真实网站统一真人
  验收；若失败，按步骤记录并只修阻断闭环的问题，不扩张额外页面、字段或平台逻辑。

## 15. 变更控制

- 产品目标、用户心智和最终验收变化：先更新
  `docs/features/ai-web-affairs-agent.md`，再同步本文。
- 开发顺序、代码落点、估算、状态和风险变化：更新本文并追加进度记录。
- 架构宪法例外：先提交 ADR，未批准前不得实现。
- 已 `Complete` 里程碑的验收标准发生实质变化：重新打开为 `In Progress` 或新增
  后续里程碑，不能静默修改历史证据。
- 新增平台适配器不得改变通用流程和资源模型；需要例外时先评审是否形成第二状态 owner。
- D0–D4 中发现的新需求默认进入后续清单，不得顺手实现；只有修复安全问题、阻断当前
  验收或满足已确认验收步骤所必需的变化可以进入当前批次。
- 任何违反 6.1 禁止项的实现必须先更新产品事实源、说明为什么现有唯一链路无法成立并
  获得用户确认；不能只更新开发文档或用代码评审代替产品确认。
