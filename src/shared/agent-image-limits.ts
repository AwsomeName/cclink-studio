/** Source files stay in the renderer; only prepared images cross Agent IPC. */
export const MAX_AGENT_IMAGES = 5
// Originals are only read and downscaled in a worker, so they may be far larger than
// the sending copy; the bound keeps a single decode within worker memory.
export const MAX_AGENT_SOURCE_IMAGE_MB = 100
export const MAX_AGENT_SOURCE_IMAGE_BYTES = MAX_AGENT_SOURCE_IMAGE_MB * 1024 * 1024
export const MAX_AGENT_IMAGE_BYTES = 3 * 1024 * 1024
export const MAX_AGENT_IMAGE_BASE64_LENGTH = Math.ceil(MAX_AGENT_IMAGE_BYTES / 3) * 4
// Include UTF-8 names and preparation metadata, even with five maximum-size images.
export const MAX_AGENT_IMAGE_PAYLOAD_BYTES =
  MAX_AGENT_IMAGES * (MAX_AGENT_IMAGE_BASE64_LENGTH + 8 * 1024)
export const MAX_AGENT_SOURCE_IMAGE_PIXELS = 100_000_000
export const MAX_AGENT_SOURCE_IMAGE_EDGE = 32_768
export const MAX_AGENT_IMAGE_EDGE = 8_000
// Existing conversation assets written before automatic preparation remain readable.
export const MAX_STORED_AGENT_IMAGE_BYTES = 5 * 1024 * 1024
