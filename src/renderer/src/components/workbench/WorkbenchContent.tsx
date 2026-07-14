import { useState, type FormEvent, type RefObject } from 'react'
import type { TerminalSubmitCommandResult } from '@shared/ipc/terminal'
import type { Tab } from '../../types'
import { workspaceRefLabel, workspaceRefSourceLabel } from '../../../../shared/workspace-ref'
import { useTerminalStore } from '../../stores/terminal-store'
import { resolveConversationTab } from '../../utils/conversation-tab'
import { getUnsupportedConversationMeta } from '../../utils/conversation-runtime-adapter'
import { submitTerminalCommand } from '../../utils/terminal-command'
import { CclinkConversation } from '../cclink/CclinkConversation'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { PanelErrorFallback } from '../common/ErrorFallback'
import { SettingsPage } from '../settings/SettingsPage'
import { AndroidDisplay } from './AndroidDisplay'
import { MarkdownEditor } from './MarkdownEditor'
import { ModelViewer } from './ModelViewer'
import { RemoteFileViewer } from './RemoteFileViewer'
import { WorkbenchAgentConversation } from './WorkbenchAgentConversation'
import { WeChatPreview } from './wechat/WeChatPreview'

interface WorkbenchContentProps {
  activeTab: Tab | undefined
  isBrowserTab: boolean
  contentRef: RefObject<HTMLDivElement | null>
}

export function WorkbenchContent({
  activeTab,
  isBrowserTab,
  contentRef,
}: WorkbenchContentProps): React.ReactElement {
  const conversationTarget = activeTab ? resolveConversationTab(activeTab) : null

  return (
    <div className="workbench-content" ref={contentRef}>
      <ErrorBoundary
        fallback={(error, retry) => (
          <PanelErrorFallback error={error} retry={retry} title="Tab 内容" />
        )}
      >
        {!isBrowserTab && activeTab && (
          <>
            {activeTab.type === 'settings' && (
              <SettingsPage initialSection={activeTab.settingsSection} />
            )}
            {activeTab.type === 'editor' && (
              <MarkdownEditor
                key={activeTab.filePath ?? activeTab.id}
                filePath={activeTab.filePath}
                tabId={activeTab.id}
              />
            )}
            {activeTab.type === 'android' && <AndroidDisplay />}
            {activeTab.type === 'preview' && activeTab.filePath && (
              <WeChatPreview key={activeTab.filePath} filePath={activeTab.filePath} />
            )}
            {activeTab.type === 'model' && activeTab.filePath && (
              <ModelViewer key={activeTab.filePath} filePath={activeTab.filePath} />
            )}
            {conversationTarget?.kind === 'remote-cclink' && (
              <CclinkConversation
                key={conversationTarget.sessionId}
                sessionId={conversationTarget.sessionId}
              />
            )}
            {conversationTarget?.kind === 'local-agent' && (
              <WorkbenchAgentConversation
                key={conversationTarget.conversationId}
                tabId={conversationTarget.tabId}
                conversationId={conversationTarget.conversationId}
              />
            )}
            {conversationTarget?.kind === 'unsupported' && (
              <UnsupportedConversationTab reason={conversationTarget.reason} />
            )}
            {activeTab.type === 'remote-file' && activeTab.remoteFile && (
              <RemoteFileViewer
                key={`${activeTab.remoteFile.serverId}:${activeTab.remoteFile.workspaceId}:${activeTab.remoteFile.path}`}
                remoteFile={activeTab.remoteFile}
              />
            )}
            {activeTab.type === 'terminal' && <TerminalPlaceholder tab={activeTab} />}
          </>
        )}
      </ErrorBoundary>
    </div>
  )
}

