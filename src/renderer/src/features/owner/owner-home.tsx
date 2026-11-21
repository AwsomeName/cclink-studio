import { useEffect, useRef, useState } from 'react'
import { acceptDirectory } from './owner-store'
import { discuss } from './research-work'
import { freshResearch } from './research-model'
import { next, type Affair } from './affair'
import {
  GROUPS,
  groupOf,
  relativeTime,
  rowMeta,
  useOwnerPrefs,
  type GroupKey,
} from './owner-status'
import { OwnerSettings } from './owner-settings'

export type HomeView =
  | { kind: 'list'; filter: GroupKey | 'all' }
  | { kind: 'new' }
  | { kind: 'settings' }

/** List-level fixed sidebar: all affairs by group, hand over a new one, Owner settings. */
function HomeNav({
  items,
  active,
  view,
  setView,
}: {
  items: Affair[]
  active: ReadonlySet<string>
  view: HomeView
  setView: (v: HomeView) => void
}) {
  const count = (key: GroupKey) => items.filter((a) => groupOf(a, active.has(a.id)) === key).length
  const on = (v: HomeView) =>
    view.kind === v.kind &&
    (v.kind !== 'list' || (view.kind === 'list' && view.filter === v.filter))
  return (
    <nav className="own-side" aria-label="Owner 事务导航">
      <button
        className={'own-side-item' + (on({ kind: 'list', filter: 'all' }) ? ' active' : '')}
        onClick={() => setView(items.length ? { kind: 'list', filter: 'all' } : { kind: 'new' })}
      >
        ◈ {items.length ? '全部事务' : '我的事务'}
        {items.length > 0 && <span className="own-count">{items.length}</span>}
      </button>
      {!items.length && <small className="own-side-note">还没有事务</small>}
      {items.length > 0 &&
        GROUPS.filter((g) => g.key !== 'attention' || count(g.key)).map((g) => (
          <button
            key={g.key}
            className={
              'own-side-item own-side-sub' + (on({ kind: 'list', filter: g.key }) ? ' active' : '')
            }
            onClick={() => setView({ kind: 'list', filter: g.key })}
          >
            {g.label}
            <span className={'own-count' + (g.waits && count(g.key) ? ' hot' : '')}>
              {count(g.key)}
            </span>
          </button>
        ))}
      <div className="own-side-gap" />
      <button
        className={'own-side-item' + (view.kind === 'new' ? ' active' : '')}
        onClick={() => setView({ kind: 'new' })}
      >
        ＋ 交办新事务
      </button>
      <div className="own-side-foot">
        <button
          className={'own-side-item' + (view.kind === 'settings' ? ' active' : '')}
          onClick={() => setView({ kind: 'settings' })}
        >
          ⚙ Owner 设置
        </button>
      </div>
    </nav>
  )
}

/** Hand over a new affair from the center. Creates the affair folder at once, then Owner drafts terms. */
function Compose({
  begin,
  intro,
  openSettings,
  legacy,
}: {
  begin: (id: string) => void
  intro: boolean
  openSettings: () => void
  legacy: () => void
}) {
  const [text, set] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const creating = useRef(false)
  const prefs = useOwnerPrefs((s) => s.prefs)
  const location = prefs?.saveLocation
  async function start() {
    const t = text.trim()
    if (!t || creating.current) return
    creating.current = true
    setSaving(true)
    setError('')
    const id = crypto.randomUUID()
    try {
      const created = acceptDirectory(
        await window.cclinkStudio.ownerDirectories.save(
          {
            id,
            title: t.slice(0, 60),
            goal: t.slice(0, 1500),
            sources: [],
            confirmed: false,
            updated: Date.now(),
            attempt: null,
            run: null,
            issue: '',
            method: null,
            result: null,
            research: freshResearch(),
          },
          0,
        ),
      )
      set('')
      begin(id)
      if (!created.directory?.error) void discuss(id, t)
    } catch (e) {
      // The draft stays in the box so nothing typed is lost.
      setError(String(e))
    } finally {
      creating.current = false
      setSaving(false)
    }
  }
  return (
    <div className="own-home-new">
      <h1>交给 Owner 一件事</h1>
      <p className="own-lead">
        Owner
        是这件事的负责人：先和你约定目标与交付物，再自己安排会话去查、用证据核对、交付成品。你只在需要决定时出面。
      </p>
      <div className="own-compose">
        <textarea
          autoFocus
          aria-label="交办一件新事务"
          value={text}
          maxLength={1500}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void start()
          }}
          placeholder="帮我调研开源芯片项目"
        />
        <div className="own-compose-bar">
          <small title={location?.path}>
            保存到　{location ? location.path + ' / ‹事务名›' : '读取中…'}
          </small>
          <button className="own-link" onClick={openSettings}>
            更改
          </button>
          <span className="own-flex" />
          <button className="own-primary" disabled={!text.trim() || saving} onClick={start}>
            {saving ? '正在建档…' : '交给 Owner'}
          </button>
        </div>
        {location?.error && (
          <p role="alert">
            保存位置不可用：{location.error}{' '}
            <button className="own-link" onClick={openSettings}>
              去 Owner 设置
            </button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      {intro && (
        <div className="own-three">
          <div>
            <b>
              <span className="own-num">1</span>先约定，确认一次
            </b>
            <p>Owner 把目标整理成范围、交付物、验收依据和时间限制。你确认后才开始派工。</p>
          </div>
          <div>
            <b>
              <span className="own-num">2</span>它推进，只在必要时找你
            </b>
            <p>查资料、补查、续用会话都由 Owner 决定。改约定、要你提供资料或授权时才停下来问。</p>
          </div>
          <div>
            <b>
              <span className="own-num">3</span>按证据交付
            </b>
            <p>成品写入磁盘、每条引用核对通过才算交付；点引用能回到原文那一行。</p>
          </div>
        </div>
      )}
      <p className="own-legacy-link">
        已有现成材料？
        <button className="own-link" onClick={legacy}>
          从已有材料做摘录
        </button>
      </p>
    </div>
  )
}

