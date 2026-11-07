import type {
  TerminalPermissionDecision,
  TerminalPermissionPolicy,
  TerminalPermissionRisk,
} from '../../shared/terminal'

const RISK_PRIORITY: Record<TerminalPermissionRisk, number> = {
  read: 0,
  network: 1,
  write: 2,
  destructive: 3,
  privileged: 4,
  unknown: 5,
}

const READ_COMMANDS = new Set([
  'cat',
  'cd',
  'du',
  'echo',
  'env',
  'find',
  'git',
  'grep',
  'head',
  'ls',
  'pwd',
  'tail',
  'tree',
  'wc',
  'which',
  'whoami',
])

const NETWORK_COMMANDS = new Set([
  'curl',
  'dig',
  'host',
  'nc',
  'netcat',
  'ping',
  'rsync',
  'scp',
  'sftp',
  'ssh',
  'telnet',
  'wget',
])

const WRITE_COMMANDS = new Set([
  'brew',
  'cp',
  'gem',
  'go',
  'mkdir',
  'mv',
  'npm',
  'pip',
  'pip3',
  'pnpm',
  'python',
  'python3',
  'touch',
  'yarn',
])

const DESTRUCTIVE_COMMANDS = new Set([
  'dd',
  'docker',
  'dropdb',
  'kill',
  'killall',
  'mkfs',
  'pkill',
  'reboot',
  'rm',
  'rmdir',
  'shutdown',
  'truncate',
])

const PRIVILEGED_COMMANDS = new Set([
  'chmod',
  'chown',
  'launchctl',
  'security',
  'su',
  'sudo',
  'systemctl',
])

const SAFE_GIT_SUBCOMMANDS = new Set(['branch', 'diff', 'log', 'show', 'status'])
const WRITE_GIT_SUBCOMMANDS = new Set([
  'add',
  'apply',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'merge',
  'pull',
  'push',
  'rebase',
  'reset',
  'restore',
  'switch',
])
const PACKAGE_INSTALL_ARGS = new Set([
  'add',
  'install',
  'i',
  'remove',
  'rm',
  'uninstall',
  'update',
  'upgrade',
])

export function classifyTerminalCommand(command: string): TerminalPermissionRisk {
  // 简化分类器不能证明复合脚本、替换及多行命令只读，交给现有 unknown 确认路径。
  if (/[\r\n`]|\$[({]|[<>]\(/u.test(command)) return 'unknown'
  const segments = splitCommandSegments(command)
  if (segments.length === 0) return 'unknown'
  return segments.map(classifyCommandSegment).reduce(highestRisk, 'read')
}

export function evaluateTerminalPermission(
  command: string,
  policy: TerminalPermissionPolicy,
): TerminalPermissionDecision {
  const normalized = normalizeCommand(command)
  if (!normalized) {
    return { action: 'deny', risk: 'unknown', reason: '空命令不能执行' }
  }

  const deniedRule = findMatchingRule(normalized, policy.denylist)
  if (deniedRule) {
    return {
      action: 'deny',
      risk: classifyTerminalCommand(command),
      reason: '命令命中 Terminal denylist',
      matchedRule: deniedRule,
    }
  }

  const allowedRule = findMatchingRule(normalized, policy.allowlist)
  if (allowedRule) {
    return {
      action: 'allow',
      risk: classifyTerminalCommand(command),
      reason: '命令命中 Terminal allowlist',
      matchedRule: allowedRule,
    }
  }

  const risk = classifyTerminalCommand(command)

  switch (policy.mode) {
    case 'read-only':
      return risk === 'read'
        ? { action: 'allow', risk, reason: '只读命令允许执行' }
        : { action: 'deny', risk, reason: '当前 Terminal 为只读模式' }
    case 'ask-every-command':
      return { action: 'confirm', risk, reason: '当前策略要求每条命令确认' }
    case 'ask-risky-command':
      return policy.requireConfirmationFor.includes(risk) || risk === 'unknown'
        ? { action: 'confirm', risk, reason: '命令风险需要确认' }
        : { action: 'allow', risk, reason: '命令风险低于确认阈值' }
    case 'trusted-session':
      return risk === 'unknown'
        ? { action: 'confirm', risk, reason: '未知命令仍需确认' }
        : { action: 'allow', risk, reason: '可信 Terminal 会话允许执行' }
  }
}

function classifyCommandSegment(segment: string): TerminalPermissionRisk {
  const tokens = tokenizeShellSegment(segment)
  if (tokens.length === 0) return 'unknown'
  if (hasWriteRedirection(segment)) return 'write'
  const commandIndex = firstExecutableTokenIndex(tokens)
  if (commandIndex === -1) return 'unknown'

  const executable = basename(tokens[commandIndex])
  const args = tokens.slice(commandIndex + 1)

  if (executable === 'sudo' || executable === 'su') return 'privileged'
  if (PRIVILEGED_COMMANDS.has(executable)) return 'privileged'
  if (DESTRUCTIVE_COMMANDS.has(executable)) return 'destructive'
  if (NETWORK_COMMANDS.has(executable)) return 'network'

  if (executable === 'git') return classifyGit(args)
  if (isPackageManager(executable)) return classifyPackageCommand(args)
  if (WRITE_COMMANDS.has(executable)) return 'write'
  if (READ_COMMANDS.has(executable)) return 'read'

  return 'unknown'
}

function classifyGit(args: string[]): TerminalPermissionRisk {
  const subcommand = args.find((arg) => !arg.startsWith('-'))
  if (!subcommand) return 'read'
  if (SAFE_GIT_SUBCOMMANDS.has(subcommand)) return 'read'
  if (WRITE_GIT_SUBCOMMANDS.has(subcommand)) return 'write'
  return 'unknown'
}

function classifyPackageCommand(args: string[]): TerminalPermissionRisk {
  return args.some((arg) => PACKAGE_INSTALL_ARGS.has(arg)) ? 'write' : 'unknown'
}

function isPackageManager(command: string): boolean {
  return ['brew', 'gem', 'go', 'npm', 'pip', 'pip3', 'pnpm', 'python', 'python3', 'yarn'].includes(
    command,
  )
}

function splitCommandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function tokenizeShellSegment(segment: string): string[] {
  const matches = segment.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? []
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ''))
}

function firstExecutableTokenIndex(tokens: string[]): number {
  return tokens.findIndex(
    (token) => !isEnvironmentAssignment(token) && token !== 'time' && token !== 'command',
  )
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)
}

function hasWriteRedirection(command: string): boolean {
  return /(^|\s)(>|>>|2>|&>|tee)(\s|$)/.test(command)
}

function basename(command: string): string {
  return command.split('/').pop()?.toLowerCase() ?? command.toLowerCase()
}

function highestRisk(a: TerminalPermissionRisk, b: TerminalPermissionRisk): TerminalPermissionRisk {
  return RISK_PRIORITY[a] >= RISK_PRIORITY[b] ? a : b
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function findMatchingRule(command: string, rules?: string[]): string | null {
  if (!rules) return null
  for (const rule of rules) {
    const normalizedRule = normalizeCommand(rule)
    if (!normalizedRule) continue
    if (command === normalizedRule || command.startsWith(`${normalizedRule} `))
      return normalizedRule
  }
  return null
}
