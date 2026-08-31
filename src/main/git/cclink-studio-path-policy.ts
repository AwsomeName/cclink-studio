import { parseStoredScheduledTaskDefinition } from '../../shared/scheduled-task/scheduled-task-schema'

const SHARED_TASK_PATH_PATTERN =
  /^\.cclink-studio\/shared\/scheduled-tasks\/[0-9a-f]{8}-[0-9a-f-]{27,35}\.json$/i

export const CCLINK_STUDIO_EXCLUDE_START = '# BEGIN CCLink Studio managed excludes v2'
export const CCLINK_STUDIO_EXCLUDE_END = '# END CCLink Studio managed excludes v2'

const CCLINK_STUDIO_EXCLUDE_RULES = [
  '/.cclink-studio/*',
  '/.cclink-studio/scheduled-tasks/',
  '/.cclink-studio/scheduled-task-results/',
  '/.cclink-studio/scheduled-task-migrations/',
  '!/.cclink-studio/shared/',
  '/.cclink-studio/shared/*',
  '!/.cclink-studio/shared/scheduled-tasks/',
  '/.cclink-studio/shared/scheduled-tasks/*',
  '!/.cclink-studio/shared/scheduled-tasks/*.json',
]

interface GitPathPolicyRunner {
  run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }>
}

export function updateCclinkStudioExcludeBlock(current: string): string {
  const block = [
    CCLINK_STUDIO_EXCLUDE_START,
    ...CCLINK_STUDIO_EXCLUDE_RULES,
    CCLINK_STUDIO_EXCLUDE_END,
  ].join('\n')
  const migrated = removeLegacyStudioExcludeRules(current)
  const start = migrated.indexOf(CCLINK_STUDIO_EXCLUDE_START)
  const end = migrated.indexOf(CCLINK_STUDIO_EXCLUDE_END)
  if (start >= 0 && end >= start) {
    const after = end + CCLINK_STUDIO_EXCLUDE_END.length
    return `${migrated.slice(0, start)}${block}${migrated.slice(after)}`
  }
  const prefix = migrated && !migrated.endsWith('\n') ? `${migrated}\n` : migrated
  return `${prefix}${block}\n`
}

export function findForbiddenCclinkStudioPaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map(normalizeGitPath)
        .filter((path) => path === '.cclink-studio' || path.startsWith('.cclink-studio/'))
        .filter((path) => !SHARED_TASK_PATH_PATTERN.test(path)),
    ),
  ).slice(0, 20)
}

export async function inspectCclinkStudioIndex(
  runner: GitPathPolicyRunner,
  repositoryRoot: string,
): Promise<string[]> {
  const result = await runner.run(repositoryRoot, [
    'ls-files',
    '--cached',
    '-z',
    '--',
    '.cclink-studio',
  ])
  return findForbiddenCclinkStudioPaths(splitNullPaths(result.stdout))
}

export async function inspectSharedTaskIndexSecrets(
  runner: GitPathPolicyRunner,
  repositoryRoot: string,
): Promise<string[]> {
  const result = await runner.run(repositoryRoot, [
    'ls-files',
    '--cached',
    '-z',
    '--',
    '.cclink-studio/shared/scheduled-tasks',
  ])
  const paths = splitNullPaths(result.stdout).filter((path) => SHARED_TASK_PATH_PATTERN.test(path))
  if (paths.length > 200) return ['.cclink-studio/shared/scheduled-tasks/<too-many-files>']
  const sensitive: string[] = []
  for (const path of paths.slice(0, 200)) {
    const blob = await runner.run(repositoryRoot, ['show', `:${path}`])
    if (containsObviousSecretText(blob.stdout)) sensitive.push(path)
  }
  return sensitive.slice(0, 20)
}

export async function inspectSharedTaskIndexDefinitions(
  runner: GitPathPolicyRunner,
  repositoryRoot: string,
): Promise<string[]> {
  const result = await runner.run(repositoryRoot, [
    'ls-files',
    '--stage',
    '-z',
    '--',
    '.cclink-studio/shared/scheduled-tasks',
  ])
  const invalid: string[] = []
  const entries = result.stdout.split('\0').filter(Boolean)
  if (entries.length > 200) return ['.cclink-studio/shared/scheduled-tasks/<too-many-files>']
  for (const entry of entries) {
    const match = /^(\d+) [0-9a-f]+ (\d+)\t(.+)$/.exec(entry)
    if (!match) continue
    const [, mode, stage, path] = match
    if (!SHARED_TASK_PATH_PATTERN.test(path)) continue
    if ((mode !== '100644' && mode !== '100755') || stage !== '0') {
      invalid.push(path)
      continue
    }
    const blob = await runner.run(repositoryRoot, ['show', `:${path}`])
    if (!isValidSharedTaskDefinition(path, blob.stdout)) invalid.push(path)
  }
  return invalid.slice(0, 20)
}

