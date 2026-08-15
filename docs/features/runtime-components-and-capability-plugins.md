# Runtime 组件与能力插件

> 状态：固定版本 Runtime 管理已交付；远程版本目录、真实双版本更新/回滚、内容包和通用能力插件自 2026-08-15 起暂停。最后更新：2026-08-15。
> 当前 Studio 仍通过完整应用 Release 更新程序代码；Claude Code Runtime 按需安装到 `userData`，OCCT 和 scrcpy 支持固定版本安装与随 App 资源回退，但均不支持远程新版本发现。
> “设置 > 组件管理”的本地盘点页面已实现，交互事实见 `component-management-settings.md`。
> 已暂停的参考计划见 `runtime-components-and-capability-plugins-development-plan.md`。

## 结论

当前产品停在“稳定核心外壳 + 可按需安装的固定 Runtime 组件”。可独立更新的 Runtime 和受限能力插件仅保留为条件性设计边界，不是当前路线图。即使未来重启，也不能让任意 npm 包进入 Electron 主进程，不能替代完整应用更新。

暂停原因：

- Claude CLI 与 App 内 Agent SDK、OCCT WASM 与 App 内 JavaScript 适配器、scrcpy server 与 App 内 Client 都需要配套验证，不存在无条件追新。
- Claude 可执行文件已移出 `.app`，安装包体积与 App 替换重复传输的主要收益已经获得。
- 小型配置和内容包体积小，单独 npm 化的产品收益不足。
- 现有 Provider、Adapter 和 MCP 工具尚无持续独立发布需求，不值得先建设通用 Plugin Host。

产品固定采用三层交付模型：

| 层级             | 典型内容                                               | 更新方式                                      |
| ---------------- | ------------------------------------------------------ | --------------------------------------------- |
| 核心外壳         | Electron、main、preload、IPC、主 React UI、权限和更新器 | 完整 Tag、签名、公证和应用安装                |
| Runtime 组件     | Claude 可执行引擎、CAD 后端、scrcpy server、受控 WASM  | 独立签名组件包，安装到 `userData`，安全点切换 |
| 能力插件         | MCP 工具、Provider、Adapter、声明式 contribution       | 预构建 npm 包，验签后在隔离宿主运行           |

Runtime 组件和能力插件都只能扩展核心外壳已经声明的 contract。它们不能新增 preload、注册任意
IPC、直接修改主 renderer、接管 Thread/Agent loop、绕过工作空间权限或取消不可逆操作的最终人工
确认。

第一版只支持维护者签名、公开可审计、明确列入允许目录的包；不建设公共插件市场，不允许用户
输入任意 npm 包名，不允许插件携带安装脚本、Node 原生模块或任意系统可执行文件。

## 当前事实

### 用户现在能做什么

- 在设置中选择 `managed`、`system` 或 `custom` Claude Code Runtime，并查看探测状态。
- 在组件页安装、检查、修复和卸载固定 Claude `2.1.211`、OCCT `0.0.23`、scrcpy `2.3.1` 和 agent-device Helper `0.17.2`。
- 使用已安装的 managed Claude、OCCT 和 scrcpy；OCCT/scrcpy 损坏或卸载时回退到随 App 资源。
- 替换 `.app` 后复用 `userData` 中已安装的 Runtime，不重新下载。
- 查看和启用/禁用随 Studio 构建的 MCP `ToolModule`。
- 在统一组件清单中查看能力类型、本地安装状态和已知版本，并重新检测 Claude 与 CAD。
- 在缺少 adb、CAD 后端或其他可选能力时继续启动 Studio，并看到相应降级状态。

### 用户现在还不能做什么

- 在不更新 Studio 的情况下下载或切换新版 Claude Code Runtime。
- 从 Studio 内安装、更新、回滚或卸载能力插件。
- 从远程目录取得可更新版本、权限、兼容性和健康状态。
- 在首次启动时从远程目录发现新版 Runtime。
- 在插件或 Runtime 更新失败后由产品自动回退到上一已知可用版本。

因此当前只宣称“固定版本 Runtime 独立安装、修复和 App 替换复用”，不宣称插件安装、npm 热更新或 Runtime 独立版本更新。

