import type { GitRepositorySnapshot } from '@shared/git'

export function getGitBranchLabel(snapshot: GitRepositorySnapshot): string {
  return snapshot.detached
    ? `detached@${snapshot.headOid?.slice(0, 7) ?? 'HEAD'}`
    : (snapshot.branch ?? '未命名分支')
}

export function formatGitChangeSummary(snapshot: GitRepositorySnapshot): string {
  const lineSummary = `+${snapshot.additions} -${snapshot.deletions}${snapshot.lineStatsIncomplete ? '*' : ''}`
  return `${snapshot.changeCount} · ${lineSummary}`
}

export function formatGitUpstream(snapshot: GitRepositorySnapshot): string {
  if (!snapshot.upstream) return '未设置上游'
  const ahead = snapshot.ahead ?? 0
  const behind = snapshot.behind ?? 0
  if (ahead === 0 && behind === 0) return `${snapshot.upstream} · 本机已知同步`
  const relation = [ahead > 0 ? `↑${ahead}` : '', behind > 0 ? `↓${behind}` : '']
    .filter(Boolean)
    .join(' ')
  return `${snapshot.upstream} · ${relation}`
}
