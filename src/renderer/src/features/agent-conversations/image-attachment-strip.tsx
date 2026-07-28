import type { AgentImageAttachment } from '@shared/ipc/agent'
import { IconClose } from '../../components/common/Icons'
import { imageAttachmentDataUrl } from './image-attachments'

export function ImageAttachmentStrip({
  images,
  onRemove,
}: {
  images: AgentImageAttachment[]
  onRemove: (imageId: string) => void
}): React.ReactElement | null {
  if (images.length === 0) return null

  return (
    <div className="agent-image-attachment-strip" aria-label="待发送图片">
      {images.map((image) => (
        <div key={image.id} className="agent-image-attachment">
          <img src={imageAttachmentDataUrl(image)} alt={image.name} />
          <span title={image.name}>{image.name}</span>
          <button type="button" title={`移除 ${image.name}`} onClick={() => onRemove(image.id)}>
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
