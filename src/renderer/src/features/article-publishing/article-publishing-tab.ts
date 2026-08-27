import type { WorkspaceRef } from '@shared/workspace-ref'
import type { Tab } from '../../types'

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
