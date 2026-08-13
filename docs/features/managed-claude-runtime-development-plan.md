# Studio 托管 Claude Runtime 开发计划

> 状态：M1 已完成；M2 的同构建 `.app` 整包替换、配置/凭证保留和失败回滚已通过，真实
> 跨构建升级样本仍待补；M3/M4 被外部门禁阻塞。
> 最后更新：2026-08-13。
> 架构决策：[`0007-managed-claude-runtime.md`](../decisions/0007-managed-claude-runtime.md)。

## 当前用户能做什么

- 首次启动时自动打开“组件管理”。
- 查看当前 Claude Runtime 来源、已安装版本、限定版本和可用版本。
- 从 npm 官方 registry 安装固定的 managed Runtime `2.1.211`，安装过程显示进度。
- 检查本机安装完整性、修复损坏文件和卸载受管版本；修复失败保留上一健康版本。
- 在 Agent 设置中选择“Studio 管理版本”，探测通过后启用；没有 API Key 时拒绝启用。
- 使用已配置的国内兼容服务地址和模型，通过 managed Runtime 执行真实 Agent/MCP 任务。
- App 进程退出、整个 `.app` 被替换并重新启动后，直接复用 `userData` 中已校验的
  Runtime、设置和凭证。
- DMG 与 `.app` 不携带 Claude 可执行文件；首次需要时由用户从组件页按需安装。

Runtime 位于 `.app` 外的 `userData`；真实 packaged smoke 已执行同一构建的“安装、退出、删除并
替换 `.app`、重新打开”，确认 macOS 整包替换不会删除安装记录、普通设置或本地凭证。产物现在
内置 Git SHA 与工作树源码指纹，旧 `dist` 无法冒充当前源码。当前仍缺少两个不同 App 构建和
两个真实 Runtime 版本之间的更新/回滚样本，不能宣称 x64 或公开发布验收完成。

## 最终用户验收

### 首次安装闭环

1. 使用空白 `userData` 启动 Studio；PATH 中有无 `claude` 都不能影响 managed 安装。
2. Studio 正常打开工作台和“组件管理”，Claude 行显示限定/可用版本
   `2.1.211`。
3. 用户点击“安装”，看到下载、校验和安装进度。
4. 成功后显示“已安装 · Studio 管理 / 版本 2.1.211”，文件位于
   `userData/runtime-components`，不位于 `.app`。
5. 用户配置支持的 API Key，重启或安全切换后，在真实工作空间完成一次文件任务
   和一次 Studio MCP 工具调用。

### App 替换升级闭环

1. 在 App A 中安装并使用 managed `2.1.211`，保存 Provider、模型、权限、角色、
   工作空间和聊天历史。
2. 退出 App A，用 App B 替换 `.app` 并重新打开。
3. App B 不重新下载兼容的 Runtime，配置、凭证和 UI 历史保留。
4. 兼容指纹相同时恢复 Session；不同时保留 UI 历史并创建新 Session。
5. Runtime 不兼容或损坏只使 Agent 降级，其他工作台能力正常。

### 更新与回滚闭环

必须使用两个真实、与当前 Agent SDK 兼容且经过签名目录批准的 Claude 版本验收。
当前只冻结 `2.1.211`，因此该闭环尚未具备真实样本。

## 里程碑

| 里程碑                 | 类型                | 用户验收                                           | 退出门禁                                                                      |
| ---------------------- | ------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| M0 决策与样本冻结      | 工程准备            | 无新增能力                                         | ADR accepted；固定 SDK/Runtime/平台包、integrity、hash、认证与回滚规则        |
| M1 安装使用闭环        | 用户功能            | 真实 npm 安装 `2.1.211`，启用后完成文件和 MCP 任务 | 不使用 npm CLI/生命周期脚本；下载、校验、probe、激活和失败隔离通过            |
| M2 迁移与 App 更新复用 | 用户功能            | 替换 `.app` 后不重下载，配置、凭证、工具和聊天保留 | system/custom 不被自动改写；指纹不兼容时不伪恢复 Session                      |
| M3 真实更新与回滚      | 用户功能            | 在两个真实版本间更新，坏版本回退                   | 第二兼容版本和远程签名目录就绪；mock 不计产品完成                             |
| M4 发布验收            | 工程准备 + 用户门禁 | arm64/x64 真人安装、替换更新、断网和回退通过       | 授权/品牌结论、真实 API-key packaged query、`pnpm verify` 和受影响 smoke 通过 |

M1 的真实 npm 安装、付费模型文件/MCP 任务和 M2 的同构建 packaged `.app` 替换、配置/凭证
保留均已通过真实应用验收；跨构建升级仍需两个不同源码指纹的 App。M3 没有第二兼容 Runtime
版本，不得只按代码完成度关闭里程碑。

