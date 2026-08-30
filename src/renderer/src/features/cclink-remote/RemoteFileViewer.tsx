import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tab } from '../../types'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteStatus } from '@shared/remote-protocol'
import {
  createRemoteMutationIdentity,
  isRemoteFilePendingMutationReusable,
  type RemoteFilePendingMutation,
} from '@shared/remote-mutation-identity'
import { IconRefresh } from '../../components/common/Icons'
import { useCclinkStore, useTabStore } from '../../stores'
import {
  clearRemoteFileDraft,
  registerRemoteFileDraft,
  rememberRemoteFileDraft,
  restoreRemoteFileDraft,
} from '../../utils/remote-file-draft-registry'

export function RemoteFileViewer({ tab }: { tab: Tab }): React.ReactElement {
  const remoteFile = tab.remoteFile!
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState<string | null>(null)
  const [sha256, setSha256] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pendingMutation, setPendingMutation] = useState<RemoteFilePendingMutation | null>(null)
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
  const updateTabDirty = useTabStore((state) => state.updateTabDirty)
  const dirty = content !== null && savedContent !== null && content !== savedContent
  const writable =
    status?.state === 'online' && status.capabilities.file.write && Boolean(sha256) && complete

  useEffect(() => {
    updateTabDirty(tab.id, dirty)
    if (dirty && content !== null && savedContent !== null && sha256) {
      rememberRemoteFileDraft(tab.id, {
        ref,
        path: remoteFile.path,
        content,
        savedContent,
        sha256,
        ...(pendingMutation ? { pendingMutation } : {}),
      })
    } else if (content !== null && savedContent !== null && !dirty) {
      clearRemoteFileDraft(tab.id)
    }
  }, [
    content,
    dirty,
    pendingMutation,
    ref,
    remoteFile.path,
    savedContent,
    sha256,
    tab.id,
    updateTabDirty,
  ])

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setSavedContent(null)
    setSha256(null)
    setComplete(false)
    setStatus(null)
    setPendingMutation(null)
    setLoading(true)
    setError(null)
    void Promise.all([
      window.cclinkStudio.remote.getStatus(ref),
      window.cclinkStudio.remote.readFile({ ref, path: remoteFile.path }),
    ])
      .then(async ([nextStatus, result]) => {
        if (cancelled) return
        setStatus(nextStatus)
        if (!result.success || !result.file) throw new Error(result.error || '远程文件读取失败')
        setComplete(result.file.complete)
        if (!result.file.complete) {
          throw new Error('远程文件只读取了部分内容，已禁止编辑以避免覆盖完整文件')
        }
        const draft = await restoreRemoteFileDraft(tab.id, ref, remoteFile.path)
        if (cancelled) return
        if (draft?.path === remoteFile.path) {
          setContent(draft.content)
          setSavedContent(draft.savedContent)
          setSha256(draft.sha256)
          setPendingMutation(draft.pendingMutation ?? null)
        } else {
          setContent(result.file.content)
          setSavedContent(result.file.content)
          setSha256(result.file.sha256 ?? null)
          setPendingMutation(null)
        }
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
  }, [ref, remoteFile.path, revision, tab.id])

  const save = useCallback(async (): Promise<boolean> => {
    if (content === null || savedContent === null || content === savedContent) return true
    if (!writable || !sha256) {
      setError(
        status?.state !== 'online'
          ? '远程设备当前离线，无法保存'
          : '当前 Agent 未提供远程文件写入能力',
      )
      return false
    }
    setLoading(true)
    setError(null)
    try {
      let session = sessions.find(
        (item) =>
          item.id === selectedSessionId &&
          item.serverId === ref.endpointId &&
          item.workspaceId === ref.workspaceId,
      )
      if (!session) session = await createSession(ref, `文件修改 · ${tab.title}`)
      const mutation = isRemoteFilePendingMutationReusable(pendingMutation, session.id, sha256)
        ? pendingMutation
        : { ...createRemoteMutationIdentity(), sessionId: session.id, expectedSha256: sha256 }
      setPendingMutation(mutation)
      rememberRemoteFileDraft(tab.id, {
        ref,
        path: remoteFile.path,
        content,
        savedContent,
        sha256,
        pendingMutation: mutation,
      })
      const result = await window.cclinkStudio.remote.writeFile({
        ref,
        sessionId: session.id,
        operationId: mutation.operationId,
        operationCreatedAt: mutation.operationCreatedAt,
        operationExpiresAt: mutation.operationExpiresAt,
        path: remoteFile.path,
        content,
        expectedSha256: sha256,
      })
      if (!result.success) throw new Error(result.error || '远程文件保存失败')
      setSavedContent(content)
      if (result.sha256) setSha256(result.sha256)
      setPendingMutation(null)
      clearRemoteFileDraft(tab.id)
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      return false
    } finally {
      setLoading(false)
    }
  }, [
    content,
    createSession,
    pendingMutation,
    ref,
    remoteFile.path,
    savedContent,
    selectedSessionId,
    sessions,
    sha256,
    status?.state,
    tab.id,
    tab.title,
    writable,
  ])

  useEffect(
    () =>
      registerRemoteFileDraft(tab.id, {
        save,
        discard: () => {
          if (savedContent !== null) setContent(savedContent)
          setPendingMutation(null)
          clearRemoteFileDraft(tab.id)
        },
      }),
    [save, savedContent, tab.id],
  )
  return (
    <div className="remote-file-viewer">
      <div className="remote-file-header">
        <div>
          <strong>{tab.title}</strong>
          <span>{remoteFile.path}</span>
        </div>
        <button
          type="button"
          title="重新读取"
          onClick={() => {
            if (dirty && !window.confirm('重新读取会放弃当前未保存的远程修改，是否继续？')) return
            if (dirty) clearRemoteFileDraft(tab.id)
            setRevision((value) => value + 1)
          }}
        >
          <IconRefresh size={14} />
        </button>
        <button
          type="button"
          title="保存到远程设备"
          disabled={loading || !dirty || !writable}
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
          onChange={(event) => {
            setContent(event.target.value)
            setPendingMutation(null)
          }}
          spellCheck={false}
        />
      )}
    </div>
  )
}
