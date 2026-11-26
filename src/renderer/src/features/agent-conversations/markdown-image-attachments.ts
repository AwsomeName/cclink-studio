import { MAX_AGENT_IMAGES, MAX_AGENT_SOURCE_IMAGE_BYTES } from '@shared/agent-image-limits'
import { replaceMarkdownSizedImages } from '@shared/markdown-sized-image'
import { useAgentStore } from '../../stores/agent-store'
import { resolveMarkdownImageSource } from '../markdown/markdown-image-source'
import { startImageImport } from './image-import-jobs'

const IMAGE_REFERENCE = /!\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g
const NETWORK = /^(?:https?:)?\/\//i

/** Image destinations in document order, for both `![]()` and the strict `<img … width>`. */
export function markdownImageDestinations(markdown: string): string[] {
  const { source } = replaceMarkdownSizedImages(markdown)
  return [...source.matchAll(IMAGE_REFERENCE)].map((match) =>
    match[1].startsWith('<') ? match[1].slice(1, -1) : match[1],
  )
}

export interface MarkdownImageAttachmentPlan {
  /** Absolute paths of local images inside the workspace, deduplicated, in document order. */
  local: string[]
  /** Network images: never fetched on the user's behalf. */
  remote: number
  /** Local references outside the workspace or not resolvable. */
  outside: number
}

export function planMarkdownImageAttachments(
  markdown: string,
  documentPath: string,
  workspaceRoot: string | null,
): MarkdownImageAttachmentPlan {
  const plan: MarkdownImageAttachmentPlan = { local: [], remote: 0, outside: 0 }
  for (const destination of markdownImageDestinations(markdown)) {
    if (NETWORK.test(destination)) {
      plan.remote += 1
      continue
    }
    if (/^(?:data|blob):/i.test(destination)) {
      plan.outside += 1
      continue
    }
    const path = resolveMarkdownImageSource(destination, documentPath)
    const inside =
      path.startsWith('/') &&
      workspaceRoot !== null &&
      (path === workspaceRoot || path.startsWith(`${workspaceRoot.replace(/\/$/, '')}/`))
    if (!inside) plan.outside += 1
    else if (!plan.local.includes(path)) plan.local.push(path)
  }
  return plan
}

export interface MarkdownImageAttachResult {
  attached: number
  pathOnly: number
  remote: number
  unavailable?: string
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Sends the local pictures a Markdown selection or file refers to along with it, through the same
 * preparation as images added to the composer by hand (limits, downscaling, clarity review).
 * Images beyond the per-message limit, too large, outside the workspace or remote stay as paths.
 */
export async function attachMarkdownImages(input: {
  conversationId: string
  markdown: string
  documentPath: string
  workspaceRoot: string | null
}): Promise<MarkdownImageAttachResult> {
  const plan = planMarkdownImageAttachments(input.markdown, input.documentPath, input.workspaceRoot)
  const result: MarkdownImageAttachResult = {
    attached: 0,
    pathOnly: plan.outside,
    remote: plan.remote,
  }
  if (plan.local.length === 0) return result
  const conversation = useAgentStore.getState().conversations[input.conversationId]
  if (!conversation) return { ...result, pathOnly: result.pathOnly + plan.local.length }
  if (conversation.runtimeBinding?.kind === 'acp') {
    return {
      ...result,
      pathOnly: result.pathOnly + plan.local.length,
      unavailable: '当前运行时不支持图片',
    }
  }
  const slots = Math.max(0, MAX_AGENT_IMAGES - (conversation.pendingImages?.length ?? 0))
  const files: File[] = []
  for (const path of plan.local) {
    if (files.length >= slots) {
      result.pathOnly += 1
      continue
    }
    try {
      const { size } = await window.cclinkStudio.fs.stat(path)
      if (size <= 0 || size > MAX_AGENT_SOURCE_IMAGE_BYTES) throw new Error('size')
      const rendered = await window.cclinkStudio.fs.renderFile(path)
      if (rendered.kind !== 'image') throw new Error('not an image')
      const name = path.split('/').pop() ?? 'image'
      files.push(new File([base64ToBytes(rendered.content)], name, { type: rendered.mimeType }))
    } catch {
      result.pathOnly += 1
    }
  }
  if (files.length === 0) return result
  const conversationId = input.conversationId
  startImageImport(
    `local:${conversationId}`,
    files,
    () => useAgentStore.getState().conversations[conversationId]?.pendingImages ?? [],
    (images) => {
      if (useAgentStore.getState().conversations[conversationId])
        useAgentStore.getState().addPendingImages(images, conversationId)
    },
  )
  result.attached = files.length
  return result
}

/** One line for the toast after a send: what came along as pictures and what stayed a path. */
export function describeMarkdownImageAttach(result: MarkdownImageAttachResult): string {
  const parts: string[] = []
  if (result.attached > 0) parts.push(`附带 ${result.attached} 张图片`)
  if (result.pathOnly > 0)
    parts.push(
      result.unavailable
        ? `${result.pathOnly} 张图片只附路径（${result.unavailable}）`
        : `另 ${result.pathOnly} 张只附路径`,
    )
  if (result.remote > 0) parts.push(`${result.remote} 张网络图片未下载`)
  return parts.join('，')
}
