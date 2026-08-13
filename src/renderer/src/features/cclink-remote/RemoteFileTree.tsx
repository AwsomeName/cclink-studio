import { useEffect, useState } from 'react'
import type { CclinkTreeNode } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores'
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
  const renderNode = (node: CclinkTreeNode, depth: number): React.ReactNode => {
    const open = expanded.has(node.path)
    return (
      <div key={node.path}>
        <button
          className="remote-tree-row"
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
      {loading && <div className="cclink-panel-state">正在读取远程文件树…</div>}
      {error && <div className="cclink-inline-notice error">{error}</div>}
      {root && (children[root.path] ?? root.children ?? []).map((node) => renderNode(node, 0))}
    </div>
  )
}
