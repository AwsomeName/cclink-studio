import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
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
import { useEscapeDismiss } from '../common/dismissable-layer'
import { useFloatingSurfaceRegistration } from '../common/floating-surface-registry'
import { EditorToolbar } from './EditorToolbar'
import {
  analyzeMarkdown,
  hashMarkdownSnapshot,
  mapTopLevelSelectionToSource,
  normalizeMarkdownEditorOutput,
  scanMarkdownBlocks,
  type MarkdownDiagnostic,
  type MarkdownSourceRange,
} from '../../features/markdown/markdown-codec'
import {
  MARKDOWN_REVEAL_RANGE_EVENT,
  type MarkdownRevealRange,
} from '../../features/markdown/markdown-navigation'
import { MarkdownImage, resolveMarkdownImageSource } from '../../features/markdown/MarkdownImage'
import {
  applyMarkdownLink,
  MarkdownKeyboardShortcuts,
  MarkdownMigratedShortcutBoundary,
  runMarkdownEditorAction,
} from '../../features/markdown/markdown-editor-shortcuts'
import { createMarkdownDiagnosticReport } from '../../features/markdown/markdown-diagnostic-report'
import { MarkdownListItem } from '../../features/markdown/markdown-list-item'
import { parseMarkdownEditorDocument } from '../../features/markdown/markdown-editor-document'
import { inspectMarkdownEditorBeforeSave } from '../../features/markdown/markdown-save-guard'
import {
  findMarkdownTextMatches,
  MarkdownSearchHighlights,
  setMarkdownSearchHighlights,
  type MarkdownSearchMatch,
} from '../../features/markdown/markdown-search'
import { registerEditorSaveGuard, runEditorSaveGuard } from '../../features/editor-save-guard'
import { resolveMountedEditorSaveTarget } from '../../features/editor-save-target'
import {
  isMarkdownHydrationPending,
  setMarkdownEditorEditable,
  shouldApplyMarkdownDocumentUpdate,
} from '../../features/markdown/markdown-editor-hydration'
import type { FsMarkdownDocumentInspection } from '@shared/ipc/fs'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { registerEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  clearMarkdownDiagnosticReport,
  publishMarkdownDiagnosticReport,
  recordRendererDiagnosticLog,
} from '../../features/diagnostics/renderer-diagnostic-log'
import {
  openHttpUrlInNewBrowserTab,
  resolveBrowserLinkClick,
} from '../../features/browser/browser-link-navigation'
import { registerMarkdownViewStateFlusher } from '../../features/markdown/markdown-view-state-lifecycle'
import { getWorkspaceStateKey } from '../../utils/workspace-state'

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
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollSaveTimerRef = useRef<number | null>(null)
  const latestScrollTopRef = useRef(0)
  const restoringScrollRef = useRef(false)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const fileKeyRef = useRef(fileKey)
  const filePathRef = useRef(filePath)
  const tiptapEditorRef = useRef<Editor | null>(null)
  const saveRef = useRef<() => void | Promise<void>>(() => undefined)
  fileKeyRef.current = fileKey
  filePathRef.current = filePath

  const fileState = useEditorStore((state) => state.files[fileKey])
  const pendingCount = useEditorStore((state) => state.pendingUpdates.length)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const editorFontFamily = useSettingsStore((state) => state.settings.editorFontFamily)
  const editorFontSize = useSettingsStore((state) => state.settings.editorFontSize)
  const editorTabSize = useSettingsStore((state) => state.settings.editorTabSize)
  const editorWordWrap = useSettingsStore((state) => state.settings.editorWordWrap)
  const showToast = useToastStore((state) => state.show)
  const activeWorkspaceKey = useWorkspaceStore((state) => workspaceRefKey(state.activeWorkspaceRef))
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
  const [protectedPreviewAvailable, setProtectedPreviewAvailable] = useState(false)
  const [markdownDiagnosticLog, setMarkdownDiagnosticLog] = useState<string | null>(null)
  const [hydratedVersion, setHydratedVersion] = useState<string | null>(null)
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null)
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  useFloatingSurfaceRegistration(linkDraft !== null || imageDraft !== null)
  useEscapeDismiss(linkDraft !== null, () => setLinkDraft(null))
  useEscapeDismiss(imageDraft !== null, () => setImageDraft(null))
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [activeFindIndex, setActiveFindIndex] = useState(0)
  const appliedUpdateIds = useRef(new Set<string>())
  const loadedVersionRef = useRef<{ fileKey: string; version: string } | undefined>(undefined)
  const reloadGenerationRef = useRef(0)
  const hydratingRef = useRef(false)
  const selectionMappingWarningRef = useRef<string | null>(null)

  useEffect(() => {
    selectionMappingWarningRef.current = null
  }, [fileKey])

  useEffect(() => {
    if (markdownDiagnosticLog) {
      publishMarkdownDiagnosticReport({
        key: tabId,
        filePath,
        report: markdownDiagnosticLog,
      })
    } else {
      clearMarkdownDiagnosticReport(tabId)
    }
  }, [filePath, markdownDiagnosticLog, tabId])

  const openLinkEditor = useCallback((targetEditor: Editor): boolean => {
    const previous = targetEditor.getAttributes('link').href as string | undefined
    setLinkDraft(previous ?? 'https://')
    return true
  }, [])

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        listItem: false,
        link: false,
        underline: false,
      }),
      Markdown,
      MarkdownListItem,
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
        enableTabIndentation: true,
        tabSize: editorTabSize,
      }),
      Placeholder.configure({ placeholder: '开始输入，或让 AI 帮你写...' }),
      MarkdownImage.configure({ documentPath: filePath, inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Link.configure({ openOnClick: false, autolink: true }),
      MarkdownKeyboardShortcuts.configure({ openLinkEditor, tabSize: editorTabSize }),
      MarkdownMigratedShortcutBoundary,
      MarkdownSearchHighlights,
    ],
    [editorTabSize, filePath, openLinkEditor],
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
          click: (_view, event) => {
            const link = resolveBrowserLinkClick(event)
            if (!link) return false
            event.preventDefault()
            void openHttpUrlInNewBrowserTab({ ...link, sourceTabId: tabId })
            return true
          },
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
      onUpdate: ({ editor: currentEditor, transaction }) => {
        if (!shouldApplyMarkdownDocumentUpdate(hydratingRef.current, transaction.docChanged)) return
        const reference = useEditorStore.getState().files[fileKeyRef.current]?.currentContent
        const markdown = normalizeMarkdownEditorOutput(currentEditor.getMarkdown(), reference)
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
  tiptapEditorRef.current = editor

  const findMatches = useMemo(
    () => (editor ? findMarkdownTextMatches(editor.state.doc, findQuery) : []),
    [editor, fileState?.currentContent, findQuery],
  )

  const revealFindMatch = useCallback(
    (match: MarkdownSearchMatch): void => {
      if (!editor) return
      editor.commands.setTextSelection(match)
      editor.commands.scrollIntoView()
    },
    [editor],
  )

  const moveFindSelection = useCallback(
    (direction: 1 | -1): void => {
      if (findMatches.length === 0) return
      const nextIndex = (activeFindIndex + direction + findMatches.length) % findMatches.length
      setActiveFindIndex(nextIndex)
      revealFindMatch(findMatches[nextIndex])
    },
    [activeFindIndex, findMatches, revealFindMatch],
  )

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    window.requestAnimationFrame(() => editor?.commands.focus())
  }, [editor])

  const openFind = useCallback((): void => {
    setFindOpen(true)
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [])

  useEffect(() => {
    if (!findOpen || !findQuery || findMatches.length === 0) {
      setActiveFindIndex(0)
      return
    }
    setActiveFindIndex(0)
    revealFindMatch(findMatches[0])
  }, [findMatches, findOpen, findQuery, revealFindMatch])

  useEffect(() => {
    if (!editor) return
    setMarkdownSearchHighlights(editor, findOpen ? findMatches : [], activeFindIndex)
  }, [activeFindIndex, editor, findMatches, findOpen])

  useEffect(() => {
    setFindOpen(false)
    setFindQuery('')
    setActiveFindIndex(0)
  }, [fileKey])

  useEffect(() => {
    if (!editor) return
    return registerEditorSaveGuard(fileKey, () => {
      const current = useEditorStore.getState().files[fileKey]
      const inspection = inspectMarkdownEditorBeforeSave(editor, current?.currentContent)
      useEditorStore.getState().setDiagnostics(fileKey, inspection.diagnostics)
      if (!inspection.safeToSave) {
        throw new Error(
          inspection.diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
            '当前 Markdown 无法安全保存',
        )
      }
    })
  }, [editor, fileKey])

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
    const reference = useEditorStore.getState().files[fileKeyRef.current]?.currentContent
    const markdown = normalizeMarkdownEditorOutput(editor.getMarkdown(), reference)
    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    const mapped = mapTopLevelSelectionToSource(
      markdown,
      startIndex,
      endIndex,
      selectedText,
      editor.state.doc.childCount,
    )
    const mappingWarning = mapped.diagnostics.find(
      (diagnostic) => diagnostic.code === 'source-map-mismatch',
    )
    if (mappingWarning) {
      const warningKey = `${fileKeyRef.current}:${mappingWarning.message}`
      if (selectionMappingWarningRef.current !== warningKey) {
        selectionMappingWarningRef.current = warningKey
        recordRendererDiagnosticLog('warn', [
          '[MarkdownEditor] 选区源码映射已降级',
          {
            filePath: filePathRef.current,
            message: mappingWarning.message,
          },
        ])
      }
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
  }, [editor])

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
      openFind,
      closeFind,
      save: () => saveRef.current(),
      runMarkdownAction: (action) => runMarkdownEditorAction(editor, action, openLinkEditor),
    })
  }, [closeFind, editor, openFind, openLinkEditor, tabId])

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
    if (loadedVersionRef.current?.version === version && hydratedVersion === version) return
    if (
      loadedVersionRef.current?.fileKey === fileKey &&
      normalizeMarkdownEditorOutput(editor.getMarkdown(), fileState.currentContent) ===
        fileState.currentContent
    ) {
      loadedVersionRef.current = { fileKey, version }
      setParseBlockedReason(null)
      setProtectedPreviewAvailable(false)
      setMarkdownDiagnosticLog(null)
      setHydratedVersion(version)
      setMarkdownEditorEditable(editor, true)
      return
    }
    loadedVersionRef.current = { fileKey, version }
    setHydratedVersion(null)
    setParseBlockedReason(null)
    setProtectedPreviewAvailable(false)
    setMarkdownEditorEditable(editor, false)
    const analysis = analyzeMarkdown(fileState.currentContent)
    const initialDiagnostics = analysis.diagnostics
    useEditorStore.getState().setDiagnostics(fileKey, initialDiagnostics)
    if (!analysis.safeToEdit) {
      const reason =
        initialDiagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ??
        '当前文件包含暂不支持的 Markdown 语法'
      setParseBlockedReason(reason)
      setProtectedPreviewAvailable(false)
      const report = createMarkdownDiagnosticReport({
        filePath,
        stage: 'preflight',
        trigger: reloadGenerationRef.current > 0 ? 'reload' : 'open',
        source: fileState.currentContent,
        diagnostics: initialDiagnostics,
        versionHash: fileState.versionHash,
        modifiedAt: fileState.modifiedAt,
        dirty: fileState.dirty,
        reloadGeneration: reloadGenerationRef.current,
      })
      setMarkdownDiagnosticLog(report)
      setHydratedVersion(version)
      console.error('[MarkdownEditor] Markdown 预检查失败\n' + report)
      return
    }

    // savedContent 是旧的磁盘基线，草稿中的结构变化本来就可能与它不同。
    // 安全性应由下方的 currentContent -> serialized 回转检查判断。
    hydratingRef.current = true
    let serialized = ''
    try {
      editor.commands.setContent(parseMarkdownEditorDocument(editor, fileState.currentContent), {
        emitUpdate: false,
      })
      serialized = normalizeMarkdownEditorOutput(editor.getMarkdown(), fileState.currentContent)
    } catch (error) {
      const parserDiagnostics: MarkdownDiagnostic[] = [
        {
          code: 'parser-runtime-error',
          severity: 'error',
          message: `Markdown 解析器运行失败：${error instanceof Error ? error.message : String(error)}`,
        },
      ]
      const reason = parserDiagnostics[0].message
      useEditorStore.getState().setDiagnostics(fileKey, parserDiagnostics)
      setParseBlockedReason(reason)
      setProtectedPreviewAvailable(false)
      const report = createMarkdownDiagnosticReport({
        filePath,
        stage: 'hydrate',
        trigger: reloadGenerationRef.current > 0 ? 'reload' : 'open',
        source: fileState.currentContent,
        diagnostics: parserDiagnostics,
        versionHash: fileState.versionHash,
        modifiedAt: fileState.modifiedAt,
        dirty: fileState.dirty,
        reloadGeneration: reloadGenerationRef.current,
        editorJson: editor.getJSON(),
        error,
      })
      setMarkdownDiagnosticLog(report)
      setHydratedVersion(version)
      console.error('[MarkdownEditor] Markdown 解析器运行失败\n' + report)
      return
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
      setProtectedPreviewAvailable(true)
      const report = createMarkdownDiagnosticReport({
        filePath,
        stage: 'roundtrip',
        trigger: reloadGenerationRef.current > 0 ? 'reload' : 'open',
        source: fileState.currentContent,
        serialized,
        diagnostics: roundTrip.diagnostics,
        versionHash: fileState.versionHash,
        modifiedAt: fileState.modifiedAt,
        dirty: fileState.dirty,
        reloadGeneration: reloadGenerationRef.current,
        editorJson: editor.getJSON(),
      })
      setMarkdownDiagnosticLog(report)
      setHydratedVersion(version)
      console.error('[MarkdownEditor] Markdown 往返检查失败\n' + report)
    } else {
      setParseBlockedReason(null)
      setProtectedPreviewAvailable(false)
      setMarkdownDiagnosticLog(null)
      setHydratedVersion(version)
      setMarkdownEditorEditable(editor, true)
    }
  }, [
    editor,
    fileKey,
    fileState?.loading,
    fileState?.savedContent,
    fileState?.dirty,
    fileState?.modifiedAt,
    fileState?.versionHash,
    filePath,
    hydratedVersion,
  ])

  useEffect(() => {
    if (!editor) return
    setMarkdownEditorEditable(editor, !parseBlockedReason)
  }, [editor, parseBlockedReason])

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
        useEditorStore.getState().files[fileKeyRef.current]?.currentContent ??
        normalizeMarkdownEditorOutput(editor.getMarkdown())
      window.cclinkStudio.editor.readResponse(request.id, content)
    })
    const offSave = window.cclinkStudio.editor.onSaveRequest(async (request) => {
      const target = resolveMountedEditorSaveTarget(request.filePath, filePathRef.current)
      if (!target.ok) {
        window.cclinkStudio.editor.saveResult(request.id, false, target.error)
        return
      }
      try {
        const result = await useEditorStore.getState().saveFile(target.filePath)
        window.cclinkStudio.editor.saveResult(
          request.id,
          result === 'saved',
          result === 'conflict'
            ? '文件已被外部修改'
            : result === 'moved'
              ? '文件在保存期间已移动，请在新位置重新保存'
              : undefined,
        )
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
        editor.commands.setContent(parseMarkdownEditorDocument(editor, next), {
          emitUpdate: false,
        })
        editorChanged = true
        const serialized = normalizeMarkdownEditorOutput(editor.getMarkdown(), next)
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
          editor.commands.setContent(parseMarkdownEditorDocument(editor, current), {
            emitUpdate: false,
          })
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
    try {
      await runEditorSaveGuard(fileKey)
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
        saved.copiedAssets > 0
          ? `Markdown 与 ${saved.copiedAssets} 个资源已保存`
          : 'Markdown 已保存',
        'success',
      )
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : '另存为失败', 'error')
      return false
    }
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
      } else if (result === 'moved') {
        showToast('文件在保存期间已移动，请在新位置重新保存', 'error')
      } else {
        showToast('已保存', 'success')
        await refreshResourceInspection()
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error')
    }
  }, [filePath, handleSaveAs, refreshResourceInspection, showToast])
  saveRef.current = handleSave

  useEffect(() => {
    useTabStore.getState().updateTabDirty(tabId, dirty)
  }, [dirty, tabId])

  const handleInsertLink = useCallback(() => {
    if (!editor) return
    openLinkEditor(editor)
  }, [editor, openLinkEditor])

  const handleApplyLink = useCallback(() => {
    if (!editor || linkDraft === null) return
    applyMarkdownLink(editor, linkDraft)
    setLinkDraft(null)
  }, [editor, linkDraft])

  const handleRemoveLink = useCallback(() => {
    if (!editor) return
    applyMarkdownLink(editor, '')
    setLinkDraft(null)
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
    try {
      loadedVersionRef.current = undefined
      setHydratedVersion(null)
      reloadGenerationRef.current += 1
      await useEditorStore.getState().reloadFile(filePath)
      showToast('已重新读取磁盘版本，正在重新检查', 'info')
    } catch (error) {
      const current = useEditorStore.getState().files[filePath]
      const report = createMarkdownDiagnosticReport({
        filePath,
        stage: 'reload',
        trigger: 'reload',
        source: current?.currentContent ?? '',
        diagnostics: current?.diagnostics ?? [],
        versionHash: current?.versionHash,
        modifiedAt: current?.modifiedAt,
        dirty: current?.dirty ?? false,
        reloadGeneration: reloadGenerationRef.current,
        error,
      })
      setMarkdownDiagnosticLog(report)
      console.error('[MarkdownEditor] Markdown 重新读取失败\n' + report)
      showToast(error instanceof Error ? error.message : '重新读取失败', 'error')
    }
  }, [filePath, showToast])

  const handleCopyDiagnosticLog = useCallback(async () => {
    const current = useEditorStore.getState().files[fileKey]
    const currentDiagnostics = current?.diagnostics ?? []
    if (!markdownDiagnosticLog && currentDiagnostics.length === 0) return
    let serialized: string | undefined
    try {
      serialized = editor
        ? normalizeMarkdownEditorOutput(editor.getMarkdown(), current?.currentContent)
        : undefined
    } catch {
      serialized = undefined
    }
    const report =
      markdownDiagnosticLog ??
      createMarkdownDiagnosticReport({
        filePath,
        stage: serialized === undefined ? 'preflight' : 'roundtrip',
        trigger: reloadGenerationRef.current > 0 ? 'reload' : 'open',
        source: current?.currentContent ?? '',
        serialized,
        diagnostics: currentDiagnostics,
        versionHash: current?.versionHash,
        modifiedAt: current?.modifiedAt,
        dirty: current?.dirty ?? false,
        reloadGeneration: reloadGenerationRef.current,
        editorJson: editor?.getJSON(),
      })
    try {
      await copyTextToClipboard(report)
      showToast('Markdown 诊断日志已复制', 'success')
    } catch {
      showToast('诊断日志复制失败', 'error')
    }
  }, [editor, fileKey, filePath, markdownDiagnosticLog, showToast])

  const handleOverwrite = useCallback(async () => {
    if (!filePath) return
    const result = await useEditorStore.getState().saveFile(filePath, { force: true })
    if (result === 'moved') {
      showToast('文件在保存期间已移动，请在新位置重新保存', 'error')
      return
    }
    showToast('已覆盖磁盘版本', 'success')
  }, [filePath, showToast])

  const expectedVersion = fileState
    ? `${fileKey}:${fileState.versionHash ?? hashMarkdownSnapshot(fileState.savedContent)}`
    : ''
  const hydrationPending =
    !fileState ||
    fileState.loading ||
    isMarkdownHydrationPending({
      hasEditor: Boolean(editor),
      hydratedVersion,
      expectedVersion,
      loadedFileKey: loadedVersionRef.current?.fileKey,
      fileKey,
    })

  const persistScrollPosition = useCallback((key: string, scrollTop: number): void => {
    useEditorStore.getState().updateMarkdownViewState(key, scrollTop)
  }, [])

  const cancelScrollRestoration = useCallback((): void => {
    if (restoringScrollRef.current && scrollContainerRef.current) {
      latestScrollTopRef.current = scrollContainerRef.current.scrollTop
    }
    restoringScrollRef.current = false
  }, [])

  const handleEditorScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      if (restoringScrollRef.current) return
      latestScrollTopRef.current = event.currentTarget.scrollTop
      if (scrollSaveTimerRef.current !== null) {
        window.clearTimeout(scrollSaveTimerRef.current)
      }
      scrollSaveTimerRef.current = window.setTimeout(() => {
        scrollSaveTimerRef.current = null
        persistScrollPosition(fileKeyRef.current, latestScrollTopRef.current)
      }, 750)
    },
    [persistScrollPosition],
  )

  const flushScrollPosition = useCallback((): void => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current)
      scrollSaveTimerRef.current = null
    }
    if (!restoringScrollRef.current && scrollContainerRef.current) {
      latestScrollTopRef.current = scrollContainerRef.current.scrollTop
    }
    persistScrollPosition(fileKeyRef.current, latestScrollTopRef.current)
  }, [persistScrollPosition])

  useEffect(() => registerMarkdownViewStateFlusher(flushScrollPosition), [flushScrollPosition])

  useEffect(() => {
    const savedScrollTop = useEditorStore.getState().markdownViewStates[fileKey]?.scrollTop ?? 0
    latestScrollTopRef.current = savedScrollTop
    const ownerWorkspaceKey = activeWorkspaceKey
    return () => {
      if (scrollSaveTimerRef.current !== null) {
        window.clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = null
      }
      // 项目切换在 React 卸载旧编辑器前已 hydrate 新项目 Store。
      // 切换边界会主动 flush，此时不能再把旧项目位置写入新项目。
      if (getWorkspaceStateKey() === ownerWorkspaceKey) {
        persistScrollPosition(fileKey, latestScrollTopRef.current)
      }
    }
  }, [activeWorkspaceKey, fileKey, persistScrollPosition])

  useEffect(() => {
    if (!editor || hydrationPending) return
    const container = scrollContainerRef.current
    if (!container) return
    const savedScrollTop = latestScrollTopRef.current
    if (savedScrollTop <= 0) {
      container.scrollTop = 0
      latestScrollTopRef.current = 0
      restoringScrollRef.current = false
      return
    }

    restoringScrollRef.current = true
    latestScrollTopRef.current = savedScrollTop
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        container.scrollTop = savedScrollTop
      })
    })
    const content = editor.view.dom
    const observer = new ResizeObserver(() => {
      if (!restoringScrollRef.current) return
      container.scrollTop = savedScrollTop
      if (Math.abs(container.scrollTop - savedScrollTop) < 1) {
        restoringScrollRef.current = false
        observer.disconnect()
      }
    })
    observer.observe(content)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      restoringScrollRef.current = false
    }
  }, [editor, fileKey, hydrationPending])

  if (fileState?.loading || !fileState) {
    return (
      <div className="markdown-editor-wrapper">
        <div className="editor-loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="markdown-editor-wrapper" ref={wrapperRef}>
      <EditorToolbar
        editor={parseBlockedReason || hydrationPending ? null : editor}
        filePath={filePath}
        dirty={dirty}
        diagnosticsCount={diagnostics.length}
        onCopyDiagnostics={() => void handleCopyDiagnosticLog()}
        onSave={() => void handleSave()}
        onInsertLink={handleInsertLink}
        onInsertImage={() => void handleInsertImage()}
        onInsertTable={handleInsertTable}
        onEditImage={handleEditImage}
      />

      {findOpen && (
        <div className="markdown-find-bar" role="search" aria-label="在 Markdown 中查找">
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            aria-label="查找 Markdown 文本"
            placeholder="查找"
            spellCheck={false}
            onChange={(event) => setFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                moveFindSelection(event.shiftKey ? -1 : 1)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closeFind()
              }
            }}
          />
          <span
            className={`markdown-find-count ${findQuery && findMatches.length === 0 ? 'empty' : ''}`}
            role="status"
            aria-live="polite"
          >
            {findQuery && findMatches.length === 0
              ? '无结果'
              : `${findMatches.length === 0 ? 0 : activeFindIndex + 1}/${findMatches.length}`}
          </span>
          <button
            type="button"
            aria-label="上一个匹配项"
            title="上一个匹配项（Shift+Enter）"
            disabled={findMatches.length === 0}
            onClick={() => moveFindSelection(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="下一个匹配项"
            title="下一个匹配项（Enter）"
            disabled={findMatches.length === 0}
            onClick={() => moveFindSelection(1)}
          >
            ↓
          </button>
          <button type="button" aria-label="关闭查找" title="关闭（Esc）" onClick={closeFind}>
            ×
          </button>
        </div>
      )}

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
        ) : hydrationPending ? (
          <div className="editor-loading">正在渲染 Markdown...</div>
        ) : parseBlockedReason && !protectedPreviewAvailable ? (
          <div className="markdown-parse-blocked">
            <strong>文档未被改写</strong>
            <span>{parseBlockedReason}</span>
            {filePath && (
              <button type="button" onClick={() => void handleReload()}>
                重新载入磁盘版本
              </button>
            )}
            {markdownDiagnosticLog && (
              <button type="button" onClick={() => void handleCopyDiagnosticLog()}>
                复制诊断日志
              </button>
            )}
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className={`tiptap-editor${editorWordWrap ? '' : ' no-wrap'}${parseBlockedReason ? ' protected' : ''}`}
            onScroll={handleEditorScroll}
            onWheelCapture={cancelScrollRestoration}
            onTouchStartCapture={cancelScrollRestoration}
            onPointerDownCapture={cancelScrollRestoration}
            onKeyDownCapture={cancelScrollRestoration}
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

      {linkDraft !== null && (
        <div className="markdown-inspector-backdrop" onPointerDown={() => setLinkDraft(null)}>
          <form
            className="markdown-inspector-panel"
            role="dialog"
            aria-modal="true"
            aria-label="编辑链接"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              handleApplyLink()
            }}
          >
            <header>插入或编辑链接</header>
            <label>
              <span>地址</span>
              <input
                autoFocus
                aria-label="链接地址"
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setLinkDraft(null)
                }}
              />
            </label>
            <footer>
              {editor?.isActive('link') && (
                <button type="button" onClick={handleRemoveLink}>
                  移除链接
                </button>
              )}
              <button type="button" onClick={() => setLinkDraft(null)}>
                取消
              </button>
              <button type="submit" className="primary">
                应用
              </button>
            </footer>
          </form>
        </div>
      )}

      {imageDraft && (
        <div className="markdown-inspector-backdrop" onPointerDown={() => setImageDraft(null)}>
          <section
            className="markdown-inspector-panel"
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
