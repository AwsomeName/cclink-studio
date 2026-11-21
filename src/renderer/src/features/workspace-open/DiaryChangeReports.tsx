import { useEffect, useState } from 'react'
import type { DiaryChangeReport } from '@shared/diary-change-report'

/** AI change reports for this project: what changed, per-file diff, and one-click undo. */
export function DiaryChangeReports({
  workspacePath,
  onOpen,
}: {
  workspacePath: string
  onOpen: (path: string) => void
}): React.ReactElement | null {
  const [reports, setReports] = useState<DiaryChangeReport[]>([])
  const [message, setMessage] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let alive = true
    const load = (): void =>
      void window.cclinkStudio.workspaceState
        .listDiaryChanges(workspacePath)
        .then((items) => {
          if (alive) setReports(items.slice(0, 3))
        })
        .catch(() => {})
    load()
    // Reports appear when an AI conversation run finishes; a light poll keeps this page current.
    const timer = window.setInterval(load, 4000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [workspacePath, refresh])
  if (!reports.length) return null
  const undo = async (report: DiaryChangeReport): Promise<void> => {
    const result = await window.cclinkStudio.workspaceState.undoDiaryChange(report.id)
    setMessage(
      `已撤销 ${result.restored.length} 个文件` +
        (result.skipped.length
          ? `；${result.skipped.join('、')} 在 AI 修改后又被改过，未撤销`
          : ''),
    )
    setRefresh((value) => value + 1)
  }
  return (
    <div className="diary-change-reports">
      <h3>AI 改动报告</h3>
      {message && <p role="status">{message}</p>}
      {reports.map((report) => (
        <article
          className="diary-card diary-change-report"
          key={report.id}
          aria-label="AI 改动报告"
        >
          <b>
            {report.files.length} 个文件 · {new Date(report.createdAt).toLocaleString()}
            {report.undone && <span className="diary-tag">已撤销</span>}
          </b>
          {report.files.map((file) => (
            <div className="diary-change-file" key={file.path}>
              <div>
                {file.status === 'added' ? '新增' : file.status === 'deleted' ? '删除' : '修改'}{' '}
                {file.path}
                <span className="muted">
                  {' '}
                  +{file.added} −{file.removed}
                </span>
                {file.status !== 'deleted' && (
                  <button onClick={() => onOpen(`${report.workspacePath}/${file.path}`)}>
                    打开
                  </button>
                )}
              </div>
              <pre className="diary-diff">
                {file.diff.map((line, index) => (
                  <span
                    key={index}
                    className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''}
                  >
                    {line}
                    {'\n'}
                  </span>
                ))}
              </pre>
            </div>
          ))}
          {!report.undone && (
            <button onClick={() => void undo(report).catch((e) => setMessage(String(e)))}>
              撤销本次修改
            </button>
          )}
        </article>
      ))}
    </div>
  )
}
