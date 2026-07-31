import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { WebAffairSnapshot } from '@shared/web-affairs/web-affair-types'
import type { WebAccount, WebResourceSnapshot } from '@shared/web-resources/web-resource-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { IconPlus } from '../../components/common/Icons'
import { useTabStore } from '../../stores'
import { WEB_AFFAIR_CHANGED_EVENT, WEB_AFFAIR_STATUS_LABELS } from './web-affair-view-model'

const DEFAULT_FLOW = [
  '确认办理要求',
  '准备并核对材料',
  '填写并提交',
  '等待审核结果',
  '处理结果并归档证据',
].join('\n')

export function WebAffairsSidebar({
  workspaceRef,
}: {
  workspaceRef: WorkspaceRef
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const [affairs, setAffairs] = useState<WebAffairSnapshot | null>(null)
  const [resources, setResources] = useState<WebResourceSnapshot | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [principalId, setPrincipalId] = useState('')
  const [accountIds, setAccountIds] = useState<string[]>([])
  const [materialPaths, setMaterialPaths] = useState<string[]>([])
  const [flowText, setFlowText] = useState(DEFAULT_FLOW)

  const reload = useCallback(async (): Promise<void> => {
    const [affairResult, resourceResult] = await Promise.all([
      window.cclinkStudio.webAffairs.getSnapshot(),
      window.cclinkStudio.webResources.getSnapshot(),
    ])
    if (!affairResult.success) throw new Error(affairResult.error.message)
    if (!resourceResult.success) throw new Error(resourceResult.error.message)
    setAffairs(affairResult.data)
    setResources(resourceResult.data)
    setError(null)
  }, [])

  useEffect(() => {
    void reload().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }, [reload])

  useEffect(() => {
    const handleChange = (): void => {
      void reload().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    }
    window.addEventListener(WEB_AFFAIR_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(WEB_AFFAIR_CHANGED_EVENT, handleChange)
  }, [reload])

  const accounts = useMemo(
    () => resources?.accounts.filter((account) => account.principalId === principalId) ?? [],
    [principalId, resources],
  )
  const sortedAffairs = useMemo(
    () =>
      [...(affairs?.affairs ?? [])].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [affairs],
  )

  const chooseMaterials = async (): Promise<void> => {
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      title: '选择事务所需的本地材料',
      multiSelections: true,
    })
    if (!result.canceled) setMaterialPaths((paths) => [...new Set([...paths, ...result.filePaths])])
  }

  const createAffair = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.webAffairs.createAffair({
        title,
        objective,
        principalId,
        accountIds,
        materialPaths,
        nodeTitles: flowText
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        workspaceRef,
      })
      if (!result.success) {
        setError(result.error.message)
        return
      }
      setShowForm(false)
      setTitle('')
      setObjective('')
      setAccountIds([])
      setMaterialPaths([])
      setFlowText(DEFAULT_FLOW)
      await reload()
      window.dispatchEvent(new Event(WEB_AFFAIR_CHANGED_EVENT))
      openTab({
        type: 'web-affair',
        title: result.data.title,
        icon: '📋',
        webAffair: { affairId: result.data.id },
        workspaceRef,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const openAffair = (affairId: string, affairTitle: string): void => {
    openTab({
      type: 'web-affair',
      title: affairTitle,
      icon: '📋',
      webAffair: { affairId },
      workspaceRef,
    })
  }

  return (
    <div className="web-affairs-sidebar">
      <div className="web-affairs-toolbar">
        <button type="button" onClick={() => setShowForm((value) => !value)}>
          <IconPlus size={14} />
          新建事务
        </button>
      </div>

      {showForm ? (
        <form className="web-affairs-form" onSubmit={(event) => void createAffair(event)}>
          <label>
            事务名称
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            最终目标
            <textarea
              required
              maxLength={4_000}
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </label>
          <label>
            代表的业务主体
            <select
              required
              value={principalId}
              onChange={(event) => {
                setPrincipalId(event.target.value)
                setAccountIds([])
              }}
            >
              <option value="">请选择主体</option>
              {resources?.principals.map((principal) => (
                <option key={principal.id} value={principal.id}>
                  {principal.name}
                </option>
              ))}
            </select>
          </label>
          {principalId ? (
            <fieldset>
              <legend>涉及的账号</legend>
              {accounts.length > 0 ? (
                accounts.map((account) => (
                  <AccountChoice
                    key={account.id}
                    account={account}
                    checked={accountIds.includes(account.id)}
                    onChange={(checked) =>
                      setAccountIds((ids) =>
                        checked ? [...ids, account.id] : ids.filter((id) => id !== account.id),
                      )
                    }
                  />
                ))
              ) : (
                <span className="web-affairs-form-hint">该主体还没有网站账号，可先只建事务。</span>
              )}
            </fieldset>
          ) : null}
          <div className="web-affairs-material-picker">
            <button type="button" onClick={() => void chooseMaterials()}>
              选择本地材料
            </button>
            <span>{materialPaths.length > 0 ? `已选 ${materialPaths.length} 个` : '未选择'}</span>
          </div>
          {materialPaths.length > 0 ? (
            <ul className="web-affairs-material-list">
              {materialPaths.map((path) => (
                <li key={path} title={path}>
                  {path.split('/').pop() ?? path}
                  <button
                    type="button"
                    aria-label={`移除 ${path}`}
                    onClick={() =>
                      setMaterialPaths((paths) => paths.filter((item) => item !== path))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label>
            整体流程（每行一个节点）
            <textarea
              required
              rows={6}
              value={flowText}
              onChange={(event) => setFlowText(event.target.value)}
            />
          </label>
          <div className="web-affairs-form-actions">
            <button type="button" onClick={() => setShowForm(false)}>
              取消
            </button>
            <button type="submit" disabled={saving || !principalId}>
              {saving ? '创建中…' : '创建事务'}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <div className="web-affairs-error">{error}</div> : null}
      {!affairs && !error ? <div className="web-affairs-empty">正在读取事务…</div> : null}
      {affairs && sortedAffairs.length === 0 ? (
        <div className="web-affairs-empty">还没有事务。创建后，流程和卡点会持续保存在这里。</div>
      ) : null}
      <div className="web-affairs-list">
        {sortedAffairs.map((affair) => {
          const completed = affair.flow.nodes.filter((node) => node.status === 'completed').length
          return (
            <button
              type="button"
              className="web-affair-row"
              key={affair.id}
              onClick={() => openAffair(affair.id, affair.title)}
            >
              <span className="web-affair-row-title">
                <strong>{affair.title}</strong>
                <em className={`web-affair-status ${affair.status}`}>
                  {WEB_AFFAIR_STATUS_LABELS[affair.status]}
                </em>
              </span>
              <span>{affair.objective}</span>
              <small>
                {completed}/{affair.flow.nodes.length} 个节点完成 ·{' '}
                {new Date(affair.updatedAt).toLocaleDateString()}
              </small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AccountChoice({
  account,
  checked,
  onChange,
}: {
  account: WebAccount
  checked: boolean
  onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <label className="web-affairs-account-choice">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {account.label}
        <small>{account.browserProfileId}</small>
      </span>
    </label>
  )
}