## 实施顺序

1. 建立 Claude 专用的最小目录、下载、校验和版本存储，不同时建设通用插件市场。
2. 扩展 shared contract、IPC 和 preload，renderer 只展示主进程事实。
3. 扩展 `ClaudeRuntimeManager` 支持 `managed`，沿用 probe-before-commit 和 generation。
4. 安装成功后在无活动 Agent 任务时激活；不安全时明确等待或重启。
5. 增加旧设置、App 替换、损坏记录、中断下载、错架构和会话兼容测试。
6. 在真实包和真实 API Key 环境完成最终验收。

## 当前硬阻塞

- Anthropic 再分发/产品使用的书面结论仍未归档。
- OSS 远程组件目录签名私钥和受保护发布流程尚未建立。
- 第二个与 Agent SDK `0.3.211` 兼容的真实 Claude 版本尚未冻结。
- x64 真机和真实 API-key packaged query 需要对应外部环境。

以上阻塞不影响 M1/M2 代码和本机 arm64 真实 npm 安装验收，但会阻止 M3/M4 被标记为
公开产品完成。

## 2026-08-12 验收记录

### 用户功能进度

- 空白隔离 `userData` 启动真实 Electron App，自动打开组件管理页：通过。
- Claude 行展示 `仅 2.1.211`、可用版本 `2.1.211` 和可点击“安装”：通过。
- UI 按钮经 preload/IPC 从 npm registry 下载真实 arm64 包并安装：通过。
- 安装后显示“已安装 · Studio 管理 / 版本 2.1.211”：通过。
- 退出 App、创建新的开发版 App 进程并复用同一隔离 `userData`，不重新下载：通过。
- 右侧 Agent 面板展开的 1440×920 窄工作区中，六列表格无需横向滚动：通过。
- 从空白隔离 `userData` 启动真实 packaged App，通过 UI 安装后退出，删除并重新复制
  同一构建的整个 `.app`，再次启动后不下载且安装记录逐字节不变：通过；该项不等同跨版本升级。
- App A 写入的模型/权限设置和隔离测试凭证在 App B 中保留；测试凭证随后清除：通过。
- managed selection 在 App B 中恢复为 active；通过 SDK 发起的无效 Key 请求得到预期
  `AUTHENTICATION_FAILED`，证明真实协议链路已启动且没有借用用户 OAuth：通过。
- 本机已有 managed `2.1.211` 激活后，使用用户现有的国内兼容服务配置和 `glm-5.2`
  执行连接测试：通过（2.13 秒，`$0.00074`）。
- 在当前真实工作空间中由 Agent 调用 `editor_write` 写入唯一验收标记，再调用
  `editor_read` 读回并返回同一标记：通过（21.20 秒，`$0.187108`）；验收文件已删除。
- 首次用未打开的 `/tmp` 目录构造隔离工作空间时，文件安全边界按设计拒绝写入；改用
  Studio 当前已打开的工作空间后通过。该负向样本证明工具不能越过当前工作空间写文件。

### 工程准备度

- npm SHA-512 integrity、二进制大小、SHA-256、macOS codesign 和
  `claude --version` 真实校验：通过。
- managed selection、设置持久化、会话兼容指纹、显式 API Key 门禁和禁用 Runtime
  自更新环境变量：通过自动化测试。
- 首次负向认证 smoke 曾发现 managed Runtime 仍会读取本机 `~/.claude`，使无效占位 Key
  意外完成一次计费请求（`$0.001143`）；现已改用独立 `CLAUDE_CONFIG_DIR` 并清空 OAuth
  token，重复 smoke 稳定返回认证失败。
- 暂存版本最终校验失败时恢复旧目录，进程在目录替换中断后从已验证备份恢复：通过。
- 网络下载瞬断最多重试三次，integrity/签名/内容错误不重试：通过。
- `pnpm verify`：通过（218 个测试文件、1280 个测试通过，真实网络烟测默认跳过 1 项）。
- arm64 本地 DMG 打包：通过；包内固定 Runtime 的版本和完整性校验通过。
- packaged App 首次启动曾发现 `tar-stream` 间接依赖未进入 asar；已将缺失运行依赖固定为
  直接依赖，并以 packaged 主入口加载和真实 UI smoke 复验：通过。

### 未通过/未执行

- 尚未在最终签名 packaged App 中使用真实 API Key 执行付费 query；当前 packaged smoke
  只验证隔离无效 Key 会稳定失败，因此该项仍是 M4 发布门禁。
- 没有第二个兼容 Runtime、远程目录签名私钥、x64 真机和授权书面结论；M3/M4 保持未完成。
