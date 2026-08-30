import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type DragEventHandler,
  type KeyboardEvent,
  type PointerEventHandler,
  type ReactElement,
  type Ref,
  type TouchEventHandler,
  type UIEventHandler,
  type WheelEventHandler,
} from 'react'
import type { AgentMessage } from '../../types'
import type { AgentContextChip } from '../../features/agent-conversations/view-model'
import type {
  AgentResourceCandidate,
  AgentSkillCandidate,
} from '../../features/agent-conversations/view-model'
import type { AgentMountedResource } from '../../types'
import type { AgentSkillRef } from '@shared/agent-role'
import type { AgentSkillSummary } from '@shared/agent-skill'
import { ConversationMessageRenderer } from '../common/ConversationMessageRenderer'
import {
  IconCheck,
  IconCircle,
  IconClipboard,
  IconError,
  IconPlus,
  IconRobot,
  IconSend,
  IconSparkle,
  IconStop,
  IconTool,
} from '../common/Icons'
import { AgentContextBar } from '../../features/agent-conversations/agent-context-bar'
import {
  ResourceCandidateMenu,
  SkillCandidateMenu,
} from '../../features/agent-conversations/context-candidate-menu'
import { MountedResourceBar } from '../../features/agent-conversations/mounted-resource-bar'
import { MountedSkillStrip } from '../../features/agent-conversations/mounted-skill-strip'
import { ImageAttachmentStrip } from '../../features/agent-conversations/image-attachment-strip'
import type { AgentImageAttachment } from '@shared/ipc/agent'
import {
  AgentComposerToolbar,
  type AgentComposerToolbarProps,
} from '../../features/agent-composer/AgentComposerToolbar'
import { useConversationScroll } from '../../features/agent-conversations/use-conversation-scroll'
import { AGENT_IMAGE_ACCEPT } from '../../features/agent-conversations/image-attachments'

export type AgentPanelVariant = 'center' | 'side'
export type AgentPanelRuntime = 'local' | 'remote'
export type AgentPanelStatusTone = 'connecting' | 'ready' | 'working' | 'unavailable'
export type AgentPanelCapabilityState = 'enabled' | 'disabled' | 'hidden'

export interface AgentPanelCapability {
  state: AgentPanelCapabilityState
  reason?: string
}

export interface AgentPanelHeaderModel {
  title: string
  runtimeLabel: string
  status: {
    tone: AgentPanelStatusTone
    label: string
    detail: string
  }
  diagnostics: AgentPanelCapability & {
    label: string
    onInvoke(): void
  }
}

export interface AgentPanelNoticeModel {
  id: string
  tone: 'info' | 'warning' | 'error'
  title: string
  detail?: string
}

export interface AgentPanelActivityAction {
  id: string
  label: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  onInvoke(): void
}

export interface AgentPanelActivityModel {
  id: string
  title: string
  status: string
  tone: 'info' | 'warning' | 'error' | 'success'
  detail?: string
  rows: Array<{
    id: string
    label: string
    detail?: string
    meta?: string
    actions?: AgentPanelActivityAction[]
  }>
  actions: AgentPanelActivityAction[]
}

export interface AgentPanelPermissionModel {
  id: string
  title: string
  tone?: 'default' | 'warning'
  rows: Array<{ label: string; value: string; monospace?: boolean; tone?: 'danger' | 'warning' }>
  actions: Array<{
    id: string
    label: string
    tone: 'approve' | 'always' | 'reject'
    disabled?: boolean
    onInvoke(): void
  }>
}

export interface AgentPanelQuestionModel {
  id: string
  title: string
  answered?: boolean
  submitting?: boolean
  error?: string | null
  questions: Array<{
    id: string
    header?: string
    question: string
    multiSelect?: boolean
    options?: Array<{ label: string; description?: string }>
  }>
  onSubmit(answers: Record<string, string>): void
}

export type AgentPanelTimelineItem =
  | {
      kind: 'message'
      id: string
      message: AgentMessage
      conversationId: string
      workspaceKey: string | null
    }
  | { kind: 'status'; id: string; label: string; detail?: string }
  | { kind: 'question'; id: string; question: AgentPanelQuestionModel }

