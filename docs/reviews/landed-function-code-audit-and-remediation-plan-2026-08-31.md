# 已落地功能代码审查与整改方案

> 状态：已被独立审查修订，本文保留初版审查证据，不再作为施工顺序事实源。
> 当前施工事实源：`docs/reviews/landed-function-independent-review-correction-2026-08-31.md`。
> 独立审查确认本文遗漏外部 MCP 自动放行、Browser Cookie 明文返回两项 P0，以及本机 MCP token
> 未强制这一项需立即止血的 P1；同时确认定时任务已有严格只读 allowlist。在修订版关闭这些差异前，
> 禁止直接按本文第 5、6 节实施。
> 审查日期：2026-08-31。
> 审查基线：`main@0db9cf4d`（v0.1.75）。
> 范围：本地文件与 Agent 工具、Android、Browser、外部 MCP、Runtime 组件启动、Agent 设置、工作空间搜索、文件迁移事务，以及远程和网页事务的产品验收事实源。
> 本文是本轮跨功能整改的管理事实源。它记录当前代码事实、用户验收动作、施工顺序和退出门禁；在相应验收完成前，不得把“代码已接入”改写为“用户闭环完成”。

## 1. 结论

当前 Studio 的本地工作台和多数主流程可以运行，类型检查、Lint 和自动化测试也处于绿色；但
“界面存在、工具可调用、测试通过”并不能证明能力已经安全落地。本轮确认了三项 P0：

1. 通用文件 IPC 和 Agent Editor 工具没有把访问范围收敛到发起 Run 的可信工作空间；
2. `auto` 权限模式、工具注解和定时任务捷径可以绕过本应不可绕过的破坏性操作确认；
3. 外部 MCP 的环境变量和请求头形成了 `CredentialService` 之外的第二凭证所有者，并把完整秘密
   返回 renderer。

另外存在 Runtime 可选组件阻断启动、设置页暴露未实现能力、搜索结果跨工作空间残留、界面字号
空壳和文件迁移崩溃窗口等 P1/P2。远程 Agent、远程 PTY、网页账号和真实网页登录身份仍缺真人
端到端证据；这些属于产品验收缺口，不应与代码缺陷混成一个“自动化通过率”。

在 RF-01、RF-02、RF-03 关闭前，不应继续扩大 Agent 文件、Android、Browser 副作用或外部 MCP
能力面。修复顺序必须先建立主进程不可绕过的安全边界，再处理界面真实性和体验问题，最后完成
真实设备、真实在线 Agent 和真实网站验收。三项 P0 均是正式发布阻塞项，不能用“默认只在本机”
或“用户通常不会这样操作”降级。

## 2. 用户端到端验收基线

工程任务以以下真人可执行动作作为产品目标。只有对应动作在真实 App 中通过，才允许关闭问题。

### A1：Agent 文件访问只属于当前工作空间

1. 用户打开本地工作空间 A，在 A 内让 Agent 读取、新建、修改和列出文件，操作成功且界面同步。
2. 让 Agent 使用绝对路径、`..`、工作空间内指向外部的符号链接、以及不存在目标的外部父目录，
   尝试读取或写入 A 之外文件。
3. Studio 在主进程拒绝这些请求，返回结构化 `OUTSIDE_WORKSPACE`，不读取、不创建、不截断目标。
4. Agent Run 进行中切换到工作空间 B；旧 Run 仍只能访问启动时固定的 A，不能跟随当前可见工作空间。
5. 用户通过受信任文件选择器显式选择工作空间外单个文件时，只有该次授权对象可访问；不得因此
   获得父目录或整个主目录权限。

### A2：破坏性和不可判断操作无法被通用模式绕过

1. 把 Agent 权限切换为 `auto`。
2. 分别请求卸载测试 Android 包、执行任意设备 shell、推送主机文件、清除单域 Cookie、清除全部
   Cookie，以及未知注解工具。
3. Studio 显示目标设备/域名/文件/命令、影响范围和风险；未经确认不产生副作用。
4. “始终允许”不出现在卸载、任意 shell、清除全部 Cookie 和未知后果操作上。
5. 普通只读截图、设备列表和工作空间内文件读取仍可按用户选择的模式直接执行。
6. 定时任务只有在保存时冻结了同一工具、同一资源范围和同一授权类别时才能自动执行；现有的
   `allowedTools` 字符串列表不能单独授权破坏性或外部副作用。

