import { useCallback, useEffect, useState } from 'react'
import {
  imageMimeTypeForExtension,
  isImageFileExtension,
  isMediaFileExtension,
  isNativeMediaPreviewFileExtension,
  isVideoFileExtension,
  mediaMimeTypeForExtension,
} from '@shared/file-types'
import type { FsOfficePreviewBlock, FsRenderResult } from '@shared/ipc/fs'
import { useCommandStore } from '../../stores/command-store'
import { useToastStore } from '../common/Toast'
import { IconClipboard } from '../common/Icons'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { registerImagePreviewContextSurface } from '../../features/context-actions/image-preview-context-surface'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { copyBase64ImageToClipboard } from '../../utils/image-clipboard'

interface FilePreviewProps {
  filePath: string
  tabId: string
  workspaceKey: string | null
}

type FilePreviewState =
  | { status: 'loading' }
  | { status: 'ready'; result: FsRenderResult }
  | { status: 'error'; message: string }

export function FilePreview({
  filePath,
  tabId,
  workspaceKey,
}: FilePreviewProps): React.ReactElement {
  const [state, setState] = useState<FilePreviewState>({ status: 'loading' })
  const executeCommand = useCommandStore((store) => store.executeCommand)
  const showToast = useToastStore((store) => store.show)
  const showContextMenu = useContextMenuStore((store) => store.show)
  const imageResult =
    state.status === 'ready' && state.result.kind === 'image' ? state.result : null

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    renderFilePreview(filePath)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', result })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  const openExternal = (): void => {
    void window.cclinkStudio.fs.openPath(filePath)
  }

  useEffect(() => {
    if (!imageResult) return
    return registerImagePreviewContextSurface(tabId, {
      copyImage: () => copyBase64ImageToClipboard(imageResult.content, imageResult.mimeType),
    })
  }, [imageResult, tabId])

  const imageTarget = useCallback(
    () => ({
      kind: 'image-preview' as const,
      workspaceKey,
      tabId,
      filePath,
    }),
    [filePath, tabId, workspaceKey],
  )

  const copyImage = useCallback(async (): Promise<void> => {
    const result = await executeCommand('imagePreview.copyImage', {
      source: 'shortcut',
      target: imageTarget(),
    })
    if (!result.ok) showToast(result.message ?? '图片复制失败', 'error')
  }, [executeCommand, imageTarget, showToast])

  if (state.status === 'loading') {
    return (
      <div className="file-preview">
        <div className="file-preview-empty">加载预览中...</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="file-preview">
        <div className="file-preview-message">
          <div className="file-preview-message-title">无法预览文件</div>
          <div className="file-preview-message-detail">{state.message}</div>
          <button type="button" onClick={openExternal}>
            用系统应用打开
          </button>
        </div>
      </div>
    )
  }

  const { result } = state

  if (result.kind === 'image') {
    return (
      <div className="file-preview image">
        <div className="file-preview-toolbar">
          <div>
            <div className="file-preview-title">{result.fileName}</div>
            <div className="file-preview-path">{result.path}</div>
          </div>
          <div className="file-preview-toolbar-actions">
            <button type="button" onClick={() => void copyImage()} title="复制图片">
              <IconClipboard size={13} />
              复制图片
            </button>
            <button type="button" onClick={openExternal}>
              系统打开
            </button>
          </div>
        </div>
        <div
          className="file-preview-image-stage"
          tabIndex={0}
          aria-label={`图片预览：${result.fileName}`}
          onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
          onCopy={(event) => {
            event.preventDefault()
            void copyImage()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.currentTarget.focus({ preventScroll: true })
            showContextMenu({
              target: imageTarget(),
              x: event.clientX,
              y: event.clientY,
              focusReturn: event.currentTarget,
            })
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
            event.preventDefault()
            showContextMenu(buildKeyboardContextMenuInput(imageTarget(), event.currentTarget))
          }}
        >
          <img src={`data:${result.mimeType};base64,${result.content}`} alt={result.fileName} />
        </div>
      </div>
    )
  }

  if (result.kind === 'pdf') {
    return (
      <div className="file-preview pdf">
        <div className="file-preview-toolbar">
          <div>
            <div className="file-preview-title">{result.fileName}</div>
            <div className="file-preview-path">{result.path}</div>
          </div>
          <button type="button" onClick={openExternal}>
            系统打开
          </button>
        </div>
        <object
          className="file-preview-pdf-frame"
          data={`data:${result.mimeType};base64,${result.content}`}
          type={result.mimeType}
        >
          <div className="file-preview-message">
            <div className="file-preview-message-title">无法内嵌显示 PDF</div>
            <button type="button" onClick={openExternal}>
              用系统应用打开
            </button>
          </div>
        </object>
      </div>
    )
  }

  if (result.kind === 'media') {
    return (
      <div className="file-preview media">
        <div className="file-preview-toolbar">
          <div>
            <div className="file-preview-title">{result.fileName}</div>
            <div className="file-preview-path">{result.path}</div>
          </div>
          <button type="button" onClick={openExternal}>
            系统打开
          </button>
        </div>
        {result.playable && result.content && result.mimeType ? (
          <div className="file-preview-media-stage">
            {result.mediaKind === 'video' ? (
              <video controls src={`data:${result.mimeType};base64,${result.content}`} />
            ) : (
              <audio controls src={`data:${result.mimeType};base64,${result.content}`} />
            )}
          </div>
        ) : (
          <div className="file-preview-message">
            <div className="file-preview-message-title">已识别媒体素材</div>
            <div className="file-preview-message-detail">
              {result.reason ?? '该媒体格式需要系统播放器或转码后预览。'}
            </div>
            <button type="button" onClick={openExternal}>
              用系统应用打开
            </button>
          </div>
        )}
      </div>
    )
  }

  if (result.kind === 'office-preview') {
    return (
      <div className={`file-preview office ${result.officeKind}`}>
        <div className="file-preview-toolbar">
          <div>
            <div className="file-preview-title">{result.fileName}</div>
            <div className="file-preview-path">{result.path}</div>
          </div>
          <button type="button" onClick={openExternal}>
            系统打开
          </button>
        </div>
        <div className="file-preview-office-stage">
          <div className="file-preview-office-document">
            <div className="file-preview-office-kicker">
              {result.officeKind === 'word' ? 'Word 只读预览' : 'PowerPoint 只读预览'}
            </div>
            {result.warning && <div className="file-preview-office-warning">{result.warning}</div>}
            {result.blocks.length === 0 ? (
              <div className="file-preview-office-empty">未抽取到可预览文本内容。</div>
            ) : (
              result.blocks.map((block, index) => renderOfficePreviewBlock(block, index))
            )}
            {result.truncated && (
              <div className="file-preview-office-warning">内容较长，预览已截断。</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="file-preview">
      <div className="file-preview-message">
        <div className="file-preview-message-title">暂无内置预览器</div>
        <div className="file-preview-message-detail">{getPreviewFallbackReason(result)}</div>
        <button type="button" onClick={openExternal}>
          用系统应用打开
        </button>
      </div>
    </div>
  )
}

function getPreviewFallbackReason(result: FsRenderResult): string {
  if ('reason' in result && result.reason) return result.reason
  if (result.kind === 'media') return '此媒体文件暂不支持内嵌播放，请用系统应用打开。'
  return '此文件类型暂无内置预览器。'
}

function renderOfficePreviewBlock(block: FsOfficePreviewBlock, index: number): React.ReactElement {
  if (block.type === 'heading') {
    switch (Math.min(Math.max(block.level ?? 2, 1), 6)) {
      case 1:
        return (
          <h1 className="file-preview-office-heading" key={index}>
            {block.text}
          </h1>
        )
      case 2:
        return (
          <h2 className="file-preview-office-heading" key={index}>
            {block.text}
          </h2>
        )
      case 3:
        return (
          <h3 className="file-preview-office-heading" key={index}>
            {block.text}
          </h3>
        )
      case 4:
        return (
          <h4 className="file-preview-office-heading" key={index}>
            {block.text}
          </h4>
        )
      case 5:
        return (
          <h5 className="file-preview-office-heading" key={index}>
            {block.text}
          </h5>
        )
      default:
        return (
          <h6 className="file-preview-office-heading" key={index}>
            {block.text}
          </h6>
        )
    }
  }

  if (block.type === 'list-item') {
    return (
      <div className="file-preview-office-list-item" key={index}>
        {block.text}
      </div>
    )
  }

  if (block.type === 'table') {
    return (
      <div className="file-preview-office-table-wrap" key={index}>
        <table className="file-preview-office-table">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (block.type === 'slide') {
    return (
      <section className="file-preview-office-slide" key={index}>
        <div className="file-preview-office-slide-number">幻灯片 {block.index}</div>
        <h2>{block.title}</h2>
        {block.lines.length > 0 && (
          <ul>
            {block.lines.map((line, lineIndex) => (
              <li key={lineIndex}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <p className="file-preview-office-paragraph" key={index}>
      {block.text}
    </p>
  )
}

async function renderFilePreview(filePath: string): Promise<FsRenderResult> {
  const fsApi = window.cclinkStudio.fs as typeof window.cclinkStudio.fs & {
    renderFile?: (path: string) => Promise<FsRenderResult>
  }

  if (typeof fsApi.renderFile === 'function') {
    try {
      return await fsApi.renderFile(filePath)
    } catch (error) {
      if (!shouldUseLegacyReadFallback(error)) throw error
    }
  }

  return renderFilePreviewFromReadFile(filePath)
}

async function renderFilePreviewFromReadFile(filePath: string): Promise<FsRenderResult> {
  const extension = extensionFromPath(filePath)
  const fileName = fileNameFromPath(filePath)

  if (isImageFileExtension(extension)) {
    const mimeType = imageMimeTypeForExtension(extension)
    if (mimeType) {
      const file = await window.cclinkStudio.fs.readFile(filePath)
      const content = typeof file === 'string' ? file : file.content
      return {
        kind: 'image',
        content,
        encoding: 'base64',
        mimeType,
        fileName,
        path: filePath,
      }
    }
  }

  if (extension === '.pdf') {
    const file = await window.cclinkStudio.fs.readFile(filePath)
    const content = typeof file === 'string' ? file : file.content
    return {
      kind: 'pdf',
      content,
      encoding: 'base64',
      mimeType: 'application/pdf',
      fileName,
      path: filePath,
    }
  }

  if (isMediaFileExtension(extension)) {
    const playable = isNativeMediaPreviewFileExtension(extension)
    const mimeType = mediaMimeTypeForExtension(extension)
    const fileStat = isVideoFileExtension(extension)
      ? await window.cclinkStudio.fs.stat(filePath)
      : null
    const videoTooLarge = Boolean(fileStat && fileStat.size > 300 * 1024 * 1024)
    const file = playable && !videoTooLarge ? await window.cclinkStudio.fs.readFile(filePath) : null
    const content = file ? (typeof file === 'string' ? file : file.content) : undefined
    return {
      kind: 'media',
      mediaKind: isVideoFileExtension(extension) ? 'video' : 'audio',
      playable: playable && !videoTooLarge,
      ...(playable && !videoTooLarge
        ? {
            content,
            encoding: 'base64' as const,
          }
        : {}),
      mimeType,
      fileName,
      path: filePath,
      ...(playable && !videoTooLarge
        ? {}
        : {
            reason: videoTooLarge
              ? '视频超过 300MB，本地内嵌预览暂不加载。'
              : '该媒体格式需要系统播放器或转码为 mp4/mov/webm/m4v 后预览。',
          }),
    }
  }

  return {
    kind: 'unsupported',
    reason: '当前窗口的预览 IPC 尚未就绪。请重试或重启应用后再预览此文件。',
    fileName,
    path: filePath,
  }
}

function shouldUseLegacyReadFallback(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /renderFile is not a function|No handler registered|fs:renderFile/i.test(message)
}

function extensionFromPath(filePath: string): string {
  const fileName = fileNameFromPath(filePath)
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath
}
