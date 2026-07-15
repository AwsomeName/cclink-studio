# CCLink Studio 边界与迁移复查

> 状态：商业模块第一轮断链后的复查清单
> 最后更新：2026-07-15

## 结论

`cclink-studio` 现在应被视为 **CCLink 的开源桌面工作台壳**。它可以从源码独立运行，默认路径不应加载登录、订阅、云同步、CCLink/TIM、远程工作区或官方发布链路。

当前不存在独立的 `cclink-cloud` / `cclink-agent` 项目。真实边界如下：

- `cclink-studio`：开源桌面壳。
- `cclink-dev`：闭源官方构建工作区，承接 release overlay、签名、公证、生产 API 注入、多仓库集成脚本。
- `/Users/apple/Desktop/chat-cc/deploy`：CCLink 云函数和账号体系。
- `/Users/apple/Desktop/chat-cc/Agent`：CCLink Agent runtime。
- `private-serv`：废弃旧项目，不再作为未来架构目标。

## 本轮已迁出/断链的商业路径

- 主进程：`auth`、`subscription`、`sync`、`cclink`、`remote`、`private-service-config`、商业 IPC、商业 terminal adapter。
- Renderer：登录页、订阅页、同步面板、CCLink 面板、远程文件树、远程会话侧栏、相关 stores/utils。
- Shared：`auth/subscription/sync/cclink/remote` IPC contract、`chatcc`、`remote-*`、`sync-types`。
- 发布：`scripts/upload-cos.mjs` 已删除；`scripts/package.sh` 只保留本地打包；`electron-builder.yml` 不再配置默认发布源。
- 依赖：默认开源依赖已移除 TIM、WebDAV、COS、QRCode 相关包。

## 当前保留的开源壳能力

| 能力 | 主要路径 | 边界说明 |
| ---- | -------- | -------- |
| 本地浏览器和 Playwright 自动化 | `src/main/browser/`, `src/main/playwright/`, `src/main/mcp/modules/browser/` | 本地桌面能力，不依赖官方云。 |
| 本地文档编辑和微信 HTML 转换 | `src/main/editor/`, `src/main/wechat/`, `src/main/mcp/modules/editor/` | 本地内容处理能力。 |
| 本地 Agent 客户端壳 | `src/main/agent-core/`, `src/main/mcp/` | 用户自配本机或自有模型后端。 |
| 本地项目/文件工作区 | `src/main/fs/`, `src/main/workspace/`, renderer stores | 负责本地文件、最近项目和 workspace state。 |
| 本地 Terminal | `src/main/terminal/`, `src/main/ipc/terminal-ipc.ts` | 使用中性 `executionError`，不依赖 remote error model。 |
| 数据源只读查询 | `src/main/data-source/` | 本地保存用户自有数据源配置。 |
| Android 真机连接 | `src/main/android/`, `src/main/mcp/modules/android/` | 保留本地设备能力，不默认承接商业云手机。 |

## 仍需显式保留的兼容名

这些名称不是当前产品心智，但暂时不能机械替换：

- `window.deepink`：preload API 兼容面。
- `appId: com.deepink.app`：macOS app identity 迁移风险高。
- userData 固定目录 `DeepInk`：已有用户本地状态迁移依赖它。
- `deepink-*` localStorage key：历史 renderer 状态迁移依赖它。
- `deepink-agent`：Agent backend 枚举和历史 conversation snapshot 仍在使用。
- `cclink` / `remote-file` tab 类型：历史 workspace snapshot 恢复需要识别并降级。

后续若要改这些名称，必须先写迁移方案和测试，不能做全文替换。

## 迁移后复查项

### 必须为 0 的默认路径残留

- `window.deepink.auth`
- `window.deepink.subscription`
- `window.deepink.sync`
- `window.deepink.cclink`
- `window.deepink.remote`
- `@shared/ipc/auth`
- `@shared/ipc/subscription`
- `@shared/ipc/sync`
- `@shared/ipc/cclink`
- `@shared/ipc/remote`
- `@shared/chatcc`
- `private-service-config`
- `remote-error` / `RemoteError` / `REMOTE_ERROR_CODE`
- `upload-cos` / `COS_*`
- `@tencentcloud/chat`
- `webdav`
- `cos-nodejs-sdk-v5`

### 可以存在但需要说明的残留

- `DeepInk`：只允许出现在兼容路径、历史测试 fixture、待清理历史文档，或下一轮明确列出的用户可见遗漏中。
- `deepink`：只允许出现在 `window.deepink`、旧 localStorage key、旧路径 fixture、`deepink-agent` 枚举、兼容 env var。
- `remote` / `cclink`：只允许作为历史 snapshot 降级、协议文档或未来商业 overlay 接入点，不允许在开源壳默认路径调用已迁走实现。

## 后续清理阶段

1. **文档事实源清理**：README、AGENTS、边界文档已经是当前事实源；其他历史 docs 后续按模块逐步改写或标记为历史规划。
2. **用户可见命名清理**：窗口标题、加载页、诊断报告、Agent welcome、错误页、脚本提示统一为 CCLink Studio。
3. **兼容迁移方案**：单独设计 `window.deepink`、`appId`、userData、localStorage、backend enum 的迁移。
4. **商业 overlay 接口**：由 `cclink-dev` 侧定义官方生产 API 注入、签名、公证和发布路径。

## /grilling

第一问：现在能不能宣布迁移完成？不能。只能说“开源壳默认路径已断开商业模块”。历史文档和兼容命名仍需分阶段处理。

第二问：为什么不把 `window.deepink` 立即改成 `window.cclinkStudio`？因为 preload API 是外部兼容面，直接替换会破坏 renderer、测试、插件和历史快照。必须先做双写/别名/迁移窗口。

第三问：为什么保留旧 `appId` 和 userData？因为 macOS identity 和本地状态目录影响已有用户数据、更新行为和权限缓存。没有迁移测试前不动。

第四问：下一次最容易漏什么？历史文档会继续把 private-serv、订阅、云同步和远程工作区描述成 Studio 内建能力；需要用扫描清单持续压住。