### A3：外部 MCP 凭证不进入普通配置和 renderer 全量状态

1. 用户新增一个 stdio MCP，填写测试 Token；再新增一个 HTTP MCP，填写 Authorization Header。
2. 保存后表单立即清除秘密明文，只显示“已配置”；刷新、重启和编辑 server 均不自动回显秘密。
3. MCP 连接可以在主进程解析凭证并正常启动；删除或替换凭证后连接状态准确降级或恢复。
4. `mcp-servers.json` 只保存非敏感配置和稳定 `credentialRef`；秘密只存在统一
   `credentials/credentials.json`，目录为 `0700`、文件为 `0600`。
5. preload、renderer 状态、Agent 消息、MCP 返回、日志和诊断报告均不包含测试秘密。
6. 模拟凭证或配置写盘失败时，UI 明确报告失败；内存、配置文件和凭证引用不出现“界面成功、重启
   丢失”或悬空状态。

### A4：可选 Runtime 损坏不阻断本地工作台

1. 备份并构造损坏、无权限或版本不兼容的 `userData/runtime-components` 状态。
2. 启动 Studio，主窗口、本地文件、Browser 和 Terminal 正常可用。
3. 组件页显示 `degraded`/`failed`、具体错误和修复入口；修复成功后能力恢复，不要求清空其他状态。

### A5：Agent 设置只展示真实支持能力

1. 打开 Agent 设置。
2. 未实现 OpenAI Compatible backend 时，该选项不可选择并明确说明；不能保存一个必然失败的组合。
3. Anthropic 兼容配置保存、测试和真实 Agent 启动使用同一份后端判定，不能一处成功、一处忽略。

### A6：搜索结果严格属于当前工作空间

1. 在工作空间 A 搜索文件，并在搜索未结束时切到 B。
2. B 不显示 A 的查询结果，迟到的 A 响应不能覆盖 B；点击结果只能打开 B 内文件。
3. 在四层以上目录创建目标文件。若产品承诺全量文件名搜索，必须能找到；若采用索引范围或结果
   上限，UI 必须明确显示“结果不完整”及原因，不能静默返回“未找到”。
4. 重启后只恢复当前工作空间自己的查询状态，不持久化其他工作空间绝对路径到同一全局键。

### A7：可见设置必须产生可见效果

1. 修改界面字号，Activity Bar、Sidebar、Workbench 和设置页按统一规则变化，重启后保持；或者在
   尚未实现前彻底移除该设置。
2. 不允许继续保留“可保存但生产代码无人消费”的设置项。

### A8：文件迁移能够从崩溃窗口恢复

1. 打开一个同时被 Editor、Tab、Agent 附件和 Browser 引用的文件并执行重命名或移动。
2. 在磁盘提交后、renderer 投影持久化前强制终止 App。
3. 重启后主进程根据持久记录完成重放或明确进入可恢复冲突；旧路径不能被当作正常状态继续保存。
4. 正常重命名仍保持单次磁盘提交，不因恢复机制重复移动或覆盖目标。

### A9：真实远程与网页事务闭环

1. 在同一已登录、已配对在线 Agent 上完成远程文件新建/修改/重命名/删除、Agent 审批与拒绝、
   大文件分页、图片输入、停止等待、realtime 重连和 PTY attach。
2. 使用两个本地工作空间和两个真实测试账号验证网站账号/Profile 隔离、重启恢复、Agent 查询和人工
   接管；不执行生产发布、付款或不可逆业务动作。
3. 自动化只能作为工程门禁，不能替代登录身份、远端执行结果和断线恢复的真人观察。

## 3. 问题登记

