import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  WebAccount,
  WebPrincipalKind,
  WebResourceProjectSnapshot,
  WebsiteResource,
} from '@shared/web-resources/web-resource-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { IconGlobe, IconPlus } from '../../components/common/Icons'
import {
  formatWebResourceLoginStatus,
  getWebResourceLoginStatus,
  observeWebResourceLogin,
  WEB_PRINCIPAL_KIND_LABELS,
  type WebResourceLoginObservation,
} from './web-resource-view-model'
import { resolveAndOpenWebResourceTab } from './web-resource-tab'
import { observeWebResourcesChanged } from './web-resource-events'
import { useTabStore } from '../../stores'

interface AccountRow {
  account: WebAccount
  website: WebsiteResource
  principalName: string
}

export function WebResourcesSidebar({
  workspaceRef,
  workspacePath,
}: {
  workspaceRef: WorkspaceRef
  workspacePath?: string | null
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState<WebResourceProjectSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showImportForm, setShowImportForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
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
    if (workspaceRef.kind !== 'local') {
      setSnapshot(null)
      setLoadError(null)
      return
    }
    const result = await window.cclinkStudio.webResources.getSnapshot({ workspaceRef })
    if (!result.success) {
      setLoadError(result.error.message)
      return
    }
    setSnapshot(result.data)
    setLoadError(null)
  }, [workspaceRef])

  useEffect(() => {
    setLoginStatuses({})
  }, [workspaceRef])

  useEffect(() => {
    void reload().catch((error) => {
      setLoadError(error instanceof Error ? error.message : String(error))
    })
  }, [reload])

  useEffect(
    () =>
      observeWebResourcesChanged(() => {
        void reload()
      }),
    [reload],
  )

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

  const beginDraft = async (): Promise<void> => {
    setSaving(true)
    setLoadError(null)
    try {
      const result = await window.cclinkStudio.webResources.beginDraft({ workspaceRef })
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
      useTabStore.getState().openTab({
        type: 'browser',
        title: '未保存的网站账号',
        icon: '🌐',
        browserProfile: result.data.browserProfileId,
        webResourceDraftRef: { draftId: result.data.draftId },
        workspaceRef,
        forceNew: true,
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const openAccount = async ({ account }: AccountRow): Promise<void> => {
    setLoadError(null)
    if (!account.projectId) {
      setLoadError(`账号“${account.label}”尚未归属当前项目`)
      return
    }
    try {
      await resolveAndOpenWebResourceTab(account.id, workspaceRef)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const confirmLogin = async (row: AccountRow): Promise<void> => {
    setSaving(true)
    setLoadError(null)
    try {
      const result = await window.cclinkStudio.webResources.confirmLogin({
        workspaceRef,
        accountId: row.account.id,
      })
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
      await reload()
      await refreshLoginStatuses()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const claimLegacyConnections = async (): Promise<void> => {
    setSaving(true)
    setLoadError(null)
    try {
      const result = await window.cclinkStudio.webResources.claimLegacyConnections({ workspaceRef })
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
      setImportMessage(`已将 ${result.data.claimedCount} 个旧网站账号归入当前项目`)
      await reload()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
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

  if (workspaceRef.kind !== 'local') {
    return (
      <div className="web-resources-sidebar">
        <div className="web-resources-empty">请先打开一个本地项目，再添加网站与账号。</div>
      </div>
    )
  }

  return (
    <div className="web-resources-sidebar">
      <div className="web-resources-toolbar">
        <button type="button" disabled={saving} onClick={() => void beginDraft()}>
          <IconPlus size={14} />
          {saving ? '正在打开…' : '添加网站与账号'}
        </button>
        <span className="web-resources-toolbar-actions">
          <button
            type="button"
            disabled={checkingLogin || rows.length === 0}
            onClick={() => void refreshLoginStatuses()}
          >
            {checkingLogin ? '核验中…' : '刷新状态'}
          </button>
          {workspacePath ? (
            <button type="button" onClick={() => setShowImportForm((value) => !value)}>
              导入
            </button>
          ) : null}
        </span>
      </div>

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
      {snapshot && snapshot.unassignedAccountCount > 0 ? (
        <div className="web-resources-legacy-notice">
          <span>发现 {snapshot.unassignedAccountCount} 个旧网站账号尚未归属项目。</span>
          <button type="button" disabled={saving} onClick={() => void claimLegacyConnections()}>
            归入当前项目
          </button>
        </div>
      ) : null}
      {!snapshot && !loadError ? (
        <div className="web-resources-empty">正在读取网站与账号</div>
      ) : null}
      {snapshot && rows.length === 0 ? (
        <div className="web-resources-empty">
          这里不再受预定义网站限制。添加第一个需要 AI 接管的网站和账号。
        </div>
      ) : null}

      <div className="web-resources-list">
        {rows.map((row) => {
          const observation = loginStatuses[row.account.id]
          const status = getWebResourceLoginStatus(observation, row.account.loginConfirmedAt)
          return (
            <div className="web-resource-row" key={row.account.id}>
              <button
                type="button"
                className="web-resource-row-open"
                onClick={() => void openAccount(row)}
                title={row.website.entryUrl}
              >
                <IconGlobe size={15} />
                <span className="web-resource-row-main">
                  <span className="web-resource-row-title">
                    <span>{row.website.name}</span>
                    <span className={`web-resource-status ${status}`} />
                  </span>
                  <span>
                    {row.principalName} ·{' '}
                    {formatWebResourceLoginStatus(observation, row.account.loginConfirmedAt)}
                  </span>
                  {row.account.label !== row.principalName || row.account.role ? (
                    <span>{[row.account.label, row.account.role].filter(Boolean).join(' · ')}</span>
                  ) : null}
                </span>
              </button>
              {status !== 'authenticated' ? (
                <button
                  type="button"
                  className="web-resource-row-confirm"
                  disabled={saving}
                  onClick={() => void confirmLogin(row)}
                >
                  确认登录
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="web-resources-boundary">
        密码与 Cookie 不存入项目资源；登录由隔离的本机浏览器环境持有。
      </div>
    </div>
  )
}
