import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  CreateWebConnectionInput,
  WebAccount,
  WebPrincipalKind,
  WebResourceSnapshot,
  WebsiteResource,
} from '@shared/web-resources/web-resource-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores'
import { IconGlobe, IconPlus } from '../../components/common/Icons'
import {
  formatWebResourceLoginStatus,
  observeWebResourceLogin,
  WEB_PRINCIPAL_KIND_LABELS,
  type WebResourceLoginObservation,
} from './web-resource-view-model'

interface AccountRow {
  account: WebAccount
  website: WebsiteResource
  principalName: string
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
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath?: string | null
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const [snapshot, setSnapshot] = useState<WebResourceSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showImportForm, setShowImportForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
  const [form, setForm] = useState<CreateWebConnectionInput>(initialForm)
  const [importPrincipalKind, setImportPrincipalKind] = useState<WebPrincipalKind>('company')
  const [importPrincipalName, setImportPrincipalName] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [loginStatuses, setLoginStatuses] = useState<Record<string, WebResourceLoginObservation>>(
    {},
  )

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
      const entries: Array<readonly [string, WebResourceLoginObservation]> = []
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
                return [account.id, observeWebResourceLogin(summary)] as const
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
    openTab({
      type: 'web-resource',
      title: `${website.name} · ${account.label}`,
      icon: '🌐',
      webResource: { accountId: account.id },
      workspaceRef,
    })
  }

  const importProjectOpsConfig = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!workspacePath) return
    setSaving(true)
    setLoadError(null)
    setImportMessage(null)
    try {
      const result = await window.cclinkStudio.webResources.importProjectOpsConfig({
        workspacePath,
        principalKind: importPrincipalKind,
        principalName: importPrincipalName,
      })
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
      setImportMessage(
        `已导入 ${result.data.importedCount} 个，跳过 ${result.data.skippedCount} 个已存在账号`,
      )
      setShowImportForm(false)
      await reload()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
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
          {workspacePath ? (
            <button type="button" onClick={() => setShowImportForm((value) => !value)}>
              导入旧配置
            </button>
          ) : null}
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
                {Object.entries(WEB_PRINCIPAL_KIND_LABELS).map(([value, label]) => (
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

      {showImportForm && workspacePath ? (
        <form
          className="web-resources-form web-resources-import-form"
          onSubmit={(event) => void importProjectOpsConfig(event)}
        >
          <div className="web-resources-import-title">导入当前项目的 cclink-accounts.json</div>
          <p>旧文件只读且保留。请指定这些账号属于哪个业务主体。</p>
          <label>
            业务主体
            <span className="web-resources-inline-fields">
              <select
                value={importPrincipalKind}
                onChange={(event) => setImportPrincipalKind(event.target.value as WebPrincipalKind)}
              >
                {Object.entries(WEB_PRINCIPAL_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                required
                maxLength={160}
                value={importPrincipalName}
                onChange={(event) => setImportPrincipalName(event.target.value)}
                placeholder="姓名或公司全称"
              />
            </span>
          </label>
          <div className="web-resources-form-actions">
            <button type="button" onClick={() => setShowImportForm(false)}>
              取消
            </button>
            <button type="submit" disabled={saving}>
              {saving ? '导入中…' : '开始导入'}
            </button>
          </div>
        </form>
      ) : null}

      {loadError ? <div className="web-resources-error">{loadError}</div> : null}
      {importMessage ? <div className="web-resources-success">{importMessage}</div> : null}
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
                  {formatWebResourceLoginStatus(observation)} · {row.account.browserProfileId}
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
