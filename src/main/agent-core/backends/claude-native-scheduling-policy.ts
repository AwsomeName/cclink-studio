import { lstat, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import policyManifest from './claude-native-scheduling-policy.json'

export const CLAUDE_NATIVE_SCHEDULING_TOOLS = Object.freeze([
  ...policyManifest.deniedTools,
]) as readonly string[]

export const CLAUDE_NATIVE_SCHEDULING_POLICY_VERSION = policyManifest.policyVersion

export const CLAUDE_NATIVE_SCHEDULING_POLICY_STATUS = Object.freeze({
  enforced: true,
  policyVersion: CLAUDE_NATIVE_SCHEDULING_POLICY_VERSION,
  deniedToolCount: CLAUDE_NATIVE_SCHEDULING_TOOLS.length,
  loopSkillDisabled: true,
  sdkSkillOverride: 'off' as const,
  preToolUseGuard: true,
})

const NATIVE_SCHEDULING_TOOL_SET = new Set(CLAUDE_NATIVE_SCHEDULING_TOOLS)
const FILE_MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const STUDIO_FILE_MUTATION_TOOLS = [
  'editor_write',
  'editor_append',
  'editor_insert',
  'editor_save',
] as const
const FILE_TARGET_KEYS = new Set(['file_path', 'filePath', 'notebook_path', 'notebookPath', 'path'])
const SHELL_TOOLS = new Set(['Bash', 'Shell'])
const SHELL_WRAPPERS = new Set(['bash', 'zsh', 'sh', 'pwsh', 'powershell', 'powershell.exe'])
const SYSTEM_SCHEDULER_EXECUTABLES = new Set([
  'at',
  'at.exe',
  'batch',
  'crontab',
  'launchctl',
  'schtasks',
  'schtasks.exe',
  'register-scheduledtask',
  'new-scheduledtask',
])

export type NativeSchedulingDenialCode =
  | 'NATIVE_SCHEDULING_TOOL_BLOCKED'
  | 'NATIVE_SCHEDULING_SKILL_BLOCKED'
  | 'NATIVE_SCHEDULING_FILE_BLOCKED'
  | 'UNBOUND_EDITOR_MUTATION_BLOCKED'
  | 'SYSTEM_SCHEDULER_COMMAND_BLOCKED'

export interface NativeSchedulingDenial {
  code: NativeSchedulingDenialCode
  reason: string
}

export function inspectNativeSchedulingToolUse(
  toolName: string,
  toolInput: unknown,
): NativeSchedulingDenial | null {
  if (NATIVE_SCHEDULING_TOOL_SET.has(toolName)) {
    return denial(
      'NATIVE_SCHEDULING_TOOL_BLOCKED',
      'Claude 原生调度工具已禁用；请使用 CCLink Studio 的 scheduled_task_* 工具。',
    )
  }

  if (toolName === 'Skill' && isLoopSkillInput(toolInput)) {
    return denial(
      'NATIVE_SCHEDULING_SKILL_BLOCKED',
      'Claude 原生 /loop 已禁用；Studio 定时任务只能由 ScheduledTaskService 管理。',
    )
  }

  if (isFileMutationTool(toolName)) {
    const targets = collectFileTargets(toolInput)
    if (isStudioFileMutationTool(toolName) && targets.length === 0) {
      return denial(
        'UNBOUND_EDITOR_MUTATION_BLOCKED',
        '普通 Agent 不能对未显式绑定文件路径的编辑器草稿执行写入；请先保存文件并提供明确路径。',
      )
    }
    if (targets.some(isExternalSchedulingFile)) {
      return denial(
        'NATIVE_SCHEDULING_FILE_BLOCKED',
        '已阻止写入 Claude 或系统调度配置；Studio 定时任务不能通过文件工具绕过。',
      )
    }
  }

  if (SHELL_TOOLS.has(toolName)) {
    const command = getStringField(toolInput, 'command')
    if (command && isExternalSchedulerCommand(command)) {
      return denial(
        'SYSTEM_SCHEDULER_COMMAND_BLOCKED',
        '已阻止创建或调用系统、Claude 原生调度；请使用 Studio 定时任务界面和 scheduled_task_* 工具。',
      )
    }
  }

  return null
}

/**
 * 补充纯字符串策略无法识别的实际 symlink 目标。
 * 仅检查工具已经明确给出的文件路径或 shell 路径 token，不扫描整个工作空间。
 */
export async function inspectNativeSchedulingSymlinkToolUse(
  toolName: string,
  toolInput: unknown,
  workspaceRoot: string,
): Promise<NativeSchedulingDenial | null> {
  const targets = isFileMutationTool(toolName)
    ? collectFileTargets(toolInput)
    : SHELL_TOOLS.has(toolName)
      ? collectShellPathCandidates(getStringField(toolInput, 'command') ?? '')
      : []
  if (targets.length === 0) return null

  const root = resolve(workspaceRoot)
  for (const target of targets) {
    const candidate = isAbsolute(target) ? resolve(target) : resolve(root, target)
    const pathFromWorkspace = relative(root, candidate)
    if (pathFromWorkspace.startsWith('..') || isAbsolute(pathFromWorkspace)) continue
    try {
      const projectedTarget = await resolveProjectedSymlinkTarget(candidate)
      if (isExternalSchedulingFile(projectedTarget)) {
        return denial(
          'NATIVE_SCHEDULING_FILE_BLOCKED',
          '已阻止通过符号链接写入 Claude 或系统调度配置；Studio 定时任务不能通过文件别名绕过。',
        )
      }
    } catch {
      return denial(
        'NATIVE_SCHEDULING_FILE_BLOCKED',
        '无法安全验证文件别名的最终写入目标，Studio 已按调度边界拒绝本次写入。',
      )
    }
  }
  return null
}

function isStudioFileMutationTool(toolName: string): boolean {
  return STUDIO_FILE_MUTATION_TOOLS.some(
    (name) => toolName === name || toolName.endsWith(`__${name}`),
  )
}

function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOLS.has(toolName) || isStudioFileMutationTool(toolName)
}

