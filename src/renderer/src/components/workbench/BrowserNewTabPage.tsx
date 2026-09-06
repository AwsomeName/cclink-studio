import { useCallback, useEffect, useState } from 'react'
import type { BrowserHistoryEntry } from '@shared/ipc/browser'
import { IconClock, IconGlobe } from '../common/Icons'
import {
  getRecentBrowserUrlLabel,
  RECENT_BROWSER_HISTORY_LIMIT,
  selectRecentBrowserHistory,
} from '../../features/browser/browser-new-tab'
import { observeBrowserHistoryChanged } from '../../features/browser/browser-history-events'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { observeWebResourcesChanged } from '../../features/web-resources/web-resource-events'

export interface BrowserNewTabAccount {
  id: string
  label: string
  websiteName: string
  entryUrl: string
}

interface BrowserNewTabPageProps {
  workspaceRef: WorkspaceRef
  onOpenUrl: (url: string) => void
  onOpenAccount: (accountId: string) => void
  onAddAccount: () => void
}

export function BrowserNewTabPage({
  workspaceRef,
  onOpenUrl,
  onOpenAccount,
  onAddAccount,
}: BrowserNewTabPageProps): React.ReactElement {
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [accounts, setAccounts] = useState<BrowserNewTabAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [accountsError, setAccountsError] = useState(false)

  const loadHistory = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(false)
    try {
      const entries = await window.cclinkStudio.browser.listHistory(RECENT_BROWSER_HISTORY_LIMIT)
      setHistory(selectRecentBrowserHistory(entries))
    } catch (cause) {
      console.warn(
        '[BrowserNewTabPage] 最近访问加载失败:',
        cause instanceof Error ? cause.message : String(cause),
      )
      setHistory([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAccounts = useCallback(async (): Promise<void> => {
    setAccountsLoading(true)
    setAccountsError(false)
    try {
      const result = await window.cclinkStudio.webResources.getSnapshot({ workspaceRef })
      if (!result.success) throw new Error(result.error.message)
      const websiteById = new Map(result.data.websites.map((website) => [website.id, website]))
      setAccounts(
        result.data.accounts.flatMap((account) => {
          if (account.archivedAt) return []
          const website = websiteById.get(account.websiteId)
          return website
            ? [
                {
                  id: account.id,
                  label: account.label,
                  websiteName: website.name,
                  entryUrl: website.entryUrl,
                },
              ]
            : []
        }),
      )
    } catch (cause) {
      console.warn(
        '[BrowserNewTabPage] 已保存账号加载失败:',
        cause instanceof Error ? cause.message : String(cause),
      )
      setAccounts([])
      setAccountsError(true)
    } finally {
      setAccountsLoading(false)
    }
  }, [workspaceRef])

  useEffect(() => {
    void loadHistory()
    const stopObservingHistory = observeBrowserHistoryChanged(() => void loadHistory())
    const stopObservingNavigation = window.cclinkStudio.browser.onUrlChanged(
      () => void loadHistory(),
    )
    return () => {
      stopObservingHistory()
      stopObservingNavigation()
    }
  }, [loadHistory])

  useEffect(() => {
    void loadAccounts()
    return observeWebResourcesChanged(() => void loadAccounts())
  }, [loadAccounts])

  return (
    <BrowserNewTabContent
      history={history}
      loading={loading}
      error={error}
      accounts={accounts}
      accountsLoading={accountsLoading}
      accountsError={accountsError}
      canOpenAccounts={workspaceRef.kind === 'local'}
      onOpenUrl={onOpenUrl}
      onOpenAccount={onOpenAccount}
      onAddAccount={onAddAccount}
      onRetry={() => void loadHistory()}
      onRetryAccounts={() => void loadAccounts()}
    />
  )
}

export function BrowserNewTabContent({
  history,
  loading,
  error,
  accounts = [],
  accountsLoading = false,
  accountsError = false,
  canOpenAccounts = true,
  onOpenUrl,
  onOpenAccount = () => undefined,
  onAddAccount = () => undefined,
  onRetry,
  onRetryAccounts = () => undefined,
}: {
  history: BrowserHistoryEntry[]
  loading: boolean
  error: boolean
  accounts?: BrowserNewTabAccount[]
  accountsLoading?: boolean
  accountsError?: boolean
  canOpenAccounts?: boolean
  onOpenUrl: (url: string) => void
  onOpenAccount?: (accountId: string) => void
  onAddAccount?: () => void
  onRetry: () => void
  onRetryAccounts?: () => void
}): React.ReactElement {
  return (
    <div className="browser-new-tab">
      <div className="browser-new-tab-inner">
        <section className="browser-new-tab-section">
          <div className="browser-new-tab-heading browser-new-tab-heading-with-action">
            <span className="browser-new-tab-heading-icon" aria-hidden="true">
              <IconGlobe size={18} />
            </span>
            <div>
              <h2>已保存账号</h2>
              <p>在同一个浏览器中打开独立的登录环境</p>
            </div>
            <button
              type="button"
              className="browser-new-tab-add-account"
              disabled={!canOpenAccounts}
              onClick={onAddAccount}
              title={canOpenAccounts ? '添加新的账号环境' : '请先打开本地工作空间'}
            >
              添加账号
            </button>
          </div>

          {accounts.length > 0 ? (
            <div className="browser-new-tab-grid" aria-label="已保存的网站账号">
              {accounts.map((account) => (
                <button
                  type="button"
                  className="browser-new-tab-card"
                  key={account.id}
                  disabled={!canOpenAccounts}
                  title={`${account.websiteName} · ${account.entryUrl}`}
                  onClick={() => onOpenAccount(account.id)}
                >
                  <span className="browser-new-tab-card-icon" aria-hidden="true">
                    <IconGlobe size={18} />
                  </span>
                  <span className="browser-new-tab-card-copy">
                    <span className="browser-new-tab-card-title">{account.label}</span>
                    <span className="browser-new-tab-card-url">{account.websiteName}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : accountsLoading ? (
            <div className="browser-new-tab-empty">正在加载已保存账号…</div>
          ) : accountsError ? (
            <button type="button" className="browser-new-tab-retry" onClick={onRetryAccounts}>
              已保存账号加载失败，点击重试
            </button>
          ) : (
            <div className="browser-new-tab-empty">还没有保存账号，可从这里添加</div>
          )}
        </section>

        <section className="browser-new-tab-section">
          <div className="browser-new-tab-heading">
            <span className="browser-new-tab-heading-icon" aria-hidden="true">
              <IconClock size={18} />
            </span>
            <div>
              <h2>最近访问</h2>
              <p>从最近打开过的网址继续浏览</p>
            </div>
          </div>

          {history.length > 0 ? (
            <div className="browser-new-tab-grid" aria-label="最近访问的网址">
              {history.map((entry) => (
                <button
                  type="button"
                  className="browser-new-tab-card"
                  key={entry.id}
                  title={entry.url}
                  onClick={() => onOpenUrl(entry.url)}
                >
                  <span className="browser-new-tab-card-icon" aria-hidden="true">
                    <IconGlobe size={18} />
                  </span>
                  <span className="browser-new-tab-card-copy">
                    <span className="browser-new-tab-card-title">
                      {entry.title?.trim() || getRecentBrowserUrlLabel(entry.url)}
                    </span>
                    <span className="browser-new-tab-card-url">
                      {getRecentBrowserUrlLabel(entry.url)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : loading ? (
            <div className="browser-new-tab-empty">正在加载最近访问…</div>
          ) : error ? (
            <button type="button" className="browser-new-tab-retry" onClick={onRetry}>
              最近访问加载失败，点击重试
            </button>
          ) : (
            <div className="browser-new-tab-empty">访问过的网址会显示在这里</div>
          )}
        </section>
      </div>
    </div>
  )
}
