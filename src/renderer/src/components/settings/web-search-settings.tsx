import { useEffect, useState } from 'react'
import {
  WEB_SEARCH_OWN_CREDENTIAL_ID,
  WEB_SEARCH_PRICE_PER_CALL_USD,
  WEB_SEARCH_RESULT_COUNTS,
  type WebSearchSettingsInput,
  type WebSearchStatus,
  type WebSearchVerifyResult,
} from '@shared/web-search/web-search-types'

export function webSearchNavLabel(status: WebSearchStatus | null): string {
  if (!status) return '正在读取…'
  if (status.state === 'ready') return status.keySource === 'agent' ? '沿用 DeepSeek' : '已启用'
  if (status.state === 'limit-reached') return '已达上限'
  if (status.state === 'missing-key') return '缺少 Key'
  return '未启用'
}

function inputFrom(status: WebSearchStatus): WebSearchSettingsInput {
  return {
    enabled: status.enabled,
    keySource: status.keySource,
    monthlyLimit: status.monthlyLimit,
    resultCount: status.resultCount,
    backends: { ...status.backends },
  }
}

type Feedback =
  | { kind: 'verified'; result: WebSearchVerifyResult }
  | { kind: 'error'; message: string }
  | { kind: 'saved'; message: string }

/**
 * Settings · API Key 与连接 · 联网搜索. The service in main owns the settings, the cap and usage;
 * this form only edits a draft and asks main to save or verify it.
 */