## 条件性重启后的用户目标与端到端验收

本节是未来若通过新 ADR 重启后的验收边界，不是当前承诺或开发计划。重启前必须先证明两个真实 Runtime 版本能在现有 Host/SDK 上兼容运行，或至少一个 Provider/Adapter/MCP 存在持续独立发布的真实产品需求。

### A. 能力插件闭环

目标完成后，用户必须能在真实应用中执行：

1. 打开“设置 > 组件与插件”，看到一个维护者签名的可安装 MCP 插件、版本、来源、大小、
   兼容范围和权限说明。
2. 点击安装，Studio 下载固定版本包，完成哈希、签名、包结构和兼容性校验。
3. 用户确认新增或扩大的权限，安装成功后按提示重启插件宿主或 Studio。
4. 新插件出现在 Agent 工具列表中，真实 Agent 调用仍经过原有工作空间绑定、权限判断、
   计划任务 allowlist 和最终人工确认。
5. 插件发布新版本后，用户不安装新版 Studio 即可更新插件；正在运行的调用继续固定旧版本，
   新版本只在安全点生效。
6. 篡改包、启动超时或连续崩溃会被拒绝或自动回退；用户仍可使用核心工作台并复制脱敏诊断。
7. 用户可以禁用、回滚或卸载插件；插件的失败和卸载不删除其他领域数据。

### B. Runtime 组件闭环

目标完成后，用户必须能在真实应用中执行：

1. 全新安装后离线启动 Studio，安装包内的保底 Runtime 可用；没有网络时不阻断工作空间、
   编辑器、浏览器和 Terminal。
2. 联网后看到一个与当前平台、架构和 Studio 版本兼容的 Runtime 新版，查看版本、来源、大小、
   发布说明和预计影响。
3. 用户确认下载后，Studio 将组件写入私有版本目录，完成哈希、发布者、架构、版本和 probe。
4. 有活动任务时显示“任务结束后生效”；当前任务继续绑定旧 Runtime，不发生运行中偷换。
5. 到达安全点后，新会话使用新版并记录 provenance；旧会话历史保留，不能伪造跨 Runtime
   Session 无损恢复。
6. 新版 probe、握手或首轮健康检查失败时，Studio 自动回退上一已知可用版本；若所有下载版
   都失败，则回到安装包内置保底版本。
7. 用户可以删除下载版并释放空间；删除后只影响对应能力，不影响应用启动。

### C. 完整应用更新仍然成立

用户必须仍可通过现有 `UpdateService` 获取核心外壳更新。插件和 Runtime 更新不能修复
Electron、preload、IPC、权限、主 UI 或插件管理器自身缺陷，也不能作为拖延完整应用更新闭环
的理由。

## 产品定义

### Runtime 组件

Runtime 组件是由核心外壳启动或调用的本地执行资源，例如：

- Claude Code 可执行引擎；
- CAD/OCCT/FreeCAD 转换后端；
- `scrcpy-server.jar`；
- 受控的 WASM 或辅助程序。

Runtime 组件不是新的 Agent 产品。Claude 可执行引擎即使独立更新，Thread、Agent loop、MCP、
权限、角色、调度、诊断和用量事实仍由 CCLink Agent 领域拥有。本文的本地 Runtime 组件也
不是架构文档中由官方集成层承接的“官方网络 Runtime”。

### 能力插件

能力插件是预构建、受限执行、通过稳定 SDK 与主程序通信的代码包。第一阶段允许：

- 注册 MCP 工具定义并通过远程代理执行；
- 注册模型/图片服务 Provider；
- 注册数据源 Adapter；
- 注册平台适配器和声明式命令 contribution；
- 使用主程序提供的有界网络、凭证使用、临时存储和工作空间能力。

第一阶段不允许：

- 直接 `require()` Node.js、Electron 或主进程内部模块；
- 直接访问文件系统、环境变量、Shell、系统凭证或任意网络地址；
- 注册 preload、IPC channel、全局快捷键或原生菜单 Host；
- 把 React 组件注入主 renderer；
- 持有 Thread、Workspace、Browser Profile、Terminal Session 或事务节点状态；
- 带入另一套 Agent loop、ACP Agent、外部 Agent Registry 或用户自定义 Agent 可执行文件。