| ID    | 优先级       | 状态               | 问题                                                                    | 用户后果                                             | 关闭验收 |
| ----- | ------------ | ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| RF-01 | P0           | Open               | 文件与 Agent 路径未绑定可信工作空间，且缺少统一 `realpath`/符号链接边界 | Agent 或受污染 renderer 可读写主目录内非工作空间文件 | A1       |
| RF-02 | P0           | Open               | 通用权限模式、`alwaysAllowed` 和定时任务分支可绕过破坏性操作确认        | 卸载、任意 shell、Cookie 删除等可能无人工确认执行    | A2       |
| RF-03 | P0           | Open               | 外部 MCP 秘密保存在普通配置并返回 renderer，写盘错误被吞掉              | Token 泄漏、保存假成功、重启丢配置                   | A3       |
| RF-04 | P1           | Open               | `RuntimeComponentManager.initialize()` 失败可阻断窗口创建               | 可选组件损坏导致全部本地能力不可用                   | A4       |
| RF-05 | P1           | Open               | 设置页允许选择后端不支持的 OpenAI Compatible                            | 用户能保存一个必然失败或被后端忽略的配置             | A5       |
| RF-06 | P1           | Open               | 搜索状态不按工作空间隔离、无 generation/取消、静默限制三层              | 串项目、打开旧路径、深层文件被误报不存在             | A6       |
| RF-07 | P2           | Open               | `uiFontSize` 可配置但生产界面不消费                                     | 用户操作无效果，形成假功能                           | A7       |
| RF-08 | P2           | Known debt         | 文件迁移仅有 renderer 内存 transition，无跨崩溃持久日志                 | 强杀/断电后磁盘与 WorkspaceState 可能分叉            | A8       |
| RF-09 | Product gate | Pending acceptance | 远程和网页事务多项代码闭环没有真实环境证据                              | 不能证明真实登录、设备、断线和账号隔离可用           | A9       |

### RF-01：工作空间文件授权缺失

代码证据：

- `src/main/fs/file-service.ts:59-92` 的注释声称限制在工作区，实际 `allowedRoots` 包含整个 home，
  校验只是 `resolve()` 后的字符串前缀；
- `src/main/fs/fs-ipc.ts` 的通用读写入口直接接收 renderer 路径；
- `src/main/mcp/modules/editor/index.ts:179-298` 已拿到 `ToolExecutionContext`，但读、写、列目录没有
  使用 `trustedWorkspace`；
- `src/main/agent-core/tools/types.ts:33-70` 已经定义 Run 启动时固定的可信工作空间，因此无需增加第二
  工作空间 owner。

根因不是缺少一个正则，而是“路径字符串”被当成“资源授权”。安全边界必须同时处理已有文件、
不存在的写入目标、符号链接、源/目标双路径、Run 中切换工作空间和显式外部文件授权。

### RF-02：副作用授权没有不可绕过的下限

代码证据：

- `src/main/mcp/permission.ts:70-91` 中 `alwaysAllowed` 优先，`auto` 对所有工具放行；
- `src/main/agent-core/tools/tool-host.ts:373-410` 只在模块策略或通用权限管理器要求时确认，存在
  `scheduledTaskPolicy` 时整体跳过确认；
- `src/main/mcp/modules/android/index.ts:145-193` 把卸载标为非破坏性，并暴露任意设备 shell、主机
  文件安装/推送；
- `src/main/mcp/modules/browser/index.ts:414-427,706-742` 把清 Cookie 标为破坏性，但动态强制策略只
  覆盖点击、按键和 evaluate。

工具自己声明的 annotation 只能用于 UI 分类，不能成为最终安全证明。未知工具、声明错误和未来新增
模块必须在宿主层 fail closed。

### RF-03：外部 MCP 复制了凭证所有权

代码证据：

- `src/renderer/src/components/settings/AgentCapabilitiesSettings.tsx:394-490` 让用户把 Token 和
  Authorization Header 填进 MCP 表单，并说明保存在 `mcp-servers.json`；
- `src/main/mcp/client-manager.ts:20-65,167-176` 在普通配置和内存中保存完整 server，使用非原子
  `writeFileSync`，保存异常只记日志；
- `src/main/ipc/agent-ipc.ts:564-604` 把完整 server 返回 renderer，并可能在实际写盘失败后返回成功；
- 审查机器上的现存 `mcp-servers.json` 权限为 `0644`；审查未读取其中内容；
- ADR 0003 已明确 `CredentialService` 是唯一凭证 owner，外部 MCP 不应再建独立秘密存储。

### RF-04 至 RF-09 摘要证据

- `src/main/runtime/core-services.ts:116-120`：Runtime 组件初始化无局部降级；
- `src/renderer/src/components/settings/SettingsPage.tsx:1128-1141` 与
  `src/main/settings/settings-ipc.ts:410-419`：UI 暴露 OpenAI Compatible，后端明确不支持；
