import { useState, useSyncExternalStore, useRef, useEffect } from 'react'
import { useAgentStore } from '../../stores/agent-store'
import { useOwners } from './owner-store'
import { discuss, research, interrupted, subscribeWork } from './research-work'
import { freshResearch, researchStatus } from './research-model'
import { session } from './owner-agent'
import type { Affair } from './affair'
export function ResearchInbox({ begin }: { begin: (id: string) => void }) {
  const [text, set] = useState('')
  function start() {
    const t = text.trim()
    if (!t) return
    const id = crypto.randomUUID()
    if (
      useOwners.getState().save({
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
      })
    ) {
      begin(id)
      void discuss(id, t)
    }
  }
  return (
    <aside className="own-start">
      <h2>Owner 主对话</h2>
      <p>想让我调研什么？我会先和你确定范围和交付物，再派会话查公开仓库。</p>
      <label>
        交办一件新事务
        <textarea
          autoFocus
          value={text}
          maxLength={1500}
          onChange={(e) => set(e.target.value)}
          placeholder="帮我调研开源芯片项目"
        />
      </label>
      <button className="own-primary" disabled={!text.trim()} onClick={start}>
        发给 Owner
      </button>
    </aside>
  )
}
export function ResearchView({ a, back }: { a: Affair; back: () => void }) {
  const r = a.research!,
    [text, set] = useState(''),
    [notice, setNotice] = useState(''),
    active = useSyncExternalStore(subscribeWork, () => !interrupted(a.id)),
    bottom = useRef<HTMLDivElement>(null)
  const [label, detail] = researchStatus(r)
  const waitingForReentry =
    !active && ['planning', 'reading', 'writing', 'checking'].includes(r.phase)
  const ready = !active && !a.confirmed && r.phase === 'ready' && !!r.plan
  const perms = useAgentStore((s) => s.pendingConfirmations)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [r.chat.length])
  function send() {
    const t = text.trim()
    if (active || !t) return
    set('')
    if (
      ready &&
      /^(确认|同意|可以|好的)[，,。！!\s]*(开始调研|按这个范围开始|开始)?[。！!\s]*$/.test(t)
    ) {
      void research(a.id)
      return
    }
    void discuss(a.id, t)
  }
  return (
    <>
      <article>
        <button onClick={back}>‹ 我的事务</button>
        <h1>{a.title}</h1>
        <div className="own-call">
          <small>{waitingForReentry ? '待恢复' : label}</small>
          <h2>{waitingForReentry ? '上次操作中断，未自动重派' : a.issue || detail}</h2>
        </div>
        {r.report && (
          <section>
            <h3>调研简报</h3>
            <p>{r.report.conclusion}</p>
            {r.report.items.map((it) => (
              <div key={it.repo}>
                <h3>{it.repo}</h3>
                <p>{it.finding}</p>
                <blockquote>{it.quote}</blockquote>
              </div>
            ))}
            <button
              onClick={async () => {
                try {
                  const target = await window.cclinkStudio.dialog.showSaveDialog({
                    title: '导出调研简报',
                    defaultPath: '开源项目调研.md',
                    filters: [{ name: 'Markdown', extensions: ['md'] }],
                  })
                  if (!target.filePath || target.canceled) return
                  await window.cclinkStudio.fs.saveMarkdownDocumentAs({
                    targetPath: target.filePath,
                    content: [
                      '# ' + a.title,
                      r.report!.conclusion,
                      ...r.report!.items.map(
                        (v) =>
                          '## ' +
                          v.repo +
                          '\n\n' +
                          v.finding +
                          '\n\n> ' +
                          v.quote +
                          '\n\n' +
                          r.docs.find((d) => d.repo === v.repo)?.url,
                      ),
                    ].join('\n\n'),
                  })
                  setNotice('已导出简报')
                } catch (e) {
                  setNotice(String(e))
                }
              }}
            >
              导出 Markdown
            </button>
          </section>
        )}
        <h3>{a.confirmed ? '已确认的调研约定' : '调研约定'}</h3>
        {r.plan ? (
          <>
            <p>
              <b>范围　</b>
              {r.plan.scope}
            </p>
            <p>
              <b>交付　</b>
              {r.plan.output}
            </p>
            <p>
              <b>官方仓库　</b>
              {r.plan.repos.join('、')}
            </p>
            <small>
              资料入口：公开 GitHub README。比较依据是读取到的原文，不包含安装或仿真结果。
            </small>
          </>
        ) : (
          <p>等 Owner 把你的要求整理成范围和交付物。</p>
        )}
        {r.log.length > 0 && (
          <section>
            <h3>执行进展</h3>
            <ol className="own-progress">
              {r.log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          </section>
        )}
        {r.docs.length > 0 && (
          <section>
            <h3>已获得的来源</h3>
            {r.docs.map((d) => (
              <details key={d.repo}>
                <summary>{d.repo} · README</summary>
                <p>{d.url}</p>
                <small>
                  读取于 {new Date(d.at).toLocaleString()} · 内容版本 {d.sha.slice(0, 10)}
                </small>
                <pre>{d.text}</pre>
              </details>
            ))}
          </section>
        )}
        {(r.phase === 'error' || waitingForReentry) && !active && (
          <button
            onClick={() =>
              void (a.confirmed
                ? research(a.id)
                : discuss(a.id, '请根据刚才的要求重新提出调研约定。'))
            }
          >
            从这里继续
          </button>
        )}
      </article>
      <aside>
        <h2>Owner 主对话</h2>
        <small>当前事务 · {a.title}</small>
        <div className="own-thread">
          {r.chat.map((m, i) => (
            <div key={i}>
              <b>{m.who}</b>
              <p>{m.text}</p>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        {perms
          .filter(
            (p) => p.conversationId === session(a, 'main') || p.conversationId === session(a, 'a'),
          )
          .map((p) => (
            <div key={p.id}>
              <b>
                {p.toolName} · {p.riskLevel}
              </b>
              {p.summary.map((s, i) => (
                <p key={i}>
                  {s.label}：{s.value}
                </p>
              ))}
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  onClick={async () => {
                    try {
                      await window.cclinkStudio.agent.resolveToolConfirmation(p.id, v, false)
                      useAgentStore.getState().removePendingConfirmation(p.id)
                    } catch (e) {
                      setNotice(String(e))
                    }
                  }}
                >
                  {v ? '仅允许这次' : '拒绝'}
                </button>
              ))}
            </div>
          ))}
        {ready && (
          <button className="own-primary" onClick={() => void research(a.id)}>
            确认范围和交付物，开始调研
          </button>
        )}
        {notice && <p role="status">{notice}</p>}
        <textarea
          aria-label="和 Owner 沟通"
          value={text}
          maxLength={1500}
          onChange={(e) => set(e.target.value)}
          placeholder={a.confirmed ? '询问本次调研…' : '调整对象、比较维度或交付形式…'}
        />
        <button disabled={active || !text.trim()} onClick={send}>
          {active ? '正在处理这件事务' : '发送给 Owner'}
        </button>
      </aside>
    </>
  )
}
