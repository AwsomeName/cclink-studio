# ADR 0007：Studio 托管的 Claude Runtime

- 状态：accepted（M1/M2：arm64 安装、真实 Agent/MCP 使用与 App 替换复用已实现）
- 日期：2026-08-12
- 取代范围：ADR 0002 中“Claude Code 只能随完整 App 更新”的限制
- 保留范围：ADR 0002 的 selection、probe、generation、provenance、认证边界和会话兼容指纹

## 结论

Claude 执行文件作为 Runtime 组件安装到 Electron `userData`，不作为普通
JavaScript 插件加载，也不运行用户机器上的 npm CLI。Studio 从 npm 下载维护者
允许目录中的精确平台包，校验后解包到不可变版本目录，再交给
`ClaudeRuntimeManager` 探测和激活。

首个允许组合固定为：

- `@anthropic-ai/claude-agent-sdk@0.3.211`；
- Claude Runtime `2.1.211`；
- `@anthropic-ai/claude-code-darwin-arm64@2.1.211`；
- x64 包在取得 x64 真机验收结果和冻结二进制 SHA-256 后才能加入允许目录；
- managed Runtime 只使用用户明确配置的 API Key，不迁移或代理
  Claude Free/Pro/Max OAuth 凭证。

当前仓库没有可用的组件目录签名私钥，也没有第二个已验证兼容版本。
因此第一批使用随 App 发布的精确允许记录完成真实 npm 安装闭环；远程签名
目录和两个真实版本之间的更新仍是后续发布门禁，不得用 mock 宣称完成。

## 用户闭环

### 首次安装

1. Studio 先进入工作台并自动打开“组件管理”，不以联网下载阻断启动。
2. 页面分别显示当前 Runtime 来源/版本、限定版本和可用版本。
3. 用户点击“安装”后，Studio 下载、校验、解包和 probe；失败不改变当前
   selection。
4. 安装成功后用户明确应用 managed Runtime；有活动 Agent 任务时拒绝切换。
5. 配置 API Key 后，用户能在真实工作空间完成文件和 MCP 工具任务。

2026-08-12 已以 managed `2.1.211`、SDK `0.3.211` 和用户现有的国内兼容服务配置完成
真实验收：连接测试成功，Agent 在当前工作空间经 `editor_write` 写入文件并经
`editor_read` 读回。组件安装和切换未改写 Provider、API URL、模型或凭证。

### App 更新

macOS App 更新仍需要退出进程、替换 `.app` 并重新打开。managed Runtime、
设置、凭证和工作空间状态位于 `userData`，不因 `.app` 替换而重新安装。
新 App 启动时必须重新校验安装记录、文件哈希、平台、架构和 SDK 兼容性：

- 兼容时直接复用；
- 不兼容时只降级 Agent，提示安装新的限定版本；
- 不删除旧 Runtime，以便 App 或 Runtime 回退；
- 不影响 Browser、Editor、Terminal、Android 等其他能力。

## 状态所有权

| 状态                                                  | 唯一所有者                |
| ----------------------------------------------------- | ------------------------- |
| 远程/内置允许目录投影                                 | `ClaudeRuntimeCatalog`    |
| 已安装版本、安装记录和下载进度                        | `RuntimeComponentManager` |
| Claude selection、active runtime、generation 和 probe | `ClaudeRuntimeManager`    |
| 持久化的用户选择                                      | `SettingsService`         |
| API Key                                               | `CredentialService`       |
| Thread、Session、工具和权限事实                       | 现有 Agent/MCP 领域       |

renderer 只显示主进程投影并发送受校验命令，不拥有安装或激活事实。

## 安全与可恢复性

- 不接受用户输入的包名、tarball URL 或 `latest`。
- 不运行 npm CLI 或 `preinstall/install/postinstall`。
- 下载先写安装暂存目录，限制重定向、域名、大小和超时。
- 仅对传输中断类下载错误做有限重试；integrity、签名、版本和包结构错误不重试。
- 同时校验 npm integrity、允许记录 SHA-256、平台、架构、可执行权限和
  `claude --version`。
- 不接受 tar 路径越界、符号链接、设备文件或多个可执行候选。
- managed Runtime 启动时注入 `DISABLE_UPDATES=1`，禁止绕过 Studio 自更新。
- managed Runtime 使用 `runtime-components/.../config` 作为独立 `CLAUDE_CONFIG_DIR`，并清空
  继承的 OAuth token；即使本机 `~/.claude` 已登录，也只能使用 Studio 明确注入的 API Key。
- 新版本只在 probe 成功且无活动任务时提交；失败保持上一已知可用版本。
- 发布暂存目录前把同版本旧目录原子移到备份；最终校验失败立即恢复，进程中断则在
  下次启动先验证并恢复备份。
- 下载、签名、版本或协议失败可回滚 Runtime；认证、限流和普通网络错误不伪装成
  Runtime 回滚理由。

## 配置和会话迁移

- Provider、API URL、模型、权限模式、禁用工具、Agent 角色、工作空间和 UI 聊天历史
  保持在原所有者中，Runtime 安装不迁移它们。
- 既有 `system` 和 `custom` 选择不自动改为 `managed`。
- 安装器不修改、导入或删除用户 `~/.claude`。
- Runtime、SDK、Provider、模型或角色兼容指纹变化时，保留 UI 历史但不恢复旧
  Claude Session ID；新会话使用已有连续性快照。

## 发布和回收门禁

- 远程目录私钥只能存在于受保护的 OSS 发布环境，不进入仓库或 App。
- OSS 和商业版使用独立目录 URL、签名根和发布状态。
- 没有第二个真实兼容版本时，只能宣称“安装/修复”，不得宣称“独立更新”。
- 未关闭 Anthropic 授权、认证、品牌和真人 packaged query 门禁前，不得宣称
  公开发布完成。
- 当新 Claude 需要更新 Agent SDK 或宿主协议时，必须更新完整 App；Runtime 管理器
  不得动态更新已打包的 SDK 代码。

## 拷问

- 只允许 `2.1.211` 时，产品交付的是托管安装和修复，还不是独立更新。
- 把 Runtime 移出 `.app` 会减少完整 App 更新的重复传输，但会使首次 Agent 使用依赖
  网络下载；无网络时必须明确降级，不能阻断工作台。
- 不能因为聊天文字还在就声称 Claude 私有 Session 无损恢复。
- 最危险的失败不是下载失败，而是新 Runtime 与旧 SDK 协议不兼容却仍被激活；
  因此真实 SDK/MCP/权限 smoke 是发布门禁。
