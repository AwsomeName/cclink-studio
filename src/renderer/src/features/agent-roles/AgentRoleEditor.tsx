import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentRoleDraft, AgentRoleSummary, AgentSkillRef } from '@shared/agent-role'
import { useToastStore } from '../../components/common/Toast'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { notifyAgentRolesChanged } from '../agent-profiles/use-agent-profiles'
import { useAgentSkills } from '../agent-skills/use-agent-skills'
import { AgentRoleIcon } from './agent-role-presentation'
import {
  clearAgentRoleDraftController,
  getAgentRoleDraftController,
  registerAgentRoleDraftController,
} from './agent-role-draft-registry'

interface AgentRoleEditorProps {
  tabId: string
  role?: AgentRoleSummary
}

const ICON_OPTIONS: AgentRoleDraft['icon'][] = [
  'assistant',
  'challenger',
  'fact-checker',
  'product',
  'architect',
  'governance',
  'rights',
]

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function lines(value: string[]): string {
  return value.join('\n')
}

function draftFromRole(role?: AgentRoleSummary): AgentRoleDraft {
  return role
    ? {
        label: role.label,
        description: role.description,
        icon: role.icon,
        goals: [...role.goals],
        suitableFor: [...role.suitableFor],
        unsuitableFor: [...role.unsuitableFor],
        instructions: [...role.instructions],
        boundaries: [...role.boundaries],
        examples: structuredClone(role.examples),
        soulMarkdown: role.soul?.markdown,
        recommendedSkillRefs: structuredClone(role.recommendedSkillRefs),
        disclaimer: role.disclaimer,
      }
    : {
        label: '',
        description: '',
        icon: 'assistant',
        goals: [''],
        suitableFor: [],
        unsuitableFor: [],
        instructions: [''],
        boundaries: ['不扩大工具、权限或数据访问范围。'],
        examples: [],
        soulMarkdown: '# 身份\n\n描述这个角色长期坚持的人格、原则与表达方式。',
        recommendedSkillRefs: [],
      }
}

