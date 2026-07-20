/**
 * 文件右键上下文菜单
 *
 * 渲染为 fixed 定位的浮层，点击外部 / Escape 关闭。
 * 仅对 .md 文件显示微信相关操作。
 */

import { useEffect, useRef } from 'react'
import { useContextMenuStore } from '../../stores/context-menu-store'
import { useTabStore } from '../../stores/tab-store'
import { useFsStore } from '../../stores/fs-store'
import { useAgentStore } from '../../stores/agent-store'
import { useEditorStore } from '../../stores/editor-store'
import { useToastStore } from './Toast'
import {
  buildHtmlBrowserTabDraft,
  buildHtmlTextTabDraft,
  isHtmlFileExtension,
} from '../../utils/html-files'

function toWorkspaceRelativePath(filePath: string, workspacePath: string | null): string {
  if (!workspacePath) return filePath
  const root = workspacePath.replace(/\/+$/, '')
  if (filePath === root) return '.'
  if (filePath.startsWith(root + '/')) return filePath.slice(root.length + 1)
  return filePath
}

export function ContextMenu(): React.ReactElement | null {
  const open = useContextMenuStore((s) => s.open)
  const x = useContextMenuStore((s) => s.x)
  const y = useContextMenuStore((s) => s.y)
  const node = useContextMenuStore((s) => s.node)
  const hide = useContextMenuStore((s) => s.hide)

  const openTab = useTabStore((s) => s.openTab)
  const showToast = useToastStore((s) => s.show)
  const startEditing = useFsStore((s) => s.startEditing)
  const toggleDir = useFsStore((s) => s.toggleDir)
  const refreshDir = useFsStore((s) => s.refreshDir)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const activeConversationId = useAgentStore((s) => s.activeConversationId)
  const addMountedResource = useAgentStore((s) => s.addMountedResource)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部或 Escape 关闭
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        hide()
      }
    }

    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }

    // 延迟绑定，避免触发菜单的右键事件立即关闭
    const timer = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    })

    return () => {
      cancelAnimationFrame(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, hide])

  /** 新建文件夹 */
  const handleNewFolder = (): void => {
    if (!node) return
    const parentPath =
      node.type === 'directory'
        ? node.path
        : node.path.lastIndexOf('/') > 0
          ? node.path.slice(0, node.path.lastIndexOf('/'))
          : '/'
    if (node.type === 'directory' && !node.expanded) void toggleDir(node.path)
    startEditing('new-folder', parentPath)
    hide()
  }

  /** 新建文件 */
  const handleNewFile = (): void => {
    if (!node) return
    const parentPath =
      node.type === 'directory'
        ? node.path
        : node.path.lastIndexOf('/') > 0
          ? node.path.slice(0, node.path.lastIndexOf('/'))
          : '/'
    if (node.type === 'directory' && !node.expanded) void toggleDir(node.path)
    startEditing('new-file', parentPath)
    hide()
  }

  /** 重命名 */
  const handleRename = (): void => {
    if (!node) return
    startEditing(node.path)
    hide()
  }

  /** 挂载文件或文件夹到当前会话 */
  const handleSendToSession = (): void => {
    if (!node) return
    const kind = node.type === 'directory' ? 'folder' : 'file'
    addMountedResource(
      {
        id: `${kind}:${node.path}`,
        kind,
        label: node.name,
        detail: node.path,
        ref: {
          type: kind,
          path: node.path,
        },
      },
      activeConversationId,
    )
    showToast('已发送到当前会话资源栏', 'success')
    hide()
  }

  const copyText = async (text: string, successMessage: string): Promise<void> => {
    hide()
    try {
      await navigator.clipboard.writeText(text)
      showToast(successMessage, 'success')
    } catch (err) {
      showToast('复制失败: ' + String(err), 'error')
    }
  }

  const handleCopyAbsolutePath = (): void => {
    if (!node) return
    void copyText(node.path, '已复制绝对路径')
  }

  const handleCopyRelativePath = (): void => {
    if (!node) return
    const relativePath = toWorkspaceRelativePath(node.path, workspacePath)
    void copyText(relativePath, relativePath === node.path ? '已复制路径' : '已复制相对路径')
  }

  const handleExtractZip = async (): Promise<void> => {
    if (!node || node.type !== 'file') return
    hide()
    try {
      const result = await window.cclinkStudio.fs.extractZip(node.path)
      const parentPath =
        node.path.lastIndexOf('/') > 0 ? node.path.slice(0, node.path.lastIndexOf('/')) : '/'
      await refreshDir(parentPath)
      showToast(`已解压到 ${result.targetDir}`, 'success')
    } catch (err) {
      showToast('解压失败: ' + String(err), 'error')
    }
  }

  const handleExportMarkdownZip = async (): Promise<void> => {
    if (!node || node.type !== 'file') return
    hide()
    const defaultPath = node.path.replace(/\.(?:md|markdown)$/i, '.zip')
    const dialogResult = await window.cclinkStudio.dialog.showSaveDialog({
      title: '导出 Markdown 文档包',
      defaultPath,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    })
    if (dialogResult.canceled || !dialogResult.filePath) return
    try {
      const result = await window.cclinkStudio.fs.exportMarkdownDocumentZip({
        documentPath: node.path,
        targetPath: dialogResult.filePath,
      })
      await refreshDir(parentPath(node.path))
      showToast(`已导出 ${result.entries} 个文件到 ${result.zipPath}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Markdown ZIP 导出失败', 'error')
    }
  }

  const handleTrashMarkdown = async (): Promise<void> => {
    if (!node || node.type !== 'file') return
    hide()
    try {
      const inspection = await window.cclinkStudio.fs.inspectMarkdownDocument(node.path)
      const hasAssets = inspection.assetDirectoryPresent || Boolean(inspection.legacyAssetDir)
      const confirmation = await window.cclinkStudio.dialog.showMessageBox({
        type: 'warning',
        title: '移到废纸篓',
        message: `要删除 ${node.name} 吗？`,
        detail: hasAssets
          ? '该文档有配套资源目录。你可以只删除 Markdown，或将正文和资源一起移到废纸篓。'
          : '文件将移到系统废纸篓，可以从废纸篓恢复。',
        buttons: hasAssets ? ['取消', '仅 Markdown', 'Markdown 和资源'] : ['取消', '移到废纸篓'],
        defaultId: hasAssets ? 2 : 1,
        cancelId: 0,
      })
      if (confirmation.response === 0) return
      const includeAssets = hasAssets && confirmation.response === 2
      const result = await window.cclinkStudio.fs.trashMarkdownDocument({
        documentPath: node.path,
        includeAssets,
      })
      const trashedPaths = result.trashedPaths
      const isTrashed = (filePath: string | undefined): boolean =>
        Boolean(
          filePath &&
          trashedPaths.some(
            (trashedPath) => filePath === trashedPath || filePath.startsWith(`${trashedPath}/`),
          ),
        )
      const tabStore = useTabStore.getState()
      for (const tab of [...tabStore.tabs]) {
        if (isTrashed(tab.filePath)) tabStore.closeTab(tab.id)
      }
      const editorStore = useEditorStore.getState()
      for (const filePath of Object.keys(editorStore.files)) {
        if (isTrashed(filePath)) editorStore.closeFile(filePath)
      }
      const agentStore = useAgentStore.getState()
      for (const [conversationId, conversation] of Object.entries(agentStore.conversations)) {
        for (const resource of conversation.mountedResources) {
          if (isTrashed(resource.ref.path)) {
            agentStore.removeMountedResource(resource.id, conversationId)
          }
        }
      }
      await refreshDir(parentPath(node.path))
      if (result.failedPaths.length > 0) {
        showToast(
          `Markdown 已移到废纸篓，但 ${result.failedPaths.length} 个资源目录未能移动`,
          'error',
        )
      } else {
        showToast(
          includeAssets ? 'Markdown 和资源已移到废纸篓' : 'Markdown 已移到废纸篓',
          'success',
        )
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '移到废纸篓失败', 'error')
    }
  }

  const handlePreview = (): void => {
    if (!node) return
    openTab({
      type: 'preview',
      title: `预览: ${node.name}`,
      icon: '👁️',
      filePath: node.path,
    })
    hide()
  }

  const handleOpenHtmlInBrowser = (): void => {
    if (!node || node.type !== 'file') return
    openTab(buildHtmlBrowserTabDraft(node.path, node.name))
    hide()
  }

  const handleOpenHtmlAsText = (): void => {
    if (!node || node.type !== 'file') return
    openTab(buildHtmlTextTabDraft(node.path, node.name))
    hide()
  }

  /** 导出微信格式：转换 + 复制到剪贴板 */
  const handleExport = async (): Promise<void> => {
    if (!node) return
    hide()
    try {
      const file = await window.cclinkStudio.fs.readFile(node.path)
      const content = typeof file === 'string' ? file : file.content
      const result = await window.cclinkStudio.wechat.convert(content)
      if (result.error) {
        showToast('转换失败: ' + result.error, 'error')
        return
      }
      if (!result.html) {
        showToast('转换失败: 未生成 HTML', 'error')
        return
      }
      // 复制富文本 HTML 到剪贴板
      const blob = new Blob([result.html], { type: 'text/html' })
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
      showToast('已复制，可直接粘贴到公众号', 'success')
    } catch (err) {
      showToast('导出失败: ' + String(err), 'error')
    }
  }

  if (!open || !node) return null

  const isDir = node.type === 'directory'
  const isMd = node.type === 'file' && (node.extension === '.md' || node.extension === '.markdown')
  const isHtml = node.type === 'file' && isHtmlFileExtension(node.extension)
  const isZip = node.type === 'file' && node.extension === '.zip'

  // 确保菜单不超出视口右侧和底部
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.max(8, Math.min(y, window.innerHeight - 320)),
    zIndex: 10000,
  }

  return (
    <div className="context-menu" ref={ref} style={menuStyle}>
      <div className="context-menu-items">
        {/* 通用操作 */}
        {isDir && (
          <>
            <div className="context-menu-item" onClick={handleNewFile}>
              <span className="context-menu-icon">📄</span>
              <span>新建文件</span>
            </div>
            <div className="context-menu-item" onClick={handleNewFolder}>
              <span className="context-menu-icon">📁</span>
              <span>新建文件夹</span>
            </div>
          </>
        )}
        {isHtml && (
          <>
            <div className="context-menu-item" onClick={handleOpenHtmlInBrowser}>
              <span className="context-menu-icon">🌐</span>
              <span>用浏览器打开</span>
            </div>
            <div className="context-menu-item" onClick={handleOpenHtmlAsText}>
              <span className="context-menu-icon">&lt;/&gt;</span>
              <span>以文本打开</span>
            </div>
            <div className="context-menu-separator" />
          </>
        )}
        <div className="context-menu-item" onClick={handleSendToSession}>
          <span className="context-menu-icon">↗</span>
          <span>发送到当前会话</span>
        </div>
        <div className="context-menu-item" onClick={handleRename}>
          <span className="context-menu-icon">✏️</span>
          <span>重命名</span>
        </div>
        <div className="context-menu-item" onClick={handleCopyAbsolutePath}>
          <span className="context-menu-icon">📋</span>
          <span>复制绝对路径</span>
        </div>
        <div className="context-menu-item" onClick={handleCopyRelativePath}>
          <span className="context-menu-icon">📎</span>
          <span>复制相对路径</span>
        </div>
        {isZip && (
          <div className="context-menu-item" onClick={() => void handleExtractZip()}>
            <span className="context-menu-icon">📦</span>
            <span>解压到同名文件夹</span>
          </div>
        )}
        {isMd && (
          <div className="context-menu-item" onClick={() => void handleExportMarkdownZip()}>
            <span className="context-menu-icon">📦</span>
            <span>导出 Markdown ZIP</span>
          </div>
        )}
        {!isHtml && <div className="context-menu-separator" />}

        {/* 微信格式操作 */}
        {isMd ? (
          <>
            <div className="context-menu-item" onClick={handlePreview}>
              <span className="context-menu-icon">👁️</span>
              <span>预览微信格式</span>
            </div>
            <div className="context-menu-item" onClick={handleExport}>
              <span className="context-menu-icon">📋</span>
              <span>导出微信格式</span>
            </div>
          </>
        ) : !isHtml ? (
          <div className="context-menu-item disabled">
            <span className="context-menu-icon">ℹ️</span>
            <span>微信格式仅支持 Markdown 文件</span>
          </div>
        ) : null}
        {isMd && (
          <>
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => void handleTrashMarkdown()}>
              <span className="context-menu-icon">🗑️</span>
              <span>移到废纸篓…</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function parentPath(filePath: string): string {
  const index = filePath.lastIndexOf('/')
  return index > 0 ? filePath.slice(0, index) : '/'
}