export interface AgentPanelEmptyModel {
  title: string
  description: string
  suggestions?: string[]
}

export interface AgentPanelComposerEnhancements {
  resourceCandidates?: {
    open: boolean
    items: AgentResourceCandidate[]
    selectedIndex: number
    onActiveIndexChange(index: number): void
    onPick(item: AgentResourceCandidate): void
    onRequestClose(): void
  }
  skillCandidates?: {
    open: boolean
    items: AgentSkillCandidate[]
    selectedIndex: number
    onActiveIndexChange(index: number): void
    onPick(item: AgentSkillCandidate): void
    onRequestClose(): void
  }
  mountedResources?: {
    items: AgentMountedResource[]
    onRemove(id: string): void
    onOpen(resource: AgentMountedResource): void
  }
  mountedSkills?: {
    items: AgentSkillRef[]
    availableSkills: AgentSkillSummary[]
    onRemove(skill: AgentSkillRef): void
  }
  images?: {
    items: AgentImageAttachment[]
    onRemove(id: string): void
  }
}

export interface AgentPanelComposerModel {
  value: string
  placeholder: string
  canSubmit: boolean
  submitting: boolean
  disabled?: boolean
  maxLength?: number
  textareaRef?: Ref<HTMLTextAreaElement>
  onChange(value: string): void
  onSubmit(): void | Promise<void>
  onStop?(): void | Promise<void>
  stopLabel?: string
  stopCapability: AgentPanelCapability
  uploadProgress?: { label: string; percent: number }
  onKeyDownBeforeSubmit?(event: KeyboardEvent<HTMLTextAreaElement>): boolean
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
  onDragOver?: DragEventHandler<HTMLTextAreaElement>
  onDrop?: DragEventHandler<HTMLTextAreaElement>
  enhancements?: AgentPanelComposerEnhancements
  actionBar:
    | {
        kind: 'local'
        toolbar: Omit<AgentComposerToolbarProps, 'sendButton' | 'canSend'>
      }
    | {
        kind: 'remote'
        runtimeLabel: string
        onAddImages?: (files: File[]) => void
        capabilities: {
          addContext: AgentPanelCapability
          role: AgentPanelCapability
          permissionMode: AgentPanelCapability
          contextUsage: AgentPanelCapability
          runtime: AgentPanelCapability
        }
      }
}

export interface AgentPanelViewModel {
  runtime: AgentPanelRuntime
  variant: AgentPanelVariant
  timelineKey: string
  header: AgentPanelHeaderModel
  contextChips: AgentContextChip[]
  notices: AgentPanelNoticeModel[]
  activities: AgentPanelActivityModel[]
  permissions: AgentPanelPermissionModel[]
  timeline: AgentPanelTimelineItem[]
  empty: AgentPanelEmptyModel
  composer: AgentPanelComposerModel
  costLabel?: string | null
  onOpenFilePath?: (path: string) => void
}

export type AgentComposerKeyDecision =
  | 'ignore-composition'
  | 'handled'
  | 'submit'
  | 'block-submit'
  | 'none'

export function isAgentComposerCandidateSelectionKey(input: {
  key: string
  shiftKey: boolean
}): boolean {
  return input.key === 'Tab' || (input.key === 'Enter' && !input.shiftKey)
}

export function resolveAgentComposerKeyDecision(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
  handledBeforeSubmit: boolean
  canSubmit: boolean
}): AgentComposerKeyDecision {
  if (input.isComposing || input.keyCode === 229) return 'ignore-composition'
  if (input.handledBeforeSubmit) return 'handled'
  if (input.key === 'Enter' && !input.shiftKey) {
    return input.canSubmit ? 'submit' : 'block-submit'
  }
  return 'none'
}

export function agentPanelMessageRevision(message: AgentMessage): string {
  const contentRevision = message.content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return `text:${block.text}`
        case 'thinking':
          return `thinking:${block.thinking}`
        case 'tool_use':
          return `tool-use:${block.id}:${block.name}:${block._rawInputJson ?? JSON.stringify(block.input)}`
        case 'tool_result':
          return `tool-result:${block.tool_use_id}:${block.is_error ? 'error' : 'success'}:${block.content}`
      }
    })
    .join('|')
  return `${message.id}:${message.isStreaming ? 'streaming' : 'settled'}:${contentRevision}`
}

