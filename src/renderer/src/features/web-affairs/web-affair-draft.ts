import type { WorkspaceRef } from '@shared/workspace-ref'
import type { Tab, WebAffairDraftState } from '../../types'

export const DEFAULT_WEB_AFFAIR_NODE_TITLES = [
  '确认办理要求',
  '准备并核对材料',
  '填写并提交',
  '等待审核结果',
  '处理结果并归档证据',
]

export function createEmptyWebAffairDraft(): WebAffairDraftState {
  return {
    title: '',
    objective: '',
    principalId: '',
    accountIds: [],
    accountGroupIds: [],
    materialPaths: [],
    nodeTitles: [...DEFAULT_WEB_AFFAIR_NODE_TITLES],
  }
}

export function createWebAffairDraftTab(workspaceRef: WorkspaceRef): {
  type: 'web-affair'
  title: string
  icon: string
  workspaceRef: WorkspaceRef
  webAffair: NonNullable<Tab['webAffair']>
} {
  return {
    type: 'web-affair',
    title: '新建事务',
    icon: '📋',
    workspaceRef,
    webAffair: {
      affairId: null,
      draftKey: crypto.randomUUID(),
      draft: createEmptyWebAffairDraft(),
    },
  }
}

export function isWebAffairDraftEmpty(draft: WebAffairDraftState): boolean {
  return (
    draft.title.trim().length === 0 &&
    draft.objective.trim().length === 0 &&
    draft.principalId.length === 0 &&
    draft.accountIds.length === 0 &&
    draft.accountGroupIds.length === 0 &&
    draft.materialPaths.length === 0
  )
}
