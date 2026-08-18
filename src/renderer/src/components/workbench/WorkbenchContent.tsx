import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalSubmitCommandResult } from '@shared/ipc/terminal'
import { isTerminalFinalStatus, type TerminalExecutionEvent } from '@shared/terminal'
import type { Tab } from '../../types'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useCommandStore } from '../../stores/command-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { useTerminalStore } from '../../stores/terminal-store'
import { resolveConversationTab } from '../../utils/conversation-tab'
import { submitTerminalCommand } from '../../utils/terminal-command'
import { resolveTerminalAltArrowSequence } from '../../utils/terminal-keyboard'
import { subscribeTerminalInputAfterReplay } from '../../utils/terminal-replay'
import { buildTerminalTabDraft, isInteractiveTerminalRuntime } from '../../utils/terminal-tab'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { PanelErrorFallback } from '../common/ErrorFallback'
import { DataSourceQueryTab } from '../data-sources/DataSourceQueryTab'
import { WebResourceDetailTab } from '../../features/web-resources/WebResourceDetailTab'
import { WebAffairTab } from '../../features/web-affairs/WebAffairTab'
import { WebAffairDraftTab } from '../../features/web-affairs/WebAffairDraftTab'
import { SettingsPage } from '../settings/SettingsPage'
import { FilePreview } from './FilePreview'
import { AndroidDisplay } from './AndroidDisplay'
import { GerberLayerPreview } from './GerberLayerPreview'
import { MarkdownEditor } from './MarkdownEditor'
import { SourceTextEditor } from './SourceTextEditor'
import { ModelViewer } from './ModelViewer'
import { WorkbenchAgentConversation } from './WorkbenchAgentConversation'
import { WeChatPreview } from './wechat/WeChatPreview'
import type { TerminalOutputLine } from '../../stores/terminal-store'
import { isHtmlFilePath } from '../../utils/html-files'
import {
  pasteClipboardToTerminal,
  registerTerminalContextSurface,
} from '../../features/context-actions/terminal-context-surface'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { ScheduledTaskTab } from '../../features/scheduled-tasks/ScheduledTaskTab'
import { AgentRoleDetailTab } from '../../features/agent-roles/AgentRoleDetailTab'
import { RemoteFileViewer } from '../../features/cclink-remote/RemoteFileViewer'
import { MediaProductionTab } from '../../features/media-production/MediaProductionTab'
import { useToastStore } from '../common/Toast'

