import { useRef, useState, useEffect, useCallback, type DragEvent } from 'react'
import { useFsStore, useTabStore } from '../../stores'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import type { ContextTarget } from '../../features/context-actions/context-target'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import type { FileTreeNode } from '../../stores/fs-store'
import {
  IconFolder,
  IconFile,
  IconPlus,
  IconChevronRight,
  IconChevronDown,
  IconRefresh,
} from '../common/Icons'
import { getModelFileIcon, getTabTypeForFile, isModelFileExtension } from '../../utils/model-files'
import { isGerberFileExtension } from '../../utils/hardware-files'
import { buildHtmlBrowserTabDraft, isHtmlFileExtension } from '../../utils/html-files'
import { getFileTreeRefreshDirectory } from './file-tree-watch'
import { resolveFileTreeClipboardShortcut } from './file-tree-shortcuts'
import { findFileTreeNode } from '../../utils/workspace-tree'
import { useCommandStore } from '../../stores/command-store'

const FILE_TREE_SCROLL_KEY = 'cclink-studio-file-tree-scroll'

function loadFileTreeScrollTop(): number {
  try {
    if (typeof localStorage === 'undefined') return 0
    return Number(localStorage.getItem(FILE_TREE_SCROLL_KEY) ?? 0)
  } catch {
    return 0
  }
}

function saveFileTreeScrollTop(scrollTop: number): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(FILE_TREE_SCROLL_KEY, String(scrollTop))
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

/** 文件扩展名 → 图标映射 */
const FILE_ICONS: Record<string, string> = {
  '.md': '📝',
  '.txt': '📄',
  '.tsx': '⚛️',
  '.ts': '⚛️',
  '.js': '📜',
  '.css': '🎨',
  '.json': '📋',
  '.html': '🌐',
  '.htm': '🌐',
  '.py': '🐍',
  '.pdf': '📕',
  '.doc': '📘',
  '.docx': '📘',
  '.xls': '📊',
  '.xlsx': '📊',
  '.ppt': '📽️',
  '.pptx': '📽️',
  '.odt': '📘',
  '.ods': '📊',
  '.odp': '📽️',
  '.pages': '📘',
  '.numbers': '📊',
  '.key': '📽️',
  '.png': '🖼️',
  '.jpg': '🖼️',
  '.jpeg': '🖼️',
  '.webp': '🖼️',
  '.bmp': '🖼️',
  '.svg': '🖼️',
  '.mp4': '🎬',
  '.mov': '🎬',
  '.webm': '🎬',
  '.m4v': '🎬',
  '.mp3': '🎵',
  '.wav': '🎵',
  '.m4a': '🎵',
  '.aac': '🎵',
  '.flac': '🎵',
  '.ogg': '🎵',
  '.opus': '🎵',
  '.zip': '🗜️',
  '.tar': '🗜️',
  '.gz': '🗜️',
  '.tgz': '🗜️',
  '.7z': '🗜️',
  '.rar': '🗜️',
  '.fbx': getModelFileIcon('.fbx'),
  '.glb': getModelFileIcon('.glb'),
  '.gltf': getModelFileIcon('.gltf'),
}

/** 获取文件图标 */
function getFileIcon(node: FileTreeNode): string {
  if (node.type === 'directory') return ''
  if (isGerberFileExtension(node.extension)) return '🧩'
  if (isModelFileExtension(node.extension)) return getModelFileIcon(node.extension)
  return FILE_ICONS[node.extension ?? ''] ?? '📄'
}

function buildFileTarget(node: FileTreeNode, workspacePath: string | null): ContextTarget {
  return {
    kind: 'file',
    workspaceKey: workspacePath,
    path: node.path,
    name: node.name,
    fileType: node.type,
    extension: node.extension,
    expanded: node.expanded,
  }
}

function isTextEditingElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  )
}

