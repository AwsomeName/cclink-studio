import type { RemoteError } from './remote-error'
import type { RemoteStatus } from './remote-protocol'

const PTY_UNAVAILABLE_MESSAGES: Readonly<Record<string, string>> = {
  node_pty_probe_pending: '远程 Agent 正在检查 PTY 启动能力，请稍后重试启动 Terminal',
  node_pty_external_not_installed: '远程 Agent 未安装独立的 node-pty 依赖',
  node_pty_external_version_unsupported: '远程 Agent 的 node-pty 版本不受支持',
  node_pty_external_abi_mismatch: '远程 Agent 的 node-pty 与当前 Node.js 版本不兼容',
  node_pty_disabled: '远程 Agent 已禁用 PTY',
  platform_unsupported: '远程 Agent 所在平台不支持持久 Terminal',
  manager_shutting_down: '远程 Agent 正在停止 PTY 服务',
}

/** Explain the existing capability decision without granting PTY capability. */
export function remoteTerminalUnavailableError(status: RemoteStatus): RemoteError | undefined {
  if (status.capabilities.shell.pty) return undefined
  if (status.state !== 'online' || status.remoteError?.context?.operation === 'capability.probe') {
    return status.remoteError
  }

  const response = status.capabilityProbe?.response
  const rawReason = response?.terminal_workspace_pty_reason
  // Agent data is untrusted and this message is also written into xterm. Only expose bounded
  // diagnostic codes, never arbitrary text, paths, credentials or terminal escape sequences.
  const reason =
    typeof rawReason === 'string' &&
    rawReason.length <= 160 &&
    /^(?:node_pty_[a-z0-9_]+(?::[A-Z0-9_:-]+)?|platform_unsupported|manager_shutting_down)$/.test(
      rawReason,
    )
      ? rawReason
      : ''
  const pending = reason === 'node_pty_probe_pending'
  const detail =
    (Object.hasOwn(PTY_UNAVAILABLE_MESSAGES, reason) && PTY_UNAVAILABLE_MESSAGES[reason]) ||
    (reason ? '远程 Agent 的 PTY 启动检查未通过' : '远程 Agent 未声明持久 Terminal 能力')
  const nextStep = pending
    ? ''
    : '；请在远程主机运行 chatcc doctor pty 查看原因和修复命令，处理后运行 chatcc restart，再重试启动 Terminal'
  return {
    layer: 'remote-agent',
    code: 'TERMINAL_PTY_UNAVAILABLE',
    message: `${detail}${reason ? `（${reason}）` : ''}${nextStep}`,
    retryable: pending || reason === 'manager_shutting_down',
    context: {
      endpointId: status.ref.endpointId,
      capability: 'shell.pty',
      ...(reason ? { reason } : {}),
    },
  }
}
