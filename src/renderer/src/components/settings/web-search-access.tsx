import { useEffect, useState } from 'react'
import type { WebSearchBackendAccess, WebSearchStatus } from '@shared/web-search/web-search-types'
import { Toggle } from '../common/Toggle'

const ROWS: Array<{ key: keyof WebSearchBackendAccess; label: string; note: string }> = [
  { key: 'codex', label: 'Codex', note: '默认 Agent。Codex 自带搜索保持关闭，改用这两个工具。' },
  {
    key: 'claudeCode',
    label: 'Claude Code',
    note: '使用 DeepSeek 模型时 Claude Code 已有内置搜索，默认不重复提供。',
  },
  { key: 'owner', label: 'Owner 调研', note: '每个事务仍需在简报里勾选“允许联网搜索”。' },
]

/** Per-agent access for the web search tools; the main-process service stores and enforces it. */
export function WebSearchAccess({ onChanged }: { onChanged: () => void }): React.ReactElement {
  const [status, setStatus] = useState<WebSearchStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    void window.cclinkStudio.webSearch.getStatus().then((result) => {
      if (result.success) setStatus(result.data)
      else setError(result.error)
    })
  }, [])
  if (!status) return <p className="agent-capabilities-note">{error ?? '正在读取联网搜索设置…'}</p>
  const toggle = async (key: keyof WebSearchBackendAccess, value: boolean) => {
    setPending(true)
    setError(null)
    const result = await window.cclinkStudio.webSearch.saveSettings({
      enabled: status.enabled,
      keySource: status.keySource,
      monthlyLimit: status.monthlyLimit,
      resultCount: status.resultCount,
      backends: { ...status.backends, [key]: value },
    })
    setPending(false)
    if (result.success) {
      setStatus(result.data)
      onChanged()
    } else setError(result.error)
  }
  return (
    <div className="web-search-access">
      <strong>谁可以用</strong>
      <div className="web-search-access-grid">
        {ROWS.map((row) => (
          <div key={row.key}>
            <div>
              <span>{row.label}</span>
              <Toggle
                checked={status.backends[row.key]}
                disabled={pending}
                onChange={(value) => void toggle(row.key, value)}
              />
            </div>
            <small>{row.note}</small>
          </div>
        ))}
      </div>
      <p className="agent-capabilities-note">
        绑定可视浏览器 Tab
        的任务里，这两个工具不提供；搜索在可视浏览器完成。只读调用不弹确认，每次调用都显示在会话里。
        {status.state !== 'ready' && ` 当前未生效：${status.reason ?? '联网搜索未启用'}。`}
      </p>
      {error && <p className="agent-capabilities-error">{error}</p>}
    </div>
  )
}
