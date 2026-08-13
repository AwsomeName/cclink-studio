import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabStore } from '../../stores/tab-store'
import { closeTabWithDraftPolicy } from '../../utils/close-tab'
import {
  clearAgentRoleDraftController,
  registerAgentRoleDraftController,
} from './agent-role-draft-registry'
import { openAgentRoleDetail } from './agent-role-draft-policy'

const tabId = 'role-tab'
const originalRole = { roleId: 'local-role', version: 1 }
const nextRole = { roleId: 'default-assistant', version: 1 }
const draft = { label: '测试角色' } as never

beforeEach(() => {
  clearAgentRoleDraftController(tabId)
  useTabStore.setState({
    tabs: [
      {
        id: tabId,
        type: 'agent-role',
        title: '角色配置',
        icon: '◇',
        agentRole: originalRole,
        dirty: true,
      },
    ],
    activeTabId: tabId,
  })
  vi.stubGlobal('window', {
    cclinkStudio: {
      dialog: { showMessageBox: vi.fn() },
    },
  })
})

describe('agent role draft policy', () => {
  it('keeps the dirty editor and viewed role when the user cancels switching', async () => {
    vi.mocked(window.cclinkStudio.dialog.showMessageBox).mockResolvedValue({ response: 2 })
    const save = vi.fn(async () => true)
    const discard = vi.fn()
    registerAgentRoleDraftController(tabId, { draft, save, discard })

    await expect(openAgentRoleDetail(nextRole)).resolves.toBe(false)
    expect(useTabStore.getState().tabs[0]).toMatchObject({ agentRole: originalRole, dirty: true })
    expect(save).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it('only switches after a successful save', async () => {
    vi.mocked(window.cclinkStudio.dialog.showMessageBox).mockResolvedValue({ response: 0 })
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    registerAgentRoleDraftController(tabId, { draft, save, discard: vi.fn() })

    await expect(openAgentRoleDetail(nextRole)).resolves.toBe(false)
    expect(useTabStore.getState().tabs[0]).toMatchObject({ agentRole: originalRole, dirty: true })

    await expect(openAgentRoleDetail(nextRole)).resolves.toBe(true)
    expect(useTabStore.getState().tabs[0]).toMatchObject({ agentRole: nextRole, dirty: false })
  })

  it('discards explicitly before switching roles', async () => {
    vi.mocked(window.cclinkStudio.dialog.showMessageBox).mockResolvedValue({ response: 1 })
    const discard = vi.fn()
    registerAgentRoleDraftController(tabId, {
      draft,
      save: vi.fn(async () => true),
      discard,
    })

    await expect(openAgentRoleDetail(nextRole)).resolves.toBe(true)
    expect(discard).toHaveBeenCalledOnce()
    expect(useTabStore.getState().tabs[0]).toMatchObject({ agentRole: nextRole, dirty: false })
  })

  it('protects closing the configuration tab with the same cancel/discard policy', async () => {
    const dialog = vi.mocked(window.cclinkStudio.dialog.showMessageBox)
    const discard = vi.fn()
    registerAgentRoleDraftController(tabId, {
      draft,
      save: vi.fn(async () => true),
      discard,
    })

    dialog.mockResolvedValueOnce({ response: 2 })
    await expect(closeTabWithDraftPolicy(tabId)).resolves.toBe(false)
    expect(useTabStore.getState().tabs).toHaveLength(1)

    dialog.mockResolvedValueOnce({ response: 1 })
    await expect(closeTabWithDraftPolicy(tabId)).resolves.toBe(true)
    expect(discard).toHaveBeenCalledOnce()
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })
})
