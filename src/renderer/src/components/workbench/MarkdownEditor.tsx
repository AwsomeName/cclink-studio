import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Link from '@tiptap/extension-link'
import { common, createLowlight } from 'lowlight'
import { useEditorStore } from '../../stores/editor-store'
import { useTabStore } from '../../stores/tab-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useCommandStore } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useToastStore } from '../common/Toast'
import { EditorToolbar } from './EditorToolbar'
import {
  analyzeMarkdown,
  hashMarkdownSnapshot,
  mapTopLevelSelectionToSource,
  scanMarkdownBlocks,
  type MarkdownSourceRange,
} from '../../features/markdown/markdown-codec'
import {
  MARKDOWN_REVEAL_RANGE_EVENT,
  type MarkdownRevealRange,
} from '../../features/markdown/markdown-navigation'
import { MarkdownImage, resolveMarkdownImageSource } from '../../features/markdown/MarkdownImage'
import type { FsMarkdownDocumentInspection } from '@shared/ipc/fs'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { registerEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { copyTextToClipboard } from '../../utils/clipboard'

const lowlight = createLowlight(common)

interface MarkdownEditorProps {
  filePath?: string
  tabId: string
}

interface ImageDraft {
  source: string
  alt: string
  title: string
}

export function MarkdownEditor({ filePath, tabId }: MarkdownEditorProps): React.ReactElement {
  const fileKey = filePath ?? `virtual:${tabId}`
  const fileKeyRef = useRef(fileKey)
  const filePathRef = useRef(filePath)
  fileKeyRef.current = fileKey
  filePathRef.current = filePath

  const fileState = useEditorStore((state) => state.files[fileKey])
  const pendingCount = useEditorStore((state) => state.pendingUpdates.length)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const editorFontFamily = useSettingsStore((state) => state.settings.editorFontFamily)
  const editorFontSize = useSettingsStore((state) => state.settings.editorFontSize)
  const editorWordWrap = useSettingsStore((state) => state.settings.editorWordWrap)
  const showToast = useToastStore((state) => state.show)
  const dirty = fileState?.dirty ?? false
  const diagnostics = fileState?.diagnostics ?? []
  const loadError =
    fileState?.error && !fileState.savedContent && !fileState.currentContent
      ? fileState.error
      : null
  const [selectionRange, setSelectionRange] = useState<MarkdownSourceRange | null>(null)
  const [resourceInspection, setResourceInspection] = useState<FsMarkdownDocumentInspection | null>(
    null,
  )
  const [parseBlockedReason, setParseBlockedReason] = useState<string | null>(null)
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null)
  const appliedUpdateIds = useRef(new Set<string>())
  const loadedVersionRef = useRef<string | undefined>(undefined)
  const hydratingRef = useRef(false)

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Markdown,
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
      Placeholder.configure({ placeholder: '开始输入，或让 AI 帮你写...' }),
      MarkdownImage.configure({ documentPath: filePath, inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    [filePath],
  )

  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: { class: 'tiptap' },
        handlePaste: (_view, event) => {
          const image = Array.from(event.clipboardData?.files ?? []).find((file) =>
            file.type.startsWith('image/'),
          )
          if (!image) return false
          event.preventDefault()
          void saveClipboardImage(image)
          return true
        },
        handleDrop: (_view, event) => {
          const image = Array.from(event.dataTransfer?.files ?? []).find((file) =>
            file.type.startsWith('image/'),
          )
          if (!image) return false
          event.preventDefault()
          void saveClipboardImage(image)
          return true
        },
        handleDOMEvents: {
          contextmenu: (_view, event) => {
            const range = currentWysiwygSelection()
            const element = event.target instanceof Element ? event.target : null
            const linkUrl = element?.closest('a')?.getAttribute('href') ?? null
            const imageSrc = element?.closest('img')?.getAttribute('src') ?? null
            event.preventDefault()
            const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
            useContextMenuStore.getState().show({
              target: {
                kind: 'editor',
                workspaceKey: workspaceRefKey(activeWorkspaceRef),
                tabId,
                filePath: filePathRef.current ?? '',
                editorKind: 'markdown',
                range,
                dirty: useEditorStore.getState().files[fileKeyRef.current]?.dirty ?? false,
                linkUrl,
                imageSrc,
              },
              x: event.clientX,
              y: event.clientY,
              focusReturn: event.target instanceof HTMLElement ? event.target : null,
            })
            return true
          },
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (hydratingRef.current) return
        const markdown = currentEditor.getMarkdown()
        useEditorStore.getState().updateContent(fileKeyRef.current, markdown)
        const analysis = analyzeMarkdown(markdown)
        useEditorStore.getState().setDiagnostics(fileKeyRef.current, analysis.diagnostics)
      },
      onSelectionUpdate: () => {
        setSelectionRange(currentWysiwygSelection())
      },
    },
    [extensions],
  )

  const currentWysiwygSelection = useCallback((): MarkdownSourceRange | null => {
    if (!editor) return null
    const { from, to } = editor.state.selection
    if (from === to) return null
    let startIndex = 0
    let endIndex = 0
    let foundStart = false
    editor.state.doc.forEach((node, offset, index) => {
      const nodeStart = offset + 1
      const nodeEnd = offset + node.nodeSize
      if (!foundStart && to >= nodeStart && from <= nodeEnd) {
        startIndex = index
        foundStart = true
      }
      if (to >= nodeStart && from <= nodeEnd) endIndex = index
    })
    const markdown = editor.getMarkdown()
    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    const mapped = mapTopLevelSelectionToSource(
      markdown,
      startIndex,
      endIndex,
      selectedText,
      editor.state.doc.childCount,
    )
    if (mapped.diagnostics.length > 0) {
      useEditorStore
        .getState()
        .setDiagnostics(fileKeyRef.current, [...diagnostics, ...mapped.diagnostics])
    }
    if (!mapped.range) return null
    const sourceLineOffset =
      useEditorStore.getState().files[fileKeyRef.current]?.sourceLineOffset ?? 0
    return sourceLineOffset > 0
      ? {
          ...mapped.range,
          startLine: mapped.range.startLine + sourceLineOffset,
          endLine: mapped.range.endLine + sourceLineOffset,
        }
      : mapped.range
  }, [diagnostics, editor])

  useEffect(() => {
    if (!editor) return
    return registerEditorContextSurface(tabId, {
      getSelectionText: () => {
        const { from, to } = editor.state.selection
        return from === to ? '' : editor.state.doc.textBetween(from, to, '\n')
      },
      copy: async () => {
        const { from, to } = editor.state.selection
        if (from !== to) await copyTextToClipboard(editor.state.doc.textBetween(from, to, '\n'))
      },
      cut: async () => {
        const { from, to } = editor.state.selection
        if (from === to) return
        await copyTextToClipboard(editor.state.doc.textBetween(from, to, '\n'))
        editor.chain().focus().deleteSelection().run()
      },
      paste: async () => {
        const text = await navigator.clipboard.readText()
        editor.chain().focus().insertContent(text).run()
      },
      selectAll: () => {
        editor.chain().focus().selectAll().run()
      },
    })
  }, [editor, tabId])

  const saveClipboardImage = useCallback(
    async (image: File) => {
      const currentPath = filePathRef.current
      if (!currentPath || !editor) {
        showToast('请先保存 Markdown 文件，再粘贴或拖入本地图片', 'info')
        return
      }
      try {
        const content = arrayBufferToBase64(await image.arrayBuffer())
        const asset = await window.cclinkStudio.fs.saveDocumentAsset({
          documentPath: currentPath,
          fileName: image.name || `pasted-${Date.now()}.png`,
          mimeType: image.type || 'image/png',
          content,
          encoding: 'base64',
        })
        insertImageNode(editor, asset.path, asset.relativePath)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '图片导入失败', 'error')
      }
    },
    [editor, showToast],
  )

  const refreshResourceInspection = useCallback(async () => {
    if (!filePath) {
      setResourceInspection(null)
      return
    }
    try {
      setResourceInspection(await window.cclinkStudio.fs.inspectMarkdownDocument(filePath))
    } catch (error) {
      console.warn('[MarkdownEditor] 资源完整性检查失败:', error)
      setResourceInspection(null)
    }
  }, [filePath])

  useEffect(() => {
    if (filePath) void useEditorStore.getState().openFile(filePath)
    else {
      const seed = useTabStore.getState().tabs.find((tab) => tab.id === tabId)?.initialContent ?? ''
      useEditorStore.getState().initVirtualFile(fileKey, seed)
    }
  }, [fileKey, filePath, tabId])

  useEffect(() => {
    if (!fileState?.loading && fileState?.versionHash) void refreshResourceInspection()
  }, [fileState?.loading, fileState?.versionHash, refreshResourceInspection])

  useEffect(() => {
    if (!editor || !fileState || fileState.loading) return
    const version = `${fileKey}:${fileState.versionHash ?? hashMarkdownSnapshot(fileState.savedContent)}`
    if (loadedVersionRef.current === version) return
    loadedVersionRef.current = version
    const analysis = analyzeMarkdown(fileState.currentContent)
    const initialDiagnostics = analysis.diagnostics
    useEditorStore.getState().setDiagnostics(fileKey, initialDiagnostics)
    if (!analysis.safeToEdit) {
      const reason =
        initialDiagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
        '当前文件包含暂不支持的 Markdown 语法'
      setParseBlockedReason(reason)
      showToast(reason, 'error')
      return
    }

    // savedContent 是旧的磁盘基线，草稿中的结构变化本来就可能与它不同。
    // 安全性应由下方的 currentContent -> serialized 回转检查判断。
    hydratingRef.current = true
    let serialized = ''
    try {
      editor.commands.setContent(fileState.currentContent, {
        contentType: 'markdown',
        emitUpdate: false,
      })
      serialized = editor.getMarkdown()
    } finally {
      hydratingRef.current = false
    }
    const roundTrip = analyzeMarkdown(fileState.currentContent, serialized)
    useEditorStore.getState().setDiagnostics(fileKey, roundTrip.diagnostics)
    if (!roundTrip.safeToSave) {
      const reason =
        roundTrip.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
        'Markdown 解析结果不安全'
      setParseBlockedReason(reason)
      showToast(reason, 'error')
    } else {
      setParseBlockedReason(null)
    }
  }, [
    editor,
    fileKey,
    fileState?.loading,
    fileState?.savedContent,
    fileState?.versionHash,
    showToast,
  ])

  useEffect(() => {
    if (!filePath) return
    const directory = filePath.slice(0, filePath.lastIndexOf('/')) || '/'
    let stop: (() => void) | undefined
    let disposed = false
    void window.cclinkStudio.fs
      .watchDir(directory, (event) => {
        if (event.filePath !== filePath) return
        void useEditorStore.getState().checkExternalChange(filePath)
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else stop = unsubscribe
      })
    return () => {
      disposed = true
      stop?.()
    }
  }, [filePath])

  useEffect(() => {
    const reveal = (event: Event): void => {
      const detail = (event as CustomEvent<MarkdownRevealRange>).detail
      const matchesFile = Boolean(filePath && detail.filePath === filePath)
      const matchesVirtualTab = Boolean(!filePath && detail.tabId === tabId)
      if (!editor || (!matchesFile && !matchesVirtualTab)) return
      const markdown = useEditorStore.getState().files[fileKey]?.currentContent ?? ''
      const sourceLineOffset = useEditorStore.getState().files[fileKey]?.sourceLineOffset ?? 0
      const requestedStartLine = Math.max(1, detail.startLine - sourceLineOffset)
      const requestedEndLine = Math.max(requestedStartLine, detail.endLine - sourceLineOffset)
      const blocks = scanMarkdownBlocks(markdown)
      const startIndex = Math.max(
        0,
        blocks.findIndex((block) => block.endLine >= requestedStartLine),
      )
      const endMatch = blocks.findIndex((block) => block.endLine >= requestedEndLine)
      const endIndex = endMatch >= 0 ? endMatch : Math.max(0, blocks.length - 1)
      let from = 1
      let to = editor.state.doc.content.size
      editor.state.doc.forEach((node, offset, index) => {
        if (index === startIndex) from = offset + 1
        if (index === endIndex) to = Math.min(editor.state.doc.content.size, offset + node.nodeSize)
      })
      editor.commands.setTextSelection({ from, to })
      editor.commands.scrollIntoView()
      editor.commands.focus()
    }
    window.addEventListener(MARKDOWN_REVEAL_RANGE_EVENT, reveal)
    return () => window.removeEventListener(MARKDOWN_REVEAL_RANGE_EVENT, reveal)
  }, [editor, fileKey, filePath, tabId])

  useEffect(() => {
    if (!editor) return
    const offRead = window.cclinkStudio.editor.onReadRequest((request) => {
      const content =
        useEditorStore.getState().files[fileKeyRef.current]?.currentContent ?? editor.getMarkdown()
      window.cclinkStudio.editor.readResponse(request.id, content)
    })
    const offSave = window.cclinkStudio.editor.onSaveRequest(async (request) => {
      const targetPath = request.filePath ?? filePathRef.current
      if (!targetPath) {
        window.cclinkStudio.editor.saveResult(request.id, false, '无文件路径')
        return
      }
      try {
        if (targetPath === filePathRef.current) {
          const result = await useEditorStore.getState().saveFile(targetPath)
          window.cclinkStudio.editor.saveResult(
            request.id,
            result === 'saved',
            result === 'conflict' ? '文件已被外部修改' : undefined,
          )
        } else {
          const content = useEditorStore.getState().files[fileKeyRef.current]?.currentContent ?? ''
          await window.cclinkStudio.fs.saveTextDocument({ filePath: targetPath, content })
          window.cclinkStudio.editor.saveResult(request.id, true)
        }
      } catch (error) {
        window.cclinkStudio.editor.saveResult(
          request.id,
          false,
          error instanceof Error ? error.message : '保存失败',
        )
      }
    })
    return () => {
      offRead()
      offSave()
    }
  }, [editor])

  useEffect(() => {
    if (!editor || pendingCount === 0) return
    const updates = useEditorStore.getState().consumePendingUpdates(filePath)
    for (const update of updates) {
      if (appliedUpdateIds.current.has(update.id)) continue
      appliedUpdateIds.current.add(update.id)
      const currentState = useEditorStore.getState().files[fileKey]
      const current = currentState?.currentContent ?? ''
      const previousDiagnostics = currentState?.diagnostics ?? []
      const next =
        update.type === 'write'
          ? update.content
          : update.type === 'append' || update.position !== 'start'
            ? joinMarkdown(current, update.content)
            : joinMarkdown(update.content, current)
      let editorChanged = false
      try {
        const inputAnalysis = analyzeMarkdown(next)
        if (!inputAnalysis.safeToEdit) {
          throw new Error(
            inputAnalysis.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
              ?.message ?? 'Agent 内容包含当前版本不支持的 Markdown 语法',
          )
        }

        hydratingRef.current = true
        editor.commands.setContent(next, { contentType: 'markdown', emitUpdate: false })
        editorChanged = true
        const serialized = editor.getMarkdown()
        const roundTrip = analyzeMarkdown(next, serialized)
        if (!roundTrip.safeToSave) {
          throw new Error(
            roundTrip.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
              'Agent 内容无法安全转换为所见即所得文档',
          )
        }

        useEditorStore.getState().updateContent(fileKey, serialized)
        useEditorStore.getState().setDiagnostics(fileKey, roundTrip.diagnostics)
        void window.cclinkStudio.editor.contentUpdateAck(update.id, true)
      } catch (error) {
        if (editorChanged) {
          editor.commands.setContent(current, { contentType: 'markdown', emitUpdate: false })
        }
        useEditorStore.getState().setDiagnostics(fileKey, previousDiagnostics)
        const message = error instanceof Error ? error.message : 'Agent 内容更新失败'
        showToast(message, 'error')
        void window.cclinkStudio.editor.contentUpdateAck(update.id, false, message)
      } finally {
        hydratingRef.current = false
      }
    }
  }, [editor, fileKey, filePath, pendingCount, showToast])

  const handleSaveAs = useCallback(async () => {
    const content = useEditorStore.getState().files[fileKey]?.currentContent ?? ''
    const result = await window.cclinkStudio.dialog.showSaveDialog({
      title: '另存为',
      defaultPath: filePath?.split('/').pop() ?? '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
    if (result.canceled || !result.filePath) return false
    const saved = await window.cclinkStudio.fs.saveMarkdownDocumentAs({
      ...(filePath ? { sourcePath: filePath } : {}),
      targetPath: result.filePath,
      content,
    })
    useEditorStore.getState().rebaseFilePaths(fileKey, saved.filePath)
    await useEditorStore.getState().reloadFile(saved.filePath)
    useTabStore.getState().updateTabFilePath(tabId, result.filePath)
    useTabStore.getState().updateTabTitle(tabId, saved.filePath.split('/').pop() ?? 'Markdown')
    showToast(
      saved.copiedAssets > 0 ? `Markdown 与 ${saved.copiedAssets} 个资源已保存` : 'Markdown 已保存',
      'success',
    )
    return true
  }, [fileKey, filePath, showToast, tabId])

  const handleSave = useCallback(async () => {
    try {
      if (!filePath) {
        await handleSaveAs()
        return
      }
      const result = await useEditorStore.getState().saveFile(filePath)
      if (result === 'conflict') {
        showToast('文件已被外部修改，请选择重新载入、另存为或覆盖', 'error')
      } else {
        showToast('已保存', 'success')
        await refreshResourceInspection()
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error')
    }
  }, [filePath, handleSaveAs, refreshResourceInspection, showToast])

  useEffect(() => {
    const save = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', save)
    return () => window.removeEventListener('keydown', save)
  }, [handleSave])

  useEffect(() => {
    useTabStore.getState().updateTabDirty(tabId, dirty)
  }, [dirty, tabId])

  const handleInsertLink = useCallback(() => {
    if (!editor) return
    const previous = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('链接地址', previous ?? 'https://')
    if (href === null) return
    if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
  }, [editor])

  const handleInsertImage = useCallback(async () => {
    if (!editor || !filePath) {
      showToast('请先保存 Markdown 文件，再插入本地图片', 'info')
      return
    }
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      title: '插入图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    })
    const sourcePath = result.filePaths[0]
    if (result.canceled || !sourcePath) return
    try {
      const asset = await window.cclinkStudio.fs.importDocumentAsset(filePath, sourcePath)
      insertImageNode(editor, asset.path, asset.relativePath)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '图片导入失败', 'error')
    }
  }, [editor, filePath, showToast])

  const handleInsertTable = useCallback(() => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }, [editor])

  const handleEditImage = useCallback(() => {
    if (!editor || !editor.isActive('image')) return
    const attributes = editor.getAttributes('image')
    setImageDraft({
      source: String(attributes.markdownSrc ?? attributes.src ?? ''),
      alt: String(attributes.alt ?? ''),
      title: String(attributes.title ?? ''),
    })
  }, [editor])

  const handleApplyImage = useCallback(() => {
    if (!editor || !imageDraft) return
    const source = imageDraft.source.trim()
    if (!source) {
      showToast('图片地址不能为空', 'error')
      return
    }
    editor
      .chain()
      .focus()
      .updateAttributes('image', {
        src: resolveMarkdownImageSource(source, filePath),
        markdownSrc: source,
        alt: imageDraft.alt.trim() || null,
        title: imageDraft.title.trim() || null,
      })
      .run()
    setImageDraft(null)
  }, [editor, filePath, imageDraft, showToast])

  const sendSelectionToConversation = useCallback(
    (range: MarkdownSourceRange) => {
      const workspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
      void executeCommand('markdown.sendSelectionToConversation', {
        source: 'toolbar',
        target: {
          kind: 'markdown-selection',
          workspaceKey,
          tabId,
          filePath: filePath ?? '',
          range,
          dirty,
        },
      }).then((result) => {
        if (!result.ok) showToast(result.message ?? '无法发送选区', 'error')
      })
    },
    [dirty, executeCommand, filePath, showToast, tabId],
  )

  const handleReload = useCallback(async () => {
    if (!filePath) return
    await useEditorStore.getState().reloadFile(filePath)
    showToast('已重新载入磁盘版本', 'success')
  }, [filePath, showToast])

  const handleOverwrite = useCallback(async () => {
    if (!filePath) return
    await useEditorStore.getState().saveFile(filePath, { force: true })
    showToast('已覆盖磁盘版本', 'success')
  }, [filePath, showToast])

  if (fileState?.loading || !fileState) {
    return (
      <div className="markdown-editor-wrapper">
        <div className="editor-loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="markdown-editor-wrapper">
      <EditorToolbar
        editor={editor}
        filePath={filePath}
        dirty={dirty}
        diagnosticsCount={diagnostics.length}
        onSave={() => void handleSave()}
        onInsertLink={handleInsertLink}
        onInsertImage={() => void handleInsertImage()}
        onInsertTable={handleInsertTable}
        onEditImage={handleEditImage}
      />

      {fileState.externalContent !== undefined && (
        <div className="markdown-conflict-banner">
          <div>
            <strong>磁盘文件已在外部修改</strong>
            <span>当前草稿尚未覆盖磁盘版本。</span>
          </div>
          <details>
            <summary>查看源码差异</summary>
            <div className="markdown-conflict-diff">
              <pre>{fileState.currentContent}</pre>
              <pre>{fileState.externalContent}</pre>
            </div>
          </details>
          <button type="button" onClick={() => void handleReload()}>
            重新载入
          </button>
          <button type="button" onClick={() => void handleSaveAs()}>
            另存为
          </button>
          <button type="button" onClick={() => void handleOverwrite()}>
            覆盖
          </button>
        </div>
      )}

      {diagnostics.length > 0 && (
        <details className="markdown-diagnostics">
          <summary>兼容性提示 ({diagnostics.length})</summary>
          {diagnostics.map((diagnostic, index) => (
            <div key={`${diagnostic.code}-${index}`} className={diagnostic.severity}>
              {diagnostic.message}
            </div>
          ))}
        </details>
      )}

      {resourceInspection && resourceInspection.warnings.length > 0 && (
        <details className="markdown-diagnostics markdown-resource-diagnostics">
          <summary>资源完整性提示 ({resourceInspection.warnings.length})</summary>
          {resourceInspection.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
          {resourceInspection.missingAssets.map((asset) => (
            <div key={`missing-${asset}`} className="error">
              缺失: {asset}
            </div>
          ))}
          <button type="button" onClick={() => void refreshResourceInspection()}>
            重新检查
          </button>
        </details>
      )}

      <div className="markdown-editor-body">
        {loadError ? (
          <div className="markdown-parse-blocked">
            <strong>无法打开文档</strong>
            <span>{loadError}</span>
            {filePath && (
              <button
                type="button"
                onClick={() => void useEditorStore.getState().openFile(filePath)}
              >
                重试
              </button>
            )}
          </div>
        ) : parseBlockedReason ? (
          <div className="markdown-parse-blocked">
            <strong>文档未被改写</strong>
            <span>{parseBlockedReason}</span>
            {filePath && (
              <button type="button" onClick={() => void handleReload()}>
                重新载入磁盘版本
              </button>
            )}
          </div>
        ) : (
          <div
            className={`tiptap-editor${editorWordWrap ? '' : ' no-wrap'}`}
            style={
              {
                '--markdown-font-family': editorFontFamily,
                '--markdown-font-size': `${editorFontSize}px`,
              } as React.CSSProperties
            }
          >
            {editor && <EditorContent editor={editor} />}
          </div>
        )}
      </div>

      {imageDraft && (
        <div className="markdown-inspector-backdrop" onPointerDown={() => setImageDraft(null)}>
          <section
            className="markdown-image-inspector"
            role="dialog"
            aria-modal="true"
            aria-label="编辑图片"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>编辑图片</header>
            <label>
              <span>地址</span>
              <input
                value={imageDraft.source}
                onChange={(event) =>
                  setImageDraft((current) =>
                    current ? { ...current, source: event.target.value } : current,
                  )
                }
              />
            </label>
            <label>
              <span>替代文本</span>
              <input
                value={imageDraft.alt}
                onChange={(event) =>
                  setImageDraft((current) =>
                    current ? { ...current, alt: event.target.value } : current,
                  )
                }
              />
            </label>
            <label>
              <span>标题</span>
              <input
                value={imageDraft.title}
                onChange={(event) =>
                  setImageDraft((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
              />
            </label>
            <footer>
              <button type="button" onClick={() => setImageDraft(null)}>
                取消
              </button>
              <button type="button" className="primary" onClick={handleApplyImage}>
                应用
              </button>
            </footer>
          </section>
        </div>
      )}

      {selectionRange && (
        <div className="markdown-selection-toolbar">
          <span>
            L{selectionRange.startLine}-L{selectionRange.endLine}
          </span>
          <button type="button" onClick={() => sendSelectionToConversation(selectionRange)}>
            发给会话
          </button>
        </div>
      )}
    </div>
  )
}

function insertImageNode(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  path: string,
  relativePath: string,
): void {
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'image',
      attrs: {
        src: resolveMarkdownImageSource(path),
        markdownSrc: relativePath,
        alt: path.split('/').pop() ?? 'image',
      },
    })
    .run()
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function joinMarkdown(first: string, second: string): string {
  if (!first.trim()) return second
  if (!second.trim()) return first
  return `${first.replace(/\s+$/, '')}\n\n${second.replace(/^\s+/, '')}`
}
