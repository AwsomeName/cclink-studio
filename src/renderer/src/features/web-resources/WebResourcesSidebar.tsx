import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  CreateWebConnectionInput,
  WebAccount,
  WebPrincipalKind,
  WebResourceSnapshot,
  WebsiteResource,
} from '@shared/web-resources/web-resource-types'
import type { BrowserSessionDiagnosticSummary } from '@shared/ipc/browser'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { useBrowserStore, useTabStore } from '../../stores'
import { IconGlobe, IconPlus } from '../../components/common/Icons'

type LoginStatus = 'checking' | 'authenticated' | 'session-data' | 'not-authenticated' | 'error'

interface LoginObservation {
  status: LoginStatus
  checkedAt: number
}

interface AccountRow {
  account: WebAccount
  website: WebsiteResource
  principalName: string
}

const PRINCIPAL_KIND_LABELS: Record<WebPrincipalKind, string> = {
  personal: '个人',
  'sole-proprietor': '个体工商户',
  company: '公司',
  organization: '其他组织',
}

function statusFromDiagnostics(summary: BrowserSessionDiagnosticSummary): LoginStatus {
  const hasActiveAuthCookie = summary.likelyAuthCookies.some(
    (cookie) => typeof cookie.expiresAt !== 'number' || cookie.expiresAt > Date.now(),
  )
  if (hasActiveAuthCookie) return 'authenticated'
  if (summary.cookieCount > 0) return 'session-data'
  return 'not-authenticated'
}

function statusLabel(observation: LoginObservation | undefined): string {
  switch (observation?.status) {
    case 'authenticated':
      return '检测到登录凭据'
    case 'session-data':
      return '有会话数据，需确认'
    case 'not-authenticated':
      return '待登录'
    case 'error':
      return '状态检查失败'
    default:
      return '检查中'
  }
}

function initialForm(): CreateWebConnectionInput {
  return {
    websiteName: '',
    entryUrl: '',
    principalKind: 'company',
    principalName: '',
    accountLabel: '',
    browserProfileId: `web-${Date.now().toString(36)}`,
  }
}

