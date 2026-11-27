# ADR 0028：停用 Codex ACP 运行时

- 状态：accepted（2026-11-28 用户确认停用）
- 取代 ADR 0012 中仍生效的 Codex ACP 运行时、独立 API Key 与 `codex-acp` 固定版本条款；ADR 0022 的原生 Codex 默认路径不变。

## 背景

ADR 0022 起新会话只提供原生 Codex（`codex app-server`）与 Claude Code，Codex ACP 只为旧会话保留：设置页里的兼容路径、单独保存的 OpenAI API Key、写死的 `codex-acp@1.3.0` 后端和一条探测脚本。它与原生 Codex 重复，却要求另一把密钥和另一套进程生命周期，继续保留只增加维护和安全面。

## 决策

- 不再启动 `codex-acp`：移除设置项、探测 IPC、后端装配、`smoke:acp-runtime` 脚本和 `@agentclientprotocol/codex-acp` 开发依赖。
- 历史上绑定 ACP 的会话照常打开、显示历史和诊断，但不能发送；运行时菜单允许切换到 Codex 或 Claude Code，从新的原生会话继续。不迁移、不续接旧 ACP Session。
- 已保存的 Codex ACP API Key 不再使用，也不能再保存新值；设置页在仍有旧密钥时提供"删除旧版 Codex ACP 的 API Key"，由用户自行删除。
- 保留 `@agentclientprotocol/sdk` 和现有 ACP 协议客户端代码，作为之后"经过验证的固定 ACP 运行时清单"（首个候选 Antigravity CLI `agy acp`）的基础。该清单需另立 ADR：每个运行时须先在本机验证权限请求、会话恢复与取消、登录探测和版本，再写入固定档案；不开放"填任意启动命令"。

## 用户验收

1. 设置页不再出现 Codex ACP 路径和"保存 API Key"；有旧密钥时只看到删除入口。
2. 新会话运行时菜单只有 Codex 与 Claude Code。
3. 打开一个历史 ACP 会话：能看到历史；发送被拦下并提示切换；切换到 Codex 后发送得到真实回复。
4. 无 ACP 会话的用户不受任何影响。

## 降级

切换后的会话从新的原生 Session 开始，不携带旧 ACP Session 的上下文；需要时用户可把历史内容复制进新消息。