- `src/renderer/src/components/sidebar/SearchPanel.tsx:8-91` 与
  `src/renderer/src/stores/fs-store.ts:820-849`：全局搜索缓存、无 generation、三层静默截断；
- `src/renderer/src/components/settings/SettingsPage.tsx:1025-1038`：`uiFontSize` 只有写入入口；
- `docs/features/workspace-system.md:183-203`：文件迁移崩溃窗口已被文档明确列为残余边界；
- `docs/ops/cclink-remote-stage-1-acceptance.md:21-27,62-95` 与
  `docs/ops/ai-web-affairs-agent-acceptance.md:18-46`：真实在线 Agent 和真实网站真人验收仍未关闭。

## 4. 目标架构与状态所有者

| 事实                             | 唯一所有者                                                                       | renderer 可见投影                              | 禁止形成的第二 owner                                       |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Run 的本地工作空间与显式路径授权 | 主进程 `WorkspaceAccessPolicy`，输入来自 `ToolExecutionContext.trustedWorkspace` | 当前工作空间标识、结构化拒绝                   | renderer 当前选中路径、工具参数里的自报 workspace          |
| 工具副作用授权                   | `McpToolHost` 的不可绕过 authorization floor                                     | 待确认卡、目标摘要、结果                       | 各模块只靠 annotation 自我判定、`PermissionManager.auto`   |
| 外部 MCP 秘密                    | 现有 `CredentialService` / `PlaintextCredentialStore`                            | 是否配置、字段名、更新时间；显式输入时短暂明文 | `McpClientManager.servers[].env/headers`、Zustand 全量秘密 |
| 外部 MCP 非敏感配置              | `McpClientManager`                                                               | 脱敏 server 配置和连接状态                     | renderer 本地持久化                                        |
| Runtime 组件安装状态             | `RuntimeComponentManager`                                                        | `ready/degraded/failed` 和修复动作             | 启动服务注册表把可选组件失败当全局失败                     |
| 工作空间搜索请求与结果           | 工作空间作用域搜索 service/store                                                 | 当前 workspace generation 的结果               | 单个全局 localStorage 结果快照                             |
| 文件迁移事务                     | 主进程持久 relocation journal + 现有 renderer projection                         | operationId、恢复状态、警告                    | 仅 renderer 内存队列                                       |

本方案遵守现有架构宪法和 ADR 0003，不需要新增架构例外。若实现者选择允许任意 home 访问、让通用
权限模式绕过破坏性操作，或重新引入独立 MCP 凭证文件，必须先提交 ADR；不能把例外藏在实现细节中。

## 5. 分阶段修复方案

每个工作包应独立合入、独立回滚。不得把全部问题堆成一次跨域重构，也不得用新增测试数量替代用户
验收结果。

### E0：固定反例和能力清单

用户增量：无；这是后续安全修复的工程门禁，不得报告为产品里程碑。

任务：

1. 先在独立验证中建立能稳定复现的红测/fixture，固定越界路径、符号链接、`auto` 破坏性操作、
   scheduled task 绕过、MCP 全量返回、保存假成功、Runtime 初始化失败、搜索迟到响应和空设置；
   红测与对应修复同批转绿，不把 failing test 合入 `main`。
2. 生成工具授权清单：工具名、模块、只读/写入/破坏性/外部副作用/人工专属、目标资源、是否允许
   `always`、是否允许定时任务。
3. 把 `verify:credential-boundary` 扩展到禁止 MCP server 配置包含 env/header 明文以及禁止列表 IPC
   返回秘密；门禁不得只搜索 Keychain 相关关键字。

退出证据：每个已知反例在修复前能稳定失败，清单覆盖全部注册工具，未知工具测试默认暂停。

### S1：统一工作空间路径授权（关闭 RF-01）

用户增量：用户和 Agent 能继续操作当前工作空间文件；所有工作空间外路径稳定拒绝。

任务：

1. 在主进程建立单一 `WorkspaceAccessPolicy`，输入必须是宿主固定的 `trustedWorkspace`，不能信任
   renderer 或工具参数自报 workspace。
2. 为现有文件解析真实路径：工作空间根和已有目标使用 `realpath`；不存在写入目标逐级找到最近已
   存在父目录并 `realpath`，再验证最终候选仍位于根内。
