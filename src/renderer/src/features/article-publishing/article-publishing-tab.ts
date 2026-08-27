import type { WorkspaceRef } from '@shared/workspace-ref'
import type { OpenDialogOptions } from '@shared/ipc/dialog'
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

export function formatArticlePublishingAccountOption(accountLabel: string): string {
  return `CSDN · ${accountLabel.trim()}`
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