function denial(code: NativeSchedulingDenialCode, message: string): NativeSchedulingDenial {
  return { code, reason: `${code}: ${message}` }
}

function isLoopSkillInput(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const record = input as Record<string, unknown>
  return [record.skill, record.name, record.command].some(
    (value) => typeof value === 'string' && /^\/?loop(?:\s|$)/i.test(value.trim()),
  )
}

function collectFileTargets(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) => {
    if (!FILE_TARGET_KEYS.has(key)) return []
    if (typeof value === 'string') return value.trim() ? [value.trim()] : []
    if (Array.isArray(value))
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    return []
  })
}

function isExternalSchedulingFile(rawPath: string): boolean {
  const path = normalizePolicyPath(rawPath)
  if (!path) return false
  return (
    /(?:^|\/)scheduled_tasks\.json$/.test(path) ||
    /(?:^|\/)library\/launchagents\/[^/]+\.plist$/.test(path) ||
    /(?:^|\/)\.config\/systemd\/user\/[^/]+\.timer$/.test(path) ||
    /(?:^|\/)etc\/systemd\/(?:system|user)\/[^/]+\.timer$/.test(path) ||
    /(?:^|\/)etc\/(?:crontab|cron\.(?:d|daily|hourly|monthly|weekly))(?:\/|$)/.test(path) ||
    /(?:^|\/)windows\/system32\/tasks(?:\/|$)/.test(path)
  )
}

