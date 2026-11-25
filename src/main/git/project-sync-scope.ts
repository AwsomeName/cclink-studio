import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PROJECT_SYNC_DELETION_LIMIT,
  PROJECT_SYNC_MAX_FILE_BYTES,
  type ProjectSyncPreview,
  type ProjectSyncSkippedFile,
} from '../../shared/git/project-sync'
import { findSensitiveFiles } from '../git-backup/git-backup-validation'
import {
  findForbiddenCclinkStudioPaths,
  updateCclinkStudioExcludeBlock,
} from './cclink-studio-path-policy'
import type { ScopedGit, SyncScope } from './sync-diary'

const BLOCK_START = '# BEGIN CCLink Studio project sync'
const BLOCK_END = '# END CCLink Studio project sync'

/** Regenerable or machine-local content never uploaded by project sync. */
export const PROJECT_SYNC_GENERATED_RULES = [
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '__pycache__/',
  '*.pyc',
  '.venv/',
  '.next/',
  '.nuxt/',
  '.turbo/',
  '.cache/',
  'dist/',
  'build/',
  '~$*',
]

/** Turns a repository-relative path into an anchored, literal ignore rule. */
export function literalIgnoreRule(path: string): string {
  const escaped = path.replace(/[\\*?[\]!#]/g, (c) => '\\' + c).replace(/ $/, '\\ ')
  return '/' + escaped
}

export function updateProjectSyncExcludeBlock(current: string, skipped: string[]): string {
  const block = [
    BLOCK_START,
    // Studio's block hides all of .cclink-studio; the project type travels with the project.
    '!/.cclink-studio/workspace-settings.json',
    '!/.cclink-studio/shared/company/',
    // Also written by WorkspaceStateService when it first sees `.git`; listing them here keeps
    // that one-time append from racing this block.
    '/.cclink-studio/project.json',
    '/.cclink-studio/state/',
    ...PROJECT_SYNC_GENERATED_RULES,
    ...skipped.map(literalIgnoreRule),
    BLOCK_END,
  ].join('\n')
  const withStudio = updateCclinkStudioExcludeBlock(current)
  const start = withStudio.indexOf(BLOCK_START)
  const end = withStudio.indexOf(BLOCK_END)
  if (start >= 0 && end >= start)
    return withStudio.slice(0, start) + block + withStudio.slice(end + BLOCK_END.length)
  return (withStudio.endsWith('\n') ? withStudio : withStudio + '\n') + block + '\n'
}

/**
 * The whole project minus large files, likely secrets, nested repositories, generated output and
 * Studio's machine-local state (ADR 0026). Skipped files are written to `.git/info/exclude` and
 * recomputed every round, so a file that shrinks or is renamed is picked up again.
 */
/** Sorts untracked candidates into skipped files; the rest are uploaded. */
export async function classifyUntracked(
  root: string,
  untracked: string[],
): Promise<ProjectSyncSkippedFile[]> {
  const skipped: ProjectSyncSkippedFile[] = []
  for (const path of untracked) {
    if (path.endsWith('/')) skipped.push({ path: path.slice(0, -1), reason: 'nested-repository' })
    else if (findSensitiveFiles([path]).length || findForbiddenCclinkStudioPaths([path]).length)
      skipped.push({ path, reason: 'sensitive' })
    else {
      const stat = await lstat(join(root, path)).catch(() => null)
      if (stat?.isFile() && stat.size > PROJECT_SYNC_MAX_FILE_BYTES)
        skipped.push({ path, reason: 'large', size: stat.size })
    }
  }
  return skipped
}

export function projectScope(
  root: string,
  hooks: Pick<SyncScope, 'beforeCommit' | 'afterUpdate' | 'describeRecordConflict'> = {},
): SyncScope {
  const excludeFile = join(root, '.git', 'info', 'exclude')
  const writeExcludes = async (skipped: string[]) => {
    const current = await readFile(excludeFile, 'utf8').catch(() => '')
    const next = updateProjectSyncExcludeBlock(current, skipped)
    if (next !== current) await writeFile(excludeFile, next, 'utf8')
  }
  const tooLarge = async (path: string) => {
    const stat = await lstat(join(root, path)).catch(() => null)
    return stat?.isFile() && stat.size > PROJECT_SYNC_MAX_FILE_BYTES ? stat.size : 0
  }
  return {
    noun: '项目',
    commitMessage: '同步项目',
    pathspecs: ['.'],
    shareable: (p) =>
      !findForbiddenCclinkStudioPaths([p]).length && !findSensitiveFiles([p]).length,
    textConflict: /\.(?:md|markdown|txt)$/i,
    deletionLimit: PROJECT_SYNC_DELETION_LIMIT,
    fileChoices: true,
    async prepare(git: ScopedGit) {
      await writeExcludes([])
      const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z']))
        .split('\0')
        .filter(Boolean)
      const skipped = await classifyUntracked(root, untracked)
      await writeExcludes(skipped.map((s) => s.path))
      return skipped
    },
    async checkChanged(paths) {
      const large: string[] = []
      for (const path of paths) if (await tooLarge(path)) large.push(path)
      if (large.length)
        throw Error(
          `已同步过的文件超过 50 MB，不能再上传：${large.slice(0, 3).join('、')}。请把它移出项目或缩小后继续同步。`,
        )
    },
    ...hooks,
  }
}

const PREVIEW_FILE_LIMIT = 20_000

/**
 * The upload list for 设置同步 and 同步范围, computed by Git with the same ignore rules and
 * classification a round uses. A folder without `.git` is inspected through a throwaway Git
 * directory so nothing is written into the project before the user confirms.
 */
export async function previewProjectFiles(
  root: string,
  run: (args: string[]) => Promise<string>,
  hasRepository: boolean,
): Promise<Omit<ProjectSyncPreview, 'workspacePath' | 'gitManaged'>> {
  // Read-only: the rules go to a throwaway file instead of the project's own exclude file, so a
  // preview never touches the skipped list the last round recorded.
  const temp = await mkdtemp(join(tmpdir(), 'studio-sync-preview-'))
  const rules = join(temp, 'exclude')
  await writeFile(rules, updateProjectSyncExcludeBlock('', []))
  let git = run
  if (!hasRepository) {
    await run(['init', '--quiet', join(temp, 'repo')])
    git = (args) => run(['--git-dir=' + join(temp, 'repo', '.git'), '--work-tree=' + root, ...args])
  }
  const excludes = ['--exclude-from=' + rules, '--exclude-per-directory=.gitignore']
  try {
    const listed = async (args: string[]) => (await git(args)).split('\0').filter(Boolean)
    const tracked = hasRepository ? await listed(['ls-files', '-z']) : []
    const untracked = await listed(['ls-files', '--others', ...excludes, '-z'])
    const skipped = await classifyUntracked(root, untracked)
    const left = new Set(skipped.map((s) => s.path))
    const generated = (
      await listed(['ls-files', '--others', '--ignored', ...excludes, '--directory', '-z'])
    )
      .filter((p) => !p.startsWith('.cclink-studio') && !left.has(p.replace(/\/$/, '')))
      .slice(0, 50)
    const files = [...tracked, ...untracked.filter((p) => !left.has(p) && !p.endsWith('/'))]
    const truncated = files.length > PREVIEW_FILE_LIMIT
    const groups = new Map<string, { files: number; bytes: number }>()
    let bytes = 0
    for (const path of files.slice(0, PREVIEW_FILE_LIMIT)) {
      if (path.startsWith('.cclink-studio/shared/company/')) continue
      const size = (await lstat(join(root, path)).catch(() => null))?.size ?? 0
      bytes += size
      const name = path.includes('/') ? path.slice(0, path.indexOf('/')) : ''
      const group = groups.get(name) ?? { files: 0, bytes: 0 }
      group.files++
      group.bytes += size
      groups.set(name, group)
    }
    return {
      files: files.filter((p) => !p.startsWith('.cclink-studio/shared/company/')).length,
      bytes,
      groups: [...groups]
        .map(([name, g]) => ({ name, ...g }))
        .sort((a, b) => b.files - a.files)
        .slice(0, 40),
      skipped: skipped.slice(0, 200),
      generated,
      truncated,
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

/** A repository project sync set up (or downloaded) carries its managed exclude block. */
export async function isProjectSyncRepository(root: string): Promise<boolean> {
  const exclude = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8').catch(() => '')
  return exclude.includes(BLOCK_START)
}

export async function markProjectSyncRepository(root: string): Promise<void> {
  const file = join(root, '.git', 'info', 'exclude')
  const current = await readFile(file, 'utf8').catch(() => '')
  await writeFile(file, updateProjectSyncExcludeBlock(current, []), 'utf8')
}
