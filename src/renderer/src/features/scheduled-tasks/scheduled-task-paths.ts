export function normalizeWorkspaceRelativePath(
  input: string,
  workspacePath: string,
  fieldLabel: string,
): string {
  const candidate = normalizeSeparators(input.trim())
  const workspace = trimTrailingSeparators(normalizeSeparators(workspacePath.trim()))
  if (!candidate) throw new Error(`${fieldLabel}不能为空`)

  if (isAbsolutePath(candidate)) {
    const comparableCandidate = comparablePath(candidate)
    const comparableWorkspace = comparablePath(workspace)
    if (comparableCandidate === comparableWorkspace) return '.'
    const workspacePrefix = `${comparableWorkspace}/`
    if (!comparableCandidate.startsWith(workspacePrefix)) {
      throw new Error(`${fieldLabel}必须位于当前工作空间内`)
    }
    return normalizeRelativeSegments(candidate.slice(workspace.length + 1), fieldLabel)
  }

  return normalizeRelativeSegments(candidate, fieldLabel)
}

function normalizeSeparators(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/{2,}/g, '/')
}

function trimTrailingSeparators(value: string): string {
  if (value === '/') return value
  return value.replace(/\/+$/, '')
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:\//.test(value)
}

function comparablePath(value: string): string {
  return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value
}

function normalizeRelativeSegments(value: string, fieldLabel: string): string {
  const segments = value.split('/').filter((segment) => segment && segment !== '.')
  if (segments.length === 0) return '.'
  if (segments.some((segment) => segment === '..' || segment.includes('\0'))) {
    throw new Error(`${fieldLabel}必须位于当前工作空间内`)
  }
  return segments.join('/')
}
