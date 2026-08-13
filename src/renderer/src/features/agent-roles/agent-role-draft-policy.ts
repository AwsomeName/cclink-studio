import type { AgentRoleRef } from '@shared/agent-role'
import { agentRoleRefsEqual } from '@shared/agent-role'
import { useTabStore } from '../../stores/tab-store'
import {
  clearAgentRoleDraftController,
  getAgentRoleDraftController,
} from './agent-role-draft-registry'

export async function confirmAgentRoleDraftExit(tabId: string): Promise<boolean> {
  const tab = useTabStore.getState().tabs.find((candidate) => candidate.id === tabId)
  if (!tab || tab.type !== 'agent-role' || !tab.dirty) return true

  const controller = getAgentRoleDraftController(tabId)
  if (!controller) {
    await window.cclinkStudio.dialog.showMessageBox({
      type: 'error',
      title: '角色草稿状态不可用',
      message: '无法确认当前角色草稿是否已经保存',
      detail: '为避免丢失修改，已阻止关闭或切换角色。请回到角色编辑页重试。',
      buttons: ['继续编辑'],
      defaultId: 0,
      cancelId: 0,
    })
    return false
  }

  const { response } = await window.cclinkStudio.dialog.showMessageBox({
    type: 'question',
    title: '未保存的角色修改',
    message: `要保存对“${controller.draft.label.trim() || tab.title}”的修改吗？`,
    detail: '保存会创建不可变新版本；放弃修改后无法恢复。',
    buttons: ['保存', '放弃修改', '取消'],
    defaultId: 0,
    cancelId: 2,
  })
  if (response === 2) return false
  if (response === 0) {
    const saved = await controller.save()
    if (saved) useTabStore.getState().updateTabDirty(tabId, false)
    return saved
  }
  if (response === 1) {
    controller.discard()
    clearAgentRoleDraftController(tabId)
    useTabStore.getState().updateTabDirty(tabId, false)
    return true
  }
  return false
}

export async function openAgentRoleDetail(roleRef: AgentRoleRef): Promise<boolean> {
  const state = useTabStore.getState()
  const existing =
    state.tabs.find((tab) => tab.id === state.activeTabId && tab.type === 'agent-role') ??
    state.tabs.find((tab) => tab.type === 'agent-role')
  if (
    existing &&
    !agentRoleRefsEqual(existing.agentRole, roleRef) &&
    !(await confirmAgentRoleDraftExit(existing.id))
  ) {
    return false
  }
  if (existing && !agentRoleRefsEqual(existing.agentRole, roleRef)) {
    clearAgentRoleDraftController(existing.id)
  }
  useTabStore.getState().openTab({
    type: 'agent-role',
    title: '角色配置',
    icon: '◇',
    agentRole: roleRef,
  })
  return true
}
