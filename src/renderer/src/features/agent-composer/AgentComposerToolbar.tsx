import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { AGENT_IMAGE_ACCEPT } from '../agent-conversations/image-attachments'
import type { AppSettings, ClaudeCodeStatus } from '@shared/ipc/settings'
import type { AgentContextUsageSnapshot } from '@shared/agent-protocol'
import type { PermissionMode } from '../../types'
import type { AgentContextCompactionState } from '../../stores/agent-store'
import type { AgentRoleRef, AgentRoleSummary } from '@shared/agent-role'
import type { AgentRuntimeBinding } from '@shared/agent-runtime'
import {
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconFile,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSettings,
  IconSparkle,
} from '../../components/common/Icons'
import { FloatingSurface } from '../../components/common/FloatingSurface'
import {
  getClaudeCodeSourceLabel,
  getClaudeCodeStatusDetail,
  getClaudeCodeStatusLabel,
  getPermissionModeOption,
  getRuntimeDetail,
  getRuntimeLabel,
  PERMISSION_MODE_OPTIONS,
} from './composer-view-model'
import { AgentRoleIcon } from '../agent-roles/agent-role-presentation'

export interface AgentComposerToolbarProps {
  roleRef?: AgentRoleRef
  roles?: AgentRoleSummary[]
  onRoleChange?: (role: AgentRoleSummary) => void
  permissionMode: PermissionMode
  settings: AppSettings
  runtimeBinding: AgentRuntimeBinding
  canChangeRuntime: boolean
  onRuntimeChange: (binding: AgentRuntimeBinding) => void
  loading: boolean
  canSend: boolean
  contextUsage: AgentContextUsageSnapshot | null
  contextCompaction: AgentContextCompactionState
  canCompact: boolean
  onPermissionModeChange: (mode: PermissionMode) => void
  onCompactContext: (instructions: string) => void
  onOpenResourceMenu: () => void
  onOpenSkillMenu: () => void
  onAddImages: (files: File[]) => void
  onOpenSettings: () => void
  sendButton: ReactNode
}

type ComposerMenuName = 'add' | 'role' | 'permission' | 'context' | 'runtime'