const MIN_COMPOSER_HEIGHT = 118
const MAX_COMPOSER_HEIGHT = 520
const MIN_MESSAGES_HEIGHT = 180

function composerHeightStorageKey(variant: AgentPanelVariant): string {
  return `cclink-studio-agent-composer-height-${variant}`
}

function loadComposerHeight(variant: AgentPanelVariant): number | null {
  try {
    const value = Number(localStorage.getItem(composerHeightStorageKey(variant)))
    if (!Number.isFinite(value) || value < MIN_COMPOSER_HEIGHT) return null
    return Math.min(value, MAX_COMPOSER_HEIGHT)
  } catch {
    return null
  }
}

export function AgentPanelView({ model }: { model: AgentPanelViewModel }): ReactElement {
  const mainRef = useRef<HTMLDivElement>(null)
  const timelineRevision = model.timeline
    .map((item) =>
      item.kind === 'message'
        ? agentPanelMessageRevision(item.message)
        : item.kind === 'question'
          ? `${item.id}:${item.question.title}:${item.question.questions.map((question) => question.question).join(',')}:${item.question.submitting ? 'submitting' : ''}`
          : `${item.id}:${item.label}:${item.detail ?? ''}`,
    )
    .concat(model.permissions.map((permission) => permission.id))
    .join('|')
  const conversationScroll = useConversationScroll(model.timelineKey, timelineRevision)

  return (
    <div
      className={`agent-panel agent-panel-${model.variant}`}
      data-agent-panel-runtime={model.runtime}
      data-agent-panel-variant={model.variant}
    >
      <div className="agent-conversation-main" ref={mainRef}>
        <PanelHeader model={model.header} />
        <ContextBar chips={model.contextChips} />
        <NoticePermissionArea
          notices={model.notices}
          activities={model.activities}
          permissions={model.permissions}
        />
        <MessageTimeline
          items={model.timeline}
          empty={model.empty}
          listRef={conversationScroll.listRef}
          onScroll={conversationScroll.onScroll}
          onWheel={conversationScroll.onWheel}
          onPointerDown={conversationScroll.onPointerDown}
          onTouchStart={conversationScroll.onTouchStart}
          onOpenFilePath={model.onOpenFilePath}
        />
        {model.costLabel ? <div className="agent-cost">{model.costLabel}</div> : null}
        <ComposerFrame model={model.composer} variant={model.variant} mainRef={mainRef} />
      </div>
    </div>
  )
}

export function PanelHeader({ model }: { model: AgentPanelHeaderModel }): ReactElement {
  const diagnosticsDisabled = model.diagnostics.state !== 'enabled'
  const diagnosticsTitle = diagnosticsDisabled
    ? model.diagnostics.reason || model.diagnostics.label
    : model.diagnostics.label
  return (
    <header className="agent-panel-header" data-agent-landmark="header">
      <IconRobot size={15} />
      <div className="agent-panel-heading">
        <strong>{model.title}</strong>
        <span>{model.runtimeLabel}</span>
      </div>
      <div
        className={`agent-panel-status ${model.status.tone}`}
        role="status"
        aria-live="polite"
        title={model.status.detail}
      >
        <span className="agent-panel-status-dot" />
        <span>{model.status.label}</span>
      </div>
      {model.diagnostics.state !== 'hidden' ? (
        <button
          type="button"
          className="agent-panel-diagnostics"
          data-agent-action="diagnostics"
          onClick={model.diagnostics.onInvoke}
          disabled={diagnosticsDisabled}
          title={diagnosticsTitle}
          aria-label={diagnosticsTitle}
        >
          <IconClipboard size={14} />
        </button>
      ) : null}
    </header>
  )
}

export function ContextBar({ chips }: { chips: AgentContextChip[] }): ReactElement {
  return (
    <div data-agent-landmark="context">
      <AgentContextBar chips={chips} />
    </div>
  )
}

