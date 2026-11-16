import { resolve } from 'node:path'
import type { CodexPermissionFacts } from '../../../shared/codex-runtime'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function label(value: unknown, allowed: string[]): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (typeof value === 'string' && allowed.includes(value)) return value
  return `other:${Array.isArray(value) ? 'array' : typeof value}`
}

function flag(value: unknown): boolean | string {
  return typeof value === 'boolean' ? value : label(value, [])
}

/** A bounded projection, not raw config/RPC logging. No paths, IDs, prompts or tool URLs. */
export function codexPermissionFacts(
  value: Record<string, unknown>,
  cwd: string,
  requested = false,
): CodexPermissionFacts {
  const sandbox = record(value.sandbox)
  const config = record(value.config)
  const roots = requested ? config['sandbox_workspace_write.writable_roots'] : sandbox.writableRoots
  const runtimeRoots = value.runtimeWorkspaceRoots
  const matching = (paths: unknown): number =>
    Array.isArray(paths)
      ? paths.filter((path) => typeof path === 'string' && resolve(path) === resolve(cwd)).length
      : 0
  return {
    modelProvider: label(value.modelProvider, ['openai']),
    approvalPolicy: label(value.approvalPolicy, ['untrusted', 'on-failure', 'on-request', 'never']),
    approvalsReviewer: label(value.approvalsReviewer, ['user', 'guardian']),
    sandboxType: requested
      ? label(value.sandbox, ['workspace-write', 'read-only'])
      : label(sandbox.type, ['workspaceWrite', 'readOnly', 'dangerFullAccess', 'externalSandbox']),
    networkAccess: flag(
      requested ? config['sandbox_workspace_write.network_access'] : sandbox.networkAccess,
    ),
    writableRootsCount: Array.isArray(roots) ? roots.length : label(roots, []),
    writableRootsMatchingCwd: matching(roots),
    runtimeRootsCount: Array.isArray(runtimeRoots) ? runtimeRoots.length : label(runtimeRoots, []),
    runtimeRootsMatchingCwd: matching(runtimeRoots),
    excludeTmpdirEnvVar: flag(
      requested
        ? config['sandbox_workspace_write.exclude_tmpdir_env_var']
        : sandbox.excludeTmpdirEnvVar,
    ),
    excludeSlashTmp: flag(
      requested ? config['sandbox_workspace_write.exclude_slash_tmp'] : sandbox.excludeSlashTmp,
    ),
    cwdMatchesRequest: typeof value.cwd === 'string' && resolve(value.cwd) === resolve(cwd),
  }
}

/** These are the existing permission gate's conditions, shared with diagnostic reporting. */
export function codexPermissionMismatches(
  value: Record<string, unknown>,
  nativeToolsAllowed: boolean,
): string[] {
  const sandbox = record(value.sandbox)
  return [
    ...(value.approvalPolicy !== 'untrusted' ? ['approvalPolicy'] : []),
    ...(value.approvalsReviewer !== 'user' ? ['approvalsReviewer'] : []),
    ...(sandbox.type !== (nativeToolsAllowed ? 'workspaceWrite' : 'readOnly')
      ? ['sandbox.type']
      : []),
    ...(sandbox.networkAccess !== false ? ['sandbox.networkAccess'] : []),
    ...(Array.isArray(sandbox.writableRoots) && sandbox.writableRoots.length > 0
      ? ['sandbox.writableRoots']
      : []),
  ]
}
