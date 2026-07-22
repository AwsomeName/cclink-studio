# 内置 Claude Code 运行时实施记录

- 日期：2026-07-22
- ADR：`docs/decisions/0002-bundled-claude-code-runtime.md`
- 当前默认：`system`
- 公开发布：未批准

## 当前结论

技术主链已经在 macOS arm64 跑通：锁定平台包、staging、manifest、包内资源、主进程解析、设置迁移、候选探测、安全切换、认证限制和独立降级均已有实现及定向测试。

这不等于“内置 Agent 已可公开发布”。Anthropic 再分发许可、Intel/Universal 产物和真实 API-key query smoke 仍是硬门禁。因此默认值继续是 `system`，旧版非空 `claudeCodePath` 迁移为 `custom`；不能把 ADR 中的最终产品方向提前伪装成已交付事实。

## 里程碑状态

| 里程碑 | 状态 | 已有证据 | 未完成 |
| --- | --- | --- | --- |
| M0 许可与技术取证 | legal-blocked | arm64 manifest、hash、版本与 packaged resource smoke | 书面再分发结论 |
| M1 运行时契约与解析 | completed | shared contract、`ClaudeRuntimeManager`、结构化错误与定向测试 | 无 |
| M2 多架构打包 | arm64-completed | arm64 `.app` 包内复验；package 后置校验 | x64、Universal、压缩产物与 query smoke |
| M3 设置与迁移 | completed | 三来源设置、旧路径迁移、probe-before-commit、状态 UI | 真人设置页验收 |
| M4 生命周期与会话 | completed | 运行中拒绝切换、配置锁、原地恢复、兼容指纹持久化与恢复门禁 | 无 |
| M5 认证与诊断 | partial | bundled 强制 API key、能力四态、运行时状态 IPC、复制诊断含来源/版本/指纹前缀、provider 失败分类、设置页隔离连接测试 | packaged 真实 query 验收 |
| M6 发布与回滚 | blocked | system 默认和显式来源可回退 | 许可、跨架构、签名/公证由发布层完成 |

## 验证结果

```text
pnpm verify：通过（154 个测试文件、932 项测试）
pnpm verify:agent-runtime：通过
electron-vite build：通过
electron-builder --dir --arm64：通过
包内 runtime manifest/hash/version/X_OK：通过
```

设置页“测试连接”会从主进程读取系统加密存储中的 Key，并通过当前候选运行时发送一次无工具、单轮、最高 `$0.05` 的隔离请求。它不会读取、恢复或修改任何会话 Session；renderer 只能收到脱敏后的认证、模型、限流、网络、代理或 provider 失败分类。当前只承诺 Anthropic 兼容 API，OpenAI Compatible 格式会在请求前明确拒绝。

standalone smoke 和真人 packaged Agent query 仍必须在正式候选产物上执行。任何一项失败，不能把 M2、M5 或 M6 的状态改成 completed。

真实 query smoke 使用专用凭证，且不会借用本机 Claude 登录：

```bash
CCLINK_AGENT_SMOKE_API_KEY='...' pnpm smoke:agent-runtime

# 验证某个已解包 .app 中的 runtime
CCLINK_AGENT_SMOKE_API_KEY='...' pnpm smoke:agent-runtime -- \
  --runtime-root '/path/to/CCLink Studio.app/Contents/Resources/agent-runtime'
```

## 下一步最该做什么

1. 在 Intel runner 原生安装锁定依赖并生成 x64 产物，不在 arm64 机器伪造跨架构成功。
2. 使用明确 API key 在打包后的 app 内完成一次真实 query，并验证无 CLI 的干净机器能运行。
3. 获得再分发书面结论后，才通过单独变更把新安装默认值从 `system` 改为 `bundled`。
