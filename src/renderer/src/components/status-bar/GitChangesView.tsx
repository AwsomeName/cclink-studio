import type { GitChangeArea, GitChangeEntry, GitRepositorySnapshot } from '@shared/git'
import { useGitStore } from '../../stores/git-store'

interface GitChangeItem {
  entry: GitChangeEntry
  area: GitChangeArea
  status: string
}

const GROUPS: Array<{ area: GitChangeArea; label: string }> = [
  { area: 'conflicted', label: '冲突' },
  { area: 'staged', label: '已暂存' },
  { area: 'unstaged', label: '未暂存' },
  { area: 'untracked', label: '未跟踪' },
]

export function GitChangesView({
  snapshot,
}: {
  snapshot: GitRepositorySnapshot
}): React.ReactElement {
  const selectedDiff = useGitStore((state) => state.selectedDiff)
  const diff = useGitStore((state) => state.diff)
  const diffLoading = useGitStore((state) => state.diffLoading)
  const loadDiff = useGitStore((state) => state.loadDiff)

  const items = buildItems(snapshot.changes)

  return (
    <div className="git-changes-view">
      <div className="git-changes-list" aria-label="Git 变更清单">
        {GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.area === group.area)
          if (groupItems.length === 0) return null
          return (
            <section className="git-change-group" key={group.area}>
              <div className="git-change-group-title">
                <span>{group.label}</span>
                <span>{groupItems.length}</span>
              </div>
              {groupItems.map((item) => {
                const active =
                  selectedDiff?.path === item.entry.path && selectedDiff.area === item.area
                return (
                  <button
                    key={`${item.area}:${item.entry.path}`}
                    type="button"
                    className={`git-change-item ${active ? 'active' : ''}`}
                    onClick={() => void loadDiff(item.entry.path, item.area)}
                    title={formatChangeTitle(item.entry)}
                  >
                    <span className={`git-change-status status-${item.status.toLowerCase()}`}>
                      {item.status}
                    </span>
                    <span className="git-change-path">{item.entry.path}</span>
                  </button>
                )
              })}
            </section>
          )
        })}
        {items.length === 0 && <div className="git-changes-empty">工作区没有变更</div>}
      </div>

      <div className="git-diff-view" aria-live="polite">
        {!selectedDiff && <div className="git-diff-placeholder">选择文件查看只读 Diff</div>}
        {selectedDiff && diffLoading && <div className="git-diff-placeholder">正在读取 Diff…</div>}
        {selectedDiff && !diffLoading && diff?.error && (
          <div className="git-diff-error">{diff.error}</div>
        )}
        {selectedDiff && !diffLoading && diff && !diff.error && (
          <>
            <div className="git-diff-title" title={diff.path}>
              {diff.path}
            </div>
            <pre className="git-diff-content">{diff.content || '没有可显示的文本差异'}</pre>
            {diff.truncated && (
              <div className="git-diff-notice">Diff 已达到显示上限，内容已截断</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function buildItems(changes: GitChangeEntry[]): GitChangeItem[] {
  const items: GitChangeItem[] = []
  for (const entry of changes) {
    if (entry.conflicted) {
      items.push({ entry, area: 'conflicted', status: 'U' })
      continue
    }
    if (entry.stagedStatus) {
      items.push({ entry, area: 'staged', status: entry.stagedStatus })
    }
    if (entry.unstagedStatus) {
      items.push({ entry, area: 'unstaged', status: entry.unstagedStatus })
    }
    if (entry.untracked) {
      items.push({ entry, area: 'untracked', status: '?' })
    }
  }
  return items
}

function formatChangeTitle(entry: GitChangeEntry): string {
  return entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path
}
