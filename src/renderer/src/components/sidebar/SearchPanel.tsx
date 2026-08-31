import { useEffect, useRef, useState, useCallback } from 'react'
import { useFsStore, useTabStore, useWorkspaceStore } from '../../stores'
import type { FileTreeNode } from '../../stores/fs-store'
import { IconSearch } from '../common/Icons'
import { getModelFileIcon, getTabTypeForFile, isModelFileExtension } from '../../utils/model-files'
import { isGerberFileExtension } from '../../utils/hardware-files'
import { isSearchResponseCurrent } from './search-request-guard'

const SEARCH_PANEL_STORAGE_KEY = 'cclink-studio-search-panel-queries-v2'

function loadSearchQuery(workspaceKey: string | null): string {
  try {
    if (typeof localStorage === 'undefined' || !workspaceKey) return ''
    const raw = localStorage.getItem(SEARCH_PANEL_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return typeof parsed[workspaceKey] === 'string' ? parsed[workspaceKey] : ''
  } catch {
    return ''
  }
}

function saveSearchQuery(workspaceKey: string | null, query: string): void {
  try {
    if (typeof localStorage === 'undefined' || !workspaceKey) return
    const raw = localStorage.getItem(SEARCH_PANEL_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    parsed[workspaceKey] = query
    localStorage.setItem(SEARCH_PANEL_STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

export function SearchPanel(): React.ReactElement {
  const workspacePath = useFsStore((s) => s.workspacePath)
  const workspaceGeneration = useWorkspaceStore((s) => s.generation)
  const [query, setQuery] = useState(() => loadSearchQuery(workspacePath))
  const [results, setResults] = useState<FileTreeNode[]>([])
  const [searching, setSearching] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const searchFiles = useFsStore((s) => s.searchFiles)
  const openTab = useTabStore((s) => s.openTab)

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !workspacePath) return
    const request = {
      sequence: ++requestSequence.current,
      workspaceKey: workspacePath,
      generation: workspaceGeneration,
      requestId: crypto.randomUUID(),
    }
    setSearching(true)
    setSearchError(null)
    try {
      const response = await searchFiles(query.trim(), request.requestId)
      const currentWorkspace = useFsStore.getState().workspacePath
      const currentGeneration = useWorkspaceStore.getState().generation
      if (
        !isSearchResponseCurrent(
          request,
          requestSequence.current,
          currentWorkspace,
          currentGeneration,
          response,
        )
      ) {
        return
      }
      setResults(response.results)
      setTruncated(response.truncated)
    } catch (error) {
      if (request.sequence !== requestSequence.current) return
      setResults([])
      setTruncated(false)
      setSearchError(error instanceof Error ? error.message : '搜索失败')
    } finally {
      if (request.sequence === requestSequence.current) setSearching(false)
    }
  }, [query, searchFiles, workspaceGeneration, workspacePath])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch()
    },
    [handleSearch],
  )

  const handleFileClick = (node: FileTreeNode): void => {
    if (node.type === 'file') {
      if (workspacePath && isGerberFileExtension(node.extension)) {
        openTab({
          type: 'hardware-gerber',
          title: node.name,
          icon: '🧩',
          filePath: node.path,
          hardwareGerber: {
            workspacePath,
            packagePath: node.path,
            entry: node.name,
          },
        })
        return
      }
      openTab({
        type: getTabTypeForFile(node.extension),
        title: node.name,
        icon: isModelFileExtension(node.extension) ? getModelFileIcon(node.extension) : '📄',
        filePath: node.path,
      })
    }
  }

  useEffect(() => {
    requestSequence.current += 1
    setQuery(loadSearchQuery(workspacePath))
    setResults([])
    setTruncated(false)
    setSearchError(null)
    setSearching(false)
  }, [workspaceGeneration, workspacePath])

  useEffect(() => saveSearchQuery(workspacePath, query), [query, workspacePath])

  return (
    <div className="search-panel">
      <div className="search-panel-input">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索文件名..."
          className="sidebar-search-input"
        />
        <button className="search-panel-btn" onClick={handleSearch} disabled={searching}>
          <IconSearch size={14} />
        </button>
      </div>

      {searching && <div className="search-panel-status">搜索中...</div>}
      {searchError && <div className="search-panel-status error">搜索失败：{searchError}</div>}
      {truncated && <div className="search-panel-status">结果已截断，请缩小关键词范围</div>}

      {results.length > 0 && (
        <div className="search-panel-results">
          {results.map((r) => (
            <div key={r.path} className="sidebar-item file" onClick={() => handleFileClick(r)}>
              <span style={{ fontSize: 14 }}>
                {r.type === 'directory' ? '📁' : isGerberFileExtension(r.extension) ? '🧩' : '📄'}
              </span>
              <span className="file-tree-name">{r.name}</span>
            </div>
          ))}
        </div>
      )}

      {!searching && !searchError && query && results.length === 0 && (
        <div className="search-panel-empty">未找到匹配的文件</div>
      )}
    </div>
  )
}
