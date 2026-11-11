import type { AgentImageAttachment } from '@shared/ipc/agent'
import type { AgentConversationState } from './conversation-state'

/** Recover once, using the original message preview bytes; never overwrite a newer draft. */
export function recoverFailedImageDraft(
  conversation: AgentConversationState,
  runId: string | null | undefined,
): AgentConversationState {
  const retry = conversation.activeImageDraft
  if (!retry || retry.runId !== runId) return conversation
  const cleared = { ...conversation, activeImageDraft: undefined }
  const message = conversation.messages.find((item) => item.id === retry.messageId)
  const images: AgentImageAttachment[] = []
  for (const resource of message?.resources ?? []) {
    if (resource.kind !== 'image') continue
    const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      resource.previewDataUrl ?? '',
    )
    if (!match || !resource.ref.size) return cleared
    images.push({
      id: resource.id,
      name: resource.label,
      mediaType: match[1] as AgentImageAttachment['mediaType'],
      data: match[2],
      size: resource.ref.size,
    })
  }
  if (!message || !images.length) return cleared
  const ids = new Set(images.map((image) => image.id))
  const alreadyPresent =
    conversation.pendingImages?.some((image) => ids.has(image.id)) ||
    conversation.queuedMessages?.some((item) =>
      item.pendingImages.some((image) => ids.has(image.id)),
    )
  if (alreadyPresent)
    return { ...cleared, messageQueuePauseReason: '图片消息发送失败，请检查后重试' }
  const content =
    message.rawText ??
    message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  const mountedResources = (message.resources ?? []).filter((resource) => resource.kind !== 'image')
  return {
    ...cleared,
    ...(!conversation.input.trim() && !conversation.pendingImages?.length
      ? {
          input: content,
          pendingImages: images,
          mountedResources,
        }
      : {
          queuedMessages: [
            {
              id: crypto.randomUUID(),
              content,
              createdAt: Date.now(),
              contextKey: retry.contextKey,
              mountedResources,
              pendingImages: images,
            },
            ...(conversation.queuedMessages ?? []),
          ],
        }),
    messageQueuePauseReason: '图片消息发送失败，请检查后重试',
  }
}