export function FileTree(): React.ReactElement {
  const tree = useFsStore((s) => s.tree)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const loading = useFsStore((s) => s.loading)
  const error = useFsStore((s) => s.error)
  const operationError = useFsStore((s) => s.operationError)
  const picking = useFsStore((s) => s.picking)
  const openWorkspacePicker = useFsStore((s) => s.openWorkspacePicker)
  const toggleDir = useFsStore((s) => s.toggleDir)
  const editingPath = useFsStore((s) => s.editingPath)
  const newFolderParent = useFsStore((s) => s.newFolderParent)
  const startEditing = useFsStore((s) => s.startEditing)
  const setSelectedPath = useFsStore((s) => s.setSelectedPath)
  const refreshWorkspace = useFsStore((s) => s.refreshWorkspace)
  const refreshDir = useFsStore((s) => s.refreshDir)
  const confirmNewFolder = useFsStore((s) => s.confirmNewFolder)
  const confirmNewFile = useFsStore((s) => s.confirmNewFile)
  const cancelEditing = useFsStore((s) => s.cancelEditing)
  const clearOperationError = useFsStore((s) => s.clearOperationError)
  const moveEntry = useFsStore((s) => s.moveEntry)
  const openTab = useTabStore((s) => s.openTab)
  const treeRef = useRef<HTMLDivElement>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRefreshDirsRef = useRef<Set<string>>(new Set())
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  useEffect(() => {
    const el = treeRef.current
    if (!el) return
    el.scrollTop = loadFileTreeScrollTop()
    const onScroll = (): void => saveFileTreeScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) return

    let dispose: (() => void) | null = null
    let cancelled = false
    const scheduleRefresh = (event: Parameters<typeof getFileTreeRefreshDirectory>[1]): void => {
      const refreshDirectory = getFileTreeRefreshDirectory(workspacePath, event)
      if (!refreshDirectory) return
      pendingRefreshDirsRef.current.add(refreshDirectory)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        const directories = Array.from(pendingRefreshDirsRef.current)
        pendingRefreshDirsRef.current.clear()
        void Promise.all(directories.map((directory) => refreshDir(directory)))
      }, 300)
    }

    void window.cclinkStudio.fs
      .watchDir(workspacePath, scheduleRefresh)
      .then((stop) => {
        if (cancelled) {
          stop()
          return
        }
        dispose = stop
      })
      .catch((error) => {
        console.warn('[FileTree] 监听工作区目录失败:', error)
      })

    return () => {
      cancelled = true
      dispose?.()
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      pendingRefreshDirsRef.current.clear()
    }
  }, [workspacePath, refreshDir])

  /** 点击文件 → HTML 默认预览，其他文件按类型打开 */
  const handleFileClick = (node: FileTreeNode): void => {
    if (node.type === 'file') {
      setSelectedPath(node.path)
      if (workspacePath && isGerberFileExtension(node.extension)) {
        openTab({
          type: 'hardware-gerber',
          title: node.name,
          icon: getFileIcon(node),
          filePath: node.path,
          hardwareGerber: {
            workspacePath,
            packagePath: node.path,
            entry: node.name,
          },
        })
        return
      }
      if (isHtmlFileExtension(node.extension)) {
        openTab(buildHtmlBrowserTabDraft(node.path, node.name))
        return
      }
      openTab({
        type: getTabTypeForFile(node.extension),
        title: node.name,
        icon: getFileIcon(node),
        filePath: node.path,
      })
    }
  }

  /** 点击目录 → 展开/折叠 */
  const handleDirClick = (node: FileTreeNode): void => {
    if (node.type === 'directory') {
      setSelectedPath(node.path)
      toggleDir(node.path)
    }
  }

  const canDropTo = useCallback(
    (targetDir: string): boolean => {
      if (!draggingPath) return false
      if (targetDir === draggingPath || targetDir.startsWith(draggingPath + '/')) return false
      return (
        `${targetDir}/${draggingPath.slice(draggingPath.lastIndexOf('/') + 1)}` !== draggingPath
      )
    },
    [draggingPath],
  )

  const resetDragState = useCallback(() => {
    setDraggingPath(null)
    setDropTargetPath(null)
  }, [])

  const handleDragStart = useCallback((node: FileTreeNode, event: DragEvent<HTMLDivElement>) => {
    setDraggingPath(node.path)
    setDropTargetPath(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', node.path)
  }, [])

  const handleDirectoryDragOver = useCallback(
    (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (!canDropTo(node.path)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropTargetPath(node.path)
    },
    [canDropTo],
  )

  const handleDirectoryDrop = useCallback(
    (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => {
      event.stopPropagation()
      if (!draggingPath || !canDropTo(node.path)) return
      event.preventDefault()
      const sourcePath = draggingPath
      resetDragState()
      void moveEntry(sourcePath, node.path)
    },
    [canDropTo, draggingPath, moveEntry, resetDragState],
  )

  if (loading) {
    return <div className="file-tree-loading">加载中...</div>
  }

  if (error) {
    return (
      <div className="file-tree-empty">
        <div className="file-tree-empty-title">无法打开工作空间</div>
        <div className="file-tree-empty-hint">{error}</div>
        <button
          className="file-tree-empty-btn"
          onClick={() => openWorkspacePicker()}
          disabled={loading || picking}
        >
          重新选择工作空间文件夹
        </button>
      </div>
    )
  }

  if (!workspacePath) {
    return (
      <div className="file-tree-empty">
        <IconFolder size={28} />
        <div className="file-tree-empty-title">尚未打开工作空间</div>
        <div className="file-tree-empty-hint">打开一个文件夹作为工作空间</div>
        <button
          className="file-tree-empty-btn"
          onClick={() => openWorkspacePicker()}
          disabled={loading || picking}
        >
          打开工作空间文件夹
        </button>
      </div>
    )
  }

  return (
    <div className="file-tree-shell">
      <div className="file-tree-toolbar">
        <button
          className="file-tree-toolbar-btn"
          onClick={() => void refreshWorkspace()}
          title="刷新文件树"
        >
          <IconRefresh size={13} />
        </button>
        <button
          className="file-tree-toolbar-btn"
          onClick={() => startEditing('new-file', workspacePath)}
          title="新建文件"
        >
          <IconFile size={13} />
          <IconPlus size={9} className="file-tree-toolbar-plus" />
        </button>
        <button
          className="file-tree-toolbar-btn"
          onClick={() => startEditing('new-folder', workspacePath)}
          title="新建文件夹"
        >
          <IconFolder size={13} />
          <IconPlus size={9} className="file-tree-toolbar-plus" />
        </button>
      </div>
      {operationError && (
        <button
          type="button"
          className="file-tree-operation-error"
          onClick={clearOperationError}
          title="点击关闭"
        >
          {operationError}
        </button>
      )}
      <div
        className={`file-tree ${dropTargetPath === workspacePath ? 'drop-target-root' : ''}`}
        ref={treeRef}
        onKeyDown={(event) => {
          const shortcut = resolveFileTreeClipboardShortcut({
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            isComposing: event.nativeEvent.isComposing,
            isTextEditing: isTextEditingElement(event.target),
          })
          if (!shortcut) return
          const fsState = useFsStore.getState()
          if (!fsState.workspacePath || !fsState.selectedPath) return
          const node = findFileTreeNode(fsState.tree, fsState.selectedPath)
          if (!node) return
          event.preventDefault()
          event.stopPropagation()
          void useCommandStore
            .getState()
            .executeCommand(shortcut === 'copy' ? 'fileTree.copyEntry' : 'fileTree.pasteEntry', {
              source: 'shortcut',
              target: buildFileTarget(node, fsState.workspacePath),
            })
        }}
        onDragOver={(event) => {
          if (!canDropTo(workspacePath)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetPath(workspacePath)
        }}
        onDrop={(event) => {
          if (!draggingPath || !canDropTo(workspacePath)) return
          event.preventDefault()
          const sourcePath = draggingPath
          resetDragState()
          void moveEntry(sourcePath, workspacePath)
        }}
      >
        {tree.map((node) => (
          <FileTreeNodeView
            key={node.path}
            node={node}
            depth={0}
            draggingPath={draggingPath}
            dropTargetPath={dropTargetPath}
            onDirClick={handleDirClick}
            onFileClick={handleFileClick}
            onDragStart={handleDragStart}
            onDragEnd={resetDragState}
            onDirectoryDragOver={handleDirectoryDragOver}
            onDirectoryDrop={handleDirectoryDrop}
          />
        ))}
        {/* 根目录新建输入框 */}
        {editingPath === 'new-folder' && newFolderParent === workspacePath && (
          <InlineInput
            depth={0}
            icon={<IconFolder size={14} />}
            onConfirm={confirmNewFolder}
            onCancel={cancelEditing}
          />
        )}
        {editingPath === 'new-file' && newFolderParent === workspacePath && (
          <InlineInput
            depth={0}
            icon={<IconFile size={14} />}
            initialValue="未命名.md"
            onConfirm={confirmNewFile}
            onCancel={cancelEditing}
          />
        )}
      </div>
    </div>
  )
}

/** 单个树节点 */
function FileTreeNodeView({
  node,
  depth,
  draggingPath,
  dropTargetPath,
  onDirClick,
  onFileClick,
  onDragStart,
  onDragEnd,
  onDirectoryDragOver,
  onDirectoryDrop,
}: {
  node: FileTreeNode
  depth: number
  draggingPath: string | null
  dropTargetPath: string | null
  onDirClick: (node: FileTreeNode) => void
  onFileClick: (node: FileTreeNode) => void
  onDragStart: (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDirectoryDragOver: (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => void
  onDirectoryDrop: (node: FileTreeNode, event: DragEvent<HTMLDivElement>) => void
}): React.ReactElement {
  const isDir = node.type === 'directory'
  const icon = getFileIcon(node)
  const showMenu = useContextMenuStore((s) => s.show)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const editingPath = useFsStore((s) => s.editingPath)
  const newFolderParent = useFsStore((s) => s.newFolderParent)
  const confirmRename = useFsStore((s) => s.confirmRename)
  const confirmNewFolder = useFsStore((s) => s.confirmNewFolder)
  const confirmNewFile = useFsStore((s) => s.confirmNewFile)
  const cancelEditing = useFsStore((s) => s.cancelEditing)
  const selectedPath = useFsStore((s) => s.selectedPath)
  const setSelectedPath = useFsStore((s) => s.setSelectedPath)

  /** 重命名输入框（在此节点上） */
  const isRenaming = editingPath === node.path

  /** 新建文件夹输入框（在此目录的子节点列表中） */
  const isNewFolderHere = editingPath === 'new-folder' && newFolderParent === node.path
  const isNewFileHere = editingPath === 'new-file' && newFolderParent === node.path

  return (
    <div className="file-tree-node">
      {/* 节点行 */}
      <div
        className={`file-tree-item ${isDir ? 'directory' : 'file'} ${isRenaming ? 'renaming' : ''} ${selectedPath === node.path ? 'selected' : ''} ${draggingPath === node.path ? 'dragging' : ''} ${dropTargetPath === node.path ? 'drop-target' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable={!isRenaming}
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? Boolean(node.expanded) : undefined}
        onDragStart={(event) => onDragStart(node, event)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          if (isDir) onDirectoryDragOver(node, event)
          else event.stopPropagation()
        }}
        onDrop={(event) => {
          if (isDir) onDirectoryDrop(node, event)
          else event.stopPropagation()
        }}
        onClick={() => {
          if (!isRenaming) {
            if (isDir) onDirClick(node)
            else onFileClick(node)
          }
        }}
        onFocus={() => setSelectedPath(node.path)}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelectedPath(node.path)
          showMenu({
            target: buildFileTarget(node, workspacePath),
            x: e.clientX,
            y: e.clientY,
            focusReturn: e.currentTarget,
          })
        }}
        onKeyDown={(event) => {
          if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
          event.preventDefault()
          event.stopPropagation()
          showMenu(
            buildKeyboardContextMenuInput(
              buildFileTarget(node, workspacePath),
              event.currentTarget,
            ),
          )
        }}
      >
        {/* 展开/折叠箭头（目录才有） */}
        <span className="file-tree-arrow">
          {isDir &&
            (node.expanded ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />)}
        </span>

        {/* 图标 */}
        <span className="file-tree-icon">
          {isDir ? <IconFolder size={14} /> : <span style={{ fontSize: 14 }}>{icon}</span>}
        </span>

        {/* 名称 */}
        {isRenaming ? (
          <InlineInputBox
            initialValue={node.name}
            onConfirm={async (name) => {
              await confirmRename(node.path, name)
            }}
            onCancel={cancelEditing}
          />
        ) : (
          <span className="file-tree-name">{node.name}</span>
        )}
      </div>

      {/* 子节点（展开时显示） */}
      {isDir && node.expanded && node.children && (
        <div className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              draggingPath={draggingPath}
              dropTargetPath={dropTargetPath}
              onDirClick={onDirClick}
              onFileClick={onFileClick}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDirectoryDragOver={onDirectoryDragOver}
              onDirectoryDrop={onDirectoryDrop}
            />
          ))}
          {/* 在此目录下新建文件夹 */}
          {isNewFolderHere && (
            <InlineInput
              depth={depth + 1}
              icon={<IconFolder size={14} />}
              onConfirm={confirmNewFolder}
              onCancel={cancelEditing}
            />
          )}
          {isNewFileHere && (
            <InlineInput
              depth={depth + 1}
              icon={<IconFile size={14} />}
              initialValue="未命名.md"
              onConfirm={confirmNewFile}
              onCancel={cancelEditing}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 内联编辑输入框（独立行版本，用于新建文件夹）
 * 自动聚焦、Enter 确认、Escape 取消
 */
function InlineInput({
  depth,
  icon,
  initialValue = '',
  onConfirm,
  onCancel,
}: {
  depth: number
  icon: React.ReactNode
  initialValue?: string
  onConfirm: (name: string) => void | Promise<void>
  onCancel: () => void
}): React.ReactElement {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = useCallback(() => {
    if (submittedRef.current) return
    const trimmed = value.trim()
    if (!trimmed) return
    submittedRef.current = true
    void onConfirm(value)
  }, [onConfirm, value])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        submittedRef.current = true
        onCancel()
      }
    },
    [submit, onCancel],
  )

  return (
    <div className="file-tree-item inline-editing" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
      <span className="file-tree-icon">{icon}</span>
      <input
        ref={inputRef}
        className="file-tree-rename-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={submit}
      />
    </div>
  )
}

/**
 * 内联编辑输入框（内嵌在节点行中使用，用于重命名）
 * 自动聚焦、Enter 确认、Escape 取消
 */
function InlineInputBox({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string
  onConfirm: (name: string) => void | Promise<void>
  onCancel: () => void
}): React.ReactElement {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    // 选中文件名（不含扩展名）
    const dotIndex = initialValue.lastIndexOf('.')
    const selEnd = dotIndex > 0 ? dotIndex : initialValue.length
    inputRef.current?.setSelectionRange(0, selEnd)
  }, [initialValue])

  const submit = useCallback(() => {
    if (submittedRef.current) return
    const trimmed = value.trim()
    if (!trimmed) return
    submittedRef.current = true
    void onConfirm(value)
  }, [onConfirm, value])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        submittedRef.current = true
        onCancel()
      }
    },
    [submit, onCancel],
  )

  return (
    <input
      ref={inputRef}
      className="file-tree-rename-input inline"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={submit}
    />
  )
}
