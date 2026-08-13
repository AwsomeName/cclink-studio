import { useMemo, useState } from 'react'
import { agentRoleRefsEqual } from '@shared/agent-role'
import { useAgentStore } from '../../stores/agent-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { notifyAgentRolesChanged, useAgentRoles } from '../agent-profiles/use-agent-profiles'
import { AgentRoleIcon } from './agent-role-presentation'
import { useToastStore } from '../../components/common/Toast'

export function AgentRolesSidebar(): React.ReactElement {
  const { roles, error, reload } = useAgentRoles()
  const showToast = useToastStore((state) => state.show)
  const [showArchived, setShowArchived] = useState(false)
  const [importing, setImporting] = useState(false)
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
  const builtinRoles = roles.filter((role) => role.source === 'builtin')
  const localRoles = roles.filter(
    (role) => role.source !== 'builtin' && role.isLatest && !role.archived,
  )
  const archivedRoles = roles.filter(
    (role) => role.source !== 'builtin' && role.isLatest && role.archived,
  )

  const openRole = (role: { roleId: string; version: number }): void =>
    openTab({
      type: 'agent-role',
      title: '角色配置',
      icon: '◇',
      agentRole: { roleId: role.roleId, version: role.version },
    })

  const importRole = async (): Promise<void> => {
    setImporting(true)
    try {
      const selected = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择角色包中的 role.json',
        filters: [{ name: 'CCLink 角色包', extensions: ['json'] }],
      })
      if (selected.canceled || !selected.filePaths[0]) return
      const result = await window.cclinkStudio.agent.previewImportRole(selected.filePaths[0])
      if (!result.success || !result.preview) {
        showToast(result.error ?? '角色包预览失败', 'error')
        return
      }
      const preview = result.preview
      const missingSkills = preview.skillStatuses.filter((skill) => !skill.available)
      const detail = [
        `${preview.role.label} · ${preview.role.roleId}@${preview.role.version}`,
        `来源 ${preview.sourceLabel}`,
        `内容指纹 ${preview.role.contentHash.slice(0, 12)}`,
        preview.conflict === 'none'
          ? '没有标识冲突'
          : preview.conflict === 'same-content'
            ? '本机已有相同版本和内容'
            : '本机已有相同角色标识，将创建新版本或副本',
        missingSkills.length > 0
          ? `缺少 Skill：${missingSkills.map((skill) => `${skill.skillId}@${skill.version}`).join('、')}`
          : '建议 Skill 均可用',
        ...preview.warnings,
      ].join('\n')
      const buttons =
        preview.conflict === 'same-id'
          ? ['更新为新版本', '另存副本', '取消']
          : ['导入', '另存副本', '取消']
      const choice = await window.cclinkStudio.dialog.showMessageBox({
        type: 'question',
        title: '确认导入角色包',
        message: '导入前检查',
        detail,
        buttons,
        defaultId: 0,
        cancelId: 2,
      })
      if (choice.response === 2) return
      const committed = await window.cclinkStudio.agent.commitImportRole(
        preview.token,
        choice.response === 1 ? 'copy' : 'update',
      )
      if (!committed.success || !committed.role) {
        showToast(committed.error ?? '角色导入失败', 'error')
        return
      }
      notifyAgentRolesChanged()
      openRole(committed.role)
      showToast(`已导入「${committed.role.label}」v${committed.role.version}`, 'success')
    } finally {
      setImporting(false)
    }
  }

  const renderRoleRows = (items: typeof roles) =>
    items.map((role) => {
      const applied = agentRoleRefsEqual(role, conversation?.configuration.roleRef)
      const opened = agentRoleRefsEqual(role, openRoleRef)
      const isDefault = agentRoleRefsEqual(role, defaultRoleRef)
      return (
        <button
          type="button"
          key={`${role.roleId}@${role.version}`}
          data-role-source={role.source}
          className={`agent-role-row${opened ? ' opened' : ''}${applied ? ' applied' : ''}`}
          onClick={() => openRole(role)}
          title="打开角色配置；不会自动切换当前会话"
        >
          <span className="agent-role-row-icon">
            <AgentRoleIcon icon={role.icon} size={16} />
          </span>
          <span className="agent-role-row-main">
            <span className="agent-role-row-head">
              <strong>{role.label}</strong>
              <span className="agent-role-row-badges">
                {role.source !== 'builtin' && <em>v{role.version}</em>}
                {applied && <em>已应用</em>}
                {isDefault && <em>默认</em>}
              </span>
            </span>
            <small>{role.description}</small>
          </span>
        </button>
      )
    })

  return (
    <div className="agent-role-sidebar">
      <section className="agent-role-current-card">
        <div className="agent-role-section-label">当前会话</div>
        <strong>{conversation?.title ?? '没有可用会话'}</strong>
        <span className="agent-role-current-identity">
          {currentRole ? (
            <>
              <AgentRoleIcon icon={currentRole.icon} size={16} />
              {currentRole.label}
            </>
          ) : conversation ? (
            `角色不可用 · ${conversation.configuration.roleRef.roleId}@${conversation.configuration.roleRef.version}`
          ) : (
            '请先新建会话'
          )}
        </span>
        {conversation?.lastRunConfigurationReceipt && (
          <small>
            最近一轮已应用 · 配置 #{conversation.lastRunConfigurationReceipt.configurationRevision}{' '}
            ·
            {conversation.lastRunConfigurationReceipt.runtimeSessionMode === 'resumed'
              ? '续接运行'
              : '新运行'}
            {conversation.lastRunConfigurationReceipt.skills.length > 0
              ? ` · Skill ${conversation.lastRunConfigurationReceipt.skills.length}`
              : ' · 无 Skill'}
          </small>
        )}
      </section>

      <div className="agent-role-sidebar-toolbar">
        <button
          type="button"
          onClick={() => openRole({ roleId: '__new-local-role__', version: 0 })}
        >
          ＋ 新建角色
        </button>
        <button type="button" disabled={importing} onClick={() => void importRole()}>
          {importing ? '导入中…' : '导入'}
        </button>
      </div>

      <div className="agent-role-section-label agent-role-list-label">我的角色</div>
      {error && (
        <div className="agent-role-sidebar-error">
          <span>角色列表加载失败：{error}</span>
          <button type="button" onClick={reload}>
            重试
          </button>
        </div>
      )}
      <div className="agent-role-list">
        {localRoles.length > 0 ? renderRoleRows(localRoles) : <small>还没有本地角色</small>}
      </div>
      {archivedRoles.length > 0 && (
        <>
          <button
            type="button"
            className="agent-role-archive-toggle"
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived ? '收起' : '显示'}已归档（{archivedRoles.length}）
          </button>
          {showArchived && <div className="agent-role-list">{renderRoleRows(archivedRoles)}</div>}
        </>
      )}

      <div className="agent-role-section-label agent-role-list-label">内置角色</div>
      <div className="agent-role-list">{renderRoleRows(builtinRoles)}</div>
    </div>
  )
}