function isExternalSchedulerCommand(command: string): boolean {
  const normalized = command.replaceAll('\\\n', ' ')
  if (containsExternalSchedulingPath(normalized)) return true

  return splitShellSegments(normalized).some((segment) => {
    const tokens = tokenizeShellSegment(segment)
    const executableIndex = findExecutableIndex(tokens)
    if (executableIndex === -1) return false
    const executable = executableName(tokens[executableIndex])
    const args = tokens
      .slice(executableIndex + 1)
      .join(' ')
      .toLowerCase()

    if (SYSTEM_SCHEDULER_EXECUTABLES.has(executable)) return true
    if (executable === 'systemctl') return /(?:list-timers|\.timer\b)/i.test(args)
    if (executable === 'systemd-run')
      return /--on-(?:active|boot|calendar|startup|unit-active)/i.test(args)
    if (SHELL_WRAPPERS.has(executable) && /(?:^|\s)-c(?:\s|$)/.test(args)) {
      const commandFlagIndex = tokens.findIndex(
        (token, index) => index > executableIndex && stripQuotes(token).toLowerCase() === '-c',
      )
      if (commandFlagIndex !== -1) {
        return isExternalSchedulerCommand(
          tokens
            .slice(commandFlagIndex + 1)
            .map(stripQuotes)
            .join(' '),
        )
      }
    }
    return false
  })
}

function containsExternalSchedulingPath(command: string): boolean {
  const normalized = command.replaceAll('\\', '/').toLowerCase()
  return (
    /(?:^|[^a-z0-9_.-])scheduled_tasks\.json(?:$|[^a-z0-9_.-])/u.test(normalized) ||
    /(?:^|[^a-z0-9_.-])(?:~\/|\/[^\s'"<>|;]*\/)?library\/launchagents\/[^\s'"<>|;]+\.plist\b/u.test(
      normalized,
    ) ||
    /(?:^|[^a-z0-9_.-])(?:~\/)?\.config\/systemd\/user\/[^\s'"<>|;]+\.timer\b/u.test(normalized) ||
    /\/etc\/systemd\/(?:system|user)\/[^\s'"<>|;]+\.timer\b/u.test(normalized) ||
    /\/etc\/(?:crontab|cron\.(?:d|daily|hourly|monthly|weekly))(?:\/|\b)/u.test(normalized) ||
    /windows\/system32\/tasks(?:\/|\b)/u.test(normalized)
  )
}

function collectShellPathCandidates(command: string): string[] {
  return splitShellSegments(command.replaceAll('\\\n', ' ')).flatMap((segment) =>
    tokenizeShellSegment(segment).flatMap((rawToken) => {
      const token = stripQuotes(rawToken)
        .replace(/^[<>]+/u, '')
        .replace(/[),]+$/u, '')
        .trim()
      if (!token || token.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)) return []
      return token.includes('/') || token.startsWith('.') ? [token] : []
    }),
  )
}

async function resolveProjectedSymlinkTarget(candidate: string, depth = 0): Promise<string> {
  if (depth > 16) throw new Error('符号链接层级过深')

  let resolvedParent: string
  try {
    resolvedParent = await realpath(dirname(candidate))
  } catch (error) {
    if (isMissingPathError(error)) return candidate
    throw error
  }
  const projected = resolve(resolvedParent, basename(candidate))

  try {
    const entry = await lstat(projected)
    if (!entry.isSymbolicLink()) return projected
    const linkTarget = await readlink(projected)
    return resolveProjectedSymlinkTarget(resolve(resolvedParent, linkTarget), depth + 1)
  } catch (error) {
    if (isMissingPathError(error)) return projected
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function normalizePolicyPath(rawPath: string): string {
  const segments: string[] = []
  for (const segment of rawPath.trim().replaceAll('\\', '/').toLowerCase().split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return segments.join('/')
}

function splitShellSegments(command: string): string[] {
  return command.split(/\r?\n|&&|\|\||[;|]/u).map((segment) => segment.trim())
}

function tokenizeShellSegment(segment: string): string[] {
  return segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []
}

function findExecutableIndex(tokens: string[]): number {
  let index = 0
  while (index < tokens.length) {
    const token = stripQuotes(tokens[index]).toLowerCase()
    if (token === 'sudo' || token === 'command' || token === 'builtin') {
      index += 1
      while (index < tokens.length && tokens[index].startsWith('-')) index += 1
      continue
    }
    if (token === 'env') {
      index += 1
      while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1
      continue
    }
    return index
  }
  return -1
}

function executableName(rawToken: string): string {
  return stripQuotes(rawToken).replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? ''
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function getStringField(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.slice(0, 100_000) : null
}
