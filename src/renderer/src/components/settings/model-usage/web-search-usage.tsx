import { useEffect, useState } from 'react'
import {
  WEB_SEARCH_PRICE_PER_CALL_USD,
  WEB_SEARCH_SOURCE_LABELS,
  type WebSearchMonthUsage,
  type WebSearchSource,
  type WebSearchStatus,
} from '@shared/web-search/web-search-types'

const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const usd = (calls: number) => '$' + (calls * WEB_SEARCH_PRICE_PER_CALL_USD).toFixed(2)

/** Monthly DeepSeek Search/Fetch counts recorded by the main-process web search service. */
export function WebSearchUsageSection({
  onOpenSettings,
}: {
  onOpenSettings: () => void
}): React.ReactElement | null {
  const [month, setMonth] = useState(thisMonth)
  const [usage, setUsage] = useState<WebSearchMonthUsage | null>(null)
  const [status, setStatus] = useState<WebSearchStatus | null>(null)
  useEffect(() => {
    void window.cclinkStudio.webSearch.getStatus().then((result) => {
      if (result.success) setStatus(result.data)
    })
  }, [])
  useEffect(() => {
    void window.cclinkStudio.webSearch.getUsage(month).then((result) => {
      if (result.success) setUsage(result.data)
    })
  }, [month])
  if (!status) return null
  const billable = (usage?.search ?? 0) + (usage?.fetch ?? 0)
  const limit = status.monthlyLimit
  const sources = Object.entries(usage?.bySource ?? {}) as Array<
    [WebSearchSource, { search: number; fetch: number }]
  >
  return (
    <section className="mu-section web-search-usage" aria-label="联网搜索用量">
      <div className="mu-between">
        <h3>联网搜索</h3>
        <div className="mu-actions">
          <input
            type="month"
            value={month}
            aria-label="联网搜索月份"
            onChange={(event) => event.target.value && setMonth(event.target.value)}
          />
          <button onClick={onOpenSettings}>设置上限</button>
        </div>
      </div>
      {!status.enabled && !billable && !usage?.failed ? (
        <p className="mu-note">
          联网搜索未启用。启用后这里显示 DeepSeek 搜索与网页读取的次数和估算费用。
        </p>
      ) : (
        <>
          <div className="mu-metrics web-search-metrics">
            <div>
              <span>搜索</span>
              <strong>{usage?.search ?? 0}</strong>
            </div>
            <div>
              <span>读取网页</span>
              <strong>{usage?.fetch ?? 0}</strong>
            </div>
            <div>
              <span>未计费（失败或无结果）</span>
              <strong>{usage?.failed ?? 0}</strong>
            </div>
            <div>
              <span>估算费用</span>
              <strong>{usd(billable)}</strong>
            </div>
          </div>
          {limit > 0 && month === thisMonth() && (
            <>
              <div className="web-search-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (billable / limit) * 100)}%` }} />
              </div>
              <p className="mu-note">
                本月 {billable.toLocaleString()} / {limit.toLocaleString()} 次上限。
              </p>
            </>
          )}
          <p className="mu-note">
            按 DeepSeek 列表价 $0.75 / 千次成功调用估算，以 DeepSeek 账单为准。
          </p>
          {sources.length > 0 && (
            <div className="mu-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>搜索</th>
                    <th>读取</th>
                    <th>估算</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map(([source, row]) => (
                    <tr key={source}>
                      <td>{WEB_SEARCH_SOURCE_LABELS[source] ?? source}</td>
                      <td>{row.search}</td>
                      <td>{row.fetch}</td>
                      <td>{usd(row.search + row.fetch)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
