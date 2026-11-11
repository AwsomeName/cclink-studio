import type { AgentImageAttachment } from '@shared/ipc/agent'
import { conversationQueueContextKey, type AgentConversationState } from './conversation-state'
import type { AgentMountedResource } from '../../types'

/** Both IPC rejection and a later Runtime error restore through the same draft rules. */
export function restoreFailedDraft(
  conversation: AgentConversationState,
  content: string,
  images: AgentImageAttachment[],
  mountedResources: AgentMountedResource[],
  contextKey: string,
): AgentConversationState {
  const cleared = { ...conversation, activeImageDraft: undefined }
  const containsDraft = (text: string, attachments: AgentImageAttachment[]): boolean =>
    text.trim() === content.trim() &&
    images.length > 0 &&
    images.every((image) => attachments.some((attachment) => attachment.id === image.id))
  if (
    containsDraft(conversation.input, conversation.pendingImages ?? []) ||
    conversation.queuedMessages?.some((item) => containsDraft(item.content, item.pendingImages))
  )
    return { ...cleared, messageQueuePauseReason: '图片消息发送失败，请检查后重试' }

  // Persistent mounts stay in the composer after sending. They are safe to restore
  // only if unchanged; a newly mounted file/browser is also a newer draft.
  const draftEmpty =
    !conversation.input.trim() &&
    !conversation.pendingImages?.length &&
    conversationQueueContextKey(conversation) === contextKey &&
    JSON.stringify(conversation.mountedResources) ===
      JSON.stringify(mountedResources.filter((resource) => resource.kind !== 'file-range'))
  return {
    ...cleared,
    ...(draftEmpty
      ? { input: content, pendingImages: images, mountedResources }
      : {
          queuedMessages: [
            {
              id: crypto.randomUUID(),
              content,
              createdAt: Date.now(),
              contextKey,
              mountedResources,
              pendingImages: images,
            },
            ...(conversation.queuedMessages ?? []),
          ],
        }),
    messageQueuePauseReason: '发送失败，请检查后重试',
  }
}

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
  const content =
    message.rawText ??
    message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  return restoreFailedDraft(cleared, content, images, retry.mountedResources, retry.contextKey)
}
