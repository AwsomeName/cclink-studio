import { useEffect, useMemo, useState } from 'react'
import type { Tab } from '../../types'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { IconRefresh } from '../../components/common/Icons'
import { useCclinkStore } from '../../stores'

export function RemoteFileViewer({ tab }: { tab: Tab }): React.ReactElement {
  const remoteFile = tab.remoteFile!
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState<string | null>(null)
  const [sha256, setSha256] = useState<string | null>(null)
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
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const sessions = useCclinkStore((state) => state.sessions)
  const createSession = useCclinkStore((state) => state.createSession)
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
        setSavedContent(result.file.content)
        setSha256(result.file.sha256 ?? null)
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

  const save = async (): Promise<void> => {
    if (content === null || !sha256 || content === savedContent) return
    setLoading(true)
    setError(null)
    try {
      let session = sessions.find(
        (item) =>
          item.id === selectedSessionId &&
          item.serverId === ref.endpointId &&
          (item.workspaceId === ref.workspaceId || item.workspacePath === ref.path),
      )
      if (!session) session = await createSession(ref, `文件修改 · ${tab.title}`)
      const now = Date.now()
      const result = await window.cclinkStudio.remote.writeFile({
        ref,
        sessionId: session.id,
        operationId: crypto.randomUUID(),
        operationCreatedAt: now,
        operationExpiresAt: now + 5 * 60_000,
        path: remoteFile.path,
        content,
        expectedSha256: sha256,
      })
      if (!result.success) throw new Error(result.error || '远程文件保存失败')
      setSavedContent(content)
      if (result.sha256) setSha256(result.sha256)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setLoading(false)
    }
  }
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
        <button
          type="button"
          title="保存到远程设备"
          disabled={loading || content === null || content === savedContent || !sha256}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
      {loading && <div className="remote-file-state">正在读取远程文件…</div>}
      {error && <div className="remote-file-state error">{error}</div>}
      {content !== null && (
        <textarea
          className="remote-file-content remote-file-editor"
          value={content}
          disabled={loading}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  )
}
