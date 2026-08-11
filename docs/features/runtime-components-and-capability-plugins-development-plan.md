# Runtime 组件与能力插件开发方案

> 状态：方案草案，尚未开始实现。最后更新：2026-08-11。
> 产品事实源：`runtime-components-and-capability-plugins.md`。
> 本计划不取代 `desktop-update-development-plan.md`；完整 App 更新仍是核心发布前置能力。

## 1. 结论

方案技术可行，但属于中等偏大的架构调整，不应以“运行一次 `npm update`”理解。

推荐路线是：

1. 完整 App updater 继续负责 Electron 核心外壳。
2. 先交付一个 sandbox MCP 插件的安装、更新和回滚纵向闭环。
3. 再交付一个本地 Runtime 组件的下载、安全点切换和内置保底回退闭环。
4. 只有两个闭环都通过真实应用验收后，才扩展 Provider、Adapter、CAD 或更多 Runtime。

第一版不做公共市场、不运行 npm CLI、不支持任意包、不加载 Node 插件、不注入 React UI，
也不实现运行中无感热替换。插件或 Runtime 更新完成后允许重启插件宿主或 Studio 生效。

建议实施前先完成现有桌面更新计划 M3-M6；若要调整优先级，必须明确接受“插件系统仍无法
修复核心外壳，且用户尚无完整自动更新闭环”的产品风险。

## 2. 用户现在能做什么、还不能做什么

### 用户现在能做什么

- 使用安装包携带或本机已有的 Claude Code Runtime。
- 使用随 Studio 构建的 MCP 工具、图片 Provider、数据源 Adapter 和 CAD 转换能力。
- 启用或禁用已经注册的 MCP `ToolModule`。
- 在可选能力失败时继续使用其他工作台能力。

### 用户现在还不能做什么

- 安装、更新、回滚或卸载 npm 能力插件。
- 独立更新 Claude、CAD、scrcpy 等 Runtime 组件。
- 在设置中审计插件权限、来源、兼容版本和健康状态。
- 在坏版本启用失败后自动回到上一已知可用组件。

因此当前产品进度为 0：已有模块化接口和打包资源只属于工程基础，不是插件更新能力。

## 3. 编码前硬门禁

### D0.1 新增架构决策

在 `docs/decisions/` 提交并评审新的 ADR，至少决定：

- 哪些 ADR 0002 条款被 Runtime 独立更新 supersede，哪些 selection、probe、generation、
  provenance 和安全点规则继续有效；
- 插件信任模型是“维护者签名的受限代码”，不是任意第三方代码；
- Plugin Host 使用 Chromium sandbox + 无 Node 的执行模型；
- 完整 App、Runtime 组件、插件分别由谁拥有更新状态；
- npm、组件 Release、OSS 与商业源的信任根和密钥轮换；
- 为什么插件目录不构成 ADR 0006 排除的 Agent Registry。

ADR 未 accepted 前，只允许完成探针和 contract 评审，不得把远程代码加载接入正式启动路径。

### D0.2 冻结首个真实纵向样本

必须在实现前选定：

- 一个无凭证、只读、只访问固定 HTTPS origin 的真实 MCP 插件；
- 一个具有明确再分发许可、发布者校验和真实用户用途的 Runtime 组件。

首个 MCP 插件建议选择“公开包/服务元数据查询”一类只读工具，用它证明 npm 下载、权限、
sandbox、MCP 代理和升级回滚，而不是先迁移 Browser、FS 或 Terminal。

Runtime 候选选择规则：

1. Claude Code 只有在 ADR 0002 再分发和认证门禁形成书面结论后才能进入公开组件源。
2. 若 Claude 门禁未关闭，选择许可清晰的 CAD 或设备辅助 Runtime。
3. 没有合格候选时，M3 保持 blocked；本地 fixture 只能证明工程门禁，不能冒充产品完成。

### D0.3 盘点收益

回看最近十次需要更新的真实改动并分类：内容包、能力插件、Runtime、完整 App。若少于三个
持续迭代模块能落入插件/Runtime 边界，先优化完整 App 发布，不启动通用插件平台。

## 4. 目标架构

