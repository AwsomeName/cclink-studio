import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalSubmitCommandResult } from '@shared/ipc/terminal'
import type { TerminalExecutionEvent } from '@shared/terminal'
import type { Tab } from '../../types'
import {
  workspaceRefKey,
  workspaceRefLabel,
  workspaceRefSourceLabel,
} from '../../../../shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import { useTerminalStore } from '../../stores/terminal-store'
import { resolveConversationTab } from '../../utils/conversation-tab'
import { submitTerminalCommand } from '../../utils/terminal-command'
import { buildTerminalTabDraft } from '../../utils/terminal-tab'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { PanelErrorFallback } from '../common/ErrorFallback'
import { DataSourceQueryTab } from '../data-sources/DataSourceQueryTab'
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
              <FilePreview key={activeTab.filePath} filePath={activeTab.filePath} />
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
  if (tab.terminal?.runtime.location === 'local') {
    return <LocalPtyTerminal tab={tab} />
  }
  return <TerminalCommandPanel tab={tab} />
}

function LocalPtyTerminal({ tab }: { tab: Tab }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const xtermRef = useRef<XtermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const terminal = tab.terminal
  const outputBySessionId = useTerminalStore((state) => state.outputBySessionId)
  const outputLines = terminal?.sessionId
    ? (outputBySessionId[terminal.sessionId] ?? EMPTY_TERMINAL_OUTPUT_LINES)
    : EMPTY_TERMINAL_OUTPUT_LINES
  const initialRecordOutput =
    outputLines.length === 0
      ? (tab.terminalRecord?.outputBuffer ?? EMPTY_TERMINAL_OUTPUT_LINES)
      : EMPTY_TERMINAL_OUTPUT_LINES

  useEffect(() => {
    if (!terminal?.sessionId || !terminal.runtime || !containerRef.current) return

    const xterm = new XtermTerminal({
      cursorBlink: true,
      convertEol: true,
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

    for (const line of [...initialRecordOutput, ...outputLines]) {
      xterm.write(line.text)
    }

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
    })

    const resizeToContainer = (): void => {
      try {
        fitAddon.fit()
        void window.cclinkStudio.terminal.resizePty({
          terminalSessionId: terminal.sessionId!,
          size: { columns: xterm.cols, rows: xterm.rows },
        })
      } catch {
        // xterm 尚未完成布局时 fit 可能失败；下一次 ResizeObserver 会重试。
      }
    }

    const dataDisposable = xterm.onData((data) => {
      void window.cclinkStudio.terminal.writePty({
        terminalSessionId: terminal.sessionId!,
        data,
      })
    })

    const resizeDisposable = xterm.onResize((size) => {
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
          xterm.write(`\r\n${event.message}\r\n`)
        } else if (event.kind === 'exit') {
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
      void window.cclinkStudio.terminal.startPty({
        terminalSessionId: terminal.sessionId!,
        runtime: terminal.runtime,
        size: { columns: xterm.cols, rows: xterm.rows },
      })
      xterm.focus()
    })

    return () => {
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
        <span>{terminal?.runtime.cwd ?? '本地 Terminal'}</span>
        {findOpen && (
          <span className="terminal-find-control">
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') findNext()
                if (event.key === 'Escape') setFindOpen(false)
              }}
              aria-label="查找 Terminal 输出"
              placeholder="查找"
            />
            <button type="button" onClick={findNext} title="查找下一个">
              查找
            </button>
            <button type="button" onClick={() => setFindOpen(false)} title="关闭查找">
              ×
            </button>
          </span>
        )}
        <button type="button" onClick={() => xtermRef.current?.focus()} title="聚焦 Terminal">
          聚焦
        </button>
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