### 内容包

模板、提示词、兼容规则、帮助文案和静态资产继续按“内容包”处理。内容包不能携带可执行
JavaScript、Shell、HTML、SVG 或动态模块。提示词和会影响外部副作用的规则虽然不是代码，
仍必须版本化、展示变更，并只影响新任务或由用户明确接受。

## 哪些改动走哪条链路

| 改动                                                   | 内容包 | 能力插件 | Runtime | 完整 App |
| ------------------------------------------------------ | ------ | -------- | ------- | -------- |
| 模板、文案、模型目录、兼容规则                         | 是     | 否       | 否      | 否       |
| 新增只调用有界 Host API 的 MCP 工具                    | 否     | 是       | 否      | 否       |
| 新增图片 Provider 或数据源 Adapter                     | 否     | 是       | 否      | 否       |
| 更新 Claude/CAD/scrcpy 本地执行资源                    | 否     | 否       | 是      | 否       |
| 修改 Electron main、preload、IPC 或主 React 交互       | 否     | 否       | 否      | 是       |
| 修改凭证、权限、工作空间边界或外部副作用确认           | 否     | 否       | 否      | 是       |
| 更新 Electron、React、Playwright、node-pty 等核心依赖   | 否     | 否       | 否      | 是       |
| 修复插件管理器、签名校验器或 Runtime 选择器自身        | 否     | 否       | 否      | 是       |
| 携带 Node 原生模块、任意二进制或需要安装脚本的 npm 包  | 否     | 否       | 受审查  | 默认是   |

判断规则只有一个：如果变更需要扩大宿主权限、改变核心状态所有者或让电脑执行宿主未声明的新系统
能力，就不能作为普通插件更新。

## 产品交互

设置新增“组件管理”分组。第一阶段先交付统一清单，详细字段和首次安装行为见
`component-management-settings.md`；接入下载管理器后的目标交互为：

```text
设置
└─ 组件与插件
   ├─ Runtime 组件
   │  ├─ Claude Code  2.1.x · 内置保底 · 已验证
   │  ├─ 可用更新      2.1.y · 230 MB
   │  └─ [下载更新] [删除下载版] [复制诊断]
   ├─ 能力插件
   │  ├─ 插件名称      1.2.0 · 已启用
   │  ├─ 权限          网络：api.example.com；工作空间：只读
   │  └─ [更新] [禁用] [回滚] [卸载]
   └─ 更新设置
      ├─ 自动检查：开
      └─ 自动下载：关
```

交互规则：

- 自动检查可以默认开启；第一版不自动下载、不自动扩大权限、不静默切换运行中的 Runtime。
- 安装和首次启用必须明确确认；相同权限范围内的小版本更新可以减少重复说明，但仍由用户点击。
- 新版本扩大网络域名、文件范围、凭证用途或外部动作时，必须重新确认。
- 第一版激活以“重启插件宿主或 Studio 后生效”为默认，不承诺运行中无感热切换。
- 组件中心只显示脱敏路径摘要，不显示凭证、完整 Home 路径、下载签名私钥或原始请求内容。

## 架构与状态所有权

```text
公开不可变组件源 / npm Registry
              |
              v
      VerifiedArtifactTransport
       download / hash / signature
              |
      +-------+------------------+
      |                          |
      v                          v
RuntimeComponentManager      PluginManager
installed verified handles   install / enable / process / rollback
      |                          |
      v                          v
domain runtime manager       sandboxed PluginHost
ClaudeRuntimeManager         RemoteToolModule / ProviderProxy
      |                          |
      +-------------+------------+
                    v
         existing host permissions and domains
```

状态所有权固定如下：