```text
renderer Settings / Status
          |
          | bounded IPC
          v
main
  ArtifactCatalogService
  VerifiedArtifactTransport
       |                       |
       v                       v
  PluginManager          RuntimeComponentManager
       |                       |
       v                       v
  PluginHost             domain Runtime manager
  sandbox/no Node        ClaudeRuntimeManager / Cad backend
       |
       v
  RemoteToolModule / ProviderProxy / AdapterProxy
       |
       v
  existing permission, workspace and domain owners
```

### 4.1 状态所有者

| 状态                                             | 所有者                    |
| ------------------------------------------------ | ------------------------- |
| App Release 检查、下载、安装                     | `UpdateService`           |
| 公开组件目录投影                                 | `ArtifactCatalogService`  |
| Runtime 包下载、验证、安装版本                   | `RuntimeComponentManager` |
| Claude selection、generation、run pin            | `ClaudeRuntimeManager`    |
| 插件启用版本、进程、健康、回滚、命名空间存储     | `PluginManager`           |
| 工具权限、会话归属和执行事实                     | `McpToolHost` / Agent 域  |
| 凭证                                             | `CredentialService`       |
| Workspace、Browser、Terminal、事务等业务状态     | 现有领域服务              |

低层下载和校验代码可以复用，产品状态机不能合并成一个含糊的“万能更新 Store”。renderer 只保存
投影，窗口重建后从上述主进程 owner 重新对账。

### 4.2 计划代码落点

```text
src/shared/artifacts/
  artifact-contract.ts
  artifact-manifest-schema.ts
  artifact-errors.ts

src/shared/plugins/
  plugin-manifest.ts
  plugin-permissions.ts
  plugin-rpc.ts

src/main/artifacts/
  artifact-catalog-service.ts
  verified-artifact-transport.ts
  artifact-package-store.ts

src/main/plugins/
  plugin-manager.ts
  plugin-host-process.ts
  plugin-permission-broker.ts
  remote-tool-module.ts

src/main/runtime-components/
  runtime-component-manager.ts
  runtime-component-store.ts

src/preload/
  plugin-host-preload.ts
  component-api.ts

src/renderer/src/features/components/
  ComponentsSettings.tsx
  component-store.ts
```

最终文件可以按实现调整，但 contract、状态 owner、sandbox host 和 renderer 投影不得混在一个
巨型管理器中。

### 4.3 生命周期接入

运行时注册顺序建议为：

```text
state-services
  -> window-runtime
  -> main-process-services
  -> artifact-and-plugin-runtime
  -> automation-runtime
  -> agent-runtime
```

插件 discovery、签名复验和已启用版本恢复必须在 `McpToolHost.start()` 前完成。第一版沿用
现有“工具模块只在 MCP Host 启动前注册”的事实，更新后重启插件宿主或 Studio，不先改造成
任意时刻注册/卸载。

启动失败时：

- 一个插件失败只隔离该插件；
- 一个 Runtime 失败只降级对应能力；
- Artifact catalog、npm 或 GitHub 不可用不阻断离线启动；
- 停止流程按反向顺序终止调用、关闭 MessagePort、销毁 Plugin Host、flush 安装记录。

## 5. 包与契约设计

### 5.1 插件 manifest

首版建议：

```typescript
interface PluginManifestV1 {
  schemaVersion: 1
  id: string
  version: string
  apiVersion: '1'
  minimumStudioVersion: string
  maximumStudioVersion?: string
  entry: 'dist/plugin.js'
  packageSha256: string
  signerKeyId: string
  permissions: Array<
    | { kind: 'network'; origins: string[] }
    | { kind: 'workspace'; mode: 'read' | 'write-prepared' }
    | { kind: 'credential-use'; types: string[] }
    | { kind: 'temporary-storage' }
    | { kind: 'agent-tool' }
  >
  contributions: {
    tools?: PluginToolContribution[]
  }
}
```

约束：

- `id`、版本、入口和权限使用严格 schema 和大小上限；
- 工具名全局唯一，内置模块优先，插件不得覆盖核心工具；
- manifest 工具注解只是声明，Host 权限策略可以收紧，插件不能自称只读后执行写操作；
- 插件输出有大小、类型和超时上限；错误跨边界结构化。

### 5.2 npm 包

发布 CI 负责：

