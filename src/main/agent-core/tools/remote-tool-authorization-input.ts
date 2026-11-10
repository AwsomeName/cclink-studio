import { posix, win32 } from 'node:path'
import type { RemoteToolAuthorizationInput } from './agent-tool-authorization-broker'

/** Evidence checks only; modes and deletion/termination policy remain in the broker. */
export function remoteToolConfirmationReason(input: RemoteToolAuthorizationInput): string | null {
  if (input.inputTruncated || hasTruncatedInput(input.params)) {
    return '远程工具参数已截断，无法完整判断影响，需要本次确认'
  }
  if (
    input.requiresExplicitApproval ||
    ['high', 'critical', 'destructive'].includes(input.riskLevel ?? '')
  ) {
    return '远程操作声明了额外确认要求，需要本次确认'
  }
  // ACP maps delete/move to Edit. Never classify these using the display name alone.
  if (input.toolKind === 'delete' || input.toolKind === 'move') {
    return '远程删除或移动操作需要本次确认'
  }
  if (input.toolKind && !['read', 'edit', 'search', 'fetch', 'execute'].includes(input.toolKind)) {
    return '远程操作类型无法可靠判断，需要本次确认'
  }
  const { params, toolName } = input
  if (params.edit_mode === 'delete') return '远程删除操作需要本次确认'
  if (
    toolName === 'Bash' &&
    (!posix.isAbsolute(input.workspacePath) ||
      /(?:^|[\s;&|])(?:powershell|pwsh|cmd)(?:\.exe)?(?:\s|$)/i.test(String(params.command ?? '')))
  ) {
    return '当前命令使用的远程 Shell 无法按现有规则判断风险，需要本次确认'
  }
  if (params.additionalPermissions || params.grantRoot || params.networkApprovalContext) {
    return '远程操作请求扩大权限，需要本次确认'
  }
  const fileTool = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)
  const target = params.file_path ?? params.notebook_path ?? params.path
  if (fileTool && (typeof target !== 'string' || !target.trim())) {
    return '远程文件操作缺少明确目标路径，需要本次确认'
  }
  for (const key of ['file_path', 'notebook_path', 'path', 'cwd']) {
    if (params[key] === undefined) continue
    if (typeof params[key] !== 'string' || !pathWithinWorkspace(input.workspacePath, params[key])) {
      return '远程操作目标超出当前工作空间或路径不明确，需要本次确认'
    }
  }
  // In particular, an ACP diff with missing old/new text may represent a deletion.
  if (toolName === 'Write' && typeof params.content !== 'string') {
    return '远程写入缺少完整内容，需要本次确认'
  }
  if (
    toolName === 'Edit' &&
    (typeof params.old_string !== 'string' || typeof params.new_string !== 'string')
  ) {
    return '远程编辑缺少完整变更内容，需要本次确认'
  }
  if (
    toolName === 'MultiEdit' &&
    (!Array.isArray(params.edits) ||
      !params.edits.length ||
      !params.edits.every(
        (edit) =>
          edit &&
          typeof edit === 'object' &&
          typeof edit.old_string === 'string' &&
          typeof edit.new_string === 'string',
      ))
  ) {
    return '远程批次编辑缺少完整变更内容，需要本次确认'
  }
  return null
}

function pathWithinWorkspace(root: string, target: string): boolean {
  const paths = win32.isAbsolute(root) && !posix.isAbsolute(root) ? win32 : posix
  if (!paths.isAbsolute(root) || !target.trim() || target.includes('\0') || target.startsWith('~'))
    return false
  if (
    paths === posix &&
    (target.includes('\\') || (win32.isAbsolute(target) && !posix.isAbsolute(target)))
  )
    return false
  const relative = paths.relative(root, paths.resolve(root, target))
  return (
    relative === '' ||
    (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`))
  )
}

function hasTruncatedInput(value: unknown, depth = 0): boolean {
  if (depth > 16) return true
  if (typeof value === 'string') return /\[truncated(?:\s|\])/.test(value)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(
    ([key, item]) =>
      (key.endsWith('_truncated') && item === true) || hasTruncatedInput(item, depth + 1),
  )
}