export function NoticePermissionArea({
  notices,
  activities,
  permissions,
}: {
  notices: AgentPanelNoticeModel[]
  activities: AgentPanelActivityModel[]
  permissions: AgentPanelPermissionModel[]
}): ReactElement {
  return (
    <section className="agent-panel-notice-area" data-agent-landmark="notice-permission">
      {notices.map((notice) => (
        <div key={notice.id} className={`agent-panel-notice ${notice.tone}`} role="status">
          <strong>{notice.title}</strong>
          {notice.detail ? <span>{notice.detail}</span> : null}
        </div>
      ))}
      {activities.map((activity) => (
        <ActivityCard key={activity.id} model={activity} />
      ))}
      {permissions.map((permission) => (
        <PermissionCard key={permission.id} model={permission} />
      ))}
    </section>
  )
}

function ActivityCard({ model }: { model: AgentPanelActivityModel }): ReactElement {
  const renderActions = (actions: AgentPanelActivityAction[]): ReactElement | null =>
    actions.length > 0 ? (
      <div className="agent-panel-activity-actions">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.tone === 'danger' ? 'danger' : undefined}
            disabled={action.disabled}
            onClick={action.onInvoke}
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null

  return (
    <div className={`agent-panel-activity ${model.tone}`}>
      <div className="agent-panel-activity-heading">
        <strong title={model.title}>{model.title}</strong>
        <span>{model.status}</span>
      </div>
      {model.detail ? <p>{model.detail}</p> : null}
      {model.rows.length > 0 ? (
        <div className="agent-panel-activity-rows">
          {model.rows.map((row) => (
            <div className="agent-panel-activity-row" key={row.id}>
              <span title={row.label}>{row.label}</span>
              {row.detail ? <em>{row.detail}</em> : null}
              {row.meta ? <small>{row.meta}</small> : null}
              {renderActions(row.actions ?? [])}
            </div>
          ))}
        </div>
      ) : null}
      {renderActions(model.actions)}
    </div>
  )
}

