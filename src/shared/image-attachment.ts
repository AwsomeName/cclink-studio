export type ImageAttachmentMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/**
 * Transient image bytes shared by bounded Agent IPC contracts.
 * The base64 payload must never enter workspace snapshots, diagnostics, or persistent remote state.
 */
export interface TransientImageAttachment {
  id: string
  name: string
  mediaType: ImageAttachmentMediaType
  /** Raw base64 without a data URL prefix. */
  data: string
  size: number
}
