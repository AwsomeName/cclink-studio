import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { WebAffairCatalog } from '@shared/web-affairs/web-affair-types'
import type { WebAccount, WebResourceSnapshot } from '@shared/web-resources/web-resource-types'
import { workspaceRefLabel } from '@shared/workspace-ref'
import { IconPlus } from '../../components/common/Icons'
import { useTabStore } from '../../stores/tab-store'
import type { Tab, WebAffairDraftState } from '../../types'
import { WEB_AFFAIR_CHANGED_EVENT } from './web-affair-view-model'
import { createEmptyWebAffairDraft, isWebAffairDraftEmpty } from './web-affair-draft'

export function WebAffairDraftTab({ tab }: { tab: Tab }): React.ReactElement {
  const updateTabDirty = useTabStore((state) => state.updateTabDirty)
  const updateTabTitle = useTabStore((state) => state.updateTabTitle)
  const updateTabWebAffair = useTabStore((state) => state.updateTabWebAffair)
  const closeTab = useTabStore((state) => state.closeTab)
  const [resources, setResources] = useState<WebResourceSnapshot | null>(null)
  const [catalog, setCatalog] = useState<WebAffairCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceRef = tab.workspaceRef
  const affairRef = tab.webAffair
  const draft = affairRef?.draft ?? createEmptyWebAffairDraft()

  useEffect(() => {
    if (!workspaceRef) return
    let cancelled = false
    setLoading(true)
    void Promise.all([
      window.cclinkStudio.webResources.getSnapshot({ workspaceRef }),
      window.cclinkStudio.webAffairs.getCatalog(),
    ])
      .then(([resourceResult, catalogResult]) => {
        if (cancelled) return
        if (!resourceResult.success) throw new Error(resourceResult.error.message)
        if (!catalogResult.success) throw new Error(catalogResult.error.message)
        setResources(resourceResult.data)
        setCatalog(catalogResult.data)
        setError(null)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceRef])

  const accounts = useMemo(
    () =>
      resources?.accounts.filter(
        (account) => !account.archivedAt && account.principalId === draft.principalId,
      ) ?? [],
    [draft.principalId, resources],
  )
  const accountGroups = useMemo(() => {
    if (!resources || !draft.principalId) return []
    const activeIds = new Set(accounts.map((account) => account.id))
    return resources.accountGroups.filter(
      (group) =>
        !group.archivedAt &&
        group.accountIds.length > 0 &&
        group.accountIds.every((id) => activeIds.has(id)),
    )
  }, [accounts, draft.principalId, resources])

  if (!workspaceRef || !affairRef || affairRef.affairId) {
    return <div className="web-affair-tab-state error">新建事务 Tab 缺少有效的工作空间绑定。</div>
  }

  const setDraft = (next: WebAffairDraftState): void => {
    updateTabWebAffair(tab.id, { ...affairRef, draft: next })
    updateTabDirty(tab.id, !isWebAffairDraftEmpty(next))
  }

  const patchDraft = (patch: Partial<WebAffairDraftState>): void => {
    setDraft({ ...draft, ...patch })
  }

  const chooseMaterials = async (): Promise<void> => {
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      title: '选择事务所需的本地材料',
      multiSelections: true,
    })
    if (!result.canceled) {
      patchDraft({ materialPaths: [...new Set([...draft.materialPaths, ...result.filePaths])] })
    }
  }

  const applyTemplate = (value: string): void => {
    const template = catalog?.templates.find((item) => `${item.id}@${item.version}` === value)
    if (!template) {
      patchDraft({ templateRef: undefined })
      return
    }
    const titleById = new Map(catalog?.atomicNodes.map((item) => [item.id, item.title]) ?? [])
    patchDraft({
      templateRef: { templateId: template.id, version: template.version },
      nodeTitles: template.nodeCatalogIds.map((id) => titleById.get(id) ?? id),
    })
  }

  const updateNodeTitle = (index: number, title: string): void => {
    patchDraft({
      nodeTitles: draft.nodeTitles.map((item, itemIndex) => (itemIndex === index ? title : item)),
    })
  }

  const removeNode = (index: number): void => {
    if (draft.nodeTitles.length <= 1) return
    patchDraft({ nodeTitles: draft.nodeTitles.filter((_, itemIndex) => itemIndex !== index) })
  }

  const createAffair = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.webAffairs.createAffair({
        title: draft.title,
        objective: draft.objective,
        principalId: draft.principalId,
        accountIds: draft.accountIds,
        accountGroupIds: draft.accountGroupIds,
        materialPaths: draft.materialPaths,
        nodeTitles: draft.nodeTitles.map((item) => item.trim()).filter(Boolean),
        workspaceRef,
        templateRef: draft.templateRef,
      })
      if (!result.success) {
        setError(result.error.message)
        return
      }
      updateTabWebAffair(tab.id, {
        affairId: result.data.id,
        draftKey: result.data.id,
      })
      updateTabTitle(tab.id, result.data.title)
      updateTabDirty(tab.id, false)
      window.dispatchEvent(new Event(WEB_AFFAIR_CHANGED_EVENT))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const selectedTemplate = draft.templateRef
    ? `${draft.templateRef.templateId}@${draft.templateRef.version}`
    : ''
  const canCreate =
    !loading &&
    !saving &&
    draft.title.trim().length > 0 &&
    draft.objective.trim().length > 0 &&
    draft.principalId.length > 0 &&
    draft.nodeTitles.some((title) => title.trim().length > 0)

  return (
    <div className="web-affair-draft-tab">
      <header className="web-affair-tab-header">
        <div>
          <div className="web-affair-tab-eyebrow">个人或公司的网页事务代理人</div>
          <h1>新建事务</h1>
          <p>先说明要办什么并绑定当前项目资源；创建后在同一个事务 Tab 持续推进。</p>
        </div>
        <span className="web-affair-draft-workspace">{workspaceRefLabel(workspaceRef)}</span>
      </header>

      {error ? <div className="web-affair-tab-alert">{error}</div> : null}

      <form className="web-affair-draft-form" onSubmit={(event) => void createAffair(event)}>
        <section className="web-affair-draft-section">
          <div className="web-affair-section-heading">
            <div>
              <span>01</span>
              <h2>目标</h2>
            </div>
            <small>定义这件事，而不是定义一次网页点击</small>
          </div>
          <div className="web-affair-draft-fields">
            <label>
              事务名称
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(event) => patchDraft({ title: event.target.value })}
              />
            </label>
            <label className="wide">
              最终目标
              <textarea
                required
                maxLength={4_000}
                rows={4}
                value={draft.objective}
                onChange={(event) => patchDraft({ objective: event.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="web-affair-draft-section">
          <div className="web-affair-section-heading">
            <div>
              <span>02</span>
              <h2>相关资源</h2>
            </div>
            <small>主体、网站账号和本地材料</small>
          </div>
          <div className="web-affair-draft-fields">
            <label>
              代表的业务主体
              <select
                required
                value={draft.principalId}
                onChange={(event) =>
                  patchDraft({
                    principalId: event.target.value,
                    accountIds: [],
                    accountGroupIds: [],
                  })
                }
              >
                <option value="">请选择主体</option>
                {resources?.principals.map((principal) => (
                  <option key={principal.id} value={principal.id}>
                    {principal.name}
                  </option>
                ))}
              </select>
              {!loading && resources?.principals.length === 0 ? (
                <small>全局账号目录还没有业务主体，请先在“网站与账号”中添加。</small>
              ) : null}
            </label>
            <fieldset>
              <legend>涉及的账号</legend>
              {draft.principalId && accounts.length > 0 ? (
                accounts.map((account) => (
                  <AccountChoice
                    key={account.id}
                    account={account}
                    checked={draft.accountIds.includes(account.id)}
                    onChange={(checked) =>
                      patchDraft({
                        accountIds: checked
                          ? [...draft.accountIds, account.id]
                          : draft.accountIds.filter((id) => id !== account.id),
                      })
                    }
                  />
                ))
              ) : (
                <small>{draft.principalId ? '该主体还没有网站账号。' : '请先选择主体。'}</small>
              )}
            </fieldset>
            <fieldset>
              <legend>引用运营矩阵（可选）</legend>
              {accountGroups.length > 0 ? (
                accountGroups.map((group) => (
                  <label key={group.id}>
                    <input
                      type="checkbox"
                      checked={draft.accountGroupIds.includes(group.id)}
                      onChange={(event) =>
                        patchDraft({
                          accountGroupIds: event.target.checked
                            ? [...draft.accountGroupIds, group.id]
                            : draft.accountGroupIds.filter((id) => id !== group.id),
                        })
                      }
                    />
                    {group.name} · {group.accountIds.length} 个账号 · v{group.revision}
                  </label>
                ))
              ) : (
                <small>当前主体没有可用运营矩阵。</small>
              )}
            </fieldset>
            <div className="web-affair-draft-materials wide">
              <div>
                <strong>本地材料</strong>
                <span>
                  {draft.materialPaths.length > 0
                    ? `已关联 ${draft.materialPaths.length} 项`
                    : '尚未关联材料'}
                </span>
              </div>
              <button type="button" onClick={() => void chooseMaterials()}>
                选择本地材料
              </button>
            </div>
            {draft.materialPaths.length > 0 ? (
              <ul className="web-affairs-material-list wide">
                {draft.materialPaths.map((path) => (
                  <li key={path} title={path}>
                    {path.split('/').pop() ?? path}
                    <button
                      type="button"
                      aria-label={`移除 ${path}`}
                      onClick={() =>
                        patchDraft({
                          materialPaths: draft.materialPaths.filter((item) => item !== path),
                        })
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="web-affair-draft-section">
          <div className="web-affair-section-heading">
            <div>
              <span>03</span>
              <h2>初始流程</h2>
            </div>
            <small>创建后仍可在事务 Tab 调整未执行节点</small>
          </div>
          <div className="web-affair-draft-flow">
            <label>
              业务模板（可选）
              <select
                value={selectedTemplate}
                onChange={(event) => applyTemplate(event.target.value)}
              >
                <option value="">不使用模板</option>
                {catalog?.templates.map((template) => (
                  <option
                    key={`${template.id}@${template.version}`}
                    value={`${template.id}@${template.version}`}
                  >
                    {template.title} · v{template.version}
                  </option>
                ))}
              </select>
            </label>
            <div className="web-affair-draft-flow-list">
              {draft.nodeTitles.map((nodeTitle, index) => (
                <div className="web-affair-draft-flow-row" key={`${affairRef.draftKey}:${index}`}>
                  <span>{index + 1}</span>
                  <input
                    required
                    maxLength={240}
                    aria-label={`流程步骤 ${index + 1}`}
                    value={nodeTitle}
                    onChange={(event) => updateNodeTitle(index, event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={draft.nodeTitles.length <= 1}
                    aria-label={`移除流程步骤 ${index + 1}`}
                    onClick={() => removeNode(index)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="web-affair-draft-add-step"
              onClick={() => patchDraft({ nodeTitles: [...draft.nodeTitles, ''] })}
            >
              <IconPlus size={14} />
              添加步骤
            </button>
          </div>
        </section>

        <footer className="web-affair-draft-actions">
          <button type="button" onClick={() => closeTab(tab.id)}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!canCreate}>
            {saving ? '创建中…' : '创建事务'}
          </button>
        </footer>
      </form>
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
        <small>使用“网站与账号”中已保存的登录状态</small>
      </span>
    </label>
  )
}