3. 读、写、列目录、创建、删除、移动、重命名都使用同一策略；双路径操作分别验证源和目标。符号
   链接默认不能扩大根目录，TOCTOU 风险通过打开/写入前复核和排他创建控制。
4. `EditorToolModule` 强制使用 `context.trustedWorkspace.kind === 'local'`；远程/global Run 不得把
   本地绝对路径传给该模块。
5. renderer 文件 IPC 改为携带主进程可核对的 workspace identity。工作空间外文件只通过主进程
   文件选择器产生短期、精确对象授权；不授予父目录，不持久化整个 home 权限。
6. Android APK 安装和 push 的主机源文件复用同一授权；不能把 Android 模块变成文件边界旁路。

失败降级：缺少可信工作空间、根路径不存在、真实路径解析失败或范围无法证明时 fail closed，返回
结构化错误；本地 Browser、Terminal 和其他工作空间能力继续可用。

验证：路径策略单元测试、FS IPC handler 测试、Editor/Android 工具集成测试，以及 A1 真实 App。

### S2：建立不可绕过的工具授权下限（关闭 RF-02）

用户增量：`auto` 仍能减少普通确认，但不会替用户执行破坏性、未知或人工专属动作。

任务：

1. 把工具授权从两个布尔 annotation 升级为宿主拥有的 `authorizationClass`：`read`、
   `workspace-write`、`external-side-effect`、`destructive`、`human-exclusive`；模块可以请求更严格，
   不能放宽宿主下限。
2. 在 `McpToolHost` 先应用不可绕过 floor，再应用用户 `auto/categorized/strict` 偏好。
   `alwaysAllowed` 只适用于明确允许的低风险类；未知工具默认确认且不提供 Always。
3. 修正 Android 卸载、任意 shell、安装、push、清 Cookie 等定义，并为每项生成经过脱敏的目标摘要。
   卸载、任意 shell、清除全部 Cookie 至少设为 `destructive` 且 `allowAlways: false`。
4. 删除“存在 `scheduledTaskPolicy` 就整体跳过确认”的捷径。定时任务必须校验冻结的工具、资源根、
   目标摘要和 authorization class；旧任务缺少新字段时进入 `needs-review`，不能静默升级授权。
5. 包名使用明确 schema；任意 shell 保留为高级能力时必须可见命令、设备 ID、超时和结果，不得把
   shell 字符串拼接当作普通结构化动作。

失败降级：确认 UI 不可用、目标摘要生成失败、任务策略版本未知时不执行副作用；Agent Run 进入
`waiting-user` 或结构化失败，不能假运行。

验证：宿主策略矩阵测试、每个高风险模块的 handler/集成测试、定时任务旧版本迁移测试，以及 A2
使用一次性测试包和测试 Profile 的真人验收。

### S3：迁移外部 MCP 凭证（关闭 RF-03）

用户增量：外部 MCP 在重启后仍能使用，但 Token 不再进入普通配置或 renderer 全量状态。

任务：

1. 给外部 server 增加稳定 `serverId`；非敏感配置保存 `credentialRef = extension:mcp.<serverId>`，
   server 改名不移动秘密身份。
2. 所有 env/header 作为 `CredentialService` 的 `generic` 记录保存。建议使用受 schema 校验的
   `envJson`/`headersJson` 字段；解析后仍需限制键名、值长度、数量和禁止 URL 明文凭证。
3. `listServers`、reload、add/update 返回脱敏 DTO，只包含 `envConfigured`、`headersConfigured`；
   编辑时不自动回显。用户替换或显式清除时由专用 IPC 更新凭证，并立即清空 React 临时明文。
4. `McpClientManager` 通过构造依赖使用 `CredentialService`，只在主进程 compose/start 时解析；禁止
   长期复制完整秘密到可枚举 server 快照。
5. 非敏感配置也改为串行、同目录临时文件、原子替换和明确 `0600`。保存失败必须向 IPC 传播，
   只有磁盘提交成功才更新内存并返回成功。
6. 迁移现有 `mcp-servers.json` 时先成功写 CredentialService，再原子重写脱敏配置。任一步失败保留
   旧文件并报告 `migration-blocked`；允许暂时重复但不允许丢失，重启后幂等重试。日志不得打印值。