| 状态                                                   | 唯一所有者                         |
| ------------------------------------------------------ | ---------------------------------- |
| 完整应用检查、下载和安装                               | `UpdateService`                    |
| Runtime 包下载、已安装版本和验证句柄                   | `RuntimeComponentManager`          |
| Claude selection、probe、generation 和活动 run         | `ClaudeRuntimeManager`             |
| 插件安装、启用版本、进程、健康、回滚和隔离存储         | `PluginManager`                    |
| Thread、Agent loop、MCP 权限和工具调用事实              | 现有 Agent Runtime / `McpToolHost` |
| 工作空间、Browser、Terminal、WebAffair 等业务状态       | 现有领域服务                       |
| 凭证                                                   | `CredentialService`                |

`RuntimeComponentManager` 只提供已验证的不可变组件句柄，不能决定一个 Agent run 正在使用哪个
Claude generation。`ClaudeRuntimeManager` 继续遵守 ADR 0002 的探测后提交和安全点切换。

插件只能保存自身命名空间内的缓存和设置。插件若贡献数据源、事务或工具，只能持有稳定引用或
可丢弃投影，不能复制业务状态成为第二事实源。

## npm 分发边界

npm 可以作为内容包、能力插件和 Runtime 组件的公开包仓库及 tarball 分发渠道。完整分类清单
见 `npm-updatable-capability-inventory.md`。Studio 不依赖用户安装 npm/pnpm，不在用户设备运行
`npm install`、`npm update` 或任何 lifecycle script。

每个通过 npm 分发的包必须：

- 使用精确版本，不使用 `latest`、`^`、`~` 或运行时依赖解析；
- 在 CI 中打成单一 browser-compatible ESM bundle；
- 不包含 `preinstall`、`install`、`postinstall`、动态下载器或原生依赖；
- 包含严格 manifest、SDK 版本、Host 兼容范围、权限和入口摘要；
- 同时通过 npm integrity、Studio 目录中记录的 SHA-256 和维护者数字签名；
- 解包时拒绝绝对路径、`..`、符号链接、超限文件数、超限大小和未声明入口；
- 只从维护者允许目录解析 tarball URL，不接受 renderer 提供任意 URL。

第一版不把 npm 账号本身作为唯一信任根。npm 账号或 Registry 被接管时，没有维护者签名的
包仍必须被 Studio 拒绝。

## 插件执行隔离与权限

第一版插件在独立、sandboxed、`nodeIntegration: false`、`contextIsolation: true` 的隐藏
Plugin Host 中运行。宿主通过受限 MessagePort RPC 提供能力，不把 Electron 或 Node API
暴露给插件。

插件 manifest 允许声明的首批权限：

```text
network:<https-origin allowlist>
workspace:read
workspace:write-prepared
credential-use:<credential-type>
temporary-storage
agent-tool
```

约束：

- 网络默认拒绝；插件自己的浏览上下文不能直接访问外网，网络请求由主进程 broker 校验域名、
  方法、大小、超时和重定向后代办。
- 凭证默认不返回原文。Host 应优先代为附加认证或完成签名；确需传入时必须有单独设计和用户
  可见权限，不得进入日志或插件持久化。
- 工作空间能力只接受 Host 生成的 opaque handle 或已绑定的 `workspaceRef`，插件不能自报路径。
- `workspace:write-prepared` 只能准备可审阅变更；删除、外部提交、支付、发帖和发送消息继续走
  现有人工确认。
- Plugin Host 崩溃只使该插件失败，不能导致主进程、其他插件或核心能力退出。

需要 Node、原生库或系统可执行文件的能力不进入普通插件宿主。它们必须作为 Runtime 组件
单独评审、签名、限制环境和工作目录；需要扩大系统权限时先提交独立 ADR。

## Runtime 分发与首次启动

Runtime 组件可以通过 npm 的精确平台包分发，也可以使用本仓库不可变 Tag 对应的公开组件
资产。npm 在这里仅是下载源；Runtime 下载后仍由 `RuntimeComponentManager` 完成平台、架构、
哈希、发布者和 probe 校验，不能进入普通 Plugin Host。若使用组件 Tag，其命名空间必须与 App
Release 隔离，App updater 必须忽略组件 Tag。商业版组件源由 `cclink-dev` 独立注入，不与
OSS 共享凭证、签名密钥或发布状态。

