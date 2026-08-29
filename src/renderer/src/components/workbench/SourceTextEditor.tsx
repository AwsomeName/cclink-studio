import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editor-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { buildHtmlBrowserTabDraft } from '../../utils/html-files'
import { IconGlobe } from '../common/Icons'
import { useToastStore } from '../common/Toast'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { MarkdownSourceRange } from '../../features/markdown/markdown-codec'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { registerEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import { copyTextToClipboard } from '../../utils/clipboard'
import { resolveMountedEditorSaveTarget } from '../../features/editor-save-target'

interface SourceTextEditorProps {
  filePath: string
  tabId: string
}

function sourceSelectionRange(
  content: string,
  start: number,
  end: number,
): MarkdownSourceRange | null {
  if (start === end) return null
  const beforeStart = content.slice(0, start)
  const beforeEnd = content.slice(0, end)
  const startLines = beforeStart.split('\n')
  const endLines = beforeEnd.split('\n')
  return {
    startLine: startLines.length,
    endLine: endLines.length,
    startColumn: (startLines.at(-1)?.length ?? 0) + 1,
    endColumn: (endLines.at(-1)?.length ?? 0) + 1,
    selectedText: content.slice(start, end),
    sourceSnapshot: content.slice(start, end),
  }
}

function findSourceTextMatches(
  content: string,
  query: string,
): Array<{ from: number; to: number }> {
  if (!query) return []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...content.matchAll(new RegExp(escaped, 'giu'))].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }))
}

