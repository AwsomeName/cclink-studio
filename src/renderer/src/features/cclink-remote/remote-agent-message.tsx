import { useState } from 'react'
import type { CclinkRemoteMessage } from '@shared/cclink'
import type { RemoteWorkspaceRef } from '@shared/workspace-ref'
import { ContentBlockRenderer } from '../../components/common/ConversationMessageRenderer'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'

export function RemoteAgentMessage({
  message,
  workspaceRef,
  sessionId,
  reload,
}: {
  message: CclinkRemoteMessage
  workspaceRef: RemoteWorkspaceRef
  sessionId: string
  reload(): Promise<void>
}): React.ReactElement {
  const [controlError, setControlError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  if (message.type === 'agentTool') {
    const stateLabels = {
      pending: '等待执行',
      executing: '正在执行',
      completed: '执行完成',
      failed: '执行失败',
      denied: '已拒绝',
    } as const
    const resultContent =
      message.tool.error ||
      message.tool.output ||
      (message.tool.state === 'completed' ||
      message.tool.state === 'failed' ||
      message.tool.state === 'denied'
        ? stateLabels[message.tool.state]
        : null)
    const decide = async (approved: boolean): Promise<void> => {
      const requestId = message.tool.requestId
      if (!requestId || deciding) return
      setControlError(null)
      setDeciding(true)
      try {
        const result = await window.cclinkStudio.cclink.resolveToolApproval({
          ref: workspaceRef,
          sessionId,
          requestId,
          toolUseId: message.tool.id,
          approved,
        })
        if (!result.success) throw new Error(result.error || '远程审批发送失败')
        await reload()
      } catch (error) {
        setControlError(error instanceof Error ? error.message : String(error))
      } finally {
        setDeciding(false)
      }
    }
    return (
      <div className="agent-message assistant remote-agent-tool-message">
        <ContentBlockRenderer
          block={{
            type: 'tool_use',
            id: message.tool.id,
            name: message.tool.name,
            input: message.tool.input ?? {},
          }}
        />
        {resultContent && (
          <ContentBlockRenderer
            block={{
              type: 'tool_result',
              tool_use_id: message.tool.id,
              content: resultContent,
              is_error: message.tool.state === 'failed' || message.tool.state === 'denied',
            }}
          />
        )}
        {(message.tool.state === 'pending' || message.tool.state === 'executing') && (
          <div className={`remote-tool-progress ${message.tool.state}`} role="status">
            <span />
            {stateLabels[message.tool.state]}
          </div>
        )}
        {message.tool.approvalReason && (
          <div className="remote-tool-approval-reason">{message.tool.approvalReason}</div>
        )}
        {message.tool.requiresApproval && message.tool.requestId && (
          <div className="remote-tool-actions">
            <button
              className="confirm-reject-btn"
              type="button"
              disabled={deciding}
              onClick={() => void decide(false)}
            >
              拒绝
            </button>
            <button
              className="confirm-approve-btn"
              type="button"
              disabled={deciding}
              onClick={() => void decide(true)}
            >
              {deciding ? '等待 Agent 确认…' : '允许本次操作'}
            </button>
          </div>
        )}
        {controlError && <div className="remote-tool-control-error">{controlError}</div>}
      </div>
    )
  }
  if (message.type === 'userQuestion') {
    return (
      <RemoteAgentQuestion
        message={message}
        workspaceRef={workspaceRef}
        sessionId={sessionId}
        reload={reload}
      />
    )
  }
  if (message.type === 'agentText') {
    return (
      <div className="agent-message assistant">
        <ConversationMarkdown source={message.content} />
      </div>
    )
  }
  return (
    <div className={`agent-message ${message.type === 'user' ? 'user' : 'system'}`}>
      <div className="content-text">{message.content}</div>
    </div>
  )
}

function RemoteAgentQuestion({
  message,
  workspaceRef,
  sessionId,
  reload,
}: {
  message: Extract<CclinkRemoteMessage, { type: 'userQuestion' }>
  workspaceRef: RemoteWorkspaceRef
  sessionId: string
  reload(): Promise<void>
}): React.ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const complete = message.questions.every((question) =>
    Boolean(answers[question.question]?.trim()),
  )
  const submit = async (): Promise<void> => {
    if (!complete || message.answered || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await window.cclinkStudio.cclink.answerQuestion({
        ref: workspaceRef,
        sessionId,
        requestId: message.requestId,
        toolUseId: message.toolUseId,
        answers,
      })
      if (!result.success) throw new Error(result.error || '远程问题回答失败')
      await reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="agent-message assistant remote-agent-question">
      <div className="remote-agent-question-card">
        <strong>Agent 需要你的选择</strong>
        {message.questions.map((question) => (
          <div key={question.id} className="remote-question-item">
            <span>{question.header || question.question}</span>
            {question.header && <small>{question.question}</small>}
            {question.options?.length && question.multiSelect ? (
              <span className="remote-question-options">
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
                        disabled={message.answered || submitting}
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
                      {option.description && <small>{option.description}</small>}
                    </label>
                  )
                })}
              </span>
            ) : question.options?.length ? (
              <select
                disabled={message.answered || submitting}
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
                disabled={message.answered || submitting}
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
          disabled={!complete || message.answered || submitting}
          onClick={() => void submit()}
        >
          {message.answered ? '已回答' : submitting ? '等待 Agent 确认…' : '提交回答'}
        </button>
        {error && <div className="remote-tool-control-error">{error}</div>}
      </div>
    </div>
  )
}
