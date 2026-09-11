import { parsePlatformDraftAnchor } from '@shared/article-publishing/platform-draft-anchor'
import { articlePublishingDetailDefinitions } from '@shared/article-publishing/article-publishing-plan'
import type { WorkspaceRef } from '@shared/workspace-ref'
import type { OpenDialogOptions } from '@shared/ipc/dialog'
import type { WebAffair } from '@shared/web-affairs/web-affair-types'
import type { Tab } from '../../types'

export function createArticleMarkdownOpenDialogOptions(
  workspaceRef: Extract<WorkspaceRef, { kind: 'local' }>,
): OpenDialogOptions {
  return {
    title: '选择要发布的 Markdown',
    defaultPath: workspaceRef.path,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  }
}

export function formatArticlePublishingAccountOption(
  accountLabel: string,
  platformLabel = 'CSDN',
): string {
  return `${platformLabel} · ${accountLabel.trim()}`
}

export function getArticlePublishingRuntimeBinding(affair: WebAffair | null): {
  attemptId: string
  conversationId: string
} | null {
  const attemptId = affair?.articlePublishing?.execution.currentAttemptId
  const attempt = affair?.attempts.find((candidate) => candidate.id === attemptId)
  return attempt && affair
    ? {
        attemptId: attempt.id,
        conversationId: attempt.conversationId ?? `article-publishing-${affair.id}`,
      }
    : null
}

export interface ArticlePublishingFileDetails {
  fileName: string
  workspaceRelativePath: string | null
  absolutePath: string
}

type ArticlePublishingAgentStartResult =
  | { status: 'accepted' }
  | { status: 'ignored'; reason: string }
  | { status: 'failed'; error: string }

export function getArticlePublishingAgentStartError(
  result: ArticlePublishingAgentStartResult,
): string | null {
  if (result.status === 'accepted') return null
  if (result.status === 'failed') return result.error
  return `Agent 未接收发布任务（${result.reason}）`
}

export function getArticlePublishingFileDetails(
  filePath: string,
  workspacePath: string,
): ArticlePublishingFileDetails {
  const normalizedFilePath = filePath.replaceAll('\\', '/')
  const normalizedWorkspacePath = workspacePath.replaceAll('\\', '/').replace(/\/+$/u, '')
  const fileName = normalizedFilePath.split('/').filter(Boolean).at(-1) ?? filePath
  const comparisonFilePath = /^[A-Za-z]:\//u.test(normalizedFilePath)
    ? normalizedFilePath.toLowerCase()
    : normalizedFilePath
  const comparisonWorkspacePath = /^[A-Za-z]:\//u.test(normalizedWorkspacePath)
    ? normalizedWorkspacePath.toLowerCase()
    : normalizedWorkspacePath
  const workspacePrefix = `${comparisonWorkspacePath}/`
  const workspaceRelativePath = comparisonFilePath.startsWith(workspacePrefix)
    ? normalizedFilePath.slice(normalizedWorkspacePath.length + 1)
    : comparisonFilePath === comparisonWorkspacePath
      ? fileName
      : null

  return { fileName, workspaceRelativePath, absolutePath: filePath }
}

export function createArticlePublishingDraftTab(workspaceRef: WorkspaceRef): {
  type: 'article-publishing'
  title: string
  icon: string
  workspaceRef: WorkspaceRef
  articlePublishing: NonNullable<Tab['articlePublishing']>
} {
  return {
    type: 'article-publishing',
    title: '新建文章发布',
    icon: '📰',
    workspaceRef,
    articlePublishing: { affairId: null, draftKey: crypto.randomUUID() },
  }
}

/** Preview definitions only; an entered anchor does not assert that recovery has succeeded. */
export function articlePublishingPreviewDefinitions(
  input: Parameters<typeof articlePublishingDetailDefinitions>[0] & {
    existingDraftUrl: string
    localDraftId?: string
  },
) {
  const anchor = parsePlatformDraftAnchor(input.existingDraftUrl, input.localDraftId)
  return articlePublishingDetailDefinitions({
    ...input,
    draft:
      input.draft ??
      (anchor && anchor.adapterId === input.adapterId
        ? { platformDraftId: anchor.draftId, url: anchor.url }
        : undefined),
  })
}
