import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tab } from '../../types'
import {
  DEFAULT_AGENT_ROLE_REF,
  agentRoleRefsEqual,
  agentSkillRefsEqual,
  type AgentRoleSummary,
} from '@shared/agent-role'
import { useAgentStore } from '../../stores/agent-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useToastStore } from '../../components/common/Toast'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { notifyAgentRolesChanged, useAgentRoles } from '../agent-profiles/use-agent-profiles'
import { useAgentSkills } from '../agent-skills/use-agent-skills'
import { applyAgentRoleToConversation, getApplyAgentRoleError } from './agent-role-actions'
import { AgentRoleIcon } from './agent-role-presentation'
import { AgentRoleEditor } from './AgentRoleEditor'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'

function compareRoleVersions(current: AgentRoleSummary, latest: AgentRoleSummary): string[] {
  const sections: Array<[string, unknown, unknown]> = [
    ['名称与简介', [current.label, current.description], [latest.label, latest.description]],
    ['目标', current.goals, latest.goals],
    ['适用场景', current.suitableFor, latest.suitableFor],
    ['不适用场景', current.unsuitableFor, latest.unsuitableFor],
    ['行为规则', current.instructions, latest.instructions],
    ['边界', current.boundaries, latest.boundaries],
    ['示例', current.examples, latest.examples],
    ['SOUL.md', current.soul?.contentHash ?? null, latest.soul?.contentHash ?? null],
    ['建议 Skills', current.recommendedSkillRefs, latest.recommendedSkillRefs],
  ]
  return sections
    .filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right))
    .map(([label]) => label)
}

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
  const [editing, setEditing] = useState(false)
  const editAfterCopyRoleId = useRef<string | null>(null)
  const openTab = useTabStore((state) => state.openTab)
  const createConversation = useAgentStore((state) => state.createConversation)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const role = useMemo(
    () =>
      roles.find(
        (candidate) =>
          candidate.roleId === tab.agentRole?.roleId && candidate.version === tab.agentRole.version,
      ),
    [roles, tab.agentRole],
  )

  useEffect(() => {
    const shouldEditCopiedRole = editAfterCopyRoleId.current === tab.agentRole?.roleId
    editAfterCopyRoleId.current = null
    setEditing(shouldEditCopiedRole)
  }, [tab.agentRole?.roleId, tab.agentRole?.version])

  if (tab.agentRole?.roleId === '__new-local-role__') {
    return <AgentRoleEditor tabId={tab.id} />
  }

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

  if (editing && role.source !== 'builtin' && role.isLatest) {
    return <AgentRoleEditor tabId={tab.id} role={role} />
  }

  const roleRef = { roleId: role.roleId, version: role.version }
  const applied = agentRoleRefsEqual(roleRef, conversation?.configuration.roleRef)
  const isDefault = agentRoleRefsEqual(roleRef, defaultRoleRef)
  const isDefaultRole = role.roleId === defaultRoleRef.roleId
  const roleVersions = roles
    .filter((candidate) => candidate.roleId === role.roleId)
    .sort((left, right) => right.version - left.version)
  const latestRole = roleVersions[0]
  const changesFromLatest =
    latestRole && latestRole.version !== role.version ? compareRoleVersions(role, latestRole) : []

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

  const copyRole = async (openEditor = false): Promise<void> => {
    const result = await window.cclinkStudio.agent.copyRole(roleRef)
    if (!result.success || !result.role) {
      showToast(result.error ?? '复制角色失败', 'error')
      return
    }
    if (openEditor) editAfterCopyRoleId.current = result.role.roleId
    notifyAgentRolesChanged()
    openTab({ type: 'agent-role', title: '角色配置', icon: '◇', agentRole: result.role })
    showToast(
      openEditor
        ? `已创建可编辑副本「${result.role.label}」`
        : `已复制为本地角色「${result.role.label}」`,
      'success',
    )
  }

  const setArchived = async (): Promise<void> => {
    if (!role.archived && isDefaultRole) {
      showToast('该角色是新会话默认角色；请先设置其他默认角色，再归档。', 'error')
      return
    }
    const result = await window.cclinkStudio.agent.setRoleArchived(role.roleId, !role.archived)
    if (!result.success || !result.role) {
      showToast(result.error ?? '角色归档状态保存失败', 'error')
      return
    }
    notifyAgentRolesChanged()
    showToast(result.role.archived ? '角色已归档；已有会话仍可继续使用' : '角色已恢复', 'success')
  }

  const exportRole = async (): Promise<void> => {
    const selected = await window.cclinkStudio.dialog.showOpenDialog({
      title: '选择角色包导出位置',
      selectDirectory: true,
    })
    if (selected.canceled || !selected.filePaths[0]) return
    const result = await window.cclinkStudio.agent.exportRole(roleRef, selected.filePaths[0])
    showToast(
      result.success ? `角色包已导出到 ${result.directoryPath}` : (result.error ?? '角色导出失败'),
      result.success ? 'success' : 'error',
    )
  }

  const tryInNewConversation = (): void => {
    createConversation({
      runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
      roleRef,
      activate: true,
    })
    showToast(`已新建会话试用「${role.label}」v${role.version}`, 'success')
  }

  return (
    <div className="agent-role-detail">
      <header className="agent-role-detail-header">
        <div className="agent-role-detail-title">
          <span className="agent-role-detail-icon">
            <AgentRoleIcon icon={role.icon} size={27} />
          </span>
          <div>
            <div className="agent-role-detail-eyebrow">
              {role.source === 'builtin'
                ? '内置角色'
                : role.source === 'imported'
                  ? '导入角色'
                  : '我的角色'}{' '}
              · v{role.version}
              {role.archived ? ' · 已归档' : ''}
            </div>
            <h1>{role.label}</h1>
            <p>{role.description}</p>
            {role.source === 'builtin' && (
              <small className="agent-role-edit-hint">
                内置角色不会被直接覆盖；点击“编辑副本”会创建本地角色并立即进入编辑。
              </small>
            )}
          </div>
        </div>
        <div className="agent-role-detail-actions">
          <button type="button" onClick={() => void exportRole()}>
            导出
          </button>
          <button
            type="button"
            className={role.source === 'builtin' ? 'agent-role-edit-action' : undefined}
            onClick={() => void copyRole(role.source === 'builtin')}
          >
            {role.source === 'builtin' ? '编辑副本' : '复制'}
          </button>
          {role.source !== 'builtin' && role.isLatest && (
            <button type="button" onClick={() => setEditing(true)} disabled={role.archived}>
              编辑角色
            </button>
          )}
          {role.source !== 'builtin' && role.isLatest && (
            <button
              type="button"
              onClick={() => void setArchived()}
              title={!role.archived && isDefaultRole ? '请先设置其他新会话默认角色' : undefined}
            >
              {role.archived ? '恢复' : '归档'}
            </button>
          )}
          <button type="button" onClick={tryInNewConversation} disabled={role.archived}>
            在新会话试用
          </button>
          <button
            type="button"
            onClick={setAsDefault}
            disabled={role.archived || isDefault || saving !== null}
          >
            {isDefault ? '新会话默认' : saving === 'default' ? '保存中…' : '设为新会话默认'}
          </button>
          <button
            type="button"
            className="primary"
            onClick={applyToConversation}
            disabled={role.archived || !conversation || applied || saving !== null}
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

      {roleVersions.length > 1 && (
        <div className="agent-role-version-card">
          <span>版本</span>
          <select
            value={role.version}
            onChange={(event) => {
              const version = Number(event.target.value)
              openTab({
                type: 'agent-role',
                title: '角色配置',
                icon: '◇',
                agentRole: { roleId: role.roleId, version },
              })
            }}
          >
            {roleVersions.map((candidate) => (
              <option key={candidate.version} value={candidate.version}>
                v{candidate.version}
                {candidate.isLatest ? ' · 最新' : ' · 历史'}
              </option>
            ))}
          </select>
          {latestRole && latestRole.version !== role.version && (
            <button
              type="button"
              disabled={!conversation || saving !== null}
              onClick={() =>
                void applyAgentRoleToConversation(conversation!.id, latestRole).then((result) => {
                  const failure = getApplyAgentRoleError(result)
                  showToast(
                    failure ?? `当前会话已显式升级到 v${latestRole.version}`,
                    failure ? 'error' : 'success',
                  )
                })
              }
            >
              当前会话升级到 v{latestRole.version}
            </button>
          )}
          {conversation && !agentRoleRefsEqual(conversation.configuration.roleRef, roleRef) && (
            <button type="button" onClick={() => void applyToConversation()}>
              将当前会话切换/回滚到 v{role.version}
            </button>
          )}
          {changesFromLatest.length > 0 && (
            <small>
              与 v{latestRole.version} 不同：{changesFromLatest.join('、')}
            </small>
          )}
        </div>
      )}

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
                const mounted =
                  conversation?.mountedSkills.some((item) => agentSkillRefsEqual(item, skillRef)) ??
                  false
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
                        void addMountedSkill(
                          { skillId: skill.skillId, version: skill.version },
                          conversation.id,
                        ).then((saved) => {
                          showToast(
                            saved
                              ? `已将「${skill.label}」挂载到当前会话`
                              : 'Skill 挂载保存失败，原配置已保留',
                            saved ? 'success' : 'error',
                          )
                        })
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
            {conversation?.lastRunConfigurationReceipt && (
              <>
                <div>
                  <dt>最近运行指纹</dt>
                  <dd
                    title={conversation.lastRunConfigurationReceipt.configurationFingerprint ?? ''}
                  >
                    {conversation.lastRunConfigurationReceipt.configurationFingerprint?.slice(
                      0,
                      12,
                    ) ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>最近运行 Skills</dt>
                  <dd>
                    {conversation.lastRunConfigurationReceipt.skills.length > 0
                      ? conversation.lastRunConfigurationReceipt.skills
                          .map(
                            (skill) =>
                              `${skill.ref.skillId}@${skill.ref.version} · ${skill.contentHash.slice(0, 8)}`,
                          )
                          .join('；')
                      : '无'}
                  </dd>
                </div>
              </>
            )}
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