function List({
  items,
  active,
  filter,
  open,
  create,
}: {
  items: Affair[]
  active: ReadonlySet<string>
  filter: GroupKey | 'all'
  open: (id: string) => void
  create: () => void
}) {
  const groups = GROUPS.filter((g) => filter === 'all' || g.key === filter)
  return (
    <div className="own-home-list">
      <div className="own-row-head">
        <h1>{filter === 'all' ? '我的事务' : GROUPS.find((g) => g.key === filter)!.label}</h1>
        <span className="own-flex" />
        <button className="own-primary" onClick={create}>
          ＋ 交办新事务
        </button>
      </div>
      {groups.map((g) => {
        const list = items
          .filter((a) => groupOf(a, active.has(a.id)) === g.key)
          .sort((x, y) => y.updated - x.updated)
        if (!list.length)
          return filter === 'all' ? null : (
            <p key={g.key} className="own-empty">
              这一组现在没有事务。
            </p>
          )
        return (
          <section key={g.key}>
            <h3>
              {g.label}　<small>{list.length}</small>
            </h3>
            {list.map((a) => {
              const [, detail] = next(a, active.has(a.id))
              return (
                <button
                  className={'own-row' + (g.waits ? ' waits' : '')}
                  key={a.id}
                  onClick={() => open(a.id)}
                >
                  <b>{a.title.split(/[，。；！？]/u)[0] || a.title}</b>
                  <span className="own-row-state">{detail}</span>
                  <small>{rowMeta(a, active.has(a.id))}</small>
                  <em>
                    {relativeTime(a.updated)}
                    <br />
                    打开 ›
                  </em>
                </button>
              )
            })}
          </section>
        )
      })}
      <p className="own-hint">Owner 自己在补查不算等你；会话结束或仅有新消息也不产生待办。</p>
    </div>
  )
}

export function OwnerHome({
  items,
  active,
  view,
  setView,
  open,
  legacy,
}: {
  items: Affair[]
  active: ReadonlySet<string>
  view: HomeView
  setView: (v: HomeView) => void
  open: (id: string) => void
  legacy: () => void
}) {
  const load = useOwnerPrefs((s) => s.load)
  useEffect(() => {
    void load()
  }, [load, view.kind])
  const shown: HomeView = view.kind === 'list' && !items.length ? { kind: 'new' } : view
  return (
    <div className="own-detail own-home">
      <HomeNav items={items} active={active} view={shown} setView={setView} />
      <main className="own-home-main">
        {shown.kind === 'settings' ? (
          <OwnerSettings />
        ) : shown.kind === 'new' ? (
          <Compose
            begin={open}
            intro={!items.length}
            openSettings={() => setView({ kind: 'settings' })}
            legacy={legacy}
          />
        ) : (
          <List
            items={items}
            active={active}
            filter={shown.filter}
            open={open}
            create={() => setView({ kind: 'new' })}
          />
        )}
      </main>
    </div>
  )
}