export function AgentRoleEditor({ tabId, role }: AgentRoleEditorProps): React.ReactElement {
  const initialDraft = useMemo(() => draftFromRole(role), [role])
  const [draft, setDraft] = useState<AgentRoleDraft>(
    () => getAgentRoleDraftController(tabId)?.draft ?? initialDraft,
  )
  const [saving, setSaving] = useState(false)
  const showToast = useToastStore((state) => state.show)
  const openTab = useTabStore((state) => state.openTab)
  const createConversation = useAgentStore((state) => state.createConversation)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const { skills } = useAgentSkills()
  const updateTabDirty = useTabStore((state) => state.updateTabDirty)

  const editing = Boolean(role)
  const canSave = useMemo(
    () =>
      Boolean(
        draft.label.trim() &&
        draft.description.trim() &&
        draft.goals.some((item) => item.trim()) &&
        draft.instructions.some((item) => item.trim()) &&
        draft.boundaries.some((item) => item.trim()),
      ),
    [draft],
  )

  const save = useCallback(async (): Promise<boolean> => {
    if (saving) {
      showToast('角色正在保存，请稍候', 'error')
      return false
    }
    if (!canSave) {
      showToast('请先填写名称、简介、目标、行为规则和边界，再保存角色', 'error')
      return false
    }
    setSaving(true)
    try {
      const result = role
        ? await window.cclinkStudio.agent.updateRole(role.roleId, role.version, draft)
        : await window.cclinkStudio.agent.createRole(draft)
      if (!result.success || !result.role) {
        showToast(result.error ?? '角色保存失败', 'error')
        return false
      }
      updateTabDirty(tabId, false)
      clearAgentRoleDraftController(tabId)
      notifyAgentRolesChanged()
      openTab({
        type: 'agent-role',
        title: '角色配置',
        icon: '◇',
        agentRole: result.role,
      })
      showToast(
        role
          ? `已保存为不可变新版本 v${result.role.version}；旧会话仍固定原版本`
          : `已创建「${result.role.label}」`,
        'success',
      )
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : '角色保存失败', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [canSave, draft, openTab, role, saving, showToast, tabId, updateTabDirty])

  const discard = useCallback((): void => {
    setDraft(structuredClone(initialDraft))
    updateTabDirty(tabId, false)
    clearAgentRoleDraftController(tabId)
  }, [initialDraft, tabId, updateTabDirty])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft),
    [draft, initialDraft],
  )

  useEffect(() => {
    updateTabDirty(tabId, dirty)
    registerAgentRoleDraftController(tabId, { draft: structuredClone(draft), save, discard })
  }, [dirty, discard, draft, save, tabId, updateTabDirty])

  const toggleSkill = (ref: AgentSkillRef): void => {
    setDraft((current) => {
      const mounted = current.recommendedSkillRefs.some(
        (item) => item.skillId === ref.skillId && item.version === ref.version,
      )
      return {
        ...current,
        recommendedSkillRefs: mounted
          ? current.recommendedSkillRefs.filter(
              (item) => item.skillId !== ref.skillId || item.version !== ref.version,
            )
          : [...current.recommendedSkillRefs, ref],
      }
    })
  }

  const tryInNewConversation = (): void => {
    if (!role) return
    createConversation({
      runtime: createConversationRuntimeForWorkspace(activeWorkspaceRef),
      roleRef: { roleId: role.roleId, version: role.version },
      activate: true,
    })
    showToast(`已新建会话试用「${role.label}」v${role.version}`, 'success')
  }

  return (
    <div className="agent-role-editor" data-role-editor>
      <header className="agent-role-editor-header">
        <div>
          <span className="agent-role-detail-icon">
            <AgentRoleIcon icon={draft.icon} size={24} />
          </span>
          <div>
            <div className="agent-role-detail-eyebrow">
              {editing ? `编辑本地角色 · 基于 v${role?.version}` : '新建本地角色'}
            </div>
            <h1>{draft.label || '未命名角色'}</h1>
            <p>保存会创建不可变版本；角色只改变人格与分析方式，不改变权限。</p>
          </div>
        </div>
        <div className="agent-role-detail-actions">
          {role && (
            <button type="button" onClick={tryInNewConversation}>
              在新会话试用
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={!canSave || saving}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : editing ? '保存为新版本' : '创建角色'}
          </button>
        </div>
      </header>

      <div className="agent-role-editor-grid">
        <label>
          名称
          <input
            value={draft.label}
            maxLength={80}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
        <label>
          图标
          <select
            value={draft.icon}
            onChange={(event) =>
              setDraft({ ...draft, icon: event.target.value as AgentRoleDraft['icon'] })
            }
          >
            {ICON_OPTIONS.map((icon) => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          简介
          <input
            value={draft.description}
            maxLength={240}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <RoleLinesField
          label="目标（每行一项）"
          value={draft.goals}
          onChange={(goals) => setDraft({ ...draft, goals })}
        />
        <RoleLinesField
          label="适用场景（每行一项）"
          value={draft.suitableFor}
          onChange={(suitableFor) => setDraft({ ...draft, suitableFor })}
        />
        <RoleLinesField
          label="不适用场景（每行一项）"
          value={draft.unsuitableFor}
          onChange={(unsuitableFor) => setDraft({ ...draft, unsuitableFor })}
        />
        <RoleLinesField
          label="行为规则（每行一项）"
          value={draft.instructions}
          onChange={(instructions) => setDraft({ ...draft, instructions })}
        />
        <RoleLinesField
          label="边界（每行一项）"
          value={draft.boundaries}
          onChange={(boundaries) => setDraft({ ...draft, boundaries })}
        />
        <label>
          说明
          <textarea
            value={draft.disclaimer ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, disclaimer: event.target.value || undefined })
            }
          />
        </label>
        <label className="wide">
          SOUL.md
          <textarea
            className="agent-role-editor-soul"
            value={draft.soulMarkdown ?? ''}
            onChange={(event) =>
              setDraft({ ...draft, soulMarkdown: event.target.value || undefined })
            }
          />
          <small>仅支持人格、原则和表达方式；脚本、可执行 HTML 与远程 include 会被拒绝。</small>
        </label>
        <fieldset className="wide">
          <legend>建议 Skills（不会自动挂载）</legend>
          {skills.length === 0 ? (
            <small>当前没有可用 Skill</small>
          ) : (
            skills.map((skill) => {
              const checked = draft.recommendedSkillRefs.some(
                (item) => item.skillId === skill.skillId && item.version === skill.version,
              )
              return (
                <label key={`${skill.skillId}@${skill.version}`} className="agent-role-skill-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSkill({ skillId: skill.skillId, version: skill.version })}
                  />
                  <span>
                    <strong>{skill.label}</strong>
                    <small>
                      {skill.skillId}@{skill.version} · {skill.description}
                    </small>
                  </span>
                </label>
              )
            })
          )}
        </fieldset>
        <fieldset className="wide">
          <legend>输入 / 输出关注点示例</legend>
          {draft.examples.map((example, index) => (
            <div className="agent-role-example-editor" key={index}>
              <input
                placeholder="示例输入"
                value={example.input}
                onChange={(event) => {
                  const examples = structuredClone(draft.examples)
                  examples[index].input = event.target.value
                  setDraft({ ...draft, examples })
                }}
              />
              <input
                placeholder="输出关注点"
                value={example.focus}
                onChange={(event) => {
                  const examples = structuredClone(draft.examples)
                  examples[index].focus = event.target.value
                  setDraft({ ...draft, examples })
                }}
              />
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    examples: draft.examples.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDraft({ ...draft, examples: [...draft.examples, { input: '', focus: '' }] })
            }
          >
            ＋ 添加示例
          </button>
        </fieldset>
      </div>
    </div>
  )
}

function RoleLinesField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
}): React.ReactElement {
  return (
    <label>
      {label}
      <textarea
        value={lines(value)}
        onChange={(event) => onChange(splitLines(event.target.value))}
      />
    </label>
  )
}
