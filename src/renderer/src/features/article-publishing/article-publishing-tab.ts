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

export interface ArticlePublishingFileDetails {
  fileName: string
  workspaceRelativePath: string | null
  absolutePath: string
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