1. 固定依赖并构建单一 browser ESM bundle。
2. 检查没有 lifecycle script、原生 `.node`、额外可执行文件、符号链接和动态外部依赖。
3. 运行插件 contract、sandbox 和真实 Host SDK 兼容测试。
4. `npm pack` 后计算 SHA-256，生成维护者签名目录记录。
5. 先发布不可变精确版本，再由人工批准更新公开允许目录。

客户端负责：

1. 只读取允许目录给出的精确 tarball URL、integrity、SHA-256 和签名。
2. 不调用 npm CLI，不解析 `latest`，不运行依赖安装或 lifecycle script。
3. 下载到 `.part`，限制域名跳转、大小、文件数、展开后大小和路径。
4. 原子提交 `userData/plugins/<id>/<version>`，最后写入 verified record。

### 5.3 Runtime manifest

Runtime manifest 在通用字段外必须声明：

- `platform`、`arch`、Host protocol；
- 入口相对路径、文件大小、SHA-256；
- 发布者、签名和可选 Apple Team ID；
- probe 命令的固定类型，不允许服务端下发任意参数；
- 最低/最高 Studio 版本和领域兼容版本。

客户端不接受服务端下发任意 Shell 命令。每个 `componentId` 的 probe 由当前 Studio 内置
Adapter 定义，例如 Claude 只允许有界版本查询和最小握手。

## 6. 插件隔离设计

### 6.1 Plugin Host

第一版使用隐藏的 sandbox renderer：

- `sandbox: true`；
- `contextIsolation: true`；
- `nodeIntegration: false`；
- 无 Browser、主 renderer 或普通 preload API；
- Host 自有最小 preload 只建立 MessagePort，不暴露 `ipcRenderer`；
- 使用受控自定义协议加载本地已验签 bundle，不使用 `file://`；
- CSP 默认 `default-src 'none'; script-src 'self'; connect-src 'none'`；
- 禁止导航、新窗口、下载、权限请求和直接网络访问。

一个插件一个 Host 最容易隔离故障但进程成本高；一个共享 Host 成本低但插件之间互相影响。
M1 先采用“一插件一 Host”，用真实内存数据再决定是否合并，不能先牺牲隔离换理论性能。

### 6.2 Host Capability Broker

插件只能请求：

```text
host.network.request
host.workspace.read
host.workspace.prepareWrite
host.credential.performAuthenticatedRequest
host.storage.get/set/delete
host.logDiagnostic
```

每个请求必须带稳定 call ID、plugin ID、version 和当前 operation context。Host 校验 manifest
权限、用户批准、workspaceRef、origin、方法、超时、输入输出上限和活动任务归属。

第一版首个插件只开放 `network` 和 `agent-tool`，不开放工作空间写入和凭证。没有真实闭环证据
前，不提前实现所有 broker 方法。

### 6.3 MCP 代理

`RemoteToolModule` 在主进程实现现有 `ToolModule` 接口：

- 工具定义来自已验证 manifest，不信任运行中插件临时扩权；
- `McpToolHost` 继续负责 scheduled-task allowlist、权限确认和执行归因；
- `execute()` 将有界参数和 context 通过 MessagePort 发往固定插件版本；
- 超时、Host 退出、结果超限和 schema 错误返回结构化失败；
- 禁用插件后既不广播工具，也拒绝残留客户端调用。

不得让插件自己启动第二个 MCP Server 并绕过主 Host 权限。

## 7. Runtime 组件设计

### 7.1 存储

```text
userData/runtime-components/<componentId>/
  <version>/
    payload...
    verified.json
  state.json
```

- `<version>` 不可变，下载和解包使用临时目录；
- `state.json` 原子保存 installed、lastKnownGood、quarantined 和 lastError；
- 运行中任务固定已验证句柄，不读取可变 `current` 符号链接；
- 恢复时重新校验 verified record、入口 realpath、size/hash、平台和 Host 兼容性；
- 拒绝符号链接、目录逃逸和同版本内容替换。

### 7.2 与 ClaudeRuntimeManager 的边界

若首个 Runtime 为 Claude：

- `RuntimeComponentManager` 负责下载版本和返回 verified handle；
- `ClaudeRuntimeManager` 继续唯一拥有 bundled/system/custom selection、候选 probe、committed
  generation、活动 run 计数和安全点切换；
