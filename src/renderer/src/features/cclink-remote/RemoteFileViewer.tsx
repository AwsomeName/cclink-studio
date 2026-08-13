import { useEffect, useMemo, useState } from 'react'
import type { Tab } from '../../types'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { IconRefresh } from '../../components/common/Icons'

export function RemoteFileViewer({ tab }: { tab: Tab }): React.ReactElement {
  const remoteFile = tab.remoteFile!
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const ref = useMemo(
    () =>
      remoteWorkspaceRef({
        endpointId: remoteFile.serverId,
        workspaceId: remoteFile.workspaceId,
        path: remoteFile.workspacePath,
      }),
    [remoteFile.serverId, remoteFile.workspaceId, remoteFile.workspacePath],
  )
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.cclinkStudio.remote
      .readFile({ ref, path: remoteFile.path })
      .then((result) => {
        if (cancelled) return
        if (!result.success || !result.file) throw new Error(result.error || '远程文件读取失败')
        setContent(result.file.content)
      })
      .catch((readError: unknown) => {
        if (!cancelled) setError(readError instanceof Error ? readError.message : String(readError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ref, remoteFile.path, revision])
  return (
    <div className="remote-file-viewer">
      <div className="remote-file-header">
        <div>
          <strong>{tab.title}</strong>
          <span>{remoteFile.path}</span>
        </div>
        <button type="button" title="重新读取" onClick={() => setRevision((value) => value + 1)}>
          <IconRefresh size={14} />
        </button>
      </div>
      {loading && <div className="remote-file-state">正在读取远程文件…</div>}
      {error && <div className="remote-file-state error">{error}</div>}
      {content !== null && !loading && <pre className="remote-file-content">{content}</pre>}
    </div>
  )
}
