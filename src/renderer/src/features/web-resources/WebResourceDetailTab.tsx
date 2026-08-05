import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  WebAccount,
  WebPrincipal,
  WebsiteResource,
} from '@shared/web-resources/web-resource-types'
import { useWorkspaceStore } from '../../stores'
import {
  formatWebResourceLoginStatus,
  observeWebResourceLogin,
  WEB_PRINCIPAL_KIND_LABELS,
  type WebResourceLoginObservation,
} from './web-resource-view-model'
import { resolveAndOpenWebResourceTab } from './web-resource-tab'

interface WebResourceDetail {
  website: WebsiteResource
  principal: WebPrincipal
  account: WebAccount
}

export function WebResourceDetailTab({ accountId }: { accountId: string }): React.ReactElement {
  const workspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const [detail, setDetail] = useState<WebResourceDetail | null>(null)
  const [observation, setObservation] = useState<WebResourceLoginObservation>()
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.cclinkStudio.webResources
      .getSnapshot({ workspaceRef })
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          setError(result.error.message)
          return
        }
        const account = result.data.accounts.find((item) => item.id === accountId)
        const website = account
          ? result.data.websites.find((item) => item.id === account.websiteId)
          : undefined
        const principal = account
          ? result.data.principals.find((item) => item.id === account.principalId)
          : undefined
        if (!account || !website || !principal) {
          setError('网站账号资源不存在或已失效')
          return
        }
        setDetail({ account, website, principal })
        setError(null)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [accountId, workspaceRef])

  const checkLogin = useCallback(async (): Promise<void> => {
    if (!detail) return
    setChecking(true)
    try {
      const summary = await window.cclinkStudio.browser.getSessionDiagnostics({
        url: detail.website.entryUrl,
        profileId: detail.account.browserProfileId,
      })
      setObservation(observeWebResourceLogin(summary))
    } catch (reason) {
      setObservation({ status: 'error', checkedAt: Date.now() })
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChecking(false)
    }
  }, [detail])

  useEffect(() => {
    void checkLogin()
  }, [checkLogin])

  const authCookieNames = useMemo(
    () => observation?.summary?.likelyAuthCookies.map((cookie) => cookie.name) ?? [],
    [observation],
  )

  if (error && !detail) {
    return <div className="web-resource-detail-state error">{error}</div>
  }
  if (!detail) {
    return <div className="web-resource-detail-state">正在读取网站与账号资源…</div>
  }

  const openWebsite = async (): Promise<void> => {
    setError(null)
    try {
      await resolveAndOpenWebResourceTab(detail.account.id, workspaceRef)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="web-resource-detail">
      <header className="web-resource-detail-header">
        <div>
          <div className="web-resource-detail-eyebrow">网站与账号</div>
          <h1>{detail.website.name}</h1>
          <p>{detail.account.label}</p>
        </div>
        <div className="web-resource-detail-actions">
          <button type="button" disabled={checking} onClick={() => void checkLogin()}>
            {checking ? '核验中…' : '核验登录'}
          </button>
          <button type="button" className="primary" onClick={() => void openWebsite()}>
            打开网站
          </button>
        </div>
      </header>

      {error ? <div className="web-resource-detail-alert">{error}</div> : null}

      <div className="web-resource-detail-grid">
        <section>
          <h2>网站资源</h2>
          <DetailField label="名称" value={detail.website.name} />
          <DetailField label="Origin" value={detail.website.origin} />
          <DetailField label="办理入口" value={detail.website.entryUrl} />
          <DetailField label="备注" value={detail.website.notes ?? '未填写'} />
        </section>

        <section>
          <h2>业务主体与账号</h2>
          <DetailField label="主体类型" value={WEB_PRINCIPAL_KIND_LABELS[detail.principal.kind]} />
          <DetailField label="主体名称" value={detail.principal.name} />
          <DetailField label="账号名称" value={detail.account.label} />
          <DetailField label="账号角色" value={detail.account.role ?? '未填写'} />
          <DetailField label="登录提示" value={detail.account.loginHint ?? '未填写'} />
        </section>

        <section className="web-resource-session-card">
          <h2>登录环境</h2>
          <div className={`web-resource-session-state ${observation?.status ?? 'checking'}`}>
            {formatWebResourceLoginStatus(observation, detail.account.loginConfirmedAt)}
          </div>
          <DetailField
            label="Cookie"
            value={
              observation?.summary
                ? `${observation.summary.cookieCount} 个，${observation.summary.persistentCookieCount} 个持久化`
                : '待核验'
            }
          />
          <DetailField
            label="可能的登录 Cookie"
            value={authCookieNames.length > 0 ? authCookieNames.join('、') : '未检测到'}
          />
          <DetailField
            label="最近核验"
            value={observation ? new Date(observation.checkedAt).toLocaleString() : '尚未核验'}
          />
          <p className="web-resource-session-note">
            这里只展示脱敏诊断。密码不保存在项目资源中，登录状态由本机隔离环境持有。
          </p>
        </section>
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="web-resource-detail-field">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}
