import { dirname, join, resolve } from 'node:path'

/**
 * Managed Runtime versions live below one catalog-controlled platform directory. Keep Claude's
 * own auth/config state beside those versions so it cannot borrow ~/.claude subscription state.
 */
export function managedClaudeIsolationEnvironment(executablePath: string): Record<string, string> {
  const versionRoot = dirname(resolve(executablePath))
  const platformRoot = dirname(versionRoot)
  return {
    CLAUDE_CONFIG_DIR: join(platformRoot, 'config'),
    CLAUDE_CODE_OAUTH_TOKEN: '',
  }
}
