# S1 安全边界库存

> 状态：S1 进行中，S1.1 与 S1.2 已完成。分支：`codex/stabilization-s1`。起始基线：`540b93e`。日期：2026-07-20。

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
| 主 renderer | `contextIsolation: true`、`nodeIntegration: false`；S1.1 前 `sandbox: false` | renderer 被攻破后缺少 Chromium 进程沙箱 | S1.1 已改为 `sandbox: true`，待完整 smoke 固化 |
| 主 renderer CSP | `src/renderer/index.html` 尚无 CSP，主窗口也未注入响应头 CSP | 内容和网络能力缺少第二层限制 | 待处理；必须兼容开发 HMR、blob worker、图片和本地预览 |
| Browser/Auth 视图 | 普通 WebContentsView、纯净窗口和认证子进程均启用 sandbox/context isolation，认证窗口无 preload/CDP | 边界已有实现，仍需保持回归门禁 | 已有 S0 smoke 与 H3 证据 |
| preload | `src/preload/index.ts` 约 769 行，向主 renderer 暴露浏览器、文件、Terminal、Agent、Android、数据源等多组高权限 API | 任一主 renderer 注入会获得较大攻击面 | 待按能力拆分并与 IPC contract 同源 |
| IPC sender | 只有少数窗口控制路径显式校验 `event.sender`；多数 handler 默认信任调用方 | 非预期 WebContents 若获得通道访问可能调用高权限能力 | 待建立统一 trusted sender guard |
| IPC schema/scope | 数据源等少数模块使用 Zod；文件、设置、Meshy 等大量 handler 仍接收普通 TS 参数 | 运行时类型、路径和工作区作用域可被绕过 | 待按风险从文件写入、设置、Terminal、设备开始补齐 |
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

## 下一工作包

S1.3 建立主 renderer CSP，并为高权限 IPC 引入统一 trusted sender guard 与运行时 schema。优先覆盖设置、文件写入和 Terminal 边界；必须证明开发 HMR、本地图片/worker、独立认证窗口和现有 preload 不被破坏，不得通过放宽 `unsafe-eval` 或全局信任所有 WebContents 取得表面通过。
