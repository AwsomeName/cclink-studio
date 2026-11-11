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
  preparation?: {
    originalSize: number
    originalWidth: number
    originalHeight: number
    width: number
    height: number
    firstFrameOnly: boolean
    /** Significant resizing needs a user preview before this draft is submitted. */
    requiresReview: boolean
  }
}

/** Stable reference to image bytes owned by the main process, outside workspace snapshots. */
export interface AgentMessageImageAsset {
  id: string
  assetId: string
}

export type AgentMessageImageSaveResult =
  | { success: true; assets: AgentMessageImageAsset[] }
  | { success: false; error: string }

export type AgentMessageImageReadResult =
  | { success: true; dataUrl: string }
  | { success: false; error: string }
