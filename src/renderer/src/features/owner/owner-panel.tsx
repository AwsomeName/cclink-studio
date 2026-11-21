import { ResearchView } from './research-view'
import { OwnerHome, type HomeView } from './owner-home'
import { useOwnerPrefs, waitsForMe } from './owner-status'
import { activeWork, subscribeWork } from './research-work'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useOwners, loadDirectories } from './owner-store'
import { brief, next, verify, type Affair } from './affair'
import { dispatch, ensureSession, reconcile, session } from './owner-agent'
import { useAgentStore } from '../../stores/agent-store'
import { createConversationRunController as controller } from '../agent-conversations/conversation-run-controller'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import './owner.css'

function Inspector({ a, back }: { a: Affair; back: () => void }) {
  const save = useOwners((s) => s.save),
    [note, setNote] = useState(''),
    [prompt, setPrompt] = useState(''),
    [sending, setSending] = useState(false)
  const main = useAgentStore((s) => s.conversations[session(a, 'main')]),
    worker = useAgentStore((s) => s.conversations[session(a, 'a')]),
    permissions = useAgentStore((s) => s.pendingConfirmations)
  const [draft, setDraft] = useState(a.sources.map((s) => s.text)),
    [status, action] = next(a)
  const running = !!a.attempt || !!worker?.loading,
    locked = running || !!a.result
  const apply = (v: Affair) => {
    if (!save(v)) return
    if (
      v.confirmed &&
      !v.sources.some((s) => !s.text.trim()) &&
      v.method === 'agent' &&
      !v.attempt &&
      !v.result
    )
      void dispatch(v)
  }
  function localDeliver(v: Affair) {
    try {
      const result = verify(
        v,
        v.sources.map((s, i) => ({ index: i + 1, quote: s.text.trim().slice(0, 500) })),
      )
      save({ ...v, result, method: 'local', issue: '' })
    } catch (e) {
      setNote(String(e))
    }
  }
  const msgs = main?.messages.filter((m) => m.id !== 'welcome') ?? []
  async function send() {
    if (!prompt.trim() || sending || main?.loading) return
    setSending(true)
    try {
      const id = ensureSession(a, 'main'),
        r = await controller({ conversationId: id, getTabs: () => [] }).send(
          '你是这件事务的 Owner。回答用户的问题；不要声称已执行看板上未发生的动作。事务事实：' +
            JSON.stringify({
              title: a.title,
              goal: a.goal,
              state: next(a),
              sources: a.sources.map((s) => ({ name: s.name, received: !!s.text })),
              report: brief(a),
            }) +
            '\n用户：' +
            prompt.trim(),
        )
      if (r.status === 'accepted') setPrompt('')
      else setNote(r.status === 'failed' ? r.error : r.status)
    } catch (e) {
      setNote(String(e))
    } finally {
      setSending(false)
    }
  }
  return (
    <>
      <article>
        <button onClick={back}>‹ 我的事务</button>
        <h1>{a.title}</h1>
        <p>{a.goal}</p>
        <div className="own-call">
          <small>{worker?.loading && a.attempt ? '进行中' : status}</small>
          <h2>{worker?.loading && a.attempt ? '执行会话 A 正在选取原文' : action}</h2>
        </div>
        <h3>交付条件</h3>
        <p>每份材料各选一条摘录，保留来源名。逐字匹配原文后生成简报。</p>
        {!a.confirmed && (
          <div className="own-actions">
            <button
              className="own-primary"
              onClick={() => apply({ ...a, confirmed: true, method: 'agent' })}
            >
              确认交办 · 由 A 选摘
            </button>
            <button onClick={() => apply({ ...a, confirmed: true, method: 'local' })}>
              仅在本机汇编摘录
            </button>
          </div>
        )}
        <small>
          {a.method === 'local'
            ? '本机汇编使用每份材料的开头（最多 500 字），不会调用 Agent。'
            : '由 A 选摘：补齐后提交给当前配置的 Studio Agent；沿用其运行权限。'}
        </small>
        {a.attempt && worker?.loading && (
          <button
            onClick={async () => {
              const r = await controller({ conversationId: session(a, 'a') }).abort()
              if (r.status === 'failed') setNote(r.error)
            }}
          >
            停止本次执行
          </button>
        )}
        <h3>所需材料</h3>
        {a.sources.map((s, i) => (
          <label className="own-source" key={i}>
            <b>
              {i + 1}. {s.name}
            </b>
            <small>{s.text ? '已保存' : '待提供'}</small>
            {a.confirmed && !locked ? (
              <>
                <textarea
                  aria-label={s.name}
                  value={draft[i]}
                  maxLength={4000}
                  placeholder="粘贴允许用于本次简报的原文"
                  onChange={(e) => setDraft(draft.map((v, j) => (i === j ? e.target.value : v)))}
                />
                <small>也可导入 TXT / Markdown · 最多 4,000 字</small>
                <input
                  type="file"
                  aria-label={'导入 ' + s.name}
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  onChange={async (e) => {
                    const f = e.currentTarget.files?.[0]
                    e.currentTarget.value = ''
                    if (!f) return
                    try {
                      if (f.size > 16000 || !/[.](txt|md|markdown)$/i.test(f.name))
                        throw Error('请选择不超过 16 KB 的纯文本或 Markdown 文件。')
                      const text = new TextDecoder('utf-8', { fatal: true }).decode(
                        await f.arrayBuffer(),
                      )
                      if (!text.trim() || text.length > 4000 || text.includes('\0'))
                        throw Error('需要 1 至 4,000 字的 UTF-8 原文；请选取相关段落。')
                      setDraft((prev) => prev.map((v, j) => (j === i ? text : v)))
                      setNote('已载入 ' + f.name + '，请检查后保存材料。')
                    } catch (err) {
                      setNote(String(err))
                    }
                  }}
                />
              </>
            ) : s.text ? (
              <details>
                <summary>原文</summary>
                {s.text}
              </details>
            ) : null}
          </label>
        ))}
        {a.confirmed && !locked && (
          <div className="own-actions">
            <button
              className="own-primary"
              disabled={
                draft.every((v, i) => v === a.sources[i].text) &&
                !a.issue &&
                !(a.method === 'local' && a.sources.every((s) => s.text))
              }
              onClick={() => {
                const v = {
                  ...a,
                  issue: '',
                  sources: a.sources.map((s, i) => ({ ...s, text: draft[i].trim() })),
                }
                if (v.method === 'local' && v.sources.every((s) => s.text)) localDeliver(v)
                else apply(v)
              }}
            >
              {a.issue ? '重新核对并提交' : '保存材料并继续'}
            </button>
            {a.issue && a.sources.every((s) => s.text) && (
              <button onClick={() => localDeliver(a)}>改用已保存原文在本机汇编</button>
            )}
          </div>
        )}
        {(a.run || worker) && (
          <details>
            <summary>执行会话 A · {worker?.runStatus ?? '查询记录'}</summary>
            <p>
              {worker?.title}　{a.run}
            </p>
            {worker?.messages
              .filter((m) => m.id !== 'welcome')
              .map((m) => (
                <pre key={m.id}>
                  {m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')}
                </pre>
              ))}
          </details>
        )}
        {a.result && (
          <section>
            <h3>摘录简报</h3>
            <pre>{brief(a)}</pre>
            <button
              onClick={async () => {
                try {
                  const target = await window.cclinkStudio.dialog.showSaveDialog({
                    title: '导出摘录简报',
                    defaultPath: '摘录简报.md',
                    filters: [{ name: 'Markdown', extensions: ['md'] }],
                  })
                  if (target.canceled || !target.filePath) return
                  await window.cclinkStudio.fs.saveMarkdownDocumentAs({
                    targetPath: target.filePath,
                    content: brief(a),
                  })
                  setNote('已保存：' + target.filePath)
                } catch (e) {
                  setNote('导出失败：' + String(e))
                }
              }}
            >
              导出 Markdown
            </button>
          </section>
        )}
      </article>
      <aside>
        <h2>Owner 主对话</h2>
        <small>仅关联「{a.title}」</small>
        <div className="own-thread">
          <p className="own-sys">事务看板：{action}</p>
          {msgs.map((m) => (
            <div key={m.id}>
              <b>{m.role === 'user' ? '你' : m.role === 'assistant' ? 'Owner' : '运行提示'}</b>
              <p>
                {m.content
                  .flatMap((b) => (b.type === 'text' ? [b.text] : []))
                  .join('\n')
                  .split('\n用户：')
                  .pop()}
              </p>
            </div>
          ))}
        </div>
        {permissions
          .filter(
            (r) => r.conversationId === session(a, 'main') || r.conversationId === session(a, 'a'),
          )
          .map((r) => (
            <div key={r.id}>
              <strong>工具请求 · {r.toolName}</strong>
              {r.summary.map((s, i) => (
                <p key={i}>
                  {s.label}：{s.value}
                </p>
              ))}
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  onClick={async () => {
                    try {
                      await window.cclinkStudio.agent.resolveToolConfirmation(r.id, v, false)
                      useAgentStore.getState().removePendingConfirmation(r.id)
                    } catch (e) {
                      setNote(String(e))
                    }
                  }}
                >
                  {v ? '仅允许这次' : '拒绝'}
                </button>
              ))}
            </div>
          ))}
        {note && <p role="alert">{note}</p>}
        <textarea
          aria-label="询问 Owner"
          maxLength={2000}
          placeholder="询问这件事务的 Owner…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          disabled={!prompt.trim() || sending || main?.loading}
          onClick={() => {
            void send()
          }}
        >
          {main?.loading ? 'Owner 正在回复' : '发送给 Owner'}
        </button>
      </aside>
    </>
  )
}
export function OwnerEntry({ open, toggle }: { open: boolean; toggle: () => void }) {
  const active = useSyncExternalStore(subscribeWork, activeWork)
  const showCount = useOwnerPrefs((s) => s.prefs?.reminders.topbarCount ?? true)
  const load = useOwnerPrefs((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  const count = useOwners((s) => s.items.filter((a) => waitsForMe(a, active.has(a.id))).length)
  return (
    <button
      className="app-topbar-open-project"
      onClick={toggle}
      aria-expanded={open}
      aria-controls="owner-board"
    >
      ◈ Owner{showCount && count ? ' · ' + count + ' 等你' : ''}
    </button>
  )
}
export function OwnerPanel({ open, close }: { open: boolean; close: () => void }) {
  const active = useSyncExternalStore(subscribeWork, activeWork)
  const [sel, setSel] = useState<string | null>(null),
    [create, setCreate] = useState(false),
    [view, setView] = useState<HomeView>({ kind: 'list', filter: 'all' }),
    [title, setTitle] = useState(''),
    [goal, setGoal] = useState(''),
    [names, setNames] = useState('')
  const items = useOwners((s) => s.items),
    error = useOwners((s) => s.error),
    save = useOwners((s) => s.save),
    selected = items.find((a) => a.id === sel)
  useEffect(() => {
    void loadDirectories()
  }, [])
  useFloatingSurfaceRegistration(open)
  useEffect(() => {
    if (!items.some((a) => a.attempt)) return
    let pending = false
    const handle = setInterval(async () => {
      if (pending) return
      pending = true
      try {
        for (const a of useOwners.getState().items) if (a.attempt) await reconcile(a)
      } finally {
        pending = false
      }
    }, 1200)
    return () => clearInterval(handle)
  }, [items])
  useEffect(() => {
    if (!open) {
      setSel(null)
      setCreate(false)
      setView({ kind: 'list', filter: 'all' })
    }
  }, [open])
  if (!open) return null
  return (
    <section id="owner-board" className="owner-dialog" aria-label="Owner 事务面板">
      <header>
        <b>◈　Owner</b>
        <span>
          {selected
            ? '我的事务 › ' + (selected.title.split(/[，。；！？]/u)[0] || selected.title)
            : view.kind === 'settings'
              ? 'Owner 设置'
              : '我的事务'}
        </span>
        <button onClick={close}>返回工作台</button>
      </header>
      {error && <p role="alert">{error}</p>}
      {open &&
        (selected ? (
          <div className={selected.research ? 'own-detail own-work' : 'own-detail'}>
            {selected.research ? (
              <ResearchView a={selected} key={selected.id} back={() => setSel(null)} />
            ) : (
              <Inspector a={selected} key={selected.id} back={() => setSel(null)} />
            )}
          </div>
        ) : create ? (
          <div className="own-legacy">
            <article className="own-index">
              <small>OWNER　 /　 资料摘录</small>
              <h1>新建事务</h1>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const sourceNames = names
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                  if (
                    !sourceNames.length ||
                    sourceNames.length > 6 ||
                    new Set(sourceNames).size !== sourceNames.length ||
                    sourceNames.some((n) => n.length > 120)
                  ) {
                    const field = e.currentTarget.elements.namedItem(
                      'sources',
                    ) as HTMLTextAreaElement
                    field.setCustomValidity('请填写 1 到 6 个不同的材料名，每个不超过 120 字。')
                    field.reportValidity()
                    return
                  }
                  const id = crypto.randomUUID()
                  if (
                    save({
                      id,
                      title: title.trim(),
                      goal: goal.trim(),
                      sources: sourceNames.map((name) => ({ name, text: '' })),
                      confirmed: false,
                      attempt: null,
                      run: null,
                      issue: '',
                      result: null,
                      method: null,
                      updated: Date.now(),
                    })
                  ) {
                    setSel(id)
                    setCreate(false)
                    setTitle('')
                    setGoal('')
                    setNames('')
                  }
                }}
              >
                <label>
                  事务名称
                  <input
                    required
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：开源芯片资料摘录"
                  />
                </label>
                <label>
                  交办目标
                  <textarea
                    required
                    maxLength={1500}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="这份简报给谁看，需要摘出什么？"
                  />
                </label>
                <label>
                  所需材料 · 每行一份，最多六份，名称不能重复
                  <textarea
                    required
                    name="sources"
                    onInput={(e) => e.currentTarget.setCustomValidity('')}
                    maxLength={726}
                    value={names}
                    onChange={(e) => setNames(e.target.value)}
                    placeholder={'Ibex 流水线说明\nEarl Grey 系统框图说明'}
                  />
                </label>
                <button
                  className="own-primary"
                  disabled={!title.trim() || !goal.trim() || !names.trim()}
                >
                  创建交办草案
                </button>
                <button type="button" onClick={() => setCreate(false)}>
                  返回列表
                </button>
              </form>
            </article>
          </div>
        ) : (
          <OwnerHome
            items={items}
            active={active}
            view={view}
            setView={setView}
            open={(id) => {
              setSel(id)
              setView({ kind: 'list', filter: 'all' })
            }}
            legacy={() => setCreate(true)}
          />
        ))}
    </section>
  )
}