7. 诊断、Git 备份和 Agent 输出加入测试 canary，证明不会包含测试 Token。

失败降级：CredentialService `degraded/conflict/failed` 时只禁用受影响 MCP，其他 Agent 和本地能力
继续运行；不得退回普通配置明文。

验证：迁移/冲突/写失败/权限/重启集成测试、preload 结构测试、credential boundary 门禁和 A3。

### R1：Runtime 初始化降级（关闭 RF-04）

用户增量：Runtime 组件损坏时仍能进入 Studio，并在组件页修复。

任务：

1. 把 RuntimeComponentManager 初始化从阻断 state-services 的必需步骤改为独立可选 service，失败
   记录结构化 capability state，不向上抛成全局 bootstrap 失败。
2. 使用空/只读降级投影注册组件页 IPC；安装、修复前再次尝试获得 owner，不复制第二 manager。
3. Agent、CAD、Android 等消费者按 capability state 禁用自身入口并展示原因，无关能力不依赖组件
   manager ready。
4. 保持 stop/rollback 幂等，覆盖窗口重建与修复后重试。

验证：初始化抛错、目录无权限、损坏 manifest、窗口重建测试，以及 A4。

### U1：设置真实性与搜索隔离（关闭 RF-05、RF-06、RF-07）

用户增量：用户看到的选项都有效；搜索不会串工作空间或静默漏掉深层文件。

任务：

1. 在真正实现 OpenAI Compatible backend 前隐藏/禁用该选项；设置 schema、连接测试和
   `AgentBridge.buildBackendConfig()` 使用同一个 capability 判定源。
2. `uiFontSize` 二选一：接入根 CSS 变量并覆盖核心布局、持久恢复和边界测试；或删除 UI、schema
   和迁移后的废字段。不得只给 onChange 加 Toast。
3. 搜索请求绑定 `{workspaceKey, generation, requestId}`，切换工作空间取消或丢弃旧响应；结果和查询
   按 workspaceKey 保存，关闭工作空间时清理绝对路径。
4. 把递归搜索移到有界主进程 service 或建立索引，增加取消、忽略目录规则、结果上限、错误与
   `truncated` 状态；UI 明确显示不完整结果。

验证：设置契约测试、真实界面视觉检查、搜索竞态/深层目录/重启恢复测试，以及 A5-A7。

### D1：文件迁移持久恢复（关闭 RF-08）

用户增量：重命名/移动在强杀或断电后可恢复，不遗留不可判断的旧路径状态。

任务：

1. 由主进程在磁盘提交前原子写入最小 relocation journal：operationId、workspace identity、源、目标、
   companion moves、阶段和时间；禁止记录正文或凭证。
2. 磁盘提交后标记 committed；WorkspaceState 和 renderer 投影对账成功后才清除记录。
3. 启动时在窗口恢复前扫描未完成项，通过磁盘事实判断重放投影、标记冲突或要求用户处理；不得盲目
   把磁盘改回旧路径。
4. journal 损坏只降级迁移恢复并保留诊断，不阻断普通启动。

验证：进程级故障注入覆盖各提交点、幂等重放测试和 A8。该工作包不得与 S1 路径授权同时重构。

### V1：真实环境验收与文档收口（关闭 RF-09）

用户增量：远程和网页事务从“代码已接入”升级为有真实环境证据的用户闭环。

任务：

1. 按 `docs/ops/cclink-remote-stage-1-acceptance.md` 在同一在线 Agent 执行剩余矩阵并记录版本、设备、
   WorkspaceRef、时间和脱敏结果。
2. 按当前全局账号事实源和 `docs/ops/ai-web-affairs-agent-acceptance.md` 执行双工作空间、双账号、
   重启、人工接管和诊断脱敏。
3. 失败应回到对应代码问题，不得通过改写验收文档把失败项标成“范围外”。

退出证据：A9 全部通过；如果协议确实不支持远端 cancel，产品继续只称“停止等待”，不得宣称取消。

## 6. 施工顺序与合入门禁

```text
E0 反例与清单
  -> S1 工作空间路径授权
  -> S2 工具授权下限
  -> S3 MCP 凭证迁移
  -> R1 Runtime 启动降级
  -> U1 设置与搜索真实性
  -> D1 文件迁移持久恢复
  -> V1 真实环境验收与文档收口
```