export function AgentComposerToolbar({
  roleRef,
  roles = [],
  onRoleChange,
  permissionMode,
  settings,
  runtimeBinding,
  canChangeRuntime,
  onRuntimeChange,
  loading,
  canSend,
  contextUsage,
  contextCompaction,
  canCompact,
  onPermissionModeChange,
  onCompactContext,
  onOpenResourceMenu,
  onOpenSkillMenu,
  onAddImages,
  onOpenSettings,
  sendButton,
}: AgentComposerToolbarProps): ReactElement {
  const [openMenu, setOpenMenu] = useState<ComposerMenuName | null>(null)
  const [compactInstructions, setCompactInstructions] = useState('')
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null)
  const [detectingClaude, setDetectingClaude] = useState(false)
  const [claudeError, setClaudeError] = useState<string | null>(null)
  const addRef = useRef<HTMLDivElement>(null)
  const roleRefElement = useRef<HTMLDivElement>(null)
  const permissionRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const runtimeOpen = openMenu === 'runtime'
  const selectedRole =
    roles.find((role) => role.roleId === roleRef?.roleId && role.version === roleRef.version) ??
    null
  const selectedPermission = getPermissionModeOption(permissionMode)
  const runtimeLabel = runtimeBinding.kind === 'acp' ? 'Codex ACP' : getRuntimeLabel(settings)
  const runtimeDetail =
    runtimeBinding.kind === 'acp' ? 'ACP · 本机进程' : getRuntimeDetail(settings)
  const claudeStatusLabel = getClaudeCodeStatusLabel(claudeStatus)
  const claudeStatusDetail = getClaudeCodeStatusDetail(claudeStatus)
  const contextPercent = Math.round(contextUsage?.percentage ?? 0)
  const contextTone =
    contextCompaction.status === 'compacting'
      ? 'compacting'
      : contextPercent >= 90
        ? 'critical'
        : contextPercent >= 70
          ? 'warning'
          : 'normal'
  const contextCategories = [...(contextUsage?.categories ?? [])]
    .filter((category) => category.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)

  const detectClaudeCode = async (): Promise<void> => {
    setDetectingClaude(true)
    setClaudeError(null)
    try {
      const result = await window.cclinkStudio.settings.detectClaudeCode()
      if (result.success && result.status) {
        setClaudeStatus(result.status)
        return
      }
      setClaudeError(result.error ?? '检测失败')
    } catch (error) {
      setClaudeError(error instanceof Error ? error.message : String(error))
    } finally {
      setDetectingClaude(false)
    }
  }

  useEffect(() => {
    if (!runtimeOpen || runtimeBinding.kind !== 'claude-code' || claudeStatus || detectingClaude)
      return
    void detectClaudeCode()
  }, [runtimeOpen, runtimeBinding.kind, claudeStatus, detectingClaude])

  const toggleMenu = (menu: ComposerMenuName): void => {
    setOpenMenu((current) => (current === menu ? null : menu))
  }

  return (
    <div className="agent-composer-toolbar">
      <div className="agent-composer-tools">
        <div className="agent-composer-menu-wrap" ref={addRef}>
          <input
            ref={imageInputRef}
            type="file"
            accept={AGENT_IMAGE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length > 0) onAddImages(files)
            }}
          />
          <button
            className="agent-composer-icon-btn"
            data-agent-action="addContext"
            title="添加上下文"
            onClick={() => toggleMenu('add')}
            disabled={loading}
          >
            <IconPlus size={16} />
          </button>
          <FloatingSurface
            anchorRef={addRef}
            open={openMenu === 'add'}
            placement="top-start"
            className="agent-composer-menu compact"
            onRequestClose={() => setOpenMenu(null)}
          >
            <button
              onClick={() => {
                setOpenMenu(null)
                imageInputRef.current?.click()
              }}
            >
              <IconFile size={13} />
              <span>
                <strong>添加图片</strong>
                <em>PNG、JPEG、GIF 或 WebP</em>
              </span>
            </button>
            <button
              onClick={() => {
                setOpenMenu(null)
                onOpenResourceMenu()
              }}
            >
              <IconFile size={13} />
              <span>
                <strong>挂资源</strong>
                <em>@ 文件、Tab 或项目资源</em>
              </span>
            </button>
            <button
              onClick={() => {
                setOpenMenu(null)
                onOpenSkillMenu()
              }}
            >
              <IconSparkle size={13} />
              <span>
                <strong>挂技能</strong>
                <em>/ Skill 工作流</em>
              </span>
            </button>
          </FloatingSurface>
        </div>

        {onRoleChange && (
          <div className="agent-composer-menu-wrap" ref={roleRefElement}>
            <button
              className="agent-mode-btn agent-profile-btn"
              data-agent-action="role"
              onClick={() => toggleMenu('role')}
              title={
                roleRef
                  ? `当前角色: ${selectedRole?.label ?? roleRef.roleId}`
                  : '当前角色不可用，请先加载角色列表'
              }
              disabled={loading || !roleRef || roles.length === 0}
            >
              {selectedRole ? (
                <AgentRoleIcon icon={selectedRole.icon} size={14} />
              ) : (
                <IconRobot size={13} />
              )}
              <span>{selectedRole?.label ?? '角色不可用'}</span>
              <IconChevronDown size={12} />
            </button>
            <FloatingSurface
              anchorRef={roleRefElement}
              open={openMenu === 'role'}
              placement="top-start"
              className="agent-composer-menu agent-profile-menu"
              onRequestClose={() => setOpenMenu(null)}
            >
              <div className="agent-composer-menu-title">选择角色</div>
              {roles.map((role) => {
                const selected =
                  role.roleId === roleRef?.roleId && role.version === roleRef?.version
                return (
                  <button
                    key={`${role.roleId}@${role.version}`}
                    className={selected ? 'selected' : ''}
                    onClick={() => {
                      setOpenMenu(null)
                      if (!selected) onRoleChange(role)
                    }}
                  >
                    <span className="agent-profile-avatar">
                      <AgentRoleIcon icon={role.icon} size={16} />
                    </span>
                    <span>
                      <strong>{role.label}</strong>
                      <em>{role.description}</em>
                      {role.disclaimer && <small>{role.disclaimer}</small>}
                    </span>
                    {selected && <IconCheck size={11} />}
                  </button>
                )
              })}
            </FloatingSurface>
          </div>
        )}

        <div className="agent-composer-menu-wrap" ref={permissionRef}>
          <button
            className="agent-mode-btn"
            data-agent-action="permissionMode"
            onClick={() => toggleMenu('permission')}
            title={`权限模式: ${selectedPermission.label}`}
            disabled={loading}
          >
            <IconCircle size={8} filled color={selectedPermission.color} />
            {selectedPermission.label}
            <IconChevronDown size={12} />
          </button>
          <FloatingSurface
            anchorRef={permissionRef}
            open={openMenu === 'permission'}
            placement="top-start"
            className="agent-composer-menu"
            onRequestClose={() => setOpenMenu(null)}
          >
            <div className="agent-composer-menu-title">权限模式</div>
            {PERMISSION_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={option.value === permissionMode ? 'selected' : ''}
                onClick={() => {
                  setOpenMenu(null)
                  onPermissionModeChange(option.value)
                }}
              >
                <IconCircle size={8} filled color={option.color} />
                <span>
                  <strong>{option.label}</strong>
                  <em>{option.description}</em>
                </span>
                {option.value === permissionMode && <IconCheck size={11} />}
              </button>
            ))}
          </FloatingSurface>
        </div>
      </div>

      <div className="agent-composer-tools">
        <div className="agent-composer-menu-wrap" ref={contextRef}>
          <button
            type="button"
            className={`agent-context-usage-btn ${contextTone}`}
            data-agent-action="contextUsage"
            style={
              {
                '--agent-context-angle': `${Math.min(100, Math.max(0, contextPercent)) * 3.6}deg`,
              } as CSSProperties
            }
            title={
              contextUsage
                ? `上下文 ${contextPercent}% · ${formatTokens(contextUsage.totalTokens)} / ${formatTokens(contextUsage.maxTokens)}`
                : '上下文占用将在 Agent 运行后显示'
            }
            aria-label={contextUsage ? `上下文占用 ${contextPercent}%` : '上下文占用未知'}
            onClick={() => toggleMenu('context')}
          >
            <span>
              {contextCompaction.status === 'compacting'
                ? '…'
                : contextUsage
                  ? contextPercent
                  : '–'}
            </span>
          </button>
          <FloatingSurface
            anchorRef={contextRef}
            open={openMenu === 'context'}
            placement="top-end"
            className="agent-composer-menu agent-context-usage-menu align-right"
            onRequestClose={() => setOpenMenu(null)}
          >
            <div className="agent-context-usage-heading">
              <span>
                <strong>上下文窗口</strong>
                <em>{contextUsage?.model || '等待 SDK 数据'}</em>
              </span>
              <b>{contextUsage ? `${contextPercent}%` : '未知'}</b>
            </div>

            {contextUsage ? (
              <>
                <div className="agent-context-usage-meter" aria-hidden="true">
                  <span style={{ width: `${contextPercent}%` }} />
                </div>
                <div className="agent-context-usage-total">
                  <span>{formatTokens(contextUsage.totalTokens)} 已使用</span>
                  <span>{formatTokens(contextUsage.maxTokens)} 可用</span>
                </div>
                {contextCategories.length > 0 && (
                  <div className="agent-context-category-list">
                    {contextCategories.map((category) => (
                      <div key={category.name}>
                        <span>{formatCategoryName(category.name)}</span>
                        <strong>{formatTokens(category.tokens)}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <div className="agent-context-auto-compact">
                  自动压缩
                  <strong>
                    {contextUsage.isAutoCompactEnabled
                      ? contextUsage.autoCompactThreshold
                        ? `约 ${formatTokens(contextUsage.autoCompactThreshold)}`
                        : '已启用'
                      : '未启用'}
                  </strong>
                </div>
              </>
            ) : (
              <div className="agent-context-empty">暂无 SDK 用量数据</div>
            )}

            {contextCompaction.status !== 'idle' && (
              <div className={`agent-context-compact-result ${contextCompaction.status}`}>
                <span>{compactionStatusLabel(contextCompaction)}</span>
                {contextCompaction.preTokens !== null && (
                  <strong>
                    {formatTokens(contextCompaction.preTokens)}
                    {contextCompaction.postTokens !== null
                      ? ` → ${formatTokens(contextCompaction.postTokens)}`
                      : ''}
                  </strong>
                )}
              </div>
            )}

            <div className="agent-context-compact-controls">
              <input
                value={compactInstructions}
                onChange={(event) => setCompactInstructions(event.target.value)}
                placeholder="可选：指定要保留的重点"
                maxLength={1000}
                disabled={contextCompaction.status === 'compacting'}
              />
              <button
                type="button"
                className="agent-context-compact-btn"
                disabled={!canCompact || contextCompaction.status === 'compacting'}
                onClick={() => onCompactContext(compactInstructions)}
              >
                <IconRefresh size={13} />
                <span>
                  <strong>
                    {contextCompaction.status === 'compacting' ? '正在压缩' : '压缩上下文'}
                  </strong>
                  <em>{canCompact ? '保留当前会话并生成摘要' : '会话启动后可用'}</em>
                </span>
              </button>
            </div>
          </FloatingSurface>
        </div>

        <div className="agent-composer-menu-wrap" ref={runtimeRef}>
          <button
            className="agent-model-btn"
            data-agent-action="runtime"
            title="运行环境"
            onClick={() => toggleMenu('runtime')}
          >
            {runtimeLabel}
            <span>{runtimeDetail}</span>
            <IconChevronDown size={12} />
          </button>
          <FloatingSurface
            anchorRef={runtimeRef}
            open={runtimeOpen}
            placement="top-end"
            className="agent-composer-menu agent-runtime-menu align-right"
            onRequestClose={() => setOpenMenu(null)}
          >
            <div className="agent-composer-menu-title">运行环境</div>
            <button
              className={runtimeBinding.kind === 'claude-code' ? 'selected' : ''}
              disabled={!canChangeRuntime}
              onClick={() => {
                onRuntimeChange({ kind: 'claude-code' })
                setOpenMenu(null)
              }}
            >
              <IconRobot size={13} />
              <span>
                <strong>Claude Code（默认）</strong>
                <em>Studio 直接支持的默认 runtime</em>
              </span>
              {runtimeBinding.kind === 'claude-code' && <IconCheck size={11} />}
            </button>
            <button
              className={runtimeBinding.kind === 'acp' ? 'selected' : ''}
              disabled={!canChangeRuntime}
              onClick={() => {
                onRuntimeChange({ kind: 'acp', implementationId: 'codex-acp' })
                setOpenMenu(null)
              }}
            >
              <IconRobot size={13} />
              <span>
                <strong>Codex ACP</strong>
                <em>可选的平级 runtime；首条消息后锁定</em>
              </span>
              {runtimeBinding.kind === 'acp' && <IconCheck size={11} />}
            </button>
            <div className="agent-runtime-card">
              <IconRobot size={14} />
              <span>
                <strong>{runtimeLabel}</strong>
                <em>
                  {runtimeBinding.kind === 'acp'
                    ? '使用设置中独立保存的 Codex API Key'
                    : '模型、登录和 API Key 由本机 Claude Code 管理'}
                </em>
              </span>
            </div>
            {runtimeBinding.kind === 'claude-code' ? (
              <div
                className={`agent-runtime-status ${claudeStatus?.installed ? 'ready' : 'warning'}`}
              >
                <span className="agent-runtime-status-dot" />
                <span>
                  <strong>{detectingClaude ? '检测中' : claudeStatusLabel}</strong>
                  <em title={claudeError ?? claudeStatusDetail}>
                    {claudeError ?? claudeStatusDetail}
                  </em>
                </span>
                <button
                  className="agent-runtime-refresh"
                  onClick={() => void detectClaudeCode()}
                  disabled={detectingClaude}
                  title="重新检测 Claude Code"
                >
                  <IconRefresh size={12} />
                </button>
              </div>
            ) : (
              <div className="agent-runtime-status ready">
                <span className="agent-runtime-status-dot" />
                <span>
                  <strong>按需启动</strong>
                  <em>{settings.codexAcpPath.trim() || '从系统 PATH 查找 codex-acp'}</em>
                </span>
              </div>
            )}
            <div className="agent-runtime-facts">
              <span>
                <strong>
                  {runtimeBinding.kind === 'acp'
                    ? settings.codexAcpPath.trim()
                      ? '自定义路径'
                      : '系统 PATH'
                    : getClaudeCodeSourceLabel(claudeStatus?.source ?? null)}
                </strong>
                <em>来源</em>
              </span>
              <span>
                <strong>仅统计</strong>
                <em>费用策略</em>
              </span>
            </div>
            <button
              onClick={() => {
                setOpenMenu(null)
                onOpenSettings()
              }}
            >
              <IconSettings size={13} />
              <span>
                <strong>打开 Agent 设置</strong>
                <em>Claude Code、Codex ACP、权限和凭证</em>
              </span>
            </button>
          </FloatingSurface>
        </div>
        <span className="agent-composer-send-slot" aria-disabled={!canSend}>
          {sendButton}
        </span>
      </div>
    </div>
  )
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(Math.round(tokens))
}

function formatCategoryName(name: string): string {
  const labels: Record<string, string> = {
    system_prompt: '系统提示',
    systemPrompt: '系统提示',
    tools: '工具定义',
    messages: '会话消息',
    mcp_tools: 'MCP 工具',
    memory_files: '项目记忆',
  }
  return labels[name] ?? name.replaceAll('_', ' ')
}

function compactionStatusLabel(state: AgentContextCompactionState): string {
  if (state.status === 'compacting') return '正在压缩上下文'
  if (state.status === 'failed') return state.error || '压缩失败'
  return state.trigger === 'auto' ? 'SDK 已自动压缩' : '上下文已压缩'
}
