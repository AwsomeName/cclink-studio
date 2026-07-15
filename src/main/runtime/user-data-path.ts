import type { App } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const FIXED_USER_DATA_DIR_NAME = 'DeepInk'
const LEGACY_USER_DATA_DIR_NAMES = ['Electron', 'electron', 'deepink', 'DeepInk-dev', 'deepink-dev']
const MIGRATED_USER_DATA_FILES = [
  'settings.json',
  'workspace-state.json',
  'local-identity.json',
  'browser-snapshots.json',
  'browser-history.json',
  'browser-downloads.json',
  'mcp-servers.json',
  'terminal-sessions.json',
  'terminal-audit-log.json',
  'data-source/connections.json',
  'data-source/secrets.enc',
  'data-source/saved-queries.json',
  'data-source/audit-log.jsonl',
]

export interface UserDataMigrationCandidateResult {
  path: string
  migrated: string[]
  skippedExisting: string[]
  missing: string[]
  merged: string[]
  errors: string[]
}

export interface UserDataMigrationDiagnostics {
  fixedUserDataPath: string
  legacyUserDataPath: string
  candidates: UserDataMigrationCandidateResult[]
}

let lastMigrationDiagnostics: UserDataMigrationDiagnostics | null = null

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

function copyMissingLegacyEntries(fromDir: string, toDir: string): UserDataMigrationCandidateResult {
  const result: UserDataMigrationCandidateResult = {
    path: fromDir,
    migrated: [],
    skippedExisting: [],
    missing: [],
    merged: [],
    errors: [],
  }
  if (!existsSync(fromDir) || samePath(fromDir, toDir)) return result
  mkdirSync(toDir, { recursive: true })

  for (const entry of MIGRATED_USER_DATA_FILES) {
    const source = join(fromDir, entry)
    const target = join(toDir, entry)
    if (!existsSync(source)) {
      result.missing.push(entry)
      continue
    }
    if (existsSync(target)) {
      result.skippedExisting.push(entry)
      continue
    }
    try {
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      result.migrated.push(entry)
    } catch (error) {
      result.errors.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return result
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function writeJsonFile(path: string, value: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8')
}

function mergeLegacySettingsIfNeeded(fromDir: string, toDir: string): boolean {
  const sourcePath = join(fromDir, 'settings.json')
  const targetPath = join(toDir, 'settings.json')
  const source = readJsonFile(sourcePath)
  const target = readJsonFile(targetPath)
  if (!source || !target || samePath(sourcePath, targetPath)) return false

  const targetRecent = Array.isArray(target['recentWorkspacePaths'])
    ? target['recentWorkspacePaths']
    : []
  const sourceRecent = Array.isArray(source['recentWorkspacePaths'])
    ? source['recentWorkspacePaths']
    : []
  const targetLast = typeof target['lastWorkspacePath'] === 'string' ? target['lastWorkspacePath'] : ''
  const sourceLast = typeof source['lastWorkspacePath'] === 'string' ? source['lastWorkspacePath'] : ''
  const nextLast = targetLast || sourceLast
  const nextRecent = targetRecent.length > 0 ? targetRecent : sourceRecent
  if (nextLast === targetLast && nextRecent === targetRecent) return false

  writeJsonFile(targetPath, {
    ...target,
    lastWorkspacePath: nextLast,
    recentWorkspacePaths: nextRecent,
  })
  return true
}

function mergeLegacyWorkspaceStateIfNeeded(fromDir: string, toDir: string): boolean {
  const sourcePath = join(fromDir, 'workspace-state.json')
  const targetPath = join(toDir, 'workspace-state.json')
  const source = readJsonFile(sourcePath)
  const target = readJsonFile(targetPath)
  if (!source || !target || samePath(sourcePath, targetPath)) return false

  const sourceWorkspaces = source['workspaces']
  const targetWorkspaces = target['workspaces']
  if (
    !sourceWorkspaces ||
    typeof sourceWorkspaces !== 'object' ||
    Object.keys(sourceWorkspaces).length === 0 ||
    (targetWorkspaces && typeof targetWorkspaces === 'object' && Object.keys(targetWorkspaces).length > 0)
  ) {
    return false
  }

  writeJsonFile(targetPath, {
    ...target,
    workspaces: sourceWorkspaces,
  })
  return true
}

export function getUserDataMigrationDiagnostics(): UserDataMigrationDiagnostics | null {
  return lastMigrationDiagnostics
}

/**
 * 固定历史本机数据目录，避免 dev/package/appName 差异造成状态分裂。
 *
 * 必须在任何服务读取 app.getPath('userData') 前调用。
 */
export function configureFixedUserDataPath(app: App): string {
  const legacyUserDataPath = app.getPath('userData')
  const fixedUserDataPath = join(app.getPath('appData'), FIXED_USER_DATA_DIR_NAME)

  try {
    const legacyCandidates = [
      legacyUserDataPath,
      ...LEGACY_USER_DATA_DIR_NAMES.map((name) => join(app.getPath('appData'), name)),
    ]
    const candidateResults: UserDataMigrationCandidateResult[] = []
    for (const candidate of legacyCandidates) {
      const result = copyMissingLegacyEntries(candidate, fixedUserDataPath)
      if (mergeLegacySettingsIfNeeded(candidate, fixedUserDataPath)) {
        result.merged.push('settings.json')
      }
      if (mergeLegacyWorkspaceStateIfNeeded(candidate, fixedUserDataPath)) {
        result.merged.push('workspace-state.json')
      }
      candidateResults.push(result)
    }
    lastMigrationDiagnostics = {
      fixedUserDataPath,
      legacyUserDataPath,
      candidates: candidateResults,
    }
  } catch (error) {
    console.warn('[CCLink Studio] 迁移旧 userData 目录失败，将继续使用固定目录:', error)
    mkdirSync(fixedUserDataPath, { recursive: true })
    lastMigrationDiagnostics = {
      fixedUserDataPath,
      legacyUserDataPath,
      candidates: [{
        path: legacyUserDataPath,
        migrated: [],
        skippedExisting: [],
        missing: [],
        merged: [],
        errors: [error instanceof Error ? error.message : String(error)],
      }],
    }
  }

  app.setName(FIXED_USER_DATA_DIR_NAME)
  app.setPath('userData', fixedUserDataPath)
  return fixedUserDataPath
}
