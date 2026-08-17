import {
  useCallback,
  type CSSProperties,
  type ClipboardEventHandler,
  type DragEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'

export type AgentPanelVariant = 'center' | 'side'

export interface AgentPanelSurfaceProps {
  variant: AgentPanelVariant
  runtime: 'local' | 'remote'
  mainRef?: Ref<HTMLDivElement>
  className?: string
  children: ReactNode
}

export function AgentPanelSurface({
  variant,
  runtime,
  mainRef,
  className,
  children,
}: AgentPanelSurfaceProps): React.ReactElement {
  return (
    <div
      className={[
        'agent-panel',
        `agent-panel-${variant}`,
        `agent-panel-runtime-${runtime}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-agent-panel-runtime={runtime}
    >
      <div className="agent-conversation-main" ref={mainRef}>
        {children}
      </div>
    </div>
  )
}

export interface AgentMessageListProps {
  listRef?: Ref<HTMLDivElement>
  className?: string
  onScroll?: React.UIEventHandler<HTMLDivElement>
  onWheel?: React.WheelEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>
  children: ReactNode
}

export function AgentMessageList({
  listRef,
  className,
  onScroll,
  onWheel,
  onPointerDown,
  onTouchStart,
  children,
}: AgentMessageListProps): React.ReactElement {
  return (
    <div
      className={['agent-messages', 'conversation-copy-surface', className]
        .filter(Boolean)
        .join(' ')}
      ref={listRef}
      onScroll={onScroll}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onTouchStart={onTouchStart}
    >
      {children}
    </div>
  )
}

export type AgentComposerKeyDecision = 'ignore-composition' | 'handled' | 'submit' | 'none'

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
  if (input.key === 'Enter' && !input.shiftKey && input.canSubmit) return 'submit'
  return 'none'
}

export interface AgentComposerRenderActions {
  submit(): void
  canSubmit: boolean
  submitting: boolean
}

export interface AgentComposerProps {
  value: string
  onChange(value: string): void
  onSubmit(): void | Promise<void>
  canSubmit: boolean
  submitting?: boolean
  disabled?: boolean
  placeholder: string
  rows?: number
  maxLength?: number
  textareaClassName: string
  containerClassName: string
  inputContainerClassName?: string
  containerRef?: Ref<HTMLDivElement>
  textareaRef?: Ref<HTMLTextAreaElement>
  style?: CSSProperties
  leading?: ReactNode
  inputLeading?: ReactNode
  renderTrailing?(actions: AgentComposerRenderActions): ReactNode
  onKeyDownBeforeSubmit?(event: KeyboardEvent<HTMLTextAreaElement>): boolean
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
  onDragOver?: DragEventHandler<HTMLTextAreaElement>
  onDrop?: DragEventHandler<HTMLTextAreaElement>
}

export function AgentComposer({
  value,
  onChange,
  onSubmit,
  canSubmit,
  submitting = false,
  disabled = false,
  placeholder,
  rows = 2,
  maxLength,
  textareaClassName,
  containerClassName,
  inputContainerClassName,
  containerRef,
  textareaRef,
  style,
  leading,
  inputLeading,
  renderTrailing,
  onKeyDownBeforeSubmit,
  onPaste,
  onDragOver,
  onDrop,
}: AgentComposerProps): React.ReactElement {
  const submit = useCallback(() => {
    if (disabled || submitting || !canSubmit) return
    void onSubmit()
  }, [canSubmit, disabled, onSubmit, submitting])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const isComposition =
        event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
      if (isComposition) return

      const handledBeforeSubmit = onKeyDownBeforeSubmit?.(event) ?? false
      const decision = resolveAgentComposerKeyDecision({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: false,
        keyCode: event.nativeEvent.keyCode,
        handledBeforeSubmit,
        canSubmit: !disabled && !submitting && canSubmit,
      })
      if (decision !== 'submit') return
      event.preventDefault()
      submit()
    },
    [canSubmit, disabled, onKeyDownBeforeSubmit, submit, submitting],
  )

  const textarea = (
    <textarea
      ref={textareaRef}
      className={textareaClassName}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDrop={onDrop}
      placeholder={placeholder}
      rows={rows}
    />
  )
  const actions = { submit, canSubmit: !disabled && !submitting && canSubmit, submitting }

  return (
    <div ref={containerRef} className={containerClassName} style={style}>
      {leading}
      {inputContainerClassName ? (
        <div className={inputContainerClassName}>
          {inputLeading}
          {textarea}
          {renderTrailing?.(actions)}
        </div>
      ) : (
        <>
          {inputLeading}
          {textarea}
          {renderTrailing?.(actions)}
        </>
      )}
    </div>
  )
}
