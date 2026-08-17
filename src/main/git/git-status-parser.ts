import type { GitChangeEntry } from '../../shared/git'

export interface ParsedGitStatus {
  headOid: string | null
  branch: string | null
  detached: boolean
  unborn: boolean
  upstream: string | null
  ahead: number | null
  behind: number | null
  changeCount: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  conflictedCount: number
  changes: GitChangeEntry[]
}

export interface ParsedGitNumstat {
  additions: number
  deletions: number
  incomplete: boolean
}

export function parseGitStatusPorcelainV2(output: string): ParsedGitStatus {
  const changedPaths = new Set<string>()
  const stagedPaths = new Set<string>()
  const unstagedPaths = new Set<string>()
  const untrackedPaths = new Set<string>()
  const conflictedPaths = new Set<string>()
  const changes = new Map<string, GitChangeEntry>()
  let headOid: string | null = null
  let branch: string | null = null
  let detached = false
  let unborn = false
  let upstream: string | null = null
  let ahead: number | null = null
  let behind: number | null = null

  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length)
      unborn = value === '(initial)'
      headOid = unborn ? null : value
      continue
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length)
      detached = value === '(detached)'
      branch = detached ? null : value
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length) || null
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
      if (match) {
        ahead = Number.parseInt(match[1], 10)
        behind = Number.parseInt(match[2], 10)
      }
      continue
    }

    const kind = record[0]
    if (kind === '?') {
      const path = record.slice(2)
      if (path) {
        changedPaths.add(path)
        untrackedPaths.add(path)
        changes.set(path, {
          path,
          originalPath: null,
          stagedStatus: null,
          unstagedStatus: null,
          untracked: true,
          conflicted: false,
        })
      }
      continue
    }
    if (kind === 'u') {
      const path = record.split(' ').slice(10).join(' ')
      if (path) {
        changedPaths.add(path)
        conflictedPaths.add(path)
        changes.set(path, {
          path,
          originalPath: null,
          stagedStatus: 'U',
          unstagedStatus: 'U',
          untracked: false,
          conflicted: true,
        })
      }
      continue
    }
    if (kind !== '1' && kind !== '2') continue

    const parts = record.split(' ')
    const xy = parts[1] ?? '..'
    const pathIndex = kind === '1' ? 8 : 9
    const path = parts.slice(pathIndex).join(' ')
    if (!path) continue
    const originalPath = kind === '2' ? (records[index + 1] ?? null) : null
    changedPaths.add(path)
    if (xy[0] && xy[0] !== '.') stagedPaths.add(path)
    if (xy[1] && xy[1] !== '.') unstagedPaths.add(path)
    changes.set(path, {
      path,
      originalPath,
      stagedStatus: xy[0] && xy[0] !== '.' ? xy[0] : null,
      unstagedStatus: xy[1] && xy[1] !== '.' ? xy[1] : null,
      untracked: false,
      conflicted: false,
    })
    if (kind === '2') index += 1
  }

  if (!upstream) {
    ahead = null
    behind = null
  }

  return {
    headOid,
    branch,
    detached,
    unborn,
    upstream,
    ahead,
    behind,
    changeCount: changedPaths.size,
    stagedCount: stagedPaths.size,
    unstagedCount: unstagedPaths.size,
    untrackedCount: untrackedPaths.size,
    conflictedCount: conflictedPaths.size,
    changes: [...changes.values()].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export function parseGitNumstat(output: string): ParsedGitNumstat {
  let additions = 0
  let deletions = 0
  let incomplete = false

  for (const record of output.split('\0')) {
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = firstTab >= 0 ? record.indexOf('\t', firstTab + 1) : -1
    if (firstTab < 0 || secondTab < 0) continue
    const added = record.slice(0, firstTab)
    const deleted = record.slice(firstTab + 1, secondTab)
    if (added === '-' || deleted === '-') {
      incomplete = true
      continue
    }
    const addedCount = Number.parseInt(added, 10)
    const deletedCount = Number.parseInt(deleted, 10)
    if (Number.isFinite(addedCount)) additions += addedCount
    if (Number.isFinite(deletedCount)) deletions += deletedCount
  }

  return { additions, deletions, incomplete }
}