export function WebResourcesSidebar({
  workspaceRef,
}: {
  workspaceRef: WorkspaceRef
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const activateTab = useTabStore((state) => state.activateTab)
  const tabs = useTabStore((state) => state.tabs)
  const browserTabs = useBrowserStore((state) => state.tabs)
  const [snapshot, setSnapshot] = useState<WebResourceSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
  const [form, setForm] = useState<CreateWebConnectionInput>(initialForm)
  const [loginStatuses, setLoginStatuses] = useState<Record<string, LoginObservation>>({})

  const rows = useMemo<AccountRow[]>(() => {
    if (!snapshot) return []
    const websiteById = new Map(snapshot.websites.map((website) => [website.id, website]))
    const principalById = new Map(snapshot.principals.map((principal) => [principal.id, principal]))
    return snapshot.accounts.flatMap((account) => {
      const website = websiteById.get(account.websiteId)
      const principal = principalById.get(account.principalId)
      return website && principal ? [{ account, website, principalName: principal.name }] : []
    })
  }, [snapshot])

  const reload = useCallback(async (): Promise<void> => {
    const result = await window.cclinkStudio.webResources.getSnapshot()
    if (!result.success) {
      setLoadError(result.error.message)
      return
    }
    setSnapshot(result.data)
    setLoadError(null)
  }, [])

  useEffect(() => {
    void reload().catch((error) => {
      setLoadError(error instanceof Error ? error.message : String(error))
    })
  }, [reload])

  const refreshLoginStatuses = useCallback(async (): Promise<void> => {
    if (rows.length === 0) {
      setLoginStatuses({})
      return
    }
    setCheckingLogin(true)
    try {
      const entries: Array<readonly [string, LoginObservation]> = []
      for (let index = 0; index < rows.length; index += 8) {
        const batch = rows.slice(index, index + 8)
        entries.push(
          ...(await Promise.all(
            batch.map(async ({ account, website }) => {
              try {
                const summary = await window.cclinkStudio.browser.getSessionDiagnostics({
                  url: website.entryUrl,
                  profileId: account.browserProfileId,
                })
                return [
                  account.id,
                  { status: statusFromDiagnostics(summary), checkedAt: Date.now() },
                ] as const
              } catch {
                return [account.id, { status: 'error' as const, checkedAt: Date.now() }] as const
              }
            }),
          )),
        )
      }
      setLoginStatuses(Object.fromEntries(entries))
    } finally {
      setCheckingLogin(false)
    }
  }, [rows])

  useEffect(() => {
    void refreshLoginStatuses()
  }, [refreshLoginStatuses])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setLoadError(null)
    try {
      const result = await window.cclinkStudio.webResources.createConnection(form)
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
      setForm(initialForm())
      setShowForm(false)
      await reload()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const openAccount = ({ account, website }: AccountRow): void => {
    const existing = tabs.find(
      (tab) =>
        tab.type === 'browser' &&
        tab.browserProfile === account.browserProfileId &&
        sameOrigin(browserTabs[tab.id]?.url ?? tab.initialUrl, website.entryUrl),
    )
    if (existing) {
      activateTab(existing.id)
      return
    }
    openTab({
      type: 'browser',
      title: website.name,
      icon: '🌐',
      initialUrl: website.entryUrl,
      browserProfile: account.browserProfileId,
      workspaceRef,
      forceNew: true,
    })
  }

  return (
    <div className="web-resources-sidebar">
      <div className="web-resources-toolbar">
        <span>{rows.length} 个账号连接</span>
        <span className="web-resources-toolbar-actions">
          <button
            type="button"
            disabled={checkingLogin || rows.length === 0}
            onClick={() => void refreshLoginStatuses()}
          >
            {checkingLogin ? '核验中…' : '核验登录'}
          </button>
          <button type="button" onClick={() => setShowForm((value) => !value)}>
            <IconPlus size={14} />
            添加网站
          </button>
        </span>
      </div>

      {showForm ? (
        <form className="web-resources-form" onSubmit={(event) => void submit(event)}>
          <label>
            网站名称
            <input
              required
              maxLength={120}
              value={form.websiteName}
              onChange={(event) => setForm({ ...form, websiteName: event.target.value })}
              placeholder="例如：App Store Connect"
            />
          </label>
          <label>
            办理入口
            <input
              required
              type="url"
              value={form.entryUrl}
              onChange={(event) => setForm({ ...form, entryUrl: event.target.value })}
              placeholder="https://..."
            />
          </label>
          <label>
            业务主体
            <span className="web-resources-inline-fields">
              <select
                value={form.principalKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    principalKind: event.target.value as WebPrincipalKind,
                  })
                }
              >
                {Object.entries(PRINCIPAL_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                required
                maxLength={160}
                value={form.principalName}
                onChange={(event) => setForm({ ...form, principalName: event.target.value })}
                placeholder="姓名或公司全称"
              />
            </span>
          </label>
          <label>
            账号名称
            <input
              required
              maxLength={160}
              value={form.accountLabel}
              onChange={(event) => setForm({ ...form, accountLabel: event.target.value })}
              placeholder="用于识别，不填写密码"
            />
          </label>
          <label>
            账号角色（可选）
            <input
              maxLength={120}
              value={form.accountRole ?? ''}
              onChange={(event) => setForm({ ...form, accountRole: event.target.value })}
              placeholder="例如：管理员、经办人、开发者"
            />
          </label>
          <label>
            Browser Profile
            <input
              required
              maxLength={64}
              pattern="[A-Za-z0-9._-]+"
              value={form.browserProfileId}
              onChange={(event) => setForm({ ...form, browserProfileId: event.target.value })}
            />
            <span className="web-resources-help">隔离并复用该账号的浏览器登录态</span>
          </label>
          <label>
            登录提示（可选）
            <input
              maxLength={500}
              value={form.loginHint ?? ''}
              onChange={(event) => setForm({ ...form, loginHint: event.target.value })}
              placeholder="用户名提示、登录方式；不要填写密码"
            />
          </label>
          <div className="web-resources-form-actions">
            <button type="button" onClick={() => setShowForm(false)}>
              取消
            </button>
            <button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存并建立连接'}
            </button>
          </div>
        </form>
      ) : null}

      {loadError ? <div className="web-resources-error">{loadError}</div> : null}
      {!snapshot && !loadError ? (
        <div className="web-resources-empty">正在读取网站与账号</div>
      ) : null}
      {snapshot && rows.length === 0 && !showForm ? (
        <div className="web-resources-empty">
          这里不再受预定义网站限制。添加第一个需要 AI 接管的网站和账号。
        </div>
      ) : null}

      <div className="web-resources-list">
        {rows.map((row) => {
          const observation = loginStatuses[row.account.id]
          return (
            <button
              type="button"
              className="web-resource-row"
              key={row.account.id}
              onClick={() => openAccount(row)}
              title={`${row.website.entryUrl}\nProfile: ${row.account.browserProfileId}`}
            >
              <IconGlobe size={15} />
              <span className="web-resource-row-main">
                <span className="web-resource-row-title">
                  <span>{row.website.name}</span>
                  <span className={`web-resource-status ${observation?.status ?? 'checking'}`} />
                </span>
                <span>
                  {[row.account.label, row.account.role, row.principalName]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span>
                  {statusLabel(observation)} · {row.account.browserProfileId}
                  {observation
                    ? ` · ${new Date(observation.checkedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })} 核验`
                    : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="web-resources-boundary">
        密码与 Cookie 不存入资源库；登录态由对应 Browser Profile 持有。
      </div>
    </div>
  )
}

function sameOrigin(left: string | undefined, right: string): boolean {
  if (!left) return false
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}
