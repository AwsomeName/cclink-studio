# ADR 0010：Claude Runtime 按需安装与瘦桌面包

- 状态：accepted
- 日期：2026-08-13
- 取代范围：ADR 0002 中“Claude Code 可执行文件随 `.app` 分发”的打包决定
- 保留范围：ADR 0002/0007 的运行时选择、探测、权限、认证、会话兼容和完整性边界

## 问题

Claude Code 可执行文件展开约 231 MB、压缩后约 66 MB。ADR 0007 已经支持把同一固定版本
安装到 `userData`，继续随 `.app` 携带会产生重复存储，也无法让完整 App 更新真正减小。

## 决策

- Studio 的 DMG 和 `.app` 不再携带 `Contents/Resources/agent-runtime`。
- Claude Runtime `2.1.211` 由用户在“设置 > 组件管理”按需下载安装；本机已有 Claude
  仍可选择“系统安装”，自定义路径保持可用。
- 全新安装和组件引导版本升级后打开组件管理页，但不强迫联网、不阻断工作台。
- 历史 `bundled` 选择迁移为同版本 `managed` 选择；未安装时只降级 Agent，并保留
  Browser、Editor、Terminal、工作空间和其他本地能力。
- 完整 App 更新继续保留 `userData` 中的 managed Runtime，不重新下载。
- 本地与正式打包门禁都必须拒绝重新出现 `agent-runtime` 目录。

## 不变量

- Agent SDK、主进程后端、MCP、权限和凭证系统仍随完整 App 更新。
- Runtime 只从维护者允许的精确包下载，不执行 npm CLI 或 lifecycle script。
- managed Runtime 仍要求用户显式配置 API Key，不读取或迁移 Claude 订阅凭证。
- Runtime 下载、校验或启动失败不能阻断核心工作台。

## 影响与取舍

- 本机正常压缩验收包由约 200 MB 降至 144 MB（十进制，Finder 显示约 134 MiB）；Electron
  自身仍构成约 110 MB 的压缩体积下限。
- 无系统 Claude 且离线的新用户不能立即使用 Agent，但仍可完整进入工作台，联网后从组件页安装。
- 保留 `bundled` 解析代码只用于旧配置与历史测试兼容，不构成发布包能力，也不在 UI 中提供选择。

## 验证

1. 打包后的 `.app` 不存在 `Contents/Resources/agent-runtime`。
2. 空白 `userData` 启动后工作台和组件管理页正常打开，Claude 行可安装。
3. 安装 managed Runtime 后完成真实探测；替换整个 `.app` 后继续复用且不重新下载。
4. 历史 `bundled` 设置持久化迁移为 managed `2.1.211`。
5. `pnpm verify`、Runtime UI smoke 和 packaged replacement smoke 通过。
