# S1 安全边界库存

> 状态：S1 已完成。分支：`codex/stabilization-s1`。起始基线：`540b93e`。验证基线：`43dc9ac`。完成日期：2026-07-21。

## 结论

S1 的首要目标是切断不可信内容、密钥和高权限 IPC 之间的直接路径。本库存只记录可从当前代码验证的事实，不把测试绿色等同于安全边界完成。

## 威胁模型

- 本地 Markdown、HTML、SVG、下载文件和 Agent 输出均可能由不可信来源控制。
- 内嵌网页与认证网页不得获得主 renderer preload；主 renderer 即使发生内容注入，也应被 Chromium sandbox、CSP 和主进程 IPC 校验共同限制。
- API Key、token 和密码不得明文落盘，不得进入 renderer 全量状态、普通日志或诊断报告。
- 任何可读写文件、执行命令、控制浏览器或设备的 IPC 都必须校验调用者、参数结构和资源作用域。

## 当前库存

| 边界 | 当前事实 | 风险 | 状态 |
| --- | --- | --- | --- |
| 微信 HTML 预览 | 原实现允许 Markdown 原始 HTML，并通过 `dangerouslySetInnerHTML` 注入拥有 preload 的主 renderer | 恶意文档可尝试在高权限页面执行脚本 | S1.1 已修复：禁用原始 HTML，改用零权限 sandbox iframe，并增加 iframe 内 CSP |
| 主 renderer | `contextIsolation: true`、`nodeIntegration: false`；S1.1 前 `sandbox: false` | renderer 被攻破后缺少 Chromium 进程沙箱 | S1.1 已改为 `sandbox: true`，S1.1-S1.3 完整 smoke 均通过 |
| 主 renderer CSP | 主进程按开发/生产入口为主文档注入响应头 CSP；生产脚本只允许 self，开发只额外允许 Vite inline refresh 和精确 HMR origin/WebSocket；禁止 `unsafe-eval` | 开发环境仍因 Vite refresh 保留 `unsafe-inline`，必须防止该例外进入生产策略 | S1.3 已修复；UI smoke 以被禁止的 `data:` 脚本验证策略真实生效 |
| Browser/Auth 视图 | 普通 WebContentsView、纯净窗口和认证子进程均启用 sandbox/context isolation，认证窗口无 preload/CDP | 边界已有实现，仍需保持回归门禁 | 已有 S0 smoke 与 H3 证据 |
| preload | 总入口从 769 行降至 179 行；Browser、Android、数据源、Agent、本地高权限操作和 renderer 支撑能力按所有者拆为 typed API | 通道名和运行时 schema 尚未由单一声明源生成 | S1.4b 已完成最小化；声明源统一属于 S3 |
| IPC sender | 统一 guard 要求调用方为当前主窗口 WebContents、主 frame 且 URL 仍处于受信任 renderer 入口；所有 renderer handler/listener 已接入，官方集成只能取得同一 trusted registrar | `ipc-cleanup` 仍手工维护清理清单 | S1.4b 已关闭裸注册；生命周期与清理清单统一属于 S3 |
| IPC schema/scope | 高权限输入均使用严格有界 schema；路径写入继续由领域服务执行真实工作区授权；Browser `file:` 只允许工作区内经 `realpath` 验证的 HTML 普通文件 | 本地 HTML 子资源继续依赖 Chromium 默认 `webSecurity`；IPC 单一声明源尚未形成 | S1.4b 已关闭已知 renderer 输入与顶层本地文件越权路径；契约生成属于 S3 |
| Agent API Key | 启动时迁移到独立 `safeStorage` 文件；公共设置快照固定返回空值，Agent 只从主进程运行时快照读取 | 迁移失败时旧明文仍暂时存在，但禁止覆盖且 UI 明确显示阻塞状态 | S1.2 已修复；保留迁移失败回归测试 |
| Meshy API Key | 与 Agent Key 共用加密凭证存储，Meshy 只从主进程运行时快照读取 | Linux `basic_text` 等非安全后端不得被误判为可用加密 | S1.2 已修复；拒绝非安全后端 |
| Git/Data source 凭证 | 已使用 Electron `safeStorage` 独立加密文件，普通配置只保留引用或是否已配置 | 已有正确模式，可复用 | 保持现有回归测试 |

## S1.1 不可信 HTML 隔离

实现边界：

- MarkdownIt 禁止原始 HTML；脚本、SVG、事件属性等输入只作为转义文本输出。
- 微信预览使用无 `allow-scripts`、无 `allow-same-origin`、无表单、无弹窗和无顶层导航权限的 iframe。
- iframe 文档增加 `default-src 'none'`、`base-uri 'none'`、`form-action 'none'`，只允许内联样式和受限图片来源。
- 保存 HTML 时转义文件名，避免文件名突破 `<title>`。
- 主 renderer 启用 Electron sandbox；preload 继续通过 contextBridge 提供显式 API。

验收：

