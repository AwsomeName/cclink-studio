# S2 能力独立降级矩阵

> 状态：S2.1 已完成。分支：`codex/stabilization-s2`。起始基线：`9fed92c`。S2.1 基线：`56afb38`。日期：2026-07-21。

## 结论

S2 的目标不是给启动异常多加几层 `catch`，而是保证每项可选能力拥有独立状态、独立失败边界和可验证的降级结果。任何可选模块失败后，本地工作区、文件、编辑器、Terminal 和不依赖该模块的 Agent 工具必须继续可用。

能力状态统一使用：

- `ready`：模块已初始化，当前运行条件满足。
- `degraded`：模块主体已启动，但部分子能力或外部前置条件缺失。
- `unavailable`：模块未配置、未连接或当前环境不提供，且不是程序异常。
- `failed`：模块初始化或运行时绑定发生异常，需要诊断和修复。

## 当前矩阵

| 能力                     | 状态所有者                                   | 当前启动依赖                 | 当前失败影响                                                               | S2 目标                                             |
| ------------------------ | -------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| 本地 Agent backend       | `AgentBridge` / `AgentRuntime`               | 窗口、设置、权限、MCP        | Playwright 和 ADB 已允许缺失；MCP 失败时明确为 `unavailable`               | 后续验证运行时重连与窗口重建                        |
| MCP 工具主机             | `McpToolHost`                                | 权限系统                     | 已在 Playwright 之前独立创建、启动；模块逐项注册                           | 后续纳入统一生命周期声明源                          |
| Browser 自动化           | `PlaywrightBridge` / `BrowserManager`        | CDP 发现与连接               | CDP 失败单独标记 `failed`；普通内嵌浏览器、MCP、Editor、Agent 继续启动     | 后续补运行时恢复入口                                |
| Editor / File Agent 工具 | `EditorToolModule` / `FileService`           | 主窗口与本地文件服务         | 已在 Playwright 之前初始化；MCP 注册失败时为 `degraded`，Editor IPC 仍可用 | 后续补窗口重建覆盖                                  |
| Android 真机             | `ActiveDeviceManager` / `AdbBridge`          | 窗口阶段构造，设备可稍后连接 | 无设备为 `unavailable`；异常状态可保留为 `failed`，不阻断 Agent            | 后续隔离桥接服务初始化                              |
| agent-device 语义层      | `AgentDeviceManager`                         | ADB、active device、动态库   | 已独立初始化；不可用与初始化异常分别记录，不阻断 MCP                       | 后续验证设备连接后的状态迁移                        |
| Meshy                    | `MeshyService` / `MeshyToolModule`           | 设置与 API 配置              | 工具构造/注册已独立，失败不影响后续模块和 MCP                              | 后续隔离服务构造                                    |
| Data source              | `DataSourceService` / `DataSourceToolModule` | 本地配置加载                 | `load()` 仍在主服务串行启动路径，异常可阻断应用                            | S2.1 先隔离工具注册；后续将服务加载移入独立能力边界 |
| Hardware / CAD           | 对应 service / tool module                   | 本地服务、可选外部 CAD 后端  | 工具已分别注册和记录；服务构造仍位于主服务串行路径                         | 后续隔离服务构造；外部 CAD 缺失不得阻断硬件文件能力 |
| Terminal                 | Terminal orchestrator / execution adapter    | 主窗口、本地 PTY             | 位于主服务串行路径，失败可阻断后续 Agent IPC                               | 保持核心能力；补失败注入证明其他核心能力状态可诊断  |

## S2.1 验收结果

- [x] CDP 发现或 Playwright 连接失败时，MCP 主机、Editor 工具和本地 Agent backend 仍为 `ready`，Browser 为 `failed`。
- [x] Meshy 工具模块构造失败的注入测试证明后续 Hardware、CAD、Data source、Android、agent-device 和 MCP server 继续初始化。
- [x] `agent:getCapabilities` 返回 `ready`、`degraded`、`unavailable`、`failed` 之一，并包含有界失败原因；`available` 仅作为兼容派生字段。
- [x] 设置页显示四态真实状态；真实启动快照包含 11 项能力，Android 与 Device AI 为 `unavailable`，其余当前能力为 `ready`。
- [x] Agent 面板复制诊断日志包含同一能力快照、状态、原因和更新时间，并继续执行敏感字段脱敏。
- [x] `pnpm verify` 通过：136 个测试文件、812 项测试、typecheck 与生产构建全部返回 0。
- [x] `pnpm smoke:standalone` 通过：local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- [x] 严格 `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window` 通过：Profile Cookie/localStorage 跨进程保留，纯净认证窗口到达 Google 账号校验页；CDP 与当前自动化窗口对照仍被判为不安全浏览器。
- [x] GitHub Actions run `29798156373` 绑定 `56afb38`，`verify` 和独立 `smoke` job 均成功；CI 认证检查保持为确定性 Profile/窗口机制。

严格认证结果只证明纯净认证窗口路径和 Profile 持久化有效，不表示 Google 接受带 CDP 的自动化登录窗口。S2.1 没有改变该安全边界。

## 后续边界

S2.1 先拆自动化 runtime 内部硬依赖。`bootstrapMainProcessServices` 中 Data source、Terminal、官方集成等服务仍是串行硬依赖，必须在后续 S2 批次逐项隔离。服务启动/停止完全统一到同一声明源属于 S3，本阶段不提前重写整个生命周期框架。
