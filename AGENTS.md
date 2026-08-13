# CCLink Studio — AGENTS.md

> 本文件为 Codex 提供当前项目事实源，每次会话自动加载。

## 默认协作规则

- 默认启用 `$grill-me`：每次进行架构方案、实现计划、阶段总结、质量判断或重大技术取舍时，自动执行 `/grilling` 风格审查，不需要用户手动输入 `$grill-me`。
- `/grilling` 风格要求：先给结论，再主动拷问假设、完成度、边界条件、失败路径和下一步最该做什么；不能只报喜。
- 对普通小修、小 bug、明确代码实现任务，保持简洁执行；最终总结仍要点出残余风险和验证结果。

## 产品交付纪律

- 产品目标必须先写成用户可执行的端到端验收动作，再拆工程任务。没有用户在真实应用中可见、可操作的结果，不得命名为产品里程碑。
- 构建、签名、公证、CI、Schema、Manifest、重构和测试基建属于工程准备度，不得计入或替代用户功能进度。阶段汇报必须分列“用户功能进度”和“工程准备度”，默认先报用户功能进度。
- 新能力优先交付最小纵向闭环，再补强横向基础设施。连续开发超过 60 分钟仍未增加用户可验收能力时，必须停止扩张，执行偏航检查并向用户说明时间消耗、当前结果和下一步取舍。
- 单项前置工作超过 60 分钟，或同一阻塞连续失败两次，必须触发止损：暂停继续深挖，先汇报阻塞、替代路径和是否仍值得占用主线时间。
- 持续任务至少每 60 分钟汇报一次用户能力增量；提交数、测试数、代码量和内部里程碑完成度不能冒充产品进度。
- 产品完成声明必须附真人可执行验收步骤和结果。只有 mock、CI、脚本或文档通过时，只能声明对应工程门禁通过。
- 用户明确要求的最终能力尚未形成闭环时，阶段总结第一句必须直接说明“用户现在能做什么、还不能做什么”，不得先用内部编号或加权百分比包装。

## 架构宪法与稳定基线

- `docs/architecture.md` 的“架构宪法”是所有方案、实现和评审的最高工程约束。
- `docs/stabilization.md` 定义的 S0-S4 已关闭，当前 `main` 是稳定基线。允许按模块受控开发新功能，但不得重新引入跨能力硬依赖、第二状态所有者、生命周期分叉、重复 IPC 契约或未经验证的权限扩张。
- 新功能开始实现前，必须明确能力边界、失败降级、状态所有者、生命周期、权限面、人工确认点、诊断方式和验证方式。
- 统一上下文操作遵守 `docs/features/context-action-system.md`；M1 完成前不得继续为新区域添加独立右键菜单实现。
- 需要违反架构宪法时，先在 `docs/decisions/` 提交 ADR；没有 ADR 不得把例外实现成新默认模式。
- `pnpm verify` 或受影响 smoke 未通过时，不得宣称功能完成或可交付。
- 即使工程门禁全部通过，只要产品文档定义的用户端到端验收未通过，也不得宣称产品能力完成。

## 产品定位

**CCLink Studio 是 CCLink 唯一的 GPL-3.0-only 桌面 App。**

这个仓库提供可以从源码直接运行的完整桌面端：本地工作区、内嵌浏览器、Markdown 编辑、Agent 面板、Terminal、数据源查询、Android 真机连接，以及按需登录的 CCLink 托管远程入口。

用户心智和桌面产物都只有一个：启动 Studio 即可免登录使用全部本地能力；只有点击 CCLink 远程入口、使用托管远程服务时才要求登录。远程服务的授权与收费事实由 CCLink 云服务强制执行，桌面 entitlement 只能做 UI 提示，不能成为安全边界。

## 项目边界