- 恶意原始 HTML、事件属性和 `javascript:` Markdown 链接不能形成可执行标签。
- iframe 静态输出必须保留空 sandbox，不能加入 `allow-scripts` 或 `allow-same-origin`。
- `pnpm verify` 与 `pnpm smoke:standalone` 必须通过，确认 sandbox 没有破坏 preload 和本地能力。

结果：通过。`pnpm verify` 完成 111 个测试文件/726 项测试、typecheck 和生产构建；`pnpm smoke:standalone` 完成 local 9/9、UI 5/5、workflow 5/5、restore 4/4。

## S1.2 设置凭证隔离

实现边界：

- Agent 与 Meshy 密钥保存到 `{userData}/settings/secrets.enc`，使用 Electron `safeStorage` 加密，串行化并发变更，以独立临时文件原子替换并收紧为 `0600` 权限。
- 拒绝加密不可用以及 Linux `basic_text` 后端，不提供明文降级。
- `settings:getAll` 和 renderer Zustand store 永远只得到空密钥；renderer 只读取 `configured`、加密可用性和迁移阻塞状态。
- 密钥写入与清除使用独立 IPC；普通 `settings:set` 明确拒绝敏感字段。Agent 与 Meshy 只在主进程读取运行时设置。
- 启动发现旧版明文时，先成功写入加密存储，再删除 `settings.json` 中的敏感字段。迁移失败时继续在本次主进程内使用旧值，但禁止覆盖原设置文件，避免静默丢失。
- 重置全部设置或单项密钥时同步清除加密凭证；设置页不回显已有密钥，只允许替换或清除。

验收：

- 自动迁移后，公共设置和设置页均不含密钥原文，普通设置文件不再含敏感字段。
- 加密不可用时，旧设置文件字节不变，普通设置写入失败且内存状态不漂移。
- Linux `basic_text` 后端被拒绝；组件回归验证即使公共快照错误携带密钥也不会渲染。
- `pnpm verify` 完成 114 个测试文件/734 项测试、typecheck 和生产构建；`pnpm smoke:standalone` 完成 local 9/9、UI 5/5、workflow 5/5、restore 4/4。
- 1200 x 800 实际 renderer 截图确认 Agent 设置页无横向溢出，密钥说明与操作按钮无重叠或单字断行。

结果：通过。S1 尚未完成。

## S1.3 主 renderer 与首批高权限 IPC 边界

实现边界：

- 主窗口只允许保持在开发 renderer 同源或生产入口 `file:` 页面；拒绝跨源顶层导航和所有 `window.open`。
- 主文档 CSP 默认只信任自身。生产脚本禁止 inline 与 eval；开发仅为 Vite refresh 保留 inline，并把连接能力限制到当前 renderer origin 和同 host WebSocket。图片、媒体、worker、iframe 与 PDF 只开放当前功能需要的协议。
- 统一 trusted renderer guard 同时校验当前主窗口 WebContents、主 frame 和 renderer URL。即使其他窗口获得相同 preload，或主窗口被导航到非受信任地址，也不能调用已接入 handler。
- 设置 IPC 使用严格、有限长度和数值范围的 Zod schema；普通设置更新不能携带密钥，非法输入在持久化前拒绝。
- 文件 IPC 对路径、哈希、文本、图片资产和文档操作增加严格 schema、长度上限及 NUL 拒绝；真实路径访问仍由 FileService 的路径规则负责。
- Terminal IPC 复用既有命令、cwd、尺寸、sessionId 和工作区正规化，并在所有 handler 前增加同一 sender guard。窗口控制 IPC 同步接入。

验收：

- guard 回归覆盖错误 WebContents、子 frame、跨源页面和生产 `file:` 精确入口；handler 集成测试证明业务服务不会在拒绝前被调用。
- CSP 单元测试固定生产/开发差异且禁止 `unsafe-eval`；UI smoke 重载真实主文档，并证明策略会阻止不在 `script-src` 中的 `data:` 脚本。
- `pnpm verify` 完成 118 个测试文件/752 项测试、typecheck 与生产构建。
- `pnpm smoke:standalone` 完成 local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- 严格模式 `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window` 通过：Profile 的 Cookie/localStorage 跨进程保留，纯净窗口到达 Google 账号校验页。

结果：通过。S1 尚未完成。

## S1.4a Browser、Android 与数据源 renderer 边界

实现边界：

- trusted renderer guard 扩展到 `ipcMain.on` 单向事件；非可信 `workbench:bounds` 与 `scrcpy:touch` 在业务服务前丢弃并记录。
- Browser 全部 renderer handler 接入统一 sender guard。URL 只允许 `http:`、`https:`、`file:` 与精确 `about:blank`，拒绝 `javascript:`、`data:` 等协议；tab/profile/workspace、恢复历史、缩放、任务目标和下载 ID 均有长度或范围上限。
- Android 全部保留的 renderer handler 接入 guard；坐标、滑动时长、按键、文本、设备 ID、包过滤、APK 绝对路径和触摸事件均有运行时约束。撤销 renderer 未使用的任意 shell、文件推送和卸载入口。
- 数据源 renderer handler 接入 guard；Endpoint 只允许无明文 URL 凭证的 HTTP(S)，密钥、字段映射、超时、行数和查询体均有限制。查询必须是最大 1 MiB、深度不超过 64 的标准 JSON。撤销 renderer 未使用的更新、删除和单条记录入口。
- Meshy 服务与 Agent/MCP 能力继续留在主进程；renderer Meshy IPC 注册、preload 暴露和实现文件全部移除，避免复制同一高权限网络/写入面。
- Browser、Android 和数据源 preload 按能力拆分，仍保持现有 `window.cclinkStudio` 调用形状；新增实际加载 preload 的结构测试，固定窗口控制和核心能力存在，同时固定已退休入口不可见。

