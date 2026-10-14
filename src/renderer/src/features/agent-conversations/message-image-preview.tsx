import { useEffect, useState } from 'react'
import type { AgentMountedResource } from '../../types'

function rasterPreviewUrl(value: string | undefined): string | null {
  return value && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : null
}

function immediateImageSource(resource: AgentMountedResource): string | null {
  const preview = rasterPreviewUrl(resource.previewDataUrl)
  if (preview) return preview
  try {
    const url = new URL(resource.ref.sourceUrl ?? '')
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function MessageImagePreview({
  resource,
  conversationId,
}: {
  resource: AgentMountedResource
  conversationId: string
}): React.ReactElement {
  const immediateSource = immediateImageSource(resource)
  const assetId = resource.ref.imageAssetId
  const key = `${conversationId}:${assetId ?? resource.id}`
  const [loaded, setLoaded] = useState<{ key: string; source: string | null } | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)

  useEffect(() => {
    if (immediateSource || !assetId) return
    let disposed = false
    void window.cclinkStudio.agent.readMessageImage(conversationId, assetId).then(
      (result) => {
        if (!disposed)
          setLoaded({ key, source: result.success ? rasterPreviewUrl(result.dataUrl) : null })
      },
      () => {
        if (!disposed) setLoaded({ key, source: null })
      },
    )
    return () => {
      disposed = true
    }
  }, [assetId, conversationId, immediateSource, key])

  const source = immediateSource ?? (loaded?.key === key ? loaded.source : null)
  if (source && failedSource !== source) {
    return (
      <img
        className="message-image-preview"
        src={source}
        alt={resource.label}
        title={resource.label}
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setFailedSource(source)}
      />
    )
  }
  const loading = assetId && !immediateSource && loaded?.key !== key
  return (
    <span className="message-image-unavailable" role="status">
      {loading ? '正在加载图片' : '图片不可用'}：{resource.label}
    </span>
  )
}
