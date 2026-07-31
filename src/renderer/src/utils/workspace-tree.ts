import type { FsDirEntry } from '../../../shared/ipc/fs'

export interface FileTreeNode {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
  children?: FileTreeNode[]
  expanded?: boolean
  loading?: boolean
}

export interface WorkspaceTreeProjection {
  path: string
  tree: FileTreeNode[]
  expandedPaths: string[]
  selectedPath: string | null
}

export function findFileTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.children) {
      const found = findFileTreeNode(node.children, targetPath)
      if (found) return found
    }
  }
  return undefined
}

export function resolveFileTreeCreationParent(
  workspacePath: string,
  nodes: FileTreeNode[],
  selectedPath: string | null,
): string {
  if (!selectedPath) return workspacePath
  const selectedNode = findFileTreeNode(nodes, selectedPath)
  if (!selectedNode) return workspacePath
  if (selectedNode.type === 'directory') return selectedNode.path
  const separatorIndex = selectedNode.path.lastIndexOf('/')
  return separatorIndex > 0 ? selectedNode.path.slice(0, separatorIndex) : workspacePath
}

export function normalizeFileTreeState(
  value: unknown,
): { expandedPaths: string[]; selectedPath: string | null } | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as { expandedPaths?: string[]; selectedPath?: string | null }
  return {
    expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths.filter(Boolean) : [],
    selectedPath: parsed.selectedPath ?? null,
  }
}

export async function prepareWorkspaceTree(
  path: string,
  restoredFileTree: unknown,
  current: {
    workspacePath: string | null
    expandedPaths: string[]
    selectedPath: string | null
  },
  readDir: (path: string) => Promise<FsDirEntry[]> = (targetPath) =>
    window.cclinkStudio.fs.readDir(targetPath),
): Promise<WorkspaceTreeProjection> {
  const restored = normalizeFileTreeState(restoredFileTree)
  const sameWorkspace = current.workspacePath === path
  const expandedPaths = restored?.expandedPaths ?? (sameWorkspace ? current.expandedPaths : [])
  const selectedPath = restored?.selectedPath ?? (sameWorkspace ? current.selectedPath : null)
  const expandedSet = new Set(expandedPaths)
  const entries = await readDir(path)

  return {
    path,
    expandedPaths,
    selectedPath,
    tree: entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      extension: entry.extension,
      children: undefined,
      expanded: expandedSet.has(entry.path),
    })),
  }
}
