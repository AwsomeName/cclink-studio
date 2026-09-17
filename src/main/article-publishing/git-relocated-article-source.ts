import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import type { ArticlePublishingState } from '../../shared/article-publishing/article-publishing-types'

const execFileAsync = promisify(execFile)

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function parseExactRenames(output: string): Array<{ from: string; to: string }> {
  const fields = output.split('\0').filter(Boolean)
  const renames: Array<{ from: string; to: string }> = []
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++]
    if (status === 'R100' && fields[index] && fields[index + 1]) {
      renames.push({ from: fields[index++], to: fields[index++] })
    } else {
      index += 1
    }
  }
  return renames
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  return result.stdout
}

async function hasExactRename(root: string, from: string, to: string): Promise<boolean> {
  const output = await git(root, [
    'log',
    '--all',
    '--format=',
    '--name-status',
    '-z',
    '--find-renames=100%',
    '--',
    from,
    to,
  ])
  return parseExactRenames(output).some((entry) => entry.from === from && entry.to === to)
}

/**
 * Finds a tracked, unmodified relocation of a missing frozen article bundle.
 * Git's 100%-rename record is preferred. For files first committed after a directory
 * move, the complete bundle may instead prove identity by preserving every frozen
 * byte size and millisecond mtime. A unique clean candidate is required either way.
 */
export async function findGitRelocatedArticleSource(input: {
  workspacePath: string
  state: ArticlePublishingState
}): Promise<{ markdownPath: string; evidence: string } | undefined> {
  const { state } = input
  if (state.adapterId !== 'bilibili') return undefined
  try {
    await stat(state.source.markdownPath)
    return undefined
  } catch {
    // Only a missing frozen path is eligible for relocation recovery.
  }
  const workspacePath = resolve(input.workspacePath)
  const root = (await git(workspacePath, ['rev-parse', '--show-toplevel'])).trim()
  if (!root || !isInside(root, workspacePath) || !isInside(root, state.source.markdownPath))
    return undefined
  const originalRelative = relative(root, state.source.markdownPath)
  const tracked = (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean)
  const candidates: string[] = []
  const evidenceByCandidate = new Map<string, string>()
  for (const candidateRelative of tracked) {
    if (
      candidateRelative === originalRelative ||
      basename(candidateRelative) !== basename(originalRelative)
    )
      continue
    const candidatePath = join(root, candidateRelative)
    const candidateStat = await stat(candidatePath).catch(() => null)
    if (!candidateStat?.isFile() || candidateStat.size !== state.source.size) continue
    const markdownExactRename = await hasExactRename(root, originalRelative, candidateRelative)
    const preservedMetadata = candidateStat.mtimeMs === state.source.modifiedAt
    if (!markdownExactRename && !preservedMetadata) continue
    const imagePaths: string[] = []
    let valid = true
    for (const asset of state.assets.filter((item) => item.kind === 'local')) {
      const relocatedPath = join(dirname(candidatePath), asset.displayPath)
      const relocatedRelative = relative(root, relocatedPath)
      const imageStat = await stat(relocatedPath).catch(() => null)
      if (
        !imageStat?.isFile() ||
        imageStat.size !== asset.size ||
        !isInside(root, relocatedPath) ||
        (!(await hasExactRename(root, relative(root, asset.sourcePath), relocatedRelative)) &&
          (!preservedMetadata || imageStat.mtimeMs !== asset.modifiedAt))
      ) {
        valid = false
        break
      }
      imagePaths.push(relocatedRelative)
    }
    if (!valid) continue
    const status = await git(root, [
      'status',
      '--porcelain',
      '--untracked-files=no',
      '--',
      candidateRelative,
      ...imagePaths,
    ])
    if (status.trim()) continue
    candidates.push(candidatePath)
    evidenceByCandidate.set(
      candidatePath,
      markdownExactRename
        ? `Git 100% rename: ${originalRelative} → ${candidateRelative}`
        : `Frozen bundle size+mtime relocation: ${originalRelative} → ${candidateRelative}`,
    )
  }
  if (candidates.length !== 1) return undefined
  return {
    markdownPath: candidates[0],
    evidence: evidenceByCandidate.get(candidates[0])!,
  }
}

export const gitRelocatedArticleSourceInternals = { parseExactRenames }