顺序理由：S1-S3 是当前可被实际入口触发的 P0，且 Android 主机文件访问同时依赖 S1/S2；R1 和 U1
可以在 P0 关闭后独立推进；D1 涉及文件事务 owner，避免与 S1 同批修改；真实远程/网页验收可准备
环境，但不能在安全边界未关闭时借机扩大自动化副作用。

每批合入必须满足：

1. 只关闭本批有证据的问题 ID，不顺手扩展新功能；
2. `pnpm verify` 及受影响 smoke 通过；路径、权限、凭证和 Runtime 变更至少运行本地核心 smoke；
3. 生产实现、失败测试、诊断和文档同批完成；
4. 用户端验收未完成时，状态只能写“工程实现完成，产品验收待执行”；
5. RF-01 至 RF-03 任一未关闭时，不得把本轮称为安全整改完成。

## 7. 失败矩阵

| 场景                                    | 必须结果                           | 禁止结果                             |
| --------------------------------------- | ---------------------------------- | ------------------------------------ |
| 工作空间根或父目录包含符号链接          | 基于真实路径判定；越界拒绝         | 只做字符串前缀后放行                 |
| 新文件目标尚不存在                      | 校验最近存在父目录和最终候选       | 因无法 `realpath` 而退回 home 白名单 |
| Agent Run 中切换工作空间                | 使用 Run 固定 workspace            | 跟随 renderer 当前 workspace         |
| 权限模式为 `auto`                       | 仍执行宿主 authorization floor     | 破坏性工具全部放行                   |
| 工具 annotation 写错或缺失              | 未知默认暂停                       | 相信模块自报非破坏性                 |
| 定时任务来自旧 schema                   | `needs-review` 或拒绝高风险动作    | 仅凭工具名自动执行                   |
| MCP 凭证写成功、配置写失败              | 保留旧配置、允许幂等重试、不丢秘密 | 返回成功或删除旧配置                 |
| MCP 配置写成功前 CredentialService 失败 | 不改普通配置                       | 写入悬空 credentialRef               |
| 凭证文件损坏/冲突                       | 只禁用受影响 MCP 并提示恢复        | 明文降级或阻断整个 App               |
| Runtime 组件目录损坏                    | 工作台启动，组件能力 degraded      | bootstrap 全局失败                   |
| 工作空间切换时搜索响应迟到              | generation 丢弃                    | 旧结果覆盖新工作空间                 |
| 文件移动提交后强杀                      | journal 驱动恢复或明确冲突         | 静默保留旧引用                       |

## 8. 拷问结论

以下假设已经被代码证据否定，整改评审必须逐项回答，不能继续默认成立：

- “路径在用户 home 下就等于获得了当前工作空间授权”——不成立；home 是资源范围，不是授权范围。
- “工具标了 `destructiveHint` 就有安全边界”——不成立；注解可漏标，`auto` 和 scheduled task 还能绕过。
- “秘密只保存在本机文件就足够”——不成立；普通配置权限、renderer 全量返回和保存假成功仍是泄漏与
  数据一致性问题。
- “可选组件通常不会初始化失败”——不成立；权限、损坏状态和版本不兼容都是正常失败路径。
- “设置页能选就代表后端支持”——不成立；当前 OpenAI Compatible 明确被后端拒绝。
- “测试全绿就代表用户功能完成”——不成立；现有测试验证了当前实现，却遗漏安全策略反例和真实登录、
  在线设备、断线恢复证据。

下一步最重要的不是新增功能，也不是先做大规模重构，而是用 E0 固定反例后依次完成 S1-S3 三个
最小纵向闭环。每个闭环都必须让用户能执行一个此前不安全、修复后可验证的真实动作。

## 9. 本轮审查验证记录

在 `main@0db9cf4d` 上已执行：

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test`：337 个测试文件，2112 项通过、2 项跳过；
- `pnpm verify:credential-boundary`：通过，但当前门禁未识别 RF-03，属于需补覆盖的门禁缺口；
- 未在本轮重复运行完整 `pnpm verify`、生产 build 或真实 Electron/设备/在线 Agent smoke；本轮结论是
  代码审查与方案记录，不是产品验收完成声明。