| 位置                                            | 角色                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/Users/apple/Desktop/cclink-dev/cclink-studio` | 唯一桌面 App 与最终装配入口；GPL-3.0-only，拥有本地工作台及可选 CCLink 远程客户端。         |
| `/Users/apple/Desktop/cclink-dev`               | 迁移期只读参考与云端/发布运维工作区；旧 `commercial` overlay 在 Studio 真实验收后停止出包。 |
| `/Users/apple/Desktop/chat-cc/deploy`           | CCLink 云函数与账号体系。                                                                   |
| `/Users/apple/Desktop/chat-cc/Agent`            | CCLink Agent runtime。                                                                      |

不存在额外拆分出的云端或 Agent 独立项目。

## Studio 免费本地能力

- Electron + React + TypeScript 桌面工作台。
- VSCode 风格布局：Activity Bar、Sidebar、Workbench、Agent Panel、Status Bar。
- 内嵌浏览器和 Playwright 自动化。
- Markdown/Tiptap 编辑器和本地文件读写。
- 本地 Claude Code Agent 后端、MCP 工具系统和权限确认。
- 本地 Terminal，本地工作区和标签页恢复。
- 本地数据源只读查询，凭证只由用户本机配置和管理。
- Android 真机连接：只支持用户自有 USB 或 Wi-Fi ADB 真机。

以上能力全部免费且免登录。CCLink 配置缺失、未登录、token 失效、消息网络离线、远程 Agent 不兼容或云服务故障时，它们必须完整可用。

## Studio 内置的 CCLink 远程功能域

- 手机号登录、本地 Session 文件、token 刷新；
- CCLink 身份、设备状态、腾讯 IM transport、request/protocol router 与实时连接；
- `RemoteProvider`、远程项目选择、文件树与文件读取；
- 后续按纵向闭环逐步接入远程文件修改、远程 Agent 会话与远程 PTY。

该功能域只能拥有账号、设备连接、远程请求和远程会话事实。`RemoteWorkspaceRef`、Workspace、Tab、Workbench、项目条、`WorkspaceState`、RemoteProvider 契约、Terminal adapter 接入点、IPC schema、生命周期和诊断由 Studio 基础层统一拥有。

## 不迁移范围

- WebDAV sync；
- PricingPage、PaymentModal、ProBadge、套餐比较和桌面支付；
- 本地浏览器、编辑器等 Pro 门控；
- 商业层重复 updater、重复本地 Terminal、通用 orchestrator 以及 App、Settings、Sidebar、preload、main.css 整文件快照；
- AI 员工、商业模板和通用插件平台；
- Android SDK 下载、AVD 创建、模拟器启动或托管设备服务。

Agent runtime 继续由 `/Users/apple/Desktop/chat-cc/Agent` 现有 NPM 包发布；CCLink 云服务继续由 `/Users/apple/Desktop/chat-cc/deploy` 独立部署。本次不得修改或迁移两者。ADR 0009 取代 ADR 0004 中“双桌面制品长期并存”的前提。

## NO_SYSTEM_KEYCHAIN

- 禁止 `safeStorage`、`keytar`、Apple Keychain API、`security` 命令及任何系统凭证存储；
- 禁止读取或迁移历史钥匙串数据；旧密文只能隔离并要求重新登录；
- Session 使用 `userData` 下权限收紧的本地文件；refresh token 可持久化，access token、IM UserSig 和完整远程身份只驻留内存；
- 不执行 Developer ID 签名或 Apple 公证。

## 独立启动要求

- `pnpm dev` 必须能直接启动开发模式。
- `bash scripts/restart.sh restart` 必须能启动后台开发进程。
- 默认启动不得要求存在 `cclink-dev`、`chat-cc/deploy`、`chat-cc/Agent` 或 CCLink 服务配置。
- 找不到 `adb` 时，应用仍应启动，Android 能力降级为不可用。

## 技术栈

| 层级         | 技术                                   |
| ------------ | -------------------------------------- |
| 桌面框架     | Electron 43                            |
| 前端         | React 19 + TypeScript 5                |
| 构建         | electron-vite + Vite                   |
| 包管理       | pnpm                                   |
| 状态管理     | Zustand                                |
| 浏览器自动化 | Playwright over CDP                    |
| Android 连接 | @yume-chan/adb + scrcpy + agent-device |
| 文档编辑     | Tiptap/ProseMirror                     |
| MCP 工具     | @modelcontextprotocol/sdk              |
| Schema       | Zod                                    |
| 样式         | CSS variables + component CSS          |

## 项目结构

```text
cclink-studio/
├── docs/                  # 当前架构、开发和功能文档
├── scripts/               # 本地开发和本地打包脚本
├── src/
│   ├── main/              # Electron 主进程与本地服务
│   ├── preload/           # contextBridge 白名单 API
│   ├── renderer/          # React 工作台 UI
│   └── shared/            # 跨进程共享 contract
├── electron-builder.yml   # 开源本地打包配置，不包含官方发布源
└── package.json
```

## 开发规范

- 语言：TypeScript，严格模式。
- 命名：文件名 kebab-case，组件 PascalCase，函数/变量 camelCase。
- Electron 安全：禁用 `nodeIntegration`，启用 `contextIsolation`。
- 文件读写：渲染进程不得直连 Node.js，统一通过主进程 IPC。
- Agent 后端：默认本机 Claude Code；官方 runtime 通过官方集成层接入。
- UI：遵循 VSCode 风格工作台精神，优先键盘、清晰状态、可审计操作。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify
bash scripts/restart.sh restart
bash scripts/restart.sh status
```

## 拷问重点

- 是否让登录页或远程初始化故障挡住了本地工作台？
- `preload` 是否只暴露有界、类型化、可信 renderer 校验后的远程 API，且不泄露 token/UserSig？
- CCLink 功能域是否复制了 Workspace、Tab、Terminal 或本地 Agent 状态？
- 缺配置、未登录、远程离线或协议不兼容时，本地项目、Agent、浏览器、编辑器、Terminal、数据源和 Android 是否仍可用？
- 收费是否由服务端真正强制；客户端是否误把开发模式或网络错误当作正式授权结论？
- 是否触碰了系统钥匙串或读取了历史密文？
- 文档是否只描述当前事实源，不再保留研发阶段已废弃的历史路线？
