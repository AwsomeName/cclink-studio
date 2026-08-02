import { useMemo } from 'react'
import { agentRoleRefsEqual } from '@shared/agent-role'
import { useAgentStore } from '../../stores/agent-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { useAgentRoles } from '../agent-profiles/use-agent-profiles'
import { getAgentRoleGlyph } from './agent-role-presentation'

export function AgentRolesSidebar(): React.ReactElement {
  const { roles, error, reload } = useAgentRoles()
  const activeConversationId = useAgentStore((state) => state.activeConversationId)
  const conversation = useAgentStore((state) => state.conversations[activeConversationId])
  const defaultRoleRef = useSettingsStore((state) => state.settings.defaultAgentRoleRef)
  const openTab = useTabStore((state) => state.openTab)
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const openRoleRef = useMemo(() => {
    const tab = tabs.find((item) => item.id === activeTabId && item.type === 'agent-role')
    return tab?.agentRole ?? null
  }, [activeTabId, tabs])
  const currentRole = roles.find((role) =>
    agentRoleRefsEqual(role, conversation?.configuration.roleRef),
  )

  return (
    <div className="agent-role-sidebar">
      <section className="agent-role-current-card">
        <div className="agent-role-section-label">当前会话</div>
        <strong>{conversation?.title ?? '没有可用会话'}</strong>
        <span>
          {currentRole
            ? `${getAgentRoleGlyph(currentRole.icon)} ${currentRole.label}`
            : conversation
              ? `角色不可用 · ${conversation.configuration.roleRef.roleId}@${conversation.configuration.roleRef.version}`
              : '请先新建会话'}
        </span>
        {conversation?.lastRunConfigurationReceipt && (
          <small>
            最近一轮已应用 · 配置 #{conversation.lastRunConfigurationReceipt.configurationRevision}{' '}
            ·
            {conversation.lastRunConfigurationReceipt.runtimeSessionMode === 'resumed'
              ? '续接运行'
              : '新运行'}
          </small>
        )}
      </section>

      <div className="agent-role-section-label agent-role-list-label">内置角色</div>
      {error && (
        <div className="agent-role-sidebar-error">
          <span>角色列表加载失败：{error}</span>
          <button type="button" onClick={reload}>
            重试
          </button>
        </div>
      )}
      <div className="agent-role-list">
        {roles.map((role) => {
          const applied = agentRoleRefsEqual(role, conversation?.configuration.roleRef)
          const opened = agentRoleRefsEqual(role, openRoleRef)
          const isDefault = agentRoleRefsEqual(role, defaultRoleRef)
          return (
            <button
              type="button"
              key={`${role.roleId}@${role.version}`}
              className={`agent-role-row${opened ? ' opened' : ''}${applied ? ' applied' : ''}`}
              onClick={() =>
                openTab({
                  type: 'agent-role',
                  title: role.label,
                  icon: getAgentRoleGlyph(role.icon),
                  agentRole: { roleId: role.roleId, version: role.version },
                })
              }
              title="打开角色配置；不会自动切换当前会话"
            >
              <span className="agent-role-row-icon">{getAgentRoleGlyph(role.icon)}</span>
              <span className="agent-role-row-main">
                <span className="agent-role-row-head">
                  <strong>{role.label}</strong>
                  <span className="agent-role-row-badges">
                    {applied && <em>已应用</em>}
                    {isDefault && <em>默认</em>}
                  </span>
                </span>
                <small>{role.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