const EMPTY_TERMINAL_OUTPUT_LINES: TerminalOutputLine[] = []

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
  const contextMenuOpen = useContextMenuStore((state) => state.open)
  const browserPreviewDataUrl = useContextMenuStore((state) => state.browserPreviewDataUrl)
  const clearBrowserPreview = useContextMenuStore((state) => state.clearBrowserPreview)
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)

  useEffect(() => {
    if (contextMenuOpen || !browserPreviewDataUrl) return
    const timer = window.setTimeout(clearBrowserPreview, 120)
    return () => window.clearTimeout(timer)
  }, [browserPreviewDataUrl, clearBrowserPreview, contextMenuOpen])

  return (
    <div className="workbench-content" ref={contentRef}>
      <ErrorBoundary
        fallback={(error, retry) => (
          <PanelErrorFallback error={error} retry={retry} title="Tab 内容" />
        )}
      >
        {isBrowserTab && browserPreviewDataUrl && (
          <img
            className="browser-context-preview"
            src={browserPreviewDataUrl}
            alt=""
            draggable={false}
          />
        )}
        {!isBrowserTab && activeTab && (
          <>
            {activeTab.type === 'settings' && (
              <SettingsPage initialSection={activeTab.settingsSection} />
            )}
            {activeTab.type === 'agent-role' && <AgentRoleDetailTab tab={activeTab} />}
            {activeTab.type === 'remote-file' && activeTab.remoteFile && (
              <RemoteFileViewer
                key={`${activeTab.id}:${activeTab.remoteFile.serverId}:${activeTab.remoteFile.workspaceId}:${activeTab.remoteFile.path}`}
                tab={activeTab}
              />
            )}
            {activeTab.type === 'editor' &&
              (activeTab.filePath && isHtmlFilePath(activeTab.filePath) ? (
                <SourceTextEditor
                  key={activeTab.filePath}
                  filePath={activeTab.filePath}
                  tabId={activeTab.id}
                />
              ) : (
                <MarkdownEditor
                  key={activeTab.filePath ?? activeTab.id}
                  filePath={activeTab.filePath}
                  tabId={activeTab.id}
                />
              ))}
            {activeTab.type === 'android' && <AndroidDisplay />}
            {activeTab.type === 'preview' && activeTab.filePath && (
              <WeChatPreview key={activeTab.filePath} filePath={activeTab.filePath} />
            )}
            {activeTab.type === 'file-preview' && activeTab.filePath && (
              <FilePreview
                key={activeTab.filePath}
                filePath={activeTab.filePath}
                tabId={activeTab.id}
                workspaceKey={workspaceRefKey(activeTab.workspaceRef ?? activeWorkspaceRef)}
              />
            )}
            {activeTab.type === 'model' && activeTab.filePath && (
              <ModelViewer key={activeTab.filePath} filePath={activeTab.filePath} />
            )}
            {conversationTarget?.kind === 'local-agent' && (
              <WorkbenchAgentConversation
                key={conversationTarget.conversationId}
                tabId={conversationTarget.tabId}
                conversationId={conversationTarget.conversationId}
              />
            )}
            {activeTab.type === 'hardware-gerber' && activeTab.hardwareGerber && (
              <GerberLayerPreview
                key={`${activeTab.hardwareGerber.packagePath}:${activeTab.hardwareGerber.entry ?? ''}`}
                hardwareGerber={activeTab.hardwareGerber}
              />
            )}
            {activeTab.type === 'terminal' && <TerminalTabContent tab={activeTab} />}
            {activeTab.type === 'terminal-record' && activeTab.terminalRecord && (
              <TerminalRecordView tab={activeTab} />
            )}
            {activeTab.type === 'data-source-query' && <DataSourceQueryTab tab={activeTab} />}
            {activeTab.type === 'scheduled-task' && <ScheduledTaskTab tab={activeTab} />}
            {activeTab.type === 'web-resource' && activeTab.webResource && (
              <WebResourceDetailTab accountId={activeTab.webResource.accountId} />
            )}
            {activeTab.type === 'web-affair' && activeTab.webAffair?.affairId && (
              <WebAffairTab affairId={activeTab.webAffair.affairId} />
            )}
            {activeTab.type === 'web-affair' && activeTab.webAffair?.affairId === null && (
              <WebAffairDraftTab tab={activeTab} />
            )}
            {activeTab.type === 'media-production' && activeTab.mediaProject && (
              <MediaProductionTab tab={activeTab} />
            )}
          </>
        )}
      </ErrorBoundary>
    </div>
  )
}

function TerminalRecordView({ tab }: { tab: Tab }): React.ReactElement {
  const record = tab.terminalRecord
  const openTab = useTabStore((state) => state.openTab)
  if (!record) {
    return (
      <div className="conversation-shell local">
        <div className="terminal-placeholder">
          <div className="terminal-placeholder-title">Terminal 记录不存在</div>
        </div>
      </div>
    )
  }

  const openFreshTerminal = (): void => {
    openTab(buildTerminalTabDraft(record.runtime.workspaceRef))
  }

  return (
    <div className="conversation-shell local">
      <div className="terminal-record-view">
        <div className="terminal-record-header">
          <div>
            <div className="terminal-placeholder-title">Terminal 记录</div>
            <div className="terminal-placeholder-desc">
              这是只读历史现场；原进程不可输入时，只能从同目录新开 Terminal。
            </div>
          </div>
          <button type="button" onClick={openFreshTerminal}>
            从此目录新建 Terminal
          </button>
        </div>
        <div className="terminal-placeholder-grid">
          <TerminalMeta label="工作空间" value={workspaceRefLabel(record.runtime.workspaceRef)} />
          <TerminalMeta label="来源" value={workspaceRefSourceLabel(record.runtime.workspaceRef)} />
          <TerminalMeta label="状态" value={record.status} />
          <TerminalMeta label="cwd" value={record.runtime.cwd ?? '未设置'} />
          <TerminalMeta label="进程" value={record.processId ? String(record.processId) : '无'} />
          <TerminalMeta
            label="退出"
            value={
              typeof record.exitCode === 'number'
                ? `code ${record.exitCode}`
                : record.signal
                  ? `signal ${record.signal}`
                  : '无'
            }
          />
        </div>
        <div className="terminal-record-section">
          <div className="terminal-output-header">
            <span>命令记录</span>
          </div>
          {record.commandHistory?.length ? (
            <div className="terminal-record-command-list">
              {record.commandHistory.map((item) => (
                <code key={item.id}>{item.command}</code>
              ))}
            </div>
          ) : (
            <div className="terminal-output-empty">暂无命令记录</div>
          )}
        </div>
        <div className="terminal-record-section">
          <div className="terminal-output-header">
            <span>输出 Buffer</span>
          </div>
          <pre className="terminal-output terminal-record-output">
            {record.outputBuffer?.length ? (
              record.outputBuffer.map((line) => (
                <span key={line.id} className={`terminal-output-line ${line.kind}`}>
                  {line.text}
                </span>
              ))
            ) : (
              <span className="terminal-output-empty">暂无输出记录</span>
            )}
          </pre>
        </div>
      </div>
    </div>
  )
}