export function WebSearchConnectionForm({
  status,
  ownKeyWritable,
  onChanged,
  onBusyChange,
  onDirtyChange,
}: {
  status: WebSearchStatus | null
  ownKeyWritable: boolean
  onChanged: () => Promise<void>
  onBusyChange: (busy: boolean) => void
  onDirtyChange: (dirty: boolean) => void
}): React.ReactElement {
  const [draft, setDraft] = useState<WebSearchSettingsInput | null>(
    status ? inputFrom(status) : null,
  )
  const [ownKey, setOwnKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  useEffect(() => {
    if (status && !draft) setDraft(inputFrom(status))
  }, [status, draft])
  const dirty = Boolean(
    status &&
    draft &&
    (ownKey.trim() || JSON.stringify(inputFrom(status)) !== JSON.stringify(draft)),
  )
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  if (!status || !draft)
    return (
      <div className="connections-detail">
        <h2>联网搜索</h2>
        <p className="connections-description">正在读取联网搜索状态…</p>
      </div>
    )
  const agentKeyUsable = status.agentKeyAvailable
  const effectiveSource = !agentKeyUsable && draft.keySource === 'agent' ? 'own' : draft.keySource
  const hasKey =
    effectiveSource === 'agent' ? agentKeyUsable : status.ownKeyConfigured || Boolean(ownKey.trim())
  const update = (patch: Partial<WebSearchSettingsInput>) => {
    setDraft({ ...draft, ...patch })
    setFeedback(null)
  }
  const run = async (action: 'verify' | 'save' | 'disable') => {
    setBusy(true)
    onBusyChange(true)
    setFeedback(null)
    try {
      if (ownKey.trim()) {
        const saved = await window.cclinkStudio.credentials.set({
          id: WEB_SEARCH_OWN_CREDENTIAL_ID,
          kind: 'api-key',
          fields: { apiKey: ownKey.trim() },
        })
        if (!saved.success) throw new Error(saved.error || '密钥保存失败')
        setOwnKey('')
      }
      const next = { ...draft, keySource: effectiveSource }
      if (action === 'verify') {
        const result = await window.cclinkStudio.webSearch.verify(next)
        if (!result.success) throw new Error(result.error)
        setFeedback(
          result.data.success
            ? { kind: 'verified', result: result.data }
            : { kind: 'error', message: result.data.message },
        )
      } else {
        const result = await window.cclinkStudio.webSearch.saveSettings({
          ...next,
          enabled: action === 'disable' ? false : next.enabled,
        })
        if (!result.success) throw new Error(result.error)
        setFeedback({
          kind: 'saved',
          message: action === 'disable' ? '联网搜索已停用；Agent 将看不到这两个工具。' : '已保存。',
        })
      }
      await onChanged()
      const fresh = await window.cclinkStudio.webSearch.getStatus()
      if (fresh.success) setDraft(inputFrom(fresh.data))
    } catch (error) {
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : '操作失败' })
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }
  const verifiedAt = status.lastVerifiedAt
    ? new Date(status.lastVerifiedAt).toLocaleString('zh-CN', { hour12: false })
    : null
  return (
    <div className="connections-detail web-search-settings">
      <div className="connections-detail-heading">
        <h2>联网搜索</h2>
        <span
          className={`connections-status ${status.state === 'ready' ? 'success' : ''}`}
          role="status"
        >
          {busy
            ? '处理中…'
            : status.state === 'ready'
              ? `✓ 已启用${verifiedAt ? ` · 验证于 ${verifiedAt}` : ''}`
              : (status.reason ?? '未启用')}
        </span>
      </div>
      <p className="connections-description">
        让 Codex、Claude Code 和 Owner 通过 Studio 工具搜索网页、读取网页正文。由 DeepSeek
        搜索与网页读取接口提供，与 Agent 模型无关：用 Codex 时也能用。
      </p>
      <fieldset className="connections-form" disabled={busy}>
        <div className="web-search-key">
          <span>密钥</span>
          <label className="web-search-radio">
            <input
              type="radio"
              name="web-search-key"
              checked={effectiveSource === 'agent'}
              disabled={!agentKeyUsable}
              onChange={() => update({ keySource: 'agent' })}
            />
            <span>
              沿用 Claude Code 中保存的 DeepSeek Key
              <small>
                {agentKeyUsable
                  ? '同一账户余额；删除那边的 Key 时这里也停用。'
                  : 'Claude Code 当前没有保存 DeepSeek Key，不能沿用。'}
              </small>
            </span>
          </label>
          <label className="web-search-radio">
            <input
              type="radio"
              name="web-search-key"
              checked={effectiveSource === 'own'}
              onChange={() => update({ keySource: 'own' })}
            />
            <span>
              单独填写一个 DeepSeek Key
              <small>例如想把搜索费用记到另一个账户。</small>
            </span>
          </label>
          {effectiveSource === 'own' && (
            <label>
              DeepSeek API Key
              <input
                type="password"
                value={ownKey}
                autoComplete="off"
                spellCheck={false}
                maxLength={8192}
                disabled={!ownKeyWritable}
                placeholder={
                  status.ownKeyConfigured ? '已保存 · 输入新密钥以替换' : '输入 DeepSeek 密钥'
                }
                onChange={(event) => {
                  setOwnKey(event.target.value)
                  setFeedback(null)
                }}
              />
            </label>
          )}
        </div>
        <div className="web-search-row">
          <label>
            每月最多调用次数（0 表示不限）
            <input
              type="number"
              min={0}
              max={1000000}
              value={draft.monthlyLimit}
              onChange={(event) =>
                update({ monthlyLimit: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
              }
            />
          </label>
          <label>
            搜索结果默认条数
            <select
              value={draft.resultCount}
              onChange={(event) => update({ resultCount: Number(event.target.value) })}
            >
              {WEB_SEARCH_RESULT_COUNTS.map((count) => (
                <option key={count} value={count}>
                  {count} 条
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="connections-field-note">
          到达上限后停止调用并在会话里说明原因。DeepSeek 按成功次数收费：搜索、读取网页各 $0.75 /
          千次（约每次 ${WEB_SEARCH_PRICE_PER_CALL_USD}）；没有结果和失败的调用不收费。
        </p>
      </fieldset>
      <div className="connections-actions">
        <button
          type="button"
          className="connections-primary"
          disabled={busy || !hasKey}
          onClick={() => void run('verify')}
        >
          {busy ? '处理中…' : '验证：搜索一次并读取一页'}
        </button>
        <button
          type="button"
          className="settings-secondary-btn"
          disabled={busy || !dirty}
          onClick={() => void run('save')}
        >
          仅保存
        </button>
        {status.enabled && (
          <button
            type="button"
            className="connections-delete"
            disabled={busy}
            onClick={() => void run('disable')}
          >
            停用联网搜索
          </button>
        )}
      </div>
      <p className="connections-field-note">
        验证会真实搜索一次、读取一页（约 $0.0015），两步都成功才启用。
      </p>
      {feedback && (
        <div
          className={`connections-feedback ${feedback.kind === 'error' ? 'error' : 'success'}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          <strong>
            {feedback.kind === 'verified'
              ? '验证通过，已启用'
              : feedback.kind === 'error'
                ? '未完成'
                : '已保存'}
          </strong>
          {feedback.kind === 'verified' ? (
            <ul className="web-search-checks">
              <li>
                ✓ 搜索“{feedback.result.search?.query}”返回 {feedback.result.search?.resultCount}{' '}
                条结果 · {feedback.result.search?.durationMs}ms
              </li>
              <li>
                ✓ 读取 {feedback.result.fetch?.url} · {feedback.result.fetch?.characters} 字 ·{' '}
                {feedback.result.fetch?.durationMs}ms
              </li>
            </ul>
          ) : (
            <p>{feedback.message}</p>
          )}
        </div>
      )}
      <dl className="web-search-facts">
        <dt>发到 DeepSeek 的内容</dt>
        <dd>搜索词和要读取的网址。不发送项目文件、账号或 Cookie。</dd>
        <dt>谁可以用</dt>
        <dd>在“Agent 行为与工具 · 联网搜索”里按 Codex / Claude Code / Owner 分别开关。</dd>
        <dt>不能用来做什么</dt>
        <dd>不能证明网页上的操作已完成（例如已发布、已登录）。这些仍由可视浏览器核验。</dd>
        <dt>不可用时</dt>
        <dd>本地功能全部正常；Agent 只是看不到这两个工具。</dd>
      </dl>
    </div>
  )
}