export async function inspectCclinkStudioOutgoingHistory(
  runner: GitPathPolicyRunner,
  repositoryRoot: string,
  baseRef: string | null,
): Promise<string[]> {
  const revisionRange = baseRef ? `${baseRef}..HEAD` : 'HEAD'
  const result = await runner.run(repositoryRoot, [
    'log',
    '--format=',
    '--name-only',
    '-z',
    revisionRange,
    '--',
    '.cclink-studio',
  ])
  return findForbiddenCclinkStudioPaths(splitNullPaths(result.stdout))
}

export async function inspectSharedTaskOutgoingContent(
  runner: GitPathPolicyRunner,
  repositoryRoot: string,
  baseRef: string | null,
): Promise<{ invalid: string[]; sensitive: string[] }> {
  const revisionRange = baseRef ? `${baseRef}..HEAD` : 'HEAD'
  const commitsResult = await runner.run(repositoryRoot, ['rev-list', '--reverse', revisionRange])
  const commits = commitsResult.stdout.split(/\r?\n/).filter(Boolean)
  if (commits.length > 500) {
    return {
      invalid: ['.cclink-studio/shared/scheduled-tasks/<outgoing-history-too-large>'],
      sensitive: [],
    }
  }
  const invalid = new Set<string>()
  const sensitive = new Set<string>()
  for (const commit of commits) {
    const pathsResult = await runner.run(repositoryRoot, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      commit,
      '--',
      '.cclink-studio/shared/scheduled-tasks',
    ])
    for (const path of splitNullPaths(pathsResult.stdout).filter((candidate) =>
      SHARED_TASK_PATH_PATTERN.test(candidate),
    )) {
      let contents: string
      try {
        contents = (await runner.run(repositoryRoot, ['show', `${commit}:${path}`])).stdout
      } catch {
        continue
      }
      if (!isValidSharedTaskDefinition(path, contents)) invalid.add(path)
      if (containsObviousSecretText(contents)) sensitive.add(path)
    }
  }
  return { invalid: [...invalid].slice(0, 20), sensitive: [...sensitive].slice(0, 20) }
}

export async function resolveKnownRemoteBaseRef(
  runner: GitPathPolicyRunner,
  repositoryRoot: string,
  remote: string,
  branch: string,
): Promise<string | null> {
  const candidate = `refs/remotes/${remote}/${branch}`
  try {
    await runner.run(repositoryRoot, ['rev-parse', '--verify', candidate])
    return candidate
  } catch {
    return null
  }
}

export function containsObviousSecretText(value: string): boolean {
  return /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token)\s*[=:]\s*[^\s"']{6,}/i.test(
    value,
  )
}

function splitNullPaths(output: string): string[] {
  return output
    .split('\0')
    .map((path) => path.replace(/^\n+/, '').trim())
    .filter(Boolean)
}

function normalizeGitPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isValidSharedTaskDefinition(path: string, contents: string): boolean {
  if (Buffer.byteLength(contents, 'utf8') > 128 * 1024 || contents.includes('\0')) return false
  try {
    const parsed = parseStoredScheduledTaskDefinition(JSON.parse(contents))
    const taskId = path.slice(path.lastIndexOf('/') + 1, -5)
    return parsed.schemaVersion === 2 && parsed.id === taskId
  } catch {
    return false
  }
}

function removeLegacyStudioExcludeRules(current: string): string {
  const lines = current.split(/\r?\n/)
  const result: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '# CCLink Studio scheduled task data') {
      while (
        lines[index + 1] === '/.cclink-studio/scheduled-tasks/' ||
        lines[index + 1] === '/.cclink-studio/scheduled-task-results/'
      ) {
        index += 1
      }
      continue
    }
    if (line === '# CCLink Studio manual backup') {
      result.push(line)
      if (lines[index + 1] === '.cclink-studio/' || lines[index + 1] === '/.cclink-studio/') {
        index += 1
      }
      continue
    }
    result.push(line)
  }
  return result.join('\n')
}
