import { useState, useSyncExternalStore, useRef, useEffect } from 'react'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useAgentStore } from '../../stores/agent-store'
import { useOwners } from './owner-store'
import {
  discuss,
  research,
  interrupted,
  subscribeWork,
  askOwner,
  activeQuestion,
} from './research-work'
import { freshResearch } from './research-model'
import { session } from './owner-agent'
import { next, type Affair } from './affair'
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
      <p>告诉我你想弄清什么、最后想拿到什么。我来选项目、派会话取证，并核对结果。</p>
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
    questionId = useSyncExternalStore(subscribeWork, () => activeQuestion(a.id)),
    bottom = useRef<HTMLDivElement>(null)
  const [label, detail] = next(a, active)
  const title =
    a.title === a.goal.slice(0, 60) ? a.title.split(/[，。；！？]/u)[0] || a.title : a.title
  const waitingForReentry = label === '待恢复'
  const ready = !active && !a.confirmed && r.phase === 'ready' && !!r.plan
  const workerRun = useAgentStore((s) => s.conversations[session(a, 'a')]?.activeRunId)
  const perms = useAgentStore((s) => s.pendingConfirmations)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [r.chat.length, questionId])
  const chatBusy = a.confirmed ? !!questionId : active
  function send() {
    const t = text.trim()
    if (chatBusy || !t) return
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
        <h1>{title}</h1>
        <div className="own-call">
          <small>{label}</small>
          <h2>
            {waitingForReentry
              ? '上次操作中断，未自动重派'
              : a.issue ||
                (r.phase === 'reading' ? '取证中 · 已取得 ' + r.docs.length + ' 份原文' : detail)}
          </h2>
        </div>
        {!!r.decisions?.length && (
          <section className="own-decisions">
            <h3>Owner 的判断</h3>
            {active && r.phase === 'reading' && workerRun && (
              <small data-owner-worker-run={workerRun}>执行会话 A 正在选取本轮资料</small>
            )}
            {r.decisions.slice(-1).map((d, i) => (
              <div key={i} className={'own-decision ' + d.kind}>
                <b>
                  {d.kind === 'deliver'
                    ? '可以交付'
                    : d.kind === 'more'
                      ? '续用 A 补查'
                      : '委派会话 A'}
                </b>
                <p>{d.reason}</p>
              </div>
            ))}
            {r.decisions.length > 1 && (
              <details>
                <summary>之前的 {r.decisions.length - 1} 次判断</summary>
                {r.decisions.slice(0, -1).map((d, i) => (
                  <p key={i}>
                    <b>{d.kind === 'read' ? '首次委派' : '续用 A 补查'}</b>　{d.reason}
                  </p>
                ))}
              </details>
            )}
          </section>
        )}
        {r.report && (
          <section>
            <h3>调研简报</h3>
            <ConversationMarkdown source={r.report.conclusion} />
            {r.report.items.map((it, i) => (
              <div key={i}>
                <h3>{it.repo}</h3>
                <p>{it.finding}</p>
                <blockquote>{it.quote}</blockquote>
                <small>
                  {it.url ?? r.docs.find((d) => d.repo === it.repo)?.url}
                  {it.line ? '#L' + it.line : ''}
                </small>
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
                          (v.url ?? r.docs.find((d) => d.repo === v.repo)?.url) +
                          (v.line ? '#L' + v.line : ''),
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
              <b>Owner 选取的项目　</b>
              {r.plan.repos.join('、')}
            </p>
            <small>Owner 可根据证据缺口检索项目仓库中的文档、示例和源码。</small>
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
            {r.docs.map((d, i) => (
              <details key={i}>
                <summary>
                  {d.repo} · {d.path ?? 'README'}
                </summary>
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
        <small>当前事务 · {title}</small>
        <div className="own-thread">
          {r.chat.map((m, i) => (
            <div key={m.questionId ?? i}>
              <b>{m.who}</b>
              <p>
                {m.who === 'Owner' && m.text === r.report?.conclusion
                  ? '调研简报已放在中间看板。已核对 ' +
                    r.report.items.length +
                    ' 条引文，可展开之前的判断回看补查原因。'
                  : m.text}
              </p>
              {m.questionId &&
                (m.answer ? (
                  <div className="own-answer">
                    <b>Owner</b>
                    <p>{m.answer}</p>
                  </div>
                ) : m.questionId === questionId ? (
                  <small role="status">已收到，等待 Owner 主会话答复…</small>
                ) : (
                  <div>
                    <small>{m.answerError || '上次提问尚未取得答复。'}</small>
                    <button
                      disabled={!!questionId}
                      onClick={() => void askOwner(a.id, m.text, m.questionId)}
                    >
                      重新询问
                    </button>
                  </div>
                ))}
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
          placeholder={
            a.confirmed ? '问 Owner 当前进展或补查原因…' : '调整对象、比较维度或交付形式…'
          }
        />
        <button disabled={chatBusy || !text.trim()} onClick={send}>
          {chatBusy ? '等待 Owner 答复' : '发送给 Owner'}
        </button>
      </aside>
    </>
  )
}
