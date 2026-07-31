import { useMemo, useState } from 'react'
import type { Tab } from '../../types'
import { DEFAULT_AGENT_ROLE_REF, agentRoleRefsEqual } from '@shared/agent-role'
import { useAgentStore } from '../../stores/agent-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useToastStore } from '../../components/common/Toast'
import { useAgentRoles } from '../agent-profiles/use-agent-profiles'
import { applyAgentRoleToConversation, getApplyAgentRoleError } from './agent-role-actions'
import { getAgentRoleGlyph } from './agent-role-presentation'

export function AgentRoleDetailTab({ tab }: { tab: Tab }): React.ReactElement {
  const { roles, error, reload } = useAgentRoles()
  const activeConversationId = useAgentStore((state) => state.activeConversationId)
  const conversation = useAgentStore((state) => state.conversations[activeConversationId])
  const defaultRoleRef = useSettingsStore((state) => state.settings.defaultAgentRoleRef)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const showToast = useToastStore((state) => state.show)
  const [saving, setSaving] = useState<'conversation' | 'default' | null>(null)
  const role = useMemo(
    () =>
      roles.find(
        (candidate) =>
          candidate.roleId === tab.agentRole?.roleId && candidate.version === tab.agentRole.version,
      ),
    [roles, tab.agentRole],
  )

  if (error) {
    return (
      <div className="agent-role-detail-state error">
        角色加载失败：{error} <button type="button" onClick={reload}>重试</button>
      </div>
    )
  }
  if (!role) {
    if (roles.length === 0) {
      return <div className="agent-role-detail-state">正在加载角色定义…</div>
    }
    const migrateToDefault = async (): Promise<void> => {
      if (!conversation) return
      setSaving('conversation')
      const result = await applyAgentRoleToConversation(conversation.id, DEFAULT_AGENT_ROLE_REF)
      setSaving(null)
      const failure = getApplyAgentRoleError(result)
      showToast(failure ?? '当前会话已显式迁移到默认助手', failure ? 'error' : 'success')
    }
    return (
      <div className="agent-role-detail-state error">
        <p>角色版本 {tab.agentRole?.roleId}@{tab.agentRole?.version} 已不可用，系统不会静默替换。</p>
        <button type="button" onClick={migrateToDefault} disabled={!conversation || saving !== null}>
          将当前会话迁移到默认助手
        </button>
      </div>
    )
  }

  const roleRef = { roleId: role.roleId, version: role.version }
  const applied = agentRoleRefsEqual(roleRef, conversation?.configuration.roleRef)
  const isDefault = agentRoleRefsEqual(roleRef, defaultRoleRef)

  const applyToConversation = async (): Promise<void> => {
    if (!conversation || applied) return
    setSaving('conversation')
    const result = await applyAgentRoleToConversation(conversation.id, roleRef)
    setSaving(null)
    const failure = getApplyAgentRoleError(result)
    showToast(failure ?? `当前会话已切换为「${role.label}」`, failure ? 'error' : 'success')
  }

  const setAsDefault = async (): Promise<void> => {
    if (isDefault) return
    setSaving('default')
    const saved = await updateSettings({ defaultAgentRoleRef: roleRef })
    setSaving(null)
    showToast(
      saved ? `新会话默认角色已设为「${role.label}」` : '默认角色保存失败',
      saved ? 'success' : 'error',
    )
  }

  return (
    <div className="agent-role-detail">
      <header className="agent-role-detail-header">
        <div className="agent-role-detail-title">
          <span className="agent-role-detail-icon">{getAgentRoleGlyph(role.icon)}</span>
          <div>
            <div className="agent-role-detail-eyebrow">内置角色 · v{role.version}</div>
            <h1>{role.label}</h1>
            <p>{role.description}</p>
          </div>
        </div>
        <div className="agent-role-detail-actions">
          <button type="button" onClick={setAsDefault} disabled={isDefault || saving !== null}>
            {isDefault ? '新会话默认' : saving === 'default' ? '保存中…' : '设为新会话默认'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={applyToConversation}
            disabled={!conversation || applied || saving !== null}
          >
            {applied
              ? '已应用到当前会话'
              : saving === 'conversation'
                ? '应用中…'
                : '应用到当前会话'}
          </button>
        </div>
      </header>

      <div className="agent-role-target-card">
        <span>应用目标</span>
        <strong>{conversation?.title ?? '没有可用会话'}</strong>
        <small>切换后保留当前可见历史，但下一轮会创建新的内部运行会话；不会改变其他会话。</small>
      </div>

      <div className="agent-role-detail-grid">
        <section>
          <h2>行为规则</h2>
          <ol>
            {role.instructions.map((instruction, index) => (
              <li key={`${index}-${instruction}`}>{instruction}</li>
            ))}
          </ol>
        </section>
        <section>
          <h2>边界与说明</h2>
          <p>
            {role.disclaimer ?? '角色只影响分析视角与表达方式，不扩大工具、权限或数据访问范围。'}
          </p>
          <dl>
            <div>
              <dt>配置标识</dt>
              <dd>
                {role.roleId}@{role.version}
              </dd>
            </div>
            <div>
              <dt>当前会话版本</dt>
              <dd>{conversation ? `#${conversation.configuration.revision}` : '—'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}
