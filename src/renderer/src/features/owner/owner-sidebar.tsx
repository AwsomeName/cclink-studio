import { useCallback, useEffect, useState } from 'react'
import type { OwnerSourceEntry, OwnerSourceGrant } from '@shared/ipc/owner-source'
import type { Affair } from './affair'
import { BOARD, ownerView, tabKey, useOwnerView } from './owner-view-store'

function SourceFolder({
  affairId,
  grant,
  rel,
  depth,
  onError,
}: {
  affairId: string
  grant: OwnerSourceGrant
  rel: string
  depth: number
  onError: (message: string) => void
}) {
  const [entries, setEntries] = useState<OwnerSourceEntry[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const openTab = useOwnerView((s) => s.open)
  const active = useOwnerView((s) => ownerView(s, affairId).active)
  useEffect(() => {
    let live = true
    window.cclinkStudio.ownerSources
      .entries(affairId, grant.id, rel)
      .then((items) => live && setEntries(items))
      .catch((e) => {
        if (!live) return
        setEntries([])
        onError(String(e))
      })
    return () => {
      live = false
    }
  }, [affairId, grant.id, rel, onError])
  if (!entries) return <small className="own-side-note">读取中…</small>
  if (!entries.length) return <small className="own-side-note">（空目录）</small>
  return (
    <ul className="own-tree" style={{ paddingLeft: depth ? 10 : 0 }}>
      {entries.map((entry) => {
        const path = rel ? rel + '/' + entry.name : entry.name
        if (entry.dir)
          return (
            <li key={path}>
              <button
                className="own-side-item own-folder"
                aria-expanded={!!open[path]}
                onClick={() => setOpen((v) => ({ ...v, [path]: !v[path] }))}
              >
                {open[path] ? '▾' : '▸'} {entry.name}/
              </button>
              {open[path] && (
                <SourceFolder
                  affairId={affairId}
                  grant={grant}
                  rel={path}
                  depth={depth + 1}
                  onError={onError}
                />
              )}
            </li>
          )
        const tab = { kind: 'source' as const, grantId: grant.id, rel: path, label: grant.label }
        return (
          <li key={path}>
            <button
              className={'own-side-item' + (active === tabKey(tab) ? ' active' : '')}
              title={grant.label + '/' + path}
              onClick={() => openTab(affairId, tab)}
            >
              {entry.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Fixed 208px Owner sidebar: progress, this affair's read-only directories, saved documents. */
export function OwnerSidebar({
  a,
  title,
  back,
  notify,
}: {
  a: Affair
  title: string
  back: () => void
  notify: (message: string) => void
}) {
  const view = useOwnerView((s) => ownerView(s, a.id))
  const { open: openTab, activate, closeSource } = useOwnerView.getState()
  const [grants, setGrants] = useState<OwnerSourceGrant[] | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 交付物: true })
  const [busy, setBusy] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const onError = useCallback((m: string) => setSourceError(m), [])
  const canUseDirectory = !!a.directory && !a.directory.error
  useEffect(() => {
    if (!canUseDirectory) return
    let live = true
    window.cclinkStudio.ownerSources
      .list(a.id)
      .then((g) => live && setGrants(g))
      .catch((e) => live && setSourceError(String(e)))
    return () => {
      live = false
    }
  }, [a.id, canUseDirectory])
  async function addSource() {
    setBusy(true)
    setSourceError('')
    try {
      const next = await window.cclinkStudio.ownerSources.add(a.id)
      if (next) {
        setGrants(next)
        const added = next.at(-1)
        if (added) setExpanded((v) => ({ ...v, ['grant:' + added.id]: true }))
      }
    } catch (e) {
      setSourceError(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function revoke(g: OwnerSourceGrant) {
    try {
      setGrants(await window.cclinkStudio.ownerSources.revoke(a.id, g.id))
      closeSource(a.id, g.id)
    } catch (e) {
      setSourceError(String(e))
    }
  }
  const files = a.directory?.files ?? []
  const order = ['事务.md', '事务配置.md', '调度.md', '工作记录.md']
  const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : order.length)
  const roots = files
    .filter((f) => !f.includes('/'))
    .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y))
  const groups = ['资料', '交付物']
    .map((folder) => ({ folder, items: files.filter((f) => f.startsWith(folder + '/')) }))
    .filter((g) => g.items.length)
  const fileButton = (name: string, label = name) => {
    const tab = { kind: 'affair' as const, name }
    return (
      <button
        key={name}
        className={'own-side-item' + (view.active === tabKey(tab) ? ' active' : '')}
        title={name}
        onClick={() => openTab(a.id, tab)}
      >
        {label}
      </button>
    )
  }
  return (
    <nav className="own-side" aria-label="Owner 事务侧栏">
      <button className="own-side-back" onClick={back}>
        ‹ 我的事务
      </button>
      <b className="own-side-title" title={a.title}>
        {title}
      </b>
      <button
        className={'own-side-item own-side-main' + (view.active === BOARD ? ' active' : '')}
        onClick={() => activate(a.id, BOARD)}
      >
        ▤ 事务进度
      </button>

      <h4>本事务可读目录</h4>
      {canUseDirectory ? (
        <>
          {grants?.map((g) => (
            <div key={g.id} className="own-grant" data-owner-grant={g.id}>
              <div className="own-grant-row">
                <button
                  className="own-side-item own-folder"
                  aria-expanded={!!expanded['grant:' + g.id]}
                  title={g.path}
                  disabled={!!g.error}
                  onClick={() =>
                    setExpanded((v) => ({ ...v, ['grant:' + g.id]: !v['grant:' + g.id] }))
                  }
                >
                  {expanded['grant:' + g.id] ? '▾' : '▸'} {g.label}
                </button>
                <button
                  className="own-side-x"
                  aria-label={'撤销本事务对「' + g.label + '」的只读授权'}
                  title="撤销只读授权"
                  onClick={() => void revoke(g)}
                >
                  ×
                </button>
              </div>
              {g.error ? (
                <small className="own-side-note" role="alert">
                  {g.error}
                </small>
              ) : (
                expanded['grant:' + g.id] && (
                  <SourceFolder affairId={a.id} grant={g} rel="" depth={0} onError={onError} />
                )
              )}
            </div>
          ))}
          <button className="own-side-item" disabled={busy} onClick={() => void addSource()}>
            ▱ {busy ? '等待选择目录…' : '配置参考目录…'}
          </button>
          <small className="own-side-note">只读，仅本事务可见；Owner 取证暂不读取本地目录。</small>
          {sourceError && (
            <small className="own-side-note" role="alert">
              {sourceError}
            </small>
          )}
        </>
      ) : (
        <small className="own-side-note">事务目录就绪后可配置。</small>
      )}

      <h4>已落地文档</h4>
      {files.length ? (
        <div className="own-files">
          {roots.map((name) => fileButton(name))}
          {groups.map(({ folder, items }) => (
            <div key={folder}>
              <button
                className="own-side-item own-folder"
                aria-expanded={!!expanded[folder]}
                onClick={() => setExpanded((v) => ({ ...v, [folder]: !v[folder] }))}
              >
                {expanded[folder] ? '▾' : '▸'} {folder}/ <span>{items.length}</span>
              </button>
              {expanded[folder] && (
                <div className="own-tree">
                  {items.map((name) => fileButton(name, name.slice(folder.length + 1)))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <small className="own-side-note">尚无已核验的文件。</small>
      )}

      {a.directory && (
        <div className="own-side-foot">
          <button
            className="own-side-item"
            title={a.directory.path}
            onClick={() =>
              void window.cclinkStudio.ownerDirectories.reveal(a.id).catch((e) => notify(String(e)))
            }
          >
            ▱ 事务保存位置
          </button>
          <small className="own-side-note" title={a.directory.path}>
            {a.directory.path}
          </small>
        </div>
      )}
    </nav>
  )
}