- 下载版属于 `bundled-managed` 的内部解析来源还是新增公开 selection，必须由新 ADR 决定，
  不能在实现中临时增加第四种含义；
- 每个 conversation 保存非敏感 runtime fingerprint；切换后不盲目复用旧 SDK Session ID；
- 下载版失败时显式回到上一下载版或安装包保底版，不静默跳到 system/custom。

### 7.3 首次启动

- DMG 安装过程不联网。
- 首次启动优先使用安装包保底 Runtime；网络检查在 UI 可交互后进行。
- 没有网络时显示“使用内置版本”或明确的 capability unavailable，不弹阻断窗口。
- 首次下载显示大小、来源和磁盘需求，允许取消和稍后处理。

## 8. 里程碑

### D0：决策与收益门禁

用户功能进度：无；这是工程准备度。

任务：

- 完成新 ADR、真实改动分类、首个插件和 Runtime 候选冻结。
- 固定 Host SDK v1、权限范围、签名根、密钥轮换和 OSS/商业源边界。
- 明确与桌面 updater M3-M6 的优先顺序。

验收：

- ADR accepted；ADR 0002/0004/0006 关系明确。
- 候选插件和 Runtime 都有真人可执行验收动作、来源、许可和失败降级。
- 没有用 mock 插件或本地 fixture 宣称产品价值。

预计：2-3 工程日，不含外部许可等待。

### M1：真实 MCP 插件安装闭环

用户结果：用户从设置安装一个维护者签名的只读 MCP 插件，重启后 Agent 能真实调用；插件
失败不影响核心工作台。

任务：

- shared manifest、权限、RPC、状态和错误 schema。
- 公开允许目录、精确 npm tarball 下载、签名和安全解包。
- `PluginManager`、一插件一 sandbox Host、MessagePort RPC。
- `RemoteToolModule` 和 automation runtime 启动前注册。
- 设置页安装、权限确认、启用/禁用、进度和诊断。
- 首个插件发布 workflow 与真实公开包。

验收：

1. 干净安装的正式包从公开源安装真实插件。
2. Agent 工具列表出现新工具并完成一次真实只读调用。
3. 插件无法访问 Node、文件、Shell、未声明网络和主 renderer IPC。
4. 离线、取消、超时、坏签名、路径逃逸和 Host 崩溃均结构化降级。
5. `pnpm verify`、新增 plugin smoke、standalone smoke 和真人验收通过。

预计：10-14 工程日。

### M2：插件更新、回滚和卸载闭环

用户结果：用户不更新 Studio 即可从插件 v1 更新到 v2；故意发布的坏候选被拒绝或自动回滚
到 v1，用户能卸载并释放空间。

任务：

- available/downloading/verifying/staged/activating/healthy/rollback 状态。
- 权限 diff 和扩大权限重新确认。
- lastKnownGood、quarantine、崩溃阈值、回滚和版本垃圾回收。
- 更新时固定活动 call 版本；第一版等待安全点或要求重启。
- 公开发布 v2 和测试用坏候选，不替换同版本资产。

验收：

1. v1 和 v2 行为可由用户在真实 Agent 调用中区分。
2. 活动调用不在中途切换版本。
3. v2 权限扩大时未确认不能启用。
4. 坏版本回滚后 v1 仍可调用，诊断说明原因和回滚结果。
5. 卸载不删除其他领域数据或凭证。

预计：4-6 工程日。

### M3：首个 Runtime 独立更新闭环

用户结果：用户从安装包保底 Runtime 更新到下载版；新任务使用新版，旧任务不被中断；坏版
自动回退。

任务：

- Runtime manifest、公开组件目录、下载、发布者和平台验证。
- `RuntimeComponentManager`、版本目录、启动恢复、空间和删除。
- 领域 Runtime manager 接入 verified handle 和 safe-point commit。
- 设置页版本、大小、来源、更新、删除、回滚和诊断。
- 同仓库组件 Tag 命名空间与 App updater 忽略规则。
- 正式签名组件发布 workflow 和内置保底恢复 smoke。

验收：

