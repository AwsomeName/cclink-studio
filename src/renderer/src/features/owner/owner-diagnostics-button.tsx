import { useEffect, useRef, useState } from 'react'
import { copyTextToClipboard } from '../../utils/clipboard'
import type { Affair } from './affair'
import {
  OWNER_DIAGNOSTIC_EXCLUDES,
  OWNER_DIAGNOSTIC_INCLUDES,
  collectOwnerDiagnostics,
} from './owner-diagnostics'

/** Copies one affair's sanitized diagnostics and shows what was and was not included. */
export function CopyOwnerDiagnostics({
  a,
  active,
  workerLoading,
}: {
  a: Affair
  active: boolean
  workerLoading: boolean
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'copied'; text: string }
    | { kind: 'failed'; text?: string; error: string }
  >({ kind: 'idle' })
  const [full, setFull] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (state.kind !== 'copied' && state.kind !== 'failed') return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setState({ kind: 'idle' })
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [state.kind])
  async function copy() {
    setState({ kind: 'busy' })
    setFull(false)
    let text: string | undefined
    try {
      text = await collectOwnerDiagnostics(a, active, workerLoading)
      await copyTextToClipboard(text)
      setState({ kind: 'copied', text })
    } catch (e) {
      setState({ kind: 'failed', text, error: String(e) })
    }
  }
  const text = state.kind === 'copied' || state.kind === 'failed' ? state.text : undefined
  return (
    <span className="own-diag" ref={root}>
      <button
        className={'own-diag-button' + (state.kind === 'copied' ? ' done' : '')}
        disabled={state.kind === 'busy'}
        onClick={() => void copy()}
      >
        {state.kind === 'busy'
          ? '正在整理…'
          : state.kind === 'copied'
            ? '✓ 已复制'
            : '⧉ 复制 Owner 诊断'}
      </button>
      {(state.kind === 'copied' || state.kind === 'failed') && (
        <div className="own-diag-pop" role="dialog" aria-label="Owner 诊断复制结果">
          {state.kind === 'copied' ? (
            <h4>
              ✓ 已复制到剪贴板 · 约{' '}
              {Math.max(1, Math.round(new TextEncoder().encode(state.text).length / 1024))} KB
            </h4>
          ) : (
            <h4 className="failed" role="alert">
              复制失败：{state.error}
            </h4>
          )}
          <b>包含</b>
          <ul>
            {OWNER_DIAGNOSTIC_INCLUDES.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <b>不包含</b>
          <ul>
            {OWNER_DIAGNOSTIC_EXCLUDES.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {full && text && <pre className="own-diag-text">{text}</pre>}
          <div className="own-modal-actions">
            <span className="own-flex" />
            {text && (
              <button onClick={() => setFull((v) => !v)}>{full ? '收起全文' : '查看全文'}</button>
            )}
            <button onClick={() => setState({ kind: 'idle' })}>关闭</button>
          </div>
        </div>
      )}
    </span>
  )
}
