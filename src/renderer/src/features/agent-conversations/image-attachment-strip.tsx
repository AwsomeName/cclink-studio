import type { AgentImageAttachment } from '@shared/ipc/agent'
import { useRef, useState } from 'react'
import { IconClose } from '../../components/common/Icons'
import { FloatingSurface } from '../../components/common/FloatingSurface'
import { imageAttachmentDataUrl } from './image-attachments'

export interface ImageAttachmentStripProps {
  images: AgentImageAttachment[]
  onRemove: (imageId: string) => void
  onApprove?: (image: AgentImageAttachment) => void
  preparation?: { busy: boolean; error?: string; cancel(): void }
}

export function ImageAttachmentStrip({
  images,
  onRemove,
  onApprove,
  preparation,
}: ImageAttachmentStripProps): React.ReactElement | null {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [actualSize, setActualSize] = useState(false)
  const preview = images.find((image) => image.id === previewId)
  if (images.length === 0 && !preparation?.busy && !preparation?.error) return null

  return (
    <div ref={anchorRef}>
      {(preparation?.busy || preparation?.error) && (
        <div className="agent-image-preparation" role={preparation.error ? 'alert' : 'status'}>
          <span>
            {[
              preparation.busy && '正在处理图片…（单张原图最多 20MB，每次 5 张）',
              preparation.error,
            ]
              .filter(Boolean)
              .join('\n')}
          </span>
          <button type="button" onClick={preparation.cancel}>
            {preparation.busy ? '取消处理' : '保留已添加图片'}
          </button>
        </div>
      )}
      <div className="agent-image-attachment-strip" aria-label="待发送图片">
        {images.map((image) => (
          <div key={image.id} className="agent-image-attachment" title={image.name}>
            <button
              className="agent-image-preview-button"
              type="button"
              aria-label={`预览发送图片 ${image.name}`}
              onClick={() => {
                setPreviewId(image.id)
                setActualSize(false)
              }}
            >
              <img src={imageAttachmentDataUrl(image)} alt={image.name} draggable={false} />
              {image.preparation && (
                <span className="agent-image-label">
                  {image.preparation.requiresReview
                    ? '请检查清晰度'
                    : image.preparation.firstFrameOnly
                      ? '仅首帧'
                      : '已优化'}
                </span>
              )}
            </button>
            <button
              className="agent-image-remove"
              type="button"
              title={`移除 ${image.name}`}
              aria-label={`移除 ${image.name}`}
              onClick={() => onRemove(image.id)}
            >
              <IconClose size={12} />
            </button>
          </div>
        ))}
      </div>
      <FloatingSurface
        anchorRef={anchorRef}
        open={Boolean(preview)}
        role="dialog"
        className="agent-image-preview"
        placement="top-start"
        onRequestClose={() => setPreviewId(null)}
      >
        {preview && (
          <>
            <div className="agent-image-preview-heading">
              <strong>实际发送图片</strong>
              <button type="button" onClick={() => setPreviewId(null)} aria-label="关闭图片预览">
                关闭
              </button>
            </div>
            <div>预览为 Studio 提交给运行时的版本；运行时或模型服务仍可能再次缩放。</div>
            <div>
              {preview.name} · {(preview.size / 1024 / 1024).toFixed(2)} MB
              {preview.preparation &&
                ` · ${preview.preparation.width} × ${preview.preparation.height}（原图 ${(preview.preparation.originalSize / 1024 / 1024).toFixed(2)} MB）`}
            </div>
            {preview.preparation?.firstFrameOnly && <p>动图仅发送首帧。</p>}
            {preview.preparation?.requiresReview && (
              <p>图片已缩小，请按原尺寸检查文字；不清晰时请分段截取后重新添加。</p>
            )}
            <button type="button" onClick={() => setActualSize(!actualSize)}>
              {actualSize ? '适应预览' : '查看原尺寸'}
            </button>
            <div className="agent-image-preview-scroll">
              <img
                className={actualSize ? 'actual-size' : ''}
                src={imageAttachmentDataUrl(preview)}
                alt={preview.name}
              />
            </div>
            {preview.preparation?.requiresReview && onApprove && (
              <button
                type="button"
                onClick={() => {
                  onApprove({
                    ...preview,
                    preparation: { ...preview.preparation!, requiresReview: false },
                  })
                  setPreviewId(null)
                }}
              >
                已检查，使用此图
              </button>
            )}
          </>
        )}
      </FloatingSurface>
    </div>
  )
}