1. 离线首次启动使用安装包保底版本。
2. 公开新版真实下载、验证、probe 和启用。
3. 活动任务期间显示等待，不静默中止或切换。
4. 新任务 provenance 显示新版本；旧会话不伪恢复。
5. 篡改、错架构、错发布者、probe 超时和首次运行崩溃均回退。
6. 删除下载版后重新使用保底版，其他能力保持可用。

预计：8-12 工程日，不含签名、公证、许可和公开发布等待。

### M4：第二类插件与抽象证明

用户结果：用户安装或更新一个 Provider/Adapter 插件，现有业务 UI 和 Agent 能使用它，失败
时回到内置 Provider/Adapter，不产生第二份业务状态。

任务：

- 从图片 Provider 或数据源 Adapter 中选一个真实候选。
- 将现有硬编码 union/构造器改为稳定 descriptor + proxy contract。
- 增加 Host 代办网络和凭证使用；凭证默认不返回插件。
- UI 使用 descriptor 渲染，不注入插件 React。
- 补 Provider/Adapter 能力矩阵、真实 API 验收和失败回退。

验收：

- 插件 Provider/Adapter 不拥有 Thread、数据源配置、凭证或文件状态。
- 认证、超时、限流、取消、结果超限和插件崩溃结构化降级。
- 内置实现继续作为稳定回退；卸载插件不破坏旧配置。

预计：5-8 工程日。

### M5：生产加固与是否扩张评审

用户结果：连续两个真实插件版本和两个 Runtime 版本完成升级/回退验收；组件中心可以解释
当前使用版本、权限、健康和失败原因。

任务：

- 密钥轮换、目录撤回、降级攻击、重放和缓存恢复。
- 代理、弱网、磁盘不足、并发更新、App 升级后的兼容重检。
- CPU、内存、启动时间、磁盘和 Plugin Host 数量压测。
- 诊断脱敏和 component/plugin smoke 纳入 `pnpm verify` 或发布门禁。
- 根据真实价值决定是否扩展 CAD、更多数据源和更多 Provider。

预计：5-7 工程日。

## 9. 总工作量与关键路径

| 工作包                         | 预计工程日 | 用户功能进度                         |
| ------------------------------ | ---------- | ------------------------------------ |
| D0 决策与收益门禁              | 2-3        | 无                                   |
| M1 MCP 插件首次安装            | 10-14      | 首个插件可安装并真实调用             |
| M2 插件更新与回滚              | 4-6        | 无需更新 App 即可升级插件            |
| M3 Runtime 独立更新            | 8-12       | Runtime 可独立升级并保底回退         |
| M4 第二类插件                  | 5-8        | Provider/Adapter 扩展点得到真实证明  |
| M5 生产加固                    | 5-7        | 连续版本和异常场景达到可发布质量     |

单人完整路线约 34-50 工程日，即约 7-10 周；首个可验收插件闭环约 3-4 周。估算不包含
许可、Apple 签名公证、npm/GitHub 发布审批和真人等待时间。

若只完成 M1-M2，可以交付“维护者签名的 MCP 插件独立更新”，但不能宣称 Runtime 组件、
Provider/Adapter 或通用插件平台已完成。

## 10. 失败矩阵

| 场景                         | 产品行为                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| npm/GitHub 离线              | 保持现有版本；离线启动，不阻断其他能力                     |
| 下载取消或超时               | 删除 `.part`，保留当前版本，可重试                         |
| 哈希或签名错误               | 拒绝并删除候选；当前版本不变                               |
| tar 路径逃逸/符号链接/炸弹   | 安装前拒绝，记录结构化安全错误                             |
| Host/Studio 不兼容           | 不启用候选，显示所需 Studio 版本                           |
| 插件请求未声明权限           | Host 拒绝，插件不能自行降级权限检查                         |
| Plugin Host 握手超时         | 终止 Host，候选失败；核心工作台继续                         |
| 插件连续崩溃                 | 隔离候选并回滚 lastKnownGood                               |
| Runtime 架构/发布者不符      | probe 前拒绝；不改变 committed generation                  |
| Runtime 更新时有活动任务     | 等待安全点或让用户明确中止；默认不中断                     |
| App 升级后插件不兼容         | 自动禁用并显示原因，不勉强加载                             |
| 回滚版本也损坏               | 回到安装包保底版；无保底时仅对应能力 unavailable           |
| 卸载时仍有活动调用           | 阻止卸载或等待结束，不删除运行中文件                       |
| 磁盘空间不足                 | 下载前拒绝并显示所需空间，不清理用户文件                   |
| 权限范围扩大                 | 候选保持 staged，用户未确认前不激活                        |

