/**
 * 微信公众号格式预览组件
 *
 * 在 preview Tab 中渲染，读取 .md 文件 → IPC 转换 → 模拟手机预览。
 * 提供「复制到公众号」和「保存为 HTML」两个操作。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useToastStore } from '../../common/Toast'

interface WeChatPreviewProps {
  filePath: string
}

const WECHAT_PREVIEW_CSP = [
  "default-src 'none'",
  'img-src https: http: data: blob:',
  "style-src 'unsafe-inline'",
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function buildWechatPreviewDocument(html: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${WECHAT_PREVIEW_CSP}">
  <meta name="referrer" content="no-referrer">
  <style>
    html, body { min-height: 100%; margin: 0; }
    body { box-sizing: border-box; padding: 20px 16px; background: #fff; overflow-wrap: anywhere; }
  </style>
</head>
<body>${html}</body>
</html>`
}

export function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function WeChatPreviewFrame({ html }: { html: string }): React.ReactElement {
  return (
    <iframe
      className="wechat-preview-body"
      title="微信公众号内容预览"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={buildWechatPreviewDocument(html)}
    />
  )
}

export function WeChatPreview({ filePath }: WeChatPreviewProps): React.ReactElement {
  const [html, setHtml] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [embeddedImages, setEmbeddedImages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const showToast = useToastStore((s) => s.show)

  // 读取文件并转换
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        setLoading(true)
        setError('')
        setWarnings([])
        setEmbeddedImages(0)
        const file = await window.cclinkStudio.fs.readFile(filePath)
        const content = typeof file === 'string' ? file : file.content
        const result = await window.cclinkStudio.wechat.convert(content, filePath)
        if (result.error) {
          if (!cancelled) setError(result.error)
        } else if (!result.html) {
          if (!cancelled) setError('未生成 HTML')
        } else {
          if (!cancelled) {
            setHtml(result.html)
            setWarnings(result.warnings ?? [])
            setEmbeddedImages(result.embeddedImages ?? 0)
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [filePath])

  /** 复制到剪贴板 */
  const handleCopy = useCallback(async () => {
    if (!html) return
    try {
      const blob = new Blob([html], { type: 'text/html' })
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
      showToast(
        warnings.length > 0
          ? `已复制，${warnings.length} 张图片需要检查`
          : `已复制${embeddedImages > 0 ? `，包含 ${embeddedImages} 张本地图片` : ''}`,
        warnings.length > 0 ? 'info' : 'success',
      )
    } catch (err) {
      showToast('复制失败: ' + String(err), 'error')
    }
  }, [embeddedImages, html, showToast, warnings.length])

  /** 保存为 HTML 文件 */
  const handleSave = useCallback(async () => {
    if (!html) return
    try {
      const fileName = filePath.split('/').pop()?.replace(/\.md$/i, '') ?? 'wechat'
      const result = await window.cclinkStudio.dialog.showSaveDialog({
        title: '保存为 HTML 文件',
        defaultPath: `${fileName}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      })
      if (result && !result.canceled && result.filePath) {
        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${escapeHtmlText(fileName)}</title></head>
<body style="background:#fff;padding:20px;">${html}</body>
</html>`
        await window.cclinkStudio.fs.writeFile(result.filePath, fullHtml)
        showToast('已保存: ' + result.filePath, 'success')
      }
    } catch (err) {
      showToast('保存失败: ' + String(err), 'error')
    }
  }, [html, filePath, showToast])

  // 加载中
  if (loading) {
    return (
      <div className="wechat-preview-loading">
        <div className="wechat-preview-spinner" />
        <span>正在转换为微信格式...</span>
      </div>
    )
  }

  // 转换失败
  if (error) {
    return (
      <div className="wechat-preview-error">
        <span style={{ fontSize: 48 }}>⚠️</span>
        <span>转换失败</span>
        <span className="wechat-preview-error-msg">{error}</span>
      </div>
    )
  }

  return (
    <div className="wechat-preview">
      {/* 工具栏 */}
      <div className="wechat-preview-toolbar">
        <span className="wechat-preview-title">📱 微信公众号预览</span>
        {warnings.length > 0 && (
          <span className="wechat-preview-warning" title={warnings.join('\n')}>
            {warnings.length} 项图片提示
          </span>
        )}
        <div className="wechat-preview-actions">
          <button className="wechat-btn-copy" onClick={handleCopy} title="复制为微信公众号格式">
            📋 复制到公众号
          </button>
          <button className="wechat-btn-save" onClick={handleSave} title="保存为 HTML 文件">
            💾 保存
          </button>
        </div>
      </div>

      {/* 预览区（模拟手机宽度） */}
      <div className="wechat-preview-phone">
        <WeChatPreviewFrame html={html} />
      </div>
    </div>
  )
}