function TerminalPlaceholder({ tab }: { tab: Tab }): React.ReactElement {
  const terminal = tab.terminal
  const runtime = terminal?.runtime
  const workspace = runtime?.workspaceRef
  const [command, setCommand] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<TerminalSubmitCommandResult | null>(null)
  const [retriedAfterRegister, setRetriedAfterRegister] = useState(false)
  const outputLines = useTerminalStore((state) =>
    terminal?.sessionId ? (state.outputBySessionId[terminal.sessionId] ?? []) : [],
  )
  const appendOutputLine = useTerminalStore((state) => state.appendOutputLine)
  const clearOutput = useTerminalStore((state) => state.clearOutput)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    const normalizedCommand = command.trim()
    if (!terminal?.sessionId || !normalizedCommand) return

    setSubmitting(true)
    setSubmitResult(null)
    setRetriedAfterRegister(false)
    appendOutputLine({
      sessionId: terminal.sessionId,
      kind: 'command',
      text: `$ ${normalizedCommand}\n`,
      timestamp: Date.now(),
    })
    try {
      const output = await submitTerminalCommand(terminal, normalizedCommand)
      setSubmitResult(output.result)
      setRetriedAfterRegister(output.retriedAfterRegister)
      if (output.result.success) setCommand('')
    } catch (error) {
      setSubmitResult({
        success: false,
        status: 'rejected',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="conversation-shell local">
      <div className="terminal-placeholder">
        <div className="terminal-placeholder-title">Terminal 受控命令入口</div>
        <div className="terminal-placeholder-desc">
          当前命令会进入权限、确认和审计链路；真实 shell 后端尚未接入，因此通过后仍不会启动本机或远端进程。
        </div>
        <div className="terminal-placeholder-grid">
          <TerminalMeta label="工作空间" value={workspace ? workspaceRefLabel(workspace) : '未知'} />
          <TerminalMeta
            label="来源"
            value={workspace ? workspaceRefSourceLabel(workspace) : '未知'}
          />
          <TerminalMeta label="运行位置" value={runtime?.location === 'remote' ? '远程' : '本地'} />
          <TerminalMeta label="传输" value={runtime?.transport ?? '未知'} />
          <TerminalMeta label="后端" value={runtime?.backend ?? '未知'} />
          <TerminalMeta label="cwd" value={runtime?.cwd ?? '未设置'} />
          <TerminalMeta label="权限模式" value={terminal?.permissionPolicy.mode ?? '未知'} />
          <TerminalMeta label="关闭策略" value={terminal?.closePolicy ?? '未知'} />
        </div>
        <form className="terminal-command-form" onSubmit={handleSubmit}>
          <label className="terminal-command-label" htmlFor={`terminal-command-${tab.id}`}>
            命令
          </label>
          <div className="terminal-command-row">
            <input
              id={`terminal-command-${tab.id}`}
              className="terminal-command-input"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={runtime?.location === 'remote' ? '例如：pwd' : '例如：ls'}
              spellCheck={false}
            />
            <button type="submit" disabled={submitting || !command.trim() || !terminal?.sessionId}>
              {submitting ? '等待确认' : '提交'}
            </button>
          </div>
        </form>
        {submitResult && (
          <TerminalSubmitResultNotice
            result={submitResult}
            retriedAfterRegister={retriedAfterRegister}
          />
        )}
        <div className="terminal-output-panel">
          <div className="terminal-output-header">
            <span>输出</span>
            <button
              type="button"
              onClick={() => terminal?.sessionId && clearOutput(terminal.sessionId)}
              disabled={!terminal?.sessionId || outputLines.length === 0}
            >
              清空
            </button>
          </div>
          <pre className="terminal-output">
            {outputLines.length === 0 ? (
              <span className="terminal-output-empty">暂无输出</span>
            ) : (
              outputLines.map((line) => (
                <span key={line.id} className={`terminal-output-line ${line.kind}`}>
                  {line.text}
                </span>
              ))
            )}
          </pre>
        </div>
      </div>
    </div>
  )
}

function TerminalSubmitResultNotice({
  result,
  retriedAfterRegister,
}: {
  result: TerminalSubmitCommandResult
  retriedAfterRegister: boolean
}): React.ReactElement {
  const title = result.success ? '命令已进入审计链路' : '命令未提交'
  const message = result.success ? result.message : result.error
  const detail = result.success
    ? `风险：${result.risk} · 执行：${result.execution}`
    : result.risk
      ? `风险：${result.risk} · 状态：${result.status}`
      : `状态：${result.status}`

  return (
    <div className={`terminal-submit-result ${result.success ? 'success' : 'error'}`}>
      <strong>{title}</strong>
      <span>{message}</span>
      <code>{detail}</code>
      {retriedAfterRegister && <span>已重新登记 Terminal session 后重试。</span>}
    </div>
  )
}

function TerminalMeta({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="terminal-placeholder-meta">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function UnsupportedConversationTab({ reason }: { reason: string }): React.ReactElement {
  const meta = getUnsupportedConversationMeta({
    kind: 'unsupported',
    tabId: 'unsupported',
    reason,
  })
  return (
    <div className="conversation-shell local">
      <div className="workbench-agent-empty">
        <strong>{meta.title}</strong>
        <br />
        {meta.reason}
        <br />
        这不是会话丢失，而是对应运行通道还没有接入 Workbench Tab。
      </div>
    </div>
  )
}
