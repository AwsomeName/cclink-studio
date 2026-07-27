# 内置 Claude Code 运行时 M0 证据

- 状态：technical-complete / legal-blocked
- 日期：2026-07-22
- 对应决策：`docs/decisions/0002-bundled-claude-code-runtime.md`

## 结论

M0 技术验证已经开始，公开分发门禁尚未关闭。

当前锁定 `@anthropic-ai/claude-agent-sdk@0.3.211`，平台包携带 Claude Code `2.1.211`。构建链从锁定平台包提取二进制，生成版本、架构、大小和 SHA-256 manifest，并将运行时作为 Electron `extraResources` 放入真实文件系统，不从 `app.asar` 内直接启动。macOS 本地包把 `.app` 内资源作为只读校验源，首次使用 bundled runtime 时原子物化到 `userData/agent-runtime-cache/` 的版本化目录并复验，从应用包外执行，避免 ad-hoc 外层与上游签名内层的嵌套执行被系统终止。

Anthropic 平台包许可证指向其法律协议，没有在包内给出普通开源再分发授权。维护者仍需取得或记录适用于 CCLink Studio 开源安装包的再分发结论；结论不明确时不得公开携带或默认启用内置二进制。

## 已实现验证

- `node scripts/stage-claude-runtime.mjs`：为当前宿主架构生成并验证 staging 资源。
- `node scripts/stage-claude-runtime.mjs --arch arm64|x64|universal`：按目标架构 staging；缺少目标平台包时在打包前失败。
- `node scripts/stage-claude-runtime.mjs --verify-only`：重新校验现有 manifest、大小、SHA-256、执行权限和 `claude --version`。
- `electron-builder.yml`：将 `.agent-runtime-staging` 复制到 `resources/agent-runtime`。
- `scripts/package.sh`：在 electron-builder 之前执行目标架构 staging，失败即停止生成安装包。
- `scripts/package.sh`：DMG 与 ZIP 串行生成；打包完成后再次校验 `.app/Contents/Resources/agent-runtime`，并通过包外临时副本执行版本探测，包内资源不完整时拒绝交付。

2026-07-22 arm64 证据：

- Agent SDK：`0.3.211`。
- Claude Code：`2.1.211`。
- 原生可执行文件：`242445680` 字节。
- SHA-256：`5a728a76198b6eca7f3c7cdbff43bab44b77b48c2108f7a3107d889773382629`。
- staging 完整校验耗时：约 `0.69s`。
- `electron-builder --dir --arm64` 产物约 `1.0 GB`，其中 `agent-runtime` 约 `240 MB`。
- 包内 manifest、大小、SHA-256、执行权限和 `claude --version` 全部复验通过。

## 已实现运行时边界

- `ClaudeRuntimeManager` 是 bundled/system/custom 选择、探测、提交、状态和 generation 的主进程唯一所有者。
- bundled 缓存只由 `ClaudeRuntimeManager` 创建；目录按平台、架构、SDK 版本、Claude Code 版本和源 SHA-256 分区，损坏副本会被复验并重建。
- backend 只接收探测成功后的绝对路径，不再把空配置强制替换为 PATH 中的 `claude`。
- 设置保存前先探测候选；失败候选不覆盖当前生效运行时。
- 任一 conversation 运行中时拒绝切换运行时、模型、端点或凭证，新消息在配置事务期间也会被拒绝。
- 运行时、API 端点或模型兼容指纹随项目 conversation 快照持久化；重启或切换后不匹配时丢弃 SDK session ID，但保留本地消息历史。
- bundled 模式必须配置显式 API 凭证，拒绝借用 Claude Free/Pro/Max 订阅登录。
- 运行时失败只将 Agent 标记为 unavailable/failed，工作台其他能力继续启动。
- 设置页可选择来源、检测候选、应用配置并读取主进程真实状态。

## 尚未关闭

- 再分发许可的书面结论。
- 不依赖 Claude.ai Free/Pro/Max OAuth 的正式认证说明和真人验收。
- x64 平台包在 Apple Silicon 构建机上的确定性安装方式。
- x64、universal 两种真实安装包的 packaged runtime smoke。
- arm64、x64、universal 三种真实安装包的 API-key Agent query smoke。
- 安装包压缩后体积记录。

## M0 退出条件

只有 ADR M0 的全部验收标准通过，本文状态才能改为 `completed`。在此之前，后续代码可以建立非默认 runtime contract 和探测能力，但新安装默认值必须保持现状，公开安装包不能宣称内置 Agent 已可交付。