export function SourceTextEditor({ filePath, tabId }: SourceTextEditorProps): React.ReactElement {
  const fileState = useEditorStore((state) => state.files[filePath])
  const editorFontFamily = useSettingsStore((state) => state.settings.editorFontFamily)
  const editorFontSize = useSettingsStore((state) => state.settings.editorFontSize)
  const editorWordWrap = useSettingsStore((state) => state.settings.editorWordWrap)
  const showToast = useToastStore((state) => state.show)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [activeFindIndex, setActiveFindIndex] = useState(0)
  const findMatches = useMemo(
    () => findSourceTextMatches(fileState?.currentContent ?? '', findQuery),
    [fileState?.currentContent, findQuery],
  )

  const openFind = useCallback((): void => {
    setFindOpen(true)
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [])

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const revealFindMatch = useCallback(
    (index: number): void => {
      const textarea = textareaRef.current
      const match = findMatches[index]
      if (!textarea || !match) return
      textarea.focus()
      textarea.setSelectionRange(match.from, match.to)
      const line = textarea.value.slice(0, match.from).split('\n').length - 1
      textarea.scrollTop = Math.max(0, (line - 2) * editorFontSize * 1.6)
      requestAnimationFrame(() => findInputRef.current?.focus())
    },
    [editorFontSize, findMatches],
  )

  const moveFindSelection = useCallback(
    (direction: 1 | -1): void => {
      if (findMatches.length === 0) return
      const index = (activeFindIndex + direction + findMatches.length) % findMatches.length
      setActiveFindIndex(index)
      revealFindMatch(index)
    },
    [activeFindIndex, findMatches.length, revealFindMatch],
  )

  useEffect(() => {
    setActiveFindIndex(0)
    if (findOpen && findMatches.length > 0) revealFindMatch(0)
  }, [findMatches, findOpen, revealFindMatch])

  useEffect(() => {
    let disposed = false
    void useEditorStore
      .getState()
      .openFile(filePath)
      .then(() => {
        if (!disposed) useEditorStore.getState().setDiagnostics(filePath, [])
      })
    return () => {
      disposed = true
    }
  }, [filePath])

  useEffect(() => {
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

  const handleSave = useCallback(async () => {
    try {
      const result = await useEditorStore.getState().saveFile(filePath)
      if (result === 'conflict') {
        showToast('文件已被外部修改，请选择重新载入或覆盖', 'error')
        return false
      }
      if (result === 'moved') {
        showToast('文件在保存期间已移动，请在新位置重新保存', 'error')
        return false
      }
      showToast('已保存', 'success')
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败', 'error')
      return false
    }
  }, [filePath, showToast])

  const handleOpenPreview = useCallback(async () => {
    if (useEditorStore.getState().files[filePath]?.dirty && !(await handleSave())) return
    const title = useTabStore.getState().tabs.find((tab) => tab.id === tabId)?.title
    useTabStore
      .getState()
      .openTab(buildHtmlBrowserTabDraft(filePath, title ?? filePath.split('/').pop() ?? 'HTML'))
  }, [filePath, handleSave, tabId])

  const handleReload = useCallback(async () => {
    try {
      await useEditorStore.getState().reloadFile(filePath)
      useEditorStore.getState().setDiagnostics(filePath, [])
      showToast('已重新载入磁盘版本', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重新载入失败', 'error')
    }
  }, [filePath, showToast])

  const handleOverwrite = useCallback(async () => {
    try {
      const result = await useEditorStore.getState().saveFile(filePath, { force: true })
      if (result === 'moved') {
        showToast('文件在保存期间已移动，请在新位置重新保存', 'error')
        return
      }
      showToast('已覆盖磁盘版本', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '覆盖失败', 'error')
    }
  }, [filePath, showToast])

  useEffect(() => {
    useTabStore.getState().updateTabDirty(tabId, fileState?.dirty ?? false)
  }, [fileState?.dirty, tabId])

  useEffect(() => {
    const offRead = window.cclinkStudio.editor.onReadRequest((request) => {
      const content = useEditorStore.getState().files[filePath]?.currentContent ?? ''
      window.cclinkStudio.editor.readResponse(request.id, content)
    })
    const offSave = window.cclinkStudio.editor.onSaveRequest(async (request) => {
      const target = resolveMountedEditorSaveTarget(request.filePath, filePath)
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
  }, [filePath])

  useEffect(
    () =>
      registerEditorContextSurface(tabId, {
        getSelectionText: () => {
          const textarea = textareaRef.current
          return textarea?.value.slice(textarea.selectionStart, textarea.selectionEnd) ?? ''
        },
        copy: async () => {
          const textarea = textareaRef.current
          if (!textarea) return
          await copyTextToClipboard(
            textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
          )
        },
        cut: async () => {
          const textarea = textareaRef.current
          if (!textarea) return
          const { selectionStart, selectionEnd, value } = textarea
          await copyTextToClipboard(value.slice(selectionStart, selectionEnd))
          useEditorStore
            .getState()
            .updateContent(filePath, value.slice(0, selectionStart) + value.slice(selectionEnd))
          requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(selectionStart, selectionStart)
          })
        },
        paste: async () => {
          const textarea = textareaRef.current
          if (!textarea) return
          const text = await navigator.clipboard.readText()
          const { selectionStart, selectionEnd, value } = textarea
          useEditorStore
            .getState()
            .updateContent(
              filePath,
              value.slice(0, selectionStart) + text + value.slice(selectionEnd),
            )
          requestAnimationFrame(() => {
            const cursor = selectionStart + text.length
            textarea.focus()
            textarea.setSelectionRange(cursor, cursor)
          })
        },
        selectAll: () => {
          textareaRef.current?.select()
          textareaRef.current?.focus()
        },
        openFind,
        closeFind,
        save: handleSave,
      }),
    [closeFind, filePath, handleSave, openFind, tabId],
  )

  const showEditorContextMenu = (
    textarea: HTMLTextAreaElement,
    position: { x: number; y: number },
  ): void => {
    const range = sourceSelectionRange(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    )
    useContextMenuStore.getState().show({
      target: {
        kind: 'editor',
        workspaceKey: workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef),
        tabId,
        filePath,
        editorKind: 'source',
        range,
        dirty: useEditorStore.getState().files[filePath]?.dirty ?? false,
      },
      x: position.x,
      y: position.y,
      focusReturn: textarea,
    })
  }

  if (!fileState || fileState.loading) {
    return (
      <div className="markdown-editor-wrapper">
        <div className="editor-loading">加载中...</div>
      </div>
    )
  }

  const loadError =
    fileState.error && !fileState.savedContent && !fileState.currentContent ? fileState.error : null

  return (
    <div className="markdown-editor-wrapper source-text-editor">
      <div className="source-text-toolbar">
        <span className="source-text-mode">HTML 源码</span>
        <span className="source-text-path" title={filePath}>
          {filePath}
        </span>
        <button type="button" onClick={() => void handleOpenPreview()} title="用浏览器预览">
          <IconGlobe size={14} />
          <span>预览</span>
        </button>
        <button
          type="button"
          className={fileState.dirty ? 'dirty' : ''}
          onClick={() => void handleSave()}
          title="保存"
        >
          {fileState.dirty ? '保存·' : '保存'}
        </button>
      </div>

      {findOpen && (
        <div className="markdown-find-bar" role="search" aria-label="在源码中查找">
          <input
            ref={findInputRef}
            value={findQuery}
            aria-label="查找源码文本"
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
            disabled={findMatches.length === 0}
            onClick={() => moveFindSelection(-1)}
            aria-label="上一个匹配项"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={findMatches.length === 0}
            onClick={() => moveFindSelection(1)}
            aria-label="下一个匹配项"
          >
            ↓
          </button>
          <button type="button" onClick={closeFind} aria-label="关闭查找">
            ×
          </button>
        </div>
      )}

      {fileState.externalContent !== undefined && (
        <div className="markdown-conflict-banner">
          <div>
            <strong>磁盘文件已在外部修改</strong>
            <span>当前源码尚未覆盖磁盘版本。</span>
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
          <button type="button" onClick={() => void handleOverwrite()}>
            覆盖
          </button>
        </div>
      )}

      {loadError ? (
        <div className="markdown-parse-blocked">
          <strong>无法打开文件</strong>
          <span>{loadError}</span>
          <button type="button" onClick={() => void handleReload()}>
            重试
          </button>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className={`source-text-area${editorWordWrap ? '' : ' no-wrap'}`}
          value={fileState.currentContent}
          onChange={(event) =>
            useEditorStore.getState().updateContent(filePath, event.target.value)
          }
          aria-label="HTML 源码"
          spellCheck={false}
          wrap={editorWordWrap ? 'soft' : 'off'}
          onContextMenu={(event) => {
            event.preventDefault()
            showEditorContextMenu(event.currentTarget, { x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
            event.preventDefault()
            const input = buildKeyboardContextMenuInput(
              {
                kind: 'editor',
                workspaceKey: workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef),
                tabId,
                filePath,
                editorKind: 'source',
                range: sourceSelectionRange(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart,
                  event.currentTarget.selectionEnd,
                ),
                dirty: useEditorStore.getState().files[filePath]?.dirty ?? false,
              },
              event.currentTarget,
            )
            useContextMenuStore.getState().show(input)
          }}
          style={{
            fontFamily: editorFontFamily,
            fontSize: `${editorFontSize}px`,
          }}
        />
      )}
    </div>
  )
}