function TerminalTabContent({ tab }: { tab: Tab }): React.ReactElement {
  if (tab.terminal && isInteractiveTerminalRuntime(tab.terminal.runtime)) {
    return <PtyTerminal tab={tab} />
  }
  return <TerminalCommandPanel tab={tab} />
}

function PtyTerminal({ tab }: { tab: Tab }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const xtermRef = useRef<XtermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [restartPending, setRestartPending] = useState(false)
  const restartPendingRef = useRef(false)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const showToast = useToastStore((state) => state.show)
  const terminal = tab.terminal
  const outputBySessionId = useTerminalStore((state) => state.outputBySessionId)
  const outputLines = terminal?.sessionId
    ? (outputBySessionId[terminal.sessionId] ?? EMPTY_TERMINAL_OUTPUT_LINES)
    : EMPTY_TERMINAL_OUTPUT_LINES
  const initialRecordOutput =
    outputLines.length === 0
      ? (tab.terminalRecord?.outputBuffer?.filter((line) => line.kind !== 'input') ??
        EMPTY_TERMINAL_OUTPUT_LINES)
      : EMPTY_TERMINAL_OUTPUT_LINES
  const terminalFinal = terminal ? isTerminalFinalStatus(terminal.status) : false
  const terminalEndedRef = useRef(terminalFinal)
  terminalEndedRef.current = terminalFinal

  useEffect(() => {
    if (!terminalFinal || !xtermRef.current) return
    xtermRef.current.options.disableStdin = true
    xtermRef.current.options.cursorBlink = false
  }, [terminalFinal])

  useEffect(() => {
    if (!terminal?.sessionId || !terminal.runtime || !containerRef.current) return
    let disposed = false
    let started = false
    let queuedInput = ''

    const xterm = new XtermTerminal({
      cursorBlink: !terminalEndedRef.current,
      disableStdin: terminalEndedRef.current,
      // PTY 已负责换行转换；保留 \r 语义才能正确渲染 scp 等原地刷新的进度行。
      convertEol: false,
      fontFamily: 'Menlo, Monaco, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(containerRef.current)
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    const replayOutput = [...initialRecordOutput, ...outputLines].map((line) => line.text).join('')
    const writeInput = (data: string): void => {
      void window.cclinkStudio.terminal
        .writePty({
          terminalSessionId: terminal.sessionId!,
          data,
        })
        .then((result) => {
          if (!result.success && !disposed) {
            xterm.write(`\r\n[Terminal 输入失败：${result.error || '执行后端不可用'}]\r\n`)
          }
        })
    }
    const dataDisposable = subscribeTerminalInputAfterReplay(xterm, replayOutput, (data) => {
      if (terminalEndedRef.current) return
      if (!started) {
        queuedInput = `${queuedInput}${data}`.slice(-8_192)
        return
      }
      writeInput(data)
    })

    const unregisterContextSurface = registerTerminalContextSurface(terminal.sessionId, {
      getSelectionText: () => xterm.getSelection(),
      copy: () => copyTextToClipboard(xterm.getSelection()),
      paste: () => pasteClipboardToTerminal(terminal.sessionId!),
      clear: () => {
        xterm.clear()
        useTerminalStore.getState().clearOutput(terminal.sessionId!)
      },
      openFind: () => {
        setFindOpen(true)
        requestAnimationFrame(() => findInputRef.current?.focus())
      },
      closeFind: () => {
        setFindOpen(false)
        requestAnimationFrame(() => xterm.focus())
      },
    })

    const resizeToContainer = (): void => {
      try {
        fitAddon.fit()
        if (!terminalEndedRef.current) {
          void window.cclinkStudio.terminal.resizePty({
            terminalSessionId: terminal.sessionId!,
            size: { columns: xterm.cols, rows: xterm.rows },
          })
        }
      } catch {
        // xterm 尚未完成布局时 fit 可能失败；下一次 ResizeObserver 会重试。
      }
    }

    xterm.attachCustomKeyEventHandler((event) => {
      const sequence = resolveTerminalAltArrowSequence(event, xterm.modes.applicationCursorKeysMode)
      if (!sequence) return true
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && !terminalEndedRef.current) {
        void window.cclinkStudio.terminal.writePty({
          terminalSessionId: terminal.sessionId!,
          data: sequence,
        })
      }
      return false
    })

    const resizeDisposable = xterm.onResize((size) => {
      if (terminalEndedRef.current) return
      void window.cclinkStudio.terminal.resizePty({
        terminalSessionId: terminal.sessionId!,
        size: { columns: size.cols, rows: size.rows },
      })
    })

    const offExecutionEvent = window.cclinkStudio.terminal.onExecutionEvent(
      (event: TerminalExecutionEvent) => {
        if (event.sessionId !== terminal.sessionId) return
        if (event.kind === 'output') {
          xterm.write(event.data)
        } else if (event.kind === 'error') {
          terminalEndedRef.current = true
          started = false
          queuedInput = ''
          xterm.options.disableStdin = true
          xterm.options.cursorBlink = false
          xterm.write(`\r\n${event.message}\r\n`)
        } else if (event.kind === 'exit') {
          terminalEndedRef.current = true
          started = false
          queuedInput = ''
          xterm.options.disableStdin = true
          xterm.options.cursorBlink = false
          xterm.write(
            `\r\n[进程已退出${typeof event.exitCode === 'number' ? `，退出码 ${event.exitCode}` : ''}${event.signal ? `，信号 ${event.signal}` : ''}]\r\n`,
          )
        }
      },
    )

    const resizeObserver = new ResizeObserver(resizeToContainer)
    resizeObserver.observe(containerRef.current)
    requestAnimationFrame(() => {
      resizeToContainer()
      if (terminalEndedRef.current) return
      useTabStore.getState().updateTabTerminal(tab.id, { ...terminal, status: 'starting' })
      void window.cclinkStudio.terminal
        .startPty({
          terminalSessionId: terminal.sessionId!,
          runtime: terminal.runtime,
          size: { columns: xterm.cols, rows: xterm.rows },
        })
        .then((result) => {
          if (disposed) return
          if (!result.success) {
            queuedInput = ''
            useTabStore.getState().updateTabTerminal(tab.id, { ...terminal, status: 'error' })
            xterm.write(`\r\n[Terminal 启动失败：${result.error || '执行后端不可用'}]\r\n`)
            return
          }
          useTabStore.getState().updateTabTerminal(tab.id, {
            ...terminal,
            status: 'running',
            processId: result.processId ?? terminal.processId,
          })
          started = true
          if (queuedInput) {
            const pendingInput = queuedInput
            queuedInput = ''
            writeInput(pendingInput)
          }
          xterm.focus()
        })
    })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      unregisterContextSurface()
      offExecutionEvent()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [terminal?.sessionId, terminal?.runtime])

  const findNext = (): void => {
    const xterm = xtermRef.current
    const query = findQuery.trim().toLowerCase()
    if (!xterm || !query) return
    const buffer = xterm.buffer.active
    for (let row = 0; row < buffer.length; row += 1) {
      const text = buffer.getLine(row)?.translateToString(true) ?? ''
      const column = text.toLowerCase().indexOf(query)
      if (column < 0) continue
      xterm.select(column, row, query.length)
      xterm.scrollToLine(row)
      return
    }
  }

  const terminalTarget = () => ({
    kind: 'terminal' as const,
    workspaceKey: terminal ? workspaceRefKey(terminal.runtime.workspaceRef) : null,
    tabId: tab.id,
    sessionId: terminal?.sessionId ?? '',
    selectionText: xtermRef.current?.getSelection().slice(0, 8_000) ?? '',
    status: terminal?.status ?? 'idle',
  })

  const showTerminalContextMenu = (x: number, y: number, focusReturn: HTMLElement): void => {
    if (!terminal?.sessionId) return
    useContextMenuStore.getState().show({
      target: terminalTarget(),
      x,
      y,
      focusReturn,
    })
  }

  const restartTerminal = async (): Promise<void> => {
    if (!terminal?.sessionId || restartPendingRef.current) return
    restartPendingRef.current = true
    setRestartPending(true)
    try {
      const result = await executeCommand('terminal.restart', {
        source: 'toolbar',
        target: terminalTarget(),
      })
      if (!result.ok) showToast(result.message ?? 'Terminal 重新启动失败', 'error')
    } finally {
      restartPendingRef.current = false
      setRestartPending(false)
    }
  }

  return (
    <div
      className="terminal-pty-shell"
      tabIndex={0}
      onContextMenu={(event) => {
        if (event.target instanceof HTMLInputElement) return
        event.preventDefault()
        showTerminalContextMenu(event.clientX, event.clientY, event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKeyboardEvent(event.nativeEvent) || !terminal?.sessionId) return
        event.preventDefault()
        useContextMenuStore
          .getState()
          .show(buildKeyboardContextMenuInput(terminalTarget(), event.currentTarget))
      }}
    >
      <div className="terminal-pty-toolbar">
        <span>
          {terminal?.runtime.cwd ??
            (terminal?.runtime.location === 'remote' ? '远程 Terminal' : '本地 Terminal')}
        </span>
        {terminalFinal && (
          <span className="terminal-restart-control" title="旧 session 不会再次启动">
            <span>{terminal?.status === 'error' ? '启动失败' : '已结束'}</span>
            <button
              type="button"
              disabled={restartPending}
              onClick={() => void restartTerminal()}
              title={terminal?.status === 'error' ? '重试启动 Terminal' : '重新启动 Terminal'}
            >
              {restartPending ? '启动中…' : terminal?.status === 'error' ? '重试启动' : '重新启动'}
            </button>
          </span>
        )}
        {findOpen && (
          <span className="terminal-find-control">
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') findNext()
                if (event.key === 'Escape') {
                  setFindOpen(false)
                  requestAnimationFrame(() => xtermRef.current?.focus())
                }
              }}
              aria-label="查找 Terminal 输出"
              placeholder="查找"
            />
            <button type="button" onClick={findNext} title="查找下一个">
              查找
            </button>
            <button
              type="button"
              onClick={() => {
                setFindOpen(false)
                requestAnimationFrame(() => xtermRef.current?.focus())
              }}
              title="关闭查找"
            >
              ×
            </button>
          </span>
        )}
      </div>
      <div ref={containerRef} className="terminal-pty-surface" />
    </div>
  )
}

function TerminalCommandPanel({ tab }: { tab: Tab }): React.ReactElement {
  const terminal = tab.terminal
  const runtime = terminal?.runtime
  const workspace = runtime?.workspaceRef
  const [command, setCommand] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<TerminalSubmitCommandResult | null>(null)
  const [retriedAfterRegister, setRetriedAfterRegister] = useState(false)
  const outputBySessionId = useTerminalStore((state) => state.outputBySessionId)
  const outputLines = terminal?.sessionId
    ? (outputBySessionId[terminal.sessionId] ?? EMPTY_TERMINAL_OUTPUT_LINES)
    : EMPTY_TERMINAL_OUTPUT_LINES
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
          当前命令会进入权限、确认和审计链路；本地项目会启动本机 shell。
        </div>
        <div className="terminal-placeholder-grid">
          <TerminalMeta
            label="工作空间"
            value={workspace ? workspaceRefLabel(workspace) : '未知'}
          />
          <TerminalMeta
            label="来源"
            value={workspace ? workspaceRefSourceLabel(workspace) : '未知'}
          />
          <TerminalMeta label="运行位置" value="本地" />
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
              placeholder="例如：ls"
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