安装包必须保留最低可用版本或明确的本地降级：

```text
已下载且通过验证的兼容版本
  -> 上一已知可用下载版
  -> 安装包内置保底版本
  -> 该能力 unavailable，Studio 其他能力继续启动
```

不在 macOS Installer/DMG 阶段联网。首次启动后由 Studio UI 检查和下载，这样用户可以看到
来源、大小和失败原因，也能在网络不可用时进入工作台。

Runtime Manifest 至少包含：

```json
{
  "schemaVersion": 1,
  "componentId": "claude-code-runtime",
  "version": "x.y.z",
  "hostApiVersion": "1",
  "minimumStudioVersion": "0.1.25",
  "platform": "darwin",
  "arch": "arm64",
  "entry": "bin/runtime",
  "size": 123,
  "sha256": "...",
  "publisher": "...",
  "signature": "..."
}
```

可执行 Runtime 还必须校验平台签名、公证、架构、入口 realpath、普通文件、执行权限和有界
版本 probe。只验证哈希不能替代发布者校验。

## 生命周期与回滚

下载、安装和切换固定为：

```text
available
  -> downloading
  -> verifying
  -> staged
  -> waitingForSafePoint
  -> activating
  -> healthy
             \
              -> rollback / quarantined
```

规则：

- 下载先写 `.part`，验证完成后原子提交版本目录和记录。
- 组件目录只允许不可变版本，不能原地覆盖正在运行的版本。
- 每个 Agent run、工具调用或转换任务在创建时固定 `artifactVersion + fingerprint`。
- 更新时默认等待活动任务结束。第一版允许重启 Studio 生效，不实现复杂的运行中卸载。
- 激活前必须完成 probe/handshake；激活后异常退出达到阈值时自动回滚并隔离坏版本。
- 至少保留安装包保底版和一个上一已知可用下载版；空间回收不能删除正在使用或可回滚版本。
- App 升级后必须重新检查插件 SDK 和 Runtime Host 兼容性，不兼容时禁用而不是勉强启动。

## 错误与诊断

状态继续使用 `ready`、`degraded`、`unavailable`、`failed`。首批错误至少区分：

```text
SOURCE_UNAVAILABLE
PACKAGE_NOT_ALLOWED
PACKAGE_INTEGRITY_FAILED
PACKAGE_SIGNATURE_INVALID
PACKAGE_STRUCTURE_INVALID
HOST_VERSION_INCOMPATIBLE
PLATFORM_UNSUPPORTED
ARCH_UNSUPPORTED
PERMISSION_EXPANSION_REQUIRED
DISK_SPACE_INSUFFICIENT
DOWNLOAD_CANCELLED
ACTIVATION_BLOCKED_BY_ACTIVE_TASK
PLUGIN_HANDSHAKE_TIMEOUT
PLUGIN_CRASH_LOOP
RUNTIME_PROBE_FAILED
ROLLBACK_APPLIED
NO_FALLBACK_AVAILABLE
```

诊断记录稳定 operation ID、artifact ID、版本、来源类型、阶段、耗时、错误码、回滚结果和
脱敏消息。不得记录下载签名私钥、凭证、Cookie、完整插件请求正文、工作空间正文、完整 Home
路径或任意用户文件内容。

## OSS 与商业版边界

- OSS 默认只使用公开、免登录、维护者签名的组件目录；不内置 npm token、GitHub token、
  私有 Registry、商业更新源或 CCLink 账号依赖。
- 开源组件发布只从本仓库不可变 Tag 或受控 npm provenance 构建，不能 checkout
  `cclink-dev` 或读取商业发布状态。
- 商业版可以通过官方集成层提供独立目录和签名根，但不能让 OSS 反向 import 商业实现。
- 插件不能引入官方账号、entitlement、quota 或生产 API 作为 OSS 本地能力的启动条件。
- “插件目录”不是 Agent Registry。ACP、外部 Agent 框架和用户自带 Agent 可执行文件继续受
  ADR 0006 排除。

## 产品范围

### 第一阶段必须交付

