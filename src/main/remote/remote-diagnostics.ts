import type {
  RemoteAgentSessionDiagnosticSnapshot,
  RemoteDiagnosticCheck,
  RemoteDiagnosticEvent,
  RemoteDiagnosticReport,
  RemoteStatus,
} from '../../shared/remote-protocol'

export function buildRemoteDiagnosticReport(
  status: RemoteStatus,
  recentErrors: RemoteDiagnosticEvent[],
  agentSession?: RemoteAgentSessionDiagnosticSnapshot,
): RemoteDiagnosticReport {
  const connectionError = status.state === 'online' ? undefined : status.remoteError
  const capabilityError =
    status.remoteError?.layer === 'remote-agent' ||
    status.remoteError?.code === 'REMOTE_CAPABILITY_UNAVAILABLE' ||
    status.remoteError?.context?.operation === 'capability.probe'
      ? status.remoteError
      : undefined
  const checks: RemoteDiagnosticCheck[] = [
    {
      id: 'connection',
      label: '远端连接',
      status: status.state === 'online' ? 'pass' : 'fail',
      message:
        status.state === 'online'
          ? '远程设备在线'
          : (connectionError?.message ?? `当前状态：${status.state}`),
      ...(connectionError ? { remoteError: connectionError } : {}),
    },
    {
      id: 'protocol',
      label: '协议兼容性',
      status:
        status.compatibility === 'compatible'
          ? 'pass'
          : status.compatibility === 'upgrade-required'
            ? 'fail'
            : 'warn',
      message:
        status.compatibility === 'compatible'
          ? `协议 v${status.protocolVersion ?? '未知'} 可兼容`
          : status.compatibility === 'upgrade-required'
            ? `协议 v${status.protocolVersion ?? '未知'} 需要升级`
            : '尚未取得远端协议版本',
    },
    capability('file.read', '远程文件读取', status.capabilities.file.read),
    capability('file.write', '远程文件写入', status.capabilities.file.write),
    capability(
      'agent.session',
      '远程 Agent 会话',
      status.capabilities.agent.session,
      capabilityError,
    ),
    capability(
      'agent.stream',
      '远程 Agent 流式消息',
      status.capabilities.agent.stream,
      capabilityError,
    ),
    capability('shell.pty', '远程 PTY', status.capabilities.shell.pty),
  ]
  return {
    ref: status.ref,
    generatedAt: Date.now(),
    status,
    checks,
    recentErrors,
    ...(agentSession ? { agentSession } : {}),
  }
}

function capability(
  id: string,
  label: string,
  available: boolean,
  error?: RemoteStatus['remoteError'],
): RemoteDiagnosticCheck {
  return {
    id: `capability.${id}`,
    label,
    status: available ? 'pass' : 'warn',
    message: available ? '可用' : (error?.message ?? '远端未声明或当前不可用'),
    ...(!available && error ? { remoteError: error } : {}),
  }
}
