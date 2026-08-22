import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  WebAccount,
  WebAccountGroup,
  WebPrincipalKind,
  WebResourceSnapshot,
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
import { openDefaultBrowserTab } from './open-default-browser-tab'

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
  const [snapshot, setSnapshot] = useState<WebResourceSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showImportForm, setShowImportForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
  const [importPrincipalKind, setImportPrincipalKind] = useState<WebPrincipalKind>('company')
  const [importPrincipalName, setImportPrincipalName] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [editingGroup, setEditingGroup] = useState<WebAccountGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupAccountIds, setGroupAccountIds] = useState<string[]>([])
  const [loginStatuses, setLoginStatuses] = useState<Record<string, WebResourceLoginObservation>>(
    {},
  )

  const rows = useMemo<AccountRow[]>(() => {
    if (!snapshot) return []
    const websiteById = new Map(snapshot.websites.map((website) => [website.id, website]))
    const principalById = new Map(snapshot.principals.map((principal) => [principal.id, principal]))
    return snapshot.accounts
      .filter((account) => !account.archivedAt)
      .flatMap((account) => {
        const website = websiteById.get(account.websiteId)
        const principal = principalById.get(account.principalId)
        return website && principal ? [{ account, website, principalName: principal.name }] : []
      })
  }, [snapshot])

  const reload = useCallback(async (): Promise<void> => {
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
        void reload().catch((error) => {
          setLoadError(error instanceof Error ? error.message : String(error))
          console.error('[WebResources] 保存后刷新侧栏失败', error)
        })
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
    if (workspaceRef.kind !== 'local') {
      setLoadError('请先打开一个本地项目，再添加网站与账号')
      return
    }
    setSaving(true)
    setLoadError(null)
    try {
      const result = await openDefaultBrowserTab(workspaceRef)
      if (!result.saveable) setLoadError(`网页已打开；账号保存能力暂不可用：${result.error}`)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const openAccount = async ({ account }: AccountRow): Promise<void> => {
    setLoadError(null)
    if (workspaceRef.kind !== 'local') {
      setLoadError(`请先打开本地项目，再打开账号“${account.label}”`)
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

  const resetGroupForm = (): void => {
    setShowGroupForm(false)
    setEditingGroup(null)
    setGroupName('')
    setGroupAccountIds([])
  }

  const editGroup = (group?: WebAccountGroup): void => {
    setEditingGroup(group ?? null)
    setGroupName(group?.name ?? '')
    setGroupAccountIds(group?.accountIds ?? [])
    setShowGroupForm(true)
  }

  const saveGroup = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setLoadError(null)
    try {
      const result = editingGroup
        ? await window.cclinkStudio.webResources.updateAccountGroup({
            groupId: editingGroup.id,
            expectedRevision: editingGroup.revision,
            name: groupName,
            accountIds: groupAccountIds,
          })
        : await window.cclinkStudio.webResources.createAccountGroup({
            name: groupName,
            accountIds: groupAccountIds,
          })
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
      resetGroupForm()
      await reload()
    } finally {
      setSaving(false)
    }
  }

  const archiveGroup = async (group: WebAccountGroup): Promise<void> => {
    if (!window.confirm(`归档运营矩阵“${group.name}”？历史引用会保留。`)) return
    const result = await window.cclinkStudio.webResources.archiveAccountGroup({ groupId: group.id })
    if (!result.success) setLoadError(result.error.message)
    else await reload()
  }

  const archiveAccount = async (row: AccountRow): Promise<void> => {
    if (!window.confirm(`归档账号“${row.account.label}”？历史事务引用会保留。`)) return
    const result = await window.cclinkStudio.webResources.archiveAccount({
      accountId: row.account.id,
    })
    if (!result.success) setLoadError(result.error.message)
    else await reload()
  }

  const duplicateSets = useMemo(() => {
    const sets = new Map<string, AccountRow[]>()
    for (const row of rows) {
      const key = `${row.account.websiteId}:${row.account.principalId}:${row.account.label.trim().toLocaleLowerCase()}`
      sets.set(key, [...(sets.get(key) ?? []), row])
    }
    return [...sets.values()].filter((items) => items.length > 1)
  }, [rows])

  const mergeDuplicates = async (primary: AccountRow, duplicates: AccountRow[]): Promise<void> => {
    if (
      !window.confirm(`保留“${primary.account.label}”并合并其他 ${duplicates.length} 个重复账号？`)
    )
      return
    for (const duplicate of duplicates) {
      const result = await window.cclinkStudio.webResources.mergeAccounts({
        primaryAccountId: primary.account.id,
        duplicateAccountId: duplicate.account.id,
      })
      if (!result.success) {
        setLoadError(result.error.message)
        return
      }
    }
    await reload()
  }

  return (
    <div className="web-resources-sidebar">
      <div className="web-resources-toolbar">
        <button
          type="button"
          disabled={saving || workspaceRef.kind !== 'local'}
          onClick={() => void beginDraft()}
        >
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
          <button type="button" onClick={() => editGroup()}>
            新建矩阵
          </button>
          {workspaceRef.kind === 'local' && workspacePath ? (
            <button type="button" onClick={() => setShowImportForm((value) => !value)}>
              导入
            </button>
          ) : null}
        </span>
      </div>

      {workspaceRef.kind !== 'local' ? (
        <div className="web-resources-empty">全局账号可查看；打开本地项目后可添加或打开账号。</div>
      ) : null}

      {showGroupForm ? (
        <form className="web-resources-form" onSubmit={(event) => void saveGroup(event)}>
          <div className="web-resources-import-title">
            {editingGroup ? '编辑运营矩阵' : '新建运营矩阵'}
          </div>
          <label>
            矩阵名称
            <input
              required
              maxLength={160}
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
          </label>
          <fieldset className="web-resource-group-accounts">
            <legend>选择账号</legend>
            {rows.map((row) => (
              <label key={row.account.id}>
                <input
                  type="checkbox"
                  checked={groupAccountIds.includes(row.account.id)}
                  onChange={(event) =>
                    setGroupAccountIds((current) =>
                      event.target.checked
                        ? [...current, row.account.id]
                        : current.filter((id) => id !== row.account.id),
                    )
                  }
                />
                {row.website.name} · {row.account.label}
              </label>
            ))}
          </fieldset>
          <div className="web-resources-form-actions">
            <button type="button" onClick={resetGroupForm}>
              取消
            </button>
            <button type="submit" disabled={saving || groupAccountIds.length === 0}>
              {saving ? '保存中…' : '保存'}
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
      {duplicateSets.map((items) => (
        <div className="web-resources-legacy-notice" key={items[0].account.id}>
          <span>
            发现 {items.length} 个可能重复的“{items[0].account.label}”。
          </span>
          {items.map((primary, index) => (
            <button
              type="button"
              key={primary.account.id}
              onClick={() =>
                void mergeDuplicates(
                  primary,
                  items.filter((item) => item !== primary),
                )
              }
            >
              保留第 {index + 1} 项
            </button>
          ))}
        </div>
      ))}
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
              <button
                type="button"
                className="web-resource-row-confirm"
                disabled={saving}
                onClick={() => void archiveAccount(row)}
              >
                归档
              </button>
            </div>
          )
        })}
      </div>
      {snapshot && snapshot.accountGroups.filter((group) => !group.archivedAt).length > 0 ? (
        <div className="web-resource-groups">
          <div className="web-resources-import-title">运营矩阵</div>
          {snapshot.accountGroups
            .filter((group) => !group.archivedAt)
            .map((group) => (
              <div className="web-resource-group-row" key={group.id}>
                <span>
                  {group.name} · {group.accountIds.length} 个账号 · v{group.revision}
                </span>
                <button type="button" onClick={() => editGroup(group)}>
                  编辑
                </button>
                <button type="button" onClick={() => void archiveGroup(group)}>
                  归档
                </button>
              </div>
            ))}
        </div>
      ) : null}
      <div className="web-resources-boundary">
        账号目录全局共用；密码与 Cookie 不进入项目，登录由唯一的本机隔离浏览器环境持有。
      </div>
    </div>
  )
}
