import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'

export function openRemoteFileFromConversation(
  workspaceRef: RemoteWorkspaceRef,
  candidate: string,
): boolean {
  const filePath = resolveRemoteWorkspaceFilePath(workspaceRef, candidate)
  if (!filePath) return false

  useTabStore.getState().openTab({
    type: 'remote-file',
    title: filePath.split(/[\\/]/u).filter(Boolean).at(-1) || 'Markdown',
    icon: '📄',
    filePath,
    workspaceRef,
    remoteFile: {
      serverId: workspaceRef.endpointId,
      workspaceId: workspaceRef.workspaceId,
      workspacePath: workspaceRef.path,
      path: filePath,
    },
  })
  return true
}

export function resolveRemoteWorkspaceFilePath(
  workspaceRef: RemoteWorkspaceRef,
  candidate: string,
): string | null {
  const value = candidate.trim()
  const windows = isWindowsPath(workspaceRef.path)
  const windowsAbsolute = windows && /^[a-z]:[\\/]/iu.test(value)
  if (!value || value.includes('\0') || (/^[a-z][a-z\d+.-]*:/iu.test(value) && !windowsAbsolute)) {
    return null
  }
  const root = normalizeAbsolutePath(workspaceRef.path, windows)
  if (!root) return null

  const absoluteCandidate = normalizeAbsolutePath(value, windows)
  const resolved =
    absoluteCandidate ?? normalizeAbsolutePath(`${root}${separator(windows)}${value}`, windows)
  if (!resolved || !isInsideRoot(resolved, root, windows)) return null
  return resolved
}

function isWindowsPath(value: string): boolean {
  return /^[a-z]:[\\/]/iu.test(value) || (value.includes('\\') && !value.includes('/'))
}

function separator(windows: boolean): '/' | '\\' {
  return windows ? '\\' : '/'
}

function normalizeAbsolutePath(value: string, windows: boolean): string | null {
  const normalized = windows ? value.replace(/\//gu, '\\') : value.replace(/\\/gu, '/')
  const prefix = windows
    ? normalized.match(/^([a-z]:)\\/iu)?.[1]
    : normalized.startsWith('/')
      ? ''
      : null
  if (prefix === null || prefix === undefined) return null

  const body = windows ? normalized.slice(prefix.length + 1) : normalized.slice(1)
  const parts: string[] = []
  for (const part of body.split(separator(windows))) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }

  if (windows) return `${prefix}\\${parts.join('\\')}`
  return `/${parts.join('/')}`
}

function isInsideRoot(filePath: string, root: string, windows: boolean): boolean {
  const normalizedFile = windows ? filePath.toLocaleLowerCase('en-US') : filePath
  const normalizedRoot = windows ? root.toLocaleLowerCase('en-US') : root
  const rootPrefix = normalizedRoot.endsWith(separator(windows))
    ? normalizedRoot
    : `${normalizedRoot}${separator(windows)}`
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(rootPrefix)
}