- macOS arm64。
- 维护者签名的公开允许目录。
- 一个真实 MCP 能力插件的安装、更新、禁用、回滚和卸载闭环。
- 一个本地 Runtime 组件的检查、下载、验证、安全点切换和内置保底回退闭环。
- 组件与插件设置页、权限确认、空间管理和脱敏诊断。
- 离线首次启动、篡改包、来源不可用、架构不符、宿主不兼容和崩溃回滚验收。
- App 更新、Runtime 更新和插件更新三个状态所有者及 UI 语义明确分离。

### 第一阶段明确不做

- 公共插件市场、第三方自由发布和任意 npm 包安装。
- Windows、Linux、Intel/x64 和 Mac App Store。
- Node 插件、原生 npm 模块、安装脚本和插件自带任意可执行文件。
- 插件 React 组件注入主界面、任意 CSS、HTML 或 SVG 注入。
- 不重启的运行中代码热替换。
- 自动下载、静默权限扩大、强制升级和最低版本封锁。
- ACP、Agent Registry、用户自带 Agent 或第二套 Agent loop。
- 用插件更新修复核心外壳安全漏洞。

## 兼容性与发布纪律

- Host SDK 使用独立 `apiVersion`，只保证明确文档化的稳定 contract。
- 插件声明 `minimumStudioVersion` 和可选 `maximumStudioVersion`；超出范围默认禁用。
- Runtime 声明平台、架构、Host API 和 domain protocol 版本；版本号相近不能代替真实 probe。
- 每个插件/组件版本都是不可变发布物；撤回只通过目录标记禁用或发布新版，不能替换同版本
  tarball。
- 插件和 Runtime 的微更新仍然是一次需要 CI、签名、发布说明和验收的发布，只是不再重建
  整个 DMG。
- 完整 App updater 的自动安装与真实升级闭环关闭前，不能把本方案宣称为发布问题已经解决。

## 与现有决策的关系

- ADR 0002 当前规定内置 Claude Code 只随 Studio 更新。Runtime 独立更新会改变这一决定，
  实现前必须新增 ADR，明确 supersede 的具体条款、许可、签名根、缓存、选择和回滚语义。
- ADR 0006 继续有效：插件和可更新 Claude 执行引擎都不能拥有 Thread、Agent loop、工具权限
  或 Agent Registry。
- ADR 0004 继续有效：OSS 与商业版发布、凭证和状态独立。
- `UpdateService` 继续是完整 App 更新唯一所有者；组件更新不能复制应用安装状态机。

## 成功指标

首轮真实验收只看用户结果：

- 用户能在旧 Studio 中安装并更新真实插件，无需下载新版 DMG。
- 用户能更新真实 Runtime，新任务使用新版，旧任务不被静默中断。
- 任一坏包都被拒绝或回滚，核心工作台仍可启动。
- 离线新安装仍有明确可用能力或可理解降级，不被首次联网下载卡死。
- 插件更新没有绕过原有 MCP 权限、工作空间归属和最终人工确认。

下载字节、构建时间、包数量和测试数量只属于工程指标，不能代替上述产品验收。

## 拷问

- 最近十次想“微更新”的改动中，有多少真的落在插件/Runtime 边界内？如果大部分是主 UI、
  IPC 或核心 Bug，插件平台不会显著减少发版。
- 维护一个 Host SDK、签名根、权限 broker、兼容矩阵和回滚链，是否比继续优化完整 App 更新
  更省成本？只有存在持续独立迭代的 Provider、Adapter、MCP 或 Runtime 时答案才可能是是。
- 所谓“隔离进程”是否只是防崩溃？如果插件仍能直接使用 Node 文件和网络 API，就没有形成
  权限隔离。
- 首个 Runtime 若选择 Claude Code，ADR 0002 的许可和再分发门禁是否真的关闭？没有书面结论
  就不能用技术实现代替发布授权。
- 如果插件更新失败，用户能否在没有网络、没有 npm、没有命令行知识时恢复？不能恢复就不
  是可交付的更新系统。
- 这条路线最该先证明的是一个真实插件在不升级 App 的情况下产生用户价值，而不是先建设
  一个空的万能插件市场。
