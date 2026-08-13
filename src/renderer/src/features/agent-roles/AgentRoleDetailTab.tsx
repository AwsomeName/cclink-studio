import { useMemo, useState } from 'react'
import type { Tab } from '../../types'
import { DEFAULT_AGENT_ROLE_REF, agentRoleRefsEqual } from '@shared/agent-role'
import { useAgentStore } from '../../stores/agent-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useToastStore } from '../../components/common/Toast'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useAgentRoles } from '../agent-profiles/use-agent-profiles'
import { useAgentSkills } from '../agent-skills/use-agent-skills'
import { applyAgentRoleToConversation, getApplyAgentRoleError } from './agent-role-actions'
import { AgentRoleIcon } from './agent-role-presentation'

export function AgentRoleDetailTab({ tab }: { tab: Tab }): React.ReactElement {
  const { roles, error, reload } = useAgentRoles()
  const activeConversationId = useAgentStore((state) => state.activeConversationId)
  const conversation = useAgentStore((state) => state.conversations[activeConversationId])
  const defaultRoleRef = useSettingsStore((state) => state.settings.defaultAgentRoleRef)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const addMountedSkill = useAgentStore((state) => state.addMountedSkill)
  const showToast = useToastStore((state) => state.show)
  const { skills, error: skillsError, reload: reloadSkills } = useAgentSkills()
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
        角色加载失败：{error}{' '}
        <button type="button" onClick={reload}>
          重试
        </button>
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
        <p>
          角色版本 {tab.agentRole?.roleId}@{tab.agentRole?.version} 已不可用，系统不会静默替换。
        </p>
        <button
          type="button"
          onClick={migrateToDefault}
          disabled={!conversation || saving !== null}
        >
          将当前会话迁移到默认助手
        </button>
      </div>
    )
  }

  const roleRef = { roleId: role.roleId, version: role.version }
  const applied = agentRoleRefsEqual(roleRef, conversation?.configuration.roleRef)
  const isDefault = agentRoleRefsEqual(roleRef, defaultRoleRef)
  const mountedSkillIds = new Set(conversation?.mountedSkills.map((skill) => skill.id) ?? [])

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
          <span className="agent-role-detail-icon">
            <AgentRoleIcon icon={role.icon} size={27} />
          </span>
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
        <section className="agent-role-detail-wide agent-role-overview-section">
          <h2>角色概览</h2>
          <div className="agent-role-overview-columns">
            <div>
              <h3>目标</h3>
              <ul>
                {role.goals.map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>适合</h3>
              {role.suitableFor.length > 0 ? (
                <ul>
                  {role.suitableFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>适用于符合该角色职责的一般任务。</p>
              )}
            </div>
            <div>
              <h3>不适合</h3>
              {role.unsuitableFor.length > 0 ? (
                <ul>
                  {role.unsuitableFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>没有额外限制；仍需遵守角色边界与权限规则。</p>
              )}
            </div>
          </div>
        </section>

        {role.soul && (
          <section className="agent-role-detail-wide agent-role-soul-section" data-role-soul>
            <div className="agent-role-section-heading">
              <div>
                <h2>人格与原则 · SOUL.md</h2>
                <small>内置只读内容 · 不声明工具或权限</small>
              </div>
              <code title={role.soul.contentHash}>{role.soul.contentHash.slice(0, 12)}</code>
            </div>
            <ConversationMarkdown source={role.soul.markdown} />
          </section>
        )}

        {role.recommendedSkillRefs.length > 0 && (
          <section className="agent-role-detail-wide agent-role-skills-section">
            <div className="agent-role-section-heading">
              <div>
                <h2>建议 Skills</h2>
                <small>只在你明确挂载后进入当前会话</small>
              </div>
              {skillsError && (
                <button type="button" onClick={reloadSkills}>
                  重新加载
                </button>
              )}
            </div>
            <div className="agent-role-skill-list">
              {role.recommendedSkillRefs.map((skillRef) => {
                const skill = skills.find(
                  (candidate) =>
                    candidate.skillId === skillRef.skillId &&
                    candidate.version === skillRef.version,
                )
                const mounted = mountedSkillIds.has(skillRef.skillId)
                return (
                  <article key={`${skillRef.skillId}@${skillRef.version}`}>
                    <div>
                      <strong>{skill?.label ?? skillRef.skillId}</strong>
                      <small>
                        {skill
                          ? `${skill.name} · v${skill.version} · ${skill.source}`
                          : `${skillRef.skillId}@${skillRef.version} · 不可用`}
                      </small>
                      <p>{skill?.description ?? '当前安装中没有这个 Skill。'}</p>
                    </div>
                    <button
                      type="button"
                      disabled={!conversation || !skill?.available || mounted}
                      onClick={() => {
                        if (!conversation || !skill?.available) return
                        addMountedSkill(
                          {
                            id: skill.skillId,
                            name: skill.name,
                            label: skill.label,
                            description: skill.description,
                            source: skill.source,
                          },
                          conversation.id,
                        )
                        showToast(`已将「${skill.label}」挂载到当前会话`, 'success')
                      }}
                    >
                      {mounted ? '已挂载' : skill?.available ? '挂载到当前会话' : '不可用'}
                    </button>
                  </article>
                )
              })}
            </div>
          </section>
        )}

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
          {role.boundaries.length > 0 && (
            <ul>
              {role.boundaries.map((boundary) => (
                <li key={boundary}>{boundary}</li>
              ))}
            </ul>
          )}
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
            <div>
              <dt>内容指纹</dt>
              <dd title={role.contentHash}>{role.contentHash.slice(0, 12)}</dd>
            </div>
          </dl>
        </section>

        {role.examples.length > 0 && (
          <section className="agent-role-detail-wide agent-role-examples-section">
            <h2>输入 / 输出关注点示例</h2>
            <div className="agent-role-example-list">
              {role.examples.map((example) => (
                <article key={example.input}>
                  <strong>{example.input}</strong>
                  <p>{example.focus}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
