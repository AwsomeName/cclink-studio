import { useEffect, useState } from 'react'
import type { CclinkTreeNode } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { RemoteCapabilitySet } from '@shared/remote-protocol'
import { useCclinkStore, useTabStore } from '../../stores'
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconRefresh,
} from '../../components/common/Icons'

export function RemoteFileTree({
  workspaceRef,
}: {
  workspaceRef: RemoteWorkspaceRef
}): React.ReactElement {
  const [root, setRoot] = useState<CclinkTreeNode | null>(null)
  const [children, setChildren] = useState<Record<string, CclinkTreeNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([workspaceRef.path]))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CclinkTreeNode | null>(null)
  const [capabilities, setCapabilities] = useState<RemoteCapabilitySet | null>(null)
  const sessions = useCclinkStore((state) => state.sessions)
  const selectedSessionId = useCclinkStore((state) => state.selectedSessionId)
  const createSession = useCclinkStore((state) => state.createSession)

  const loadRoot = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.remote.listFileTree({
        ref: workspaceRef,
        path: workspaceRef.path,
        depth: 1,
      })
      if (!result.success || !result.tree) throw new Error(result.error || '远程文件树不可用')
      setRoot(result.tree)
      setChildren({ [result.tree.path]: result.tree.children ?? [] })
      const status = await window.cclinkStudio.remote.getStatus(workspaceRef)
      setCapabilities(status.capabilities)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void loadRoot()
  }, [workspaceRef.endpointId, workspaceRef.workspaceId, workspaceRef.path])

  const toggle = async (node: CclinkTreeNode): Promise<void> => {
    setSelected(node)
    if (expanded.has(node.path)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(node.path)
        return next
      })
      return
    }
    if (!children[node.path]) {
      const result = await window.cclinkStudio.remote.listFileTree({
        ref: workspaceRef,
        path: node.path,
        depth: 1,
      })
      if (!result.success || !result.tree) {
        setError(result.error || '目录读取失败')
        return
      }
      setChildren((current) => ({ ...current, [node.path]: result.tree?.children ?? [] }))
    }
    setExpanded((current) => new Set(current).add(node.path))
  }

  const openFile = (node: CclinkTreeNode): void => {
    setSelected(node)
    useTabStore.getState().openTab({
      type: 'remote-file',
      title: node.name,
      icon: '📄',
      filePath: node.path,
      workspaceRef,
      remoteFile: {
        serverId: workspaceRef.endpointId,
        workspaceId: workspaceRef.workspaceId,
        workspacePath: workspaceRef.path,
        path: node.path,
      },
    })
  }
  const ensureMutationSession = async () => {
    const existing = sessions.find(
      (session) =>
        session.id === selectedSessionId &&
        session.serverId === workspaceRef.endpointId &&
        (session.workspaceId === workspaceRef.workspaceId ||
          session.workspacePath === workspaceRef.path),
    )
    return existing ?? createSession(workspaceRef, '远程文件操作')
  }
  const mutationBase = async () => {
    const session = await ensureMutationSession()
    const now = Date.now()
    return {
      ref: workspaceRef,
      sessionId: session.id,
      operationId: crypto.randomUUID(),
      operationCreatedAt: now,
      operationExpiresAt: now + 5 * 60_000,
    }
  }
  const joinRemotePath = (parent: string, name: string): string =>
    `${parent.replace(/[\\/]$/u, '')}${parent.includes('\\') && !parent.includes('/') ? '\\' : '/'}${name}`
  const createEntry = async (type: 'file' | 'directory'): Promise<void> => {
    const parent =
      selected?.type === 'directory' ? selected.path : (root?.path ?? workspaceRef.path)
    const name = window.prompt(type === 'file' ? '新文件名' : '新文件夹名')?.trim()
    if (!name || name === '.' || name === '..' || /[\\/\0]/u.test(name)) return
    try {
      const result = await window.cclinkStudio.remote.createFile({
        ...(await mutationBase()),
        path: joinRemotePath(parent, name),
        type,
        ...(type === 'file' ? { content: '' } : {}),
      })
      if (!result.success) throw new Error(result.error || '创建失败')
      await loadRoot()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
    }
  }
  const renameSelected = async (): Promise<void> => {
    if (!selected || selected.path === workspaceRef.path) return
    const name = window.prompt('新名称', selected.name)?.trim()
    if (!name || name === selected.name || /[\\/\0]/u.test(name)) return
    const separator = selected.path.includes('\\') && !selected.path.includes('/') ? '\\' : '/'
    const parent = selected.path.slice(0, selected.path.lastIndexOf(separator))
    try {
      const result = await window.cclinkStudio.remote.renameFile({
        ...(await mutationBase()),
        oldPath: selected.path,
        newPath: joinRemotePath(parent, name),
      })
      if (!result.success) throw new Error(result.error || '重命名失败')
      setSelected(null)
      await loadRoot()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
    }
  }
  const deleteSelected = async (): Promise<void> => {
    if (!selected || selected.path === workspaceRef.path) return
    if (
      !window.confirm(
        `确定删除远程${selected.type === 'directory' ? '目录' : '文件'}“${selected.name}”？`,
      )
    )
      return
    try {
      const result = await window.cclinkStudio.remote.deleteFile({
        ...(await mutationBase()),
        path: selected.path,
        recursive: selected.type === 'directory',
      })
      if (!result.success) throw new Error(result.error || '删除失败')
      setSelected(null)
      await loadRoot()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
    }
  }
  const renderNode = (node: CclinkTreeNode, depth: number): React.ReactNode => {
    const open = expanded.has(node.path)
    return (
      <div key={node.path}>
        <button
          className={`remote-tree-row ${selected?.path === node.path ? 'active' : ''}`}
          type="button"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (node.type === 'directory' ? void toggle(node) : openFile(node))}
        >
          {node.type === 'directory' ? (
            open ? (
              <IconChevronDown size={12} />
            ) : (
              <IconChevronRight size={12} />
            )
          ) : (
            <span className="remote-tree-spacer" />
          )}
          {node.type === 'directory' ? <IconFolder size={14} /> : <IconFile size={14} />}
          <span>{node.name}</span>
        </button>
        {node.type === 'directory' &&
          open &&
          (children[node.path] ?? node.children ?? []).map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }
  return (
    <div className="remote-file-tree">
      <div className="remote-tree-toolbar">
        <span>
          {workspaceRef.endpointName || 'CCLink'} · {workspaceRef.path}
        </span>
        <button type="button" onClick={() => void loadRoot()}>
          <IconRefresh size={13} />
        </button>
      </div>
      <div className="remote-tree-actions">
        <button disabled={!capabilities?.file.create} onClick={() => void createEntry('file')}>
          新建文件
        </button>
        <button disabled={!capabilities?.file.create} onClick={() => void createEntry('directory')}>
          新建目录
        </button>
        <button
          disabled={!selected || !capabilities?.file.rename}
          onClick={() => void renameSelected()}
        >
          重命名
        </button>
        <button
          disabled={!selected || !capabilities?.file.delete}
          onClick={() => void deleteSelected()}
        >
          删除
        </button>
      </div>
      {loading && <div className="cclink-panel-state">正在读取远程文件树…</div>}
      {error && <div className="cclink-inline-notice error">{error}</div>}
      {root && (children[root.path] ?? root.children ?? []).map((node) => renderNode(node, 0))}
    </div>
  )
}