验收：

- schema 与 handler 集成回归覆盖不可信 sender、可执行 URL、异常 bounds、非法 APK 路径/触摸、数据源明文 URL 凭证、非 JSON/超大查询和 preload 暴露面。
- `pnpm verify` 完成 125 个测试文件/779 项测试、typecheck 与生产构建。
- `pnpm smoke:standalone` 完成 local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- 严格模式 `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window` 通过：Profile Cookie/localStorage 跨进程保留，纯净认证进程到达 Google 账号校验页，CDP 对照进程被判为不安全。

结果：通过。S1 尚未完成。

## S1.4b 剩余 renderer IPC 与资源授权

实现边界：

- Agent、项目运营、Git 备份、CAD/硬件、WorkspaceState、Dialog、Editor、Updater、Wechat、Identity 和 Official 全部接入 trusted renderer guard。WorkspaceState IPC 延后到主窗口和 guard 就绪后注册，不再在状态服务阶段裸注册。
- Agent 消息、连续性、资源、技能、会话/运行 ID、scope、确认、权限模式和外部 MCP 配置均有严格长度、数量、JSON 和 HTTP(S) 限制。撤销无人调用且缺少项目归属的旧 Playwright 执行/诊断 preload 与 IPC。
- 项目运营、Git、CAD/硬件和 WorkspaceState 对绝对路径、压缩包条目、凭证长度、发布记录、已知状态分区及最大 5 MiB 标准 JSON 做入口校验；领域服务继续负责允许根、工作区内路径和实际写入授权。
- Dialog、Editor 和 Wechat 对原生对话框参数、操作 ID、错误、编辑器响应和 Markdown 体积做有界校验。更新源只接受无凭证 HTTPS，清单下载地址必须同源。
- 官方集成不再取得 Electron 原始 `ipcMain`，只能通过 Studio 提供的 trusted registrar 注册 handler；OSS 主 preload 仍只暴露只读 `official.getStatus()`。
- BrowserManager 成为导航授权统一入口。`file:` 顶层导航只允许绑定工作区内真实存在的 `.html/.htm` 普通文件，使用 `realpath` 拒绝目录越界和符号链接逃逸；renderer、Agent、恢复历史和页面自身顶层跳转均经过该边界。
- preload 总入口缩减为 179 行，Agent、本地操作和 renderer 支撑能力独立成 typed 模块；结构测试固定 Meshy、Android raw 操作、数据源写入口和旧 Agent Playwright 入口不可见。

验收：

- 恶意回归覆盖不可信 sender、超大 Agent/Editor/WorkspaceState 输入、未知状态分区、非标准 JSON、MCP URL 明文凭证、相对路径、Gerber 路径穿越、Browser 本地文件越界与符号链接逃逸、更新源协议/同源约束和官方集成 registrar。
- `pnpm verify` 完成 132 个测试文件/803 项测试、OSS 边界、格式、lint、typecheck 与生产构建。真实 Git 进程集成测试使用 15 秒明确超时，避免与并行 Git 测试争用时随机触发 Vitest 5 秒默认值。
- `pnpm smoke:standalone` 完成 local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- 严格模式 `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window` 通过：Profile Cookie/localStorage 跨进程保留，纯净窗口到达 Google 账号校验页，CDP 对照进程被判为不安全。
- 首次 detached worktree 的 workflow smoke 发现 WorkspaceState 严格 JSON schema 会拒绝 renderer 正常状态中的 `undefined` 可选字段，导致项目切换和临时项目关闭失败。`43dc9ac` 在 renderer 持久化边界按 JSON 语义归一化状态，同时保留 main schema 对非标准、超限和恶意直接 IPC 输入的拒绝；新增回归后重新执行全部门禁。
- 从 `43dc9ac` 创建的全新 detached worktree 已通过 `pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm smoke:standalone` 和严格 Google 联网 `smoke:auth-window`，最终 `git status --short` 为空。
- GitHub Actions run `29795361173` 已绑定 `43dc9ac`，`verify` 与 `smoke` job 全部成功；CI smoke 覆盖 standalone 和确定性的认证 Profile/窗口机制，严格 Google 联网结果由本机及 detached worktree 保证。

结果：通过。S1 已关闭。

## 下一工作包

下一轮进入 S2 能力独立降级。先建立能力启动/失败矩阵，再处理 Agent 对 Browser、Android、Meshy、数据源和其他可选模块的初始化依赖；不得借机扩大功能面。IPC 声明源、清理清单和完整生命周期统一保留给 S3。