## 11. 测试与发布门禁

### 单元与契约

- manifest 严格键、版本、权限、Host 兼容、平台和架构。
- tar/zip 路径逃逸、符号链接、文件数、展开大小和压缩炸弹。
- 签名、key ID、轮换、撤回、哈希和同版本替换。
- RPC request/response、超时、取消、重复 ID、结果上限和崩溃。
- 权限 broker 的 origin、redirect、workspaceRef、credential-use 和外部动作拒绝。
- 版本 pin、安全点、lastKnownGood、quarantine 和空间回收。

### 真实 Electron smoke

- `sandbox === true`、`nodeIntegration === false`、`contextIsolation === true`。
- 插件无法获得 `require`、`process`、任意 `ipcRenderer`、文件和 Shell。
- 允许的 MessagePort 调用可完成，未声明网络请求被阻断。
- 主窗口重建、App 重启、离线启动和关机释放不遗留 Host 或监听器。
- 插件安装、v1 -> v2、坏候选回滚、禁用和卸载进入真实 UI。
- Runtime 保底、下载版启用、活动任务等待和坏版回退进入真实 UI。

### 发布门禁

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm verify
pnpm smoke:standalone
pnpm smoke:plugins            # 计划新增
pnpm smoke:runtime-components # 计划新增
```

此外必须在正式签名 arm64 包中完成两轮连续插件升级和两轮连续 Runtime 升级。fixture、mock、
本地开发服务器和 ad-hoc 包只能证明工程门禁，不能证明公开分发闭环。

## 12. 文档与决策维护

每个里程碑结束后同步：

- 本产品文档“当前事实”；
- 本开发计划状态、真实用户能力和残余风险；
- 新 ADR 及 ADR 0002/0004/0006 的 superseded/related 说明；
- `docs/architecture.md` 状态 owner、运行时分层和当前能力；
- `docs/development.md` 代码结构、命令和开发门禁；
- 新增组件/插件发布 runbook 和验收证据。

未实现内容继续标为方案，不得把计划文件、Schema、Manifest、发布脚本或本地 fixture 写成
“支持插件热更新”。

## 13. 止损条件

出现任一情况时停止横向扩张并重新评审：

- D0 无法找到三个持续独立迭代的真实模块；
- 首个插件必须开放 Node、Shell 或主进程直接加载才能完成；
- 同一阻塞连续失败两次，或单项签名/沙箱/Runtime 许可前置超过 60 分钟仍无用户闭环增量；
- M1 尚未完成就开始建设市场、插件 UI 框架、第三方 SDK 或多 Registry；
- 插件更新需要复制 Thread、Workspace、Browser、Terminal 或事务状态；
- Runtime 独立更新无法保留安装包保底和可验证回滚；
- 插件平台实际只能覆盖很少改动，而完整 App updater 仍未闭环。

止损后必须先报告：用户现在能做什么、还不能做什么；已消耗时间；阻塞；可替代路径；是否
应回到完整 App 更新主线。

## 14. 拷问

- npm 包即使来自维护者账号，是否仍经过 Studio 自己的签名？如果没有，npm 账号就是远程
  代码执行根权限。
- Plugin Host 是否真的没有 Node 和直接网络？如果只是 `utilityProcess`，它更像崩溃隔离，
  不是权限沙箱。
- `RemoteToolModule` 是否继续经过现有 `McpToolHost` 权限和 scheduled-task allowlist？如果
  插件自己开 MCP Server，架构已经分叉。
- Runtime 更新时谁拥有 committed generation？如果 ComponentManager 和
  ClaudeRuntimeManager 都能切换，就形成第二状态所有者。
- 用户卸载插件时，领域数据和凭证由谁拥有？答案不能是插件目录。
- 首个公开候选是否经过真实签名和网络分发？本地 fixture 通过不能证明产品完成。
- 完整 App updater 尚未关闭时，这项工作是否真的优先？插件系统不能更新自身，核心安全
  修复仍依赖完整发版。