function PermissionCard({ model }: { model: AgentPanelPermissionModel }): ReactElement {
  return (
    <div className={`tool-confirmation-card ${model.tone === 'warning' ? 'warning' : ''}`}>
      <div className="confirmation-header">
        <IconTool size={14} />
        {model.title}
      </div>
      <div className="confirmation-body">
        {model.rows.map((row, index) => (
          <div className="confirmation-row" key={`${row.label}-${index}`}>
            <span className="confirmation-label">{row.label}:</span>
            <span
              className={`confirmation-value ${row.monospace ? 'confirmation-params' : ''} ${row.tone ?? ''}`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
      <div className="confirmation-actions">
        {model.actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`confirm-${action.tone}-btn`}
            disabled={action.disabled}
            onClick={action.onInvoke}
          >
            {action.tone === 'reject' ? <IconError size={12} /> : <IconCheck size={12} />}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function MessageTimeline({
  items,
  empty,
  listRef,
  onScroll,
  onWheel,
  onPointerDown,
  onTouchStart,
  onOpenFilePath,
}: {
  items: AgentPanelTimelineItem[]
  empty: AgentPanelEmptyModel
  listRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
  onWheel?: WheelEventHandler<HTMLDivElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onTouchStart?: TouchEventHandler<HTMLDivElement>
  onOpenFilePath?: (path: string) => void
}): ReactElement {
  return (
    <div
      ref={listRef}
      className="agent-messages conversation-copy-surface"
      data-agent-landmark="timeline"
      onScroll={onScroll}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onTouchStart={onTouchStart}
    >
      {items.length === 0 ? (
        <EmptyState model={empty} />
      ) : (
        items.map((item) => {
          if (item.kind === 'message') {
            return (
              <ConversationMessageRenderer
                key={item.id}
                message={item.message}
                conversationId={item.conversationId}
                workspaceKey={item.workspaceKey}
                onOpenFilePath={onOpenFilePath}
              />
            )
          }
          if (item.kind === 'question') {
            return <QuestionCard key={item.id} model={item.question} />
          }
          return (
            <div className="agent-timeline-status" key={item.id} role="status">
              <span />
              <strong>{item.label}</strong>
              {item.detail ? <em>{item.detail}</em> : null}
              <span />
            </div>
          )
        })
      )}
    </div>
  )
}

export function EmptyState({ model }: { model: AgentPanelEmptyModel }): ReactElement {
  return (
    <div className="agent-panel-empty" data-agent-state="empty">
      <IconSparkle size={24} />
      <strong>{model.title}</strong>
      <span>{model.description}</span>
      {model.suggestions?.length ? (
        <div className="agent-panel-empty-suggestions">
          {model.suggestions.map((suggestion) => (
            <span key={suggestion}>{suggestion}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function QuestionCard({ model }: { model: AgentPanelQuestionModel }): ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const complete = model.questions.every((question) => Boolean(answers[question.question]?.trim()))
  return (
    <div className="agent-message assistant agent-question-message">
      <div className="agent-question-card">
        <strong>{model.title}</strong>
        {model.questions.map((question) => (
          <div key={question.id} className="agent-question-item">
            <span>{question.header || question.question}</span>
            {question.header ? <small>{question.question}</small> : null}
            {question.options?.length && question.multiSelect ? (
              <span className="agent-question-options">
                {question.options.map((option) => {
                  const selected = new Set(
                    (answers[question.question] ?? '')
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  )
                  return (
                    <label key={option.label}>
                      <input
                        type="checkbox"
                        disabled={model.answered || model.submitting}
                        checked={selected.has(option.label)}
                        onChange={(event) => {
                          const next = new Set(selected)
                          if (event.target.checked) next.add(option.label)
                          else next.delete(option.label)
                          setAnswers((current) => ({
                            ...current,
                            [question.question]: [...next].join(', '),
                          }))
                        }}
                      />
                      <span>{option.label}</span>
                      {option.description ? <small>{option.description}</small> : null}
                    </label>
                  )
                })}
              </span>
            ) : question.options?.length ? (
              <select
                disabled={model.answered || model.submitting}
                value={answers[question.question] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.question]: event.target.value,
                  }))
                }
              >
                <option value="">请选择</option>
                {question.options.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                    {option.description ? ` · ${option.description}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                disabled={model.answered || model.submitting}
                value={answers[question.question] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.question]: event.target.value,
                  }))
                }
              />
            )}
          </div>
        ))}
        <button
          type="button"
          disabled={!complete || model.answered || model.submitting}
          onClick={() => model.onSubmit(answers)}
        >
          {model.answered ? '已回答' : model.submitting ? '等待 Agent 确认…' : '提交回答'}
        </button>
        {model.error ? <div className="agent-question-error">{model.error}</div> : null}
      </div>
    </div>
  )
}

export function ComposerFrame({
  model,
  variant,
  mainRef,
}: {
  model: AgentPanelComposerModel
  variant: AgentPanelVariant
  mainRef: Ref<HTMLDivElement>
}): ReactElement {
  const composerRef = useRef<HTMLDivElement>(null)
  const rendererFocusRequestPendingRef = useRef(false)
  const resolvedMainRef = mainRef as React.RefObject<HTMLDivElement | null>
  const [height, setHeight] = useState<number | null>(() => loadComposerHeight(variant))
  const focusRenderer = useCallback(() => {
    if (rendererFocusRequestPendingRef.current) return
    rendererFocusRequestPendingRef.current = true
    void window.cclinkStudio.window
      .focusRenderer()
      .catch((error) => {
        console.warn('[AgentComposer] 输入焦点切回工作台失败:', error)
      })
      .finally(() => {
        rendererFocusRequestPendingRef.current = false
      })
  }, [])
  const clampHeight = useCallback(
    (nextHeight: number): number => {
      const mainHeight = resolvedMainRef.current?.getBoundingClientRect().height ?? 0
      const availableHeight =
        mainHeight > 0
          ? Math.max(MIN_COMPOSER_HEIGHT, mainHeight - MIN_MESSAGES_HEIGHT)
          : nextHeight
      return Math.min(
        Math.max(nextHeight, MIN_COMPOSER_HEIGHT),
        MAX_COMPOSER_HEIGHT,
        availableHeight,
      )
    },
    [resolvedMainRef],
  )

  useEffect(() => {
    try {
      const key = composerHeightStorageKey(variant)
      if (height === null) localStorage.removeItem(key)
      else localStorage.setItem(key, String(height))
    } catch {
      // localStorage 不可用时仍保留当前运行期尺寸。
    }
  }, [height, variant])

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startY = event.clientY
      const startHeight = composerRef.current?.getBoundingClientRect().height ?? MIN_COMPOSER_HEIGHT
      const move = (moveEvent: PointerEvent): void =>
        setHeight(clampHeight(startHeight + startY - moveEvent.clientY))
      const finish = (): void => {
        document.body.classList.remove('is-resizing-composer')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      }
      document.body.classList.add('is-resizing-composer')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [clampHeight],
  )

  const submit = useCallback(() => {
    if (model.disabled || model.submitting || !model.canSubmit) return
    void model.onSubmit()
  }, [model])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      const handledBeforeSubmit = model.onKeyDownBeforeSubmit?.(event) ?? false
      const decision = resolveAgentComposerKeyDecision({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: false,
        keyCode: event.nativeEvent.keyCode,
        handledBeforeSubmit,
        canSubmit: !model.disabled && !model.submitting && model.canSubmit,
      })
      if (decision !== 'submit' && decision !== 'block-submit') return
      event.preventDefault()
      if (decision === 'submit') submit()
    },
    [model, submit],
  )

  const enhancements = model.enhancements
  return (
    <>
      <div
        className="agent-composer-resize-handle"
        role="separator"
        aria-label="调整消息区和输入区高度"
        aria-orientation="horizontal"
        aria-valuemin={MIN_COMPOSER_HEIGHT}
        aria-valuemax={MAX_COMPOSER_HEIGHT}
        aria-valuenow={height ?? undefined}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => setHeight(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const current =
            height ?? composerRef.current?.getBoundingClientRect().height ?? MIN_COMPOSER_HEIGHT
          setHeight(clampHeight(current + (event.key === 'ArrowUp' ? 12 : -12)))
        }}
      />
      <div
        ref={composerRef}
        className={`agent-composer-wrap ${height === null ? '' : 'resized'}`}
        style={height === null ? undefined : { height }}
        data-agent-landmark="composer"
      >
        {enhancements?.resourceCandidates?.open ? (
          <ResourceCandidateMenu
            candidates={enhancements.resourceCandidates.items}
            selectedIndex={enhancements.resourceCandidates.selectedIndex}
            onActiveIndexChange={enhancements.resourceCandidates.onActiveIndexChange}
            onPick={enhancements.resourceCandidates.onPick}
            anchorRef={composerRef}
            onRequestClose={enhancements.resourceCandidates.onRequestClose}
          />
        ) : null}
        {enhancements?.skillCandidates?.open ? (
          <SkillCandidateMenu
            candidates={enhancements.skillCandidates.items}
            selectedIndex={enhancements.skillCandidates.selectedIndex}
            onActiveIndexChange={enhancements.skillCandidates.onActiveIndexChange}
            onPick={enhancements.skillCandidates.onPick}
            anchorRef={composerRef}
            onRequestClose={enhancements.skillCandidates.onRequestClose}
          />
        ) : null}
        {enhancements?.mountedResources ? (
          <MountedResourceBar
            resources={enhancements.mountedResources.items}
            onRemove={enhancements.mountedResources.onRemove}
            onOpen={enhancements.mountedResources.onOpen}
          />
        ) : null}
        {enhancements?.mountedSkills ? (
          <MountedSkillStrip
            skills={enhancements.mountedSkills.items}
            availableSkills={enhancements.mountedSkills.availableSkills}
            onRemove={enhancements.mountedSkills.onRemove}
          />
        ) : null}
        <div className="agent-input-card">
          {enhancements?.images ? (
            <ImageAttachmentStrip
              images={enhancements.images.items}
              onRemove={enhancements.images.onRemove}
            />
          ) : null}
          {model.uploadProgress ? (
            <div className="agent-upload-progress" aria-live="polite">
              <div>
                <span>{model.uploadProgress.label}</span>
                <span>{model.uploadProgress.percent}%</span>
              </div>
              <progress max={100} value={model.uploadProgress.percent} />
            </div>
          ) : null}
          <textarea
            ref={model.textareaRef}
            className="agent-input"
            value={model.value}
            disabled={model.disabled}
            maxLength={model.maxLength}
            onPointerDown={focusRenderer}
            onFocus={focusRenderer}
            onChange={(event) => model.onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={model.onPaste}
            onDragOver={model.onDragOver}
            onDrop={model.onDrop}
            placeholder={model.placeholder}
            rows={2}
          />
          <ActionBar model={model} submit={submit} />
        </div>
      </div>
    </>
  )
}

export function ActionBar({
  model,
  submit,
}: {
  model: AgentPanelComposerModel
  submit(): void
}): ReactElement {
  const remoteImageInputRef = useRef<HTMLInputElement>(null)
  const stopLabel = model.stopLabel || '停止'
  const primaryAction =
    model.submitting && model.stopCapability.state !== 'hidden' ? (
      <span
        className="agent-disabled-action"
        title={
          model.stopCapability.state === 'disabled'
            ? model.stopCapability.reason || '当前不能停止'
            : stopLabel
        }
      >
        <button
          type="button"
          className="agent-abort-btn"
          data-agent-action="stop"
          onClick={() => void model.onStop?.()}
          disabled={model.stopCapability.state !== 'enabled'}
          aria-label={
            model.stopCapability.state === 'disabled'
              ? model.stopCapability.reason || '当前不能停止'
              : stopLabel
          }
        >
          <IconStop size={15} />
        </button>
      </span>
    ) : (
      <button
        type="button"
        className="agent-send-btn"
        data-agent-action="send"
        onClick={submit}
        disabled={!model.canSubmit || model.submitting || model.disabled}
        title="发送"
        aria-label="发送"
      >
        <IconSend size={17} />
      </button>
    )

  if (model.actionBar.kind === 'local') {
    return (
      <div data-agent-landmark="action-bar">
        <AgentComposerToolbar
          {...model.actionBar.toolbar}
          canSend={model.canSubmit}
          sendButton={primaryAction}
        />
      </div>
    )
  }

  const remote = model.actionBar
  const capabilityButton = (
    id: keyof typeof remote.capabilities,
    label: string,
    icon: ReactElement,
    className = 'agent-mode-btn',
    showLabel = true,
    onClick?: () => void,
  ): ReactElement | null => {
    const capability = remote.capabilities[id]
    if (capability.state === 'hidden') return null
    return (
      <button
        type="button"
        className={className}
        data-agent-action={id}
        disabled={capability.state !== 'enabled'}
        title={capability.reason || label}
        onClick={onClick}
      >
        {icon}
        {showLabel ? <span>{label}</span> : null}
      </button>
    )
  }

  return (
    <div className="agent-composer-toolbar" data-agent-landmark="action-bar">
      <div className="agent-composer-tools">
        <input
          ref={remoteImageInputRef}
          type="file"
          accept={AGENT_IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length > 0) remote.onAddImages?.(files)
          }}
        />
        {capabilityButton(
          'addContext',
          '添加图片',
          <IconPlus size={16} />,
          'agent-composer-icon-btn',
          false,
          () => remoteImageInputRef.current?.click(),
        )}
        {capabilityButton('role', '角色', <IconRobot size={13} />)}
        {capabilityButton('permissionMode', '权限', <IconCircle size={8} />)}
      </div>
      <div className="agent-composer-tools">
        {capabilityButton('contextUsage', '–', <span>–</span>, 'agent-context-usage-btn', false)}
        {capabilityButton(
          'runtime',
          remote.runtimeLabel,
          <IconRobot size={13} />,
          'agent-model-btn',
        )}
        <span className="agent-composer-send-slot" aria-disabled={!model.canSubmit}>
          {primaryAction}
        </span>
      </div>
    </div>
  )
}
