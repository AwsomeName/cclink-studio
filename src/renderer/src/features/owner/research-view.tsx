import { useState, useSyncExternalStore, useRef, useEffect } from 'react'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useAgentStore } from '../../stores/agent-store'
import {
  acceptDirectory,
  retryDirectory,
  hasDirectoryConflict,
  useSavedDirectory,
} from './owner-store'
import {
  discuss,
  confirmResearch,
  research,
  interrupted,
  unfinishedWorker,
  subscribeWork,
  askOwner,
  activeQuestion,
} from './research-work'
import { freshResearch } from './research-model'
import { EvidencePreview, localReference, withLegacyAnchors } from './evidence-preview'
import { session } from './owner-agent'
import { next, type Affair } from './affair'
export function ResearchInbox({ begin }: { begin: (id: string) => void }) {
  const [text, set] = useState('')
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const creating = useRef(false)
  async function start() {
    const t = text.trim()
    if (!t || creating.current) return
    creating.current = true
    setSaving(true)
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
      begin(id)
      if (!created.directory?.error) void discuss(id, t)
    } catch (e) {
      setError(String(e))
    } finally {
      creating.current = false
      setSaving(false)
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
      <small>保存到「我的空间 / Owner 事务」</small>
      {error && <p role="alert">{error}</p>}
      <button className="own-primary" disabled={!text.trim() || saving} onClick={start}>
        发给 Owner
      </button>
    </aside>
  )
}
export function ResearchView({ a, back }: { a: Affair; back: () => void }) {
  const r = a.research!,
    [text, set] = useState(''),
    [notice, setNotice] = useState(''),
    [selection, setSelection] = useState<{ name: string; line?: number } | null>(null),
    [loaded, setLoaded] = useState<{ name: string; revision: number; content: string } | null>(
      null,
    ),
    active = useSyncExternalStore(subscribeWork, () => !interrupted(a.id)),
    questionId = useSyncExternalStore(subscribeWork, () => activeQuestion(a.id)),
    bottom = useRef<HTMLDivElement>(null)
  const draftVersion = useRef<number | undefined>(undefined)
  const revision = a.directory?.revision
  const saveError = a.directory?.error
  const preview =
    selection && loaded?.name === selection.name && loaded.revision === revision
      ? { ...selection, content: loaded.content }
      : null
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
  useEffect(() => {
    if (!selection || saveError || revision === undefined) return
    let active = true
    window.cclinkStudio.ownerDirectories
      .preview(a.id, selection.name)
      .then((content) => {
        if (active) setLoaded({ name: selection.name, revision, content })
      })
      .catch((e) => {
        if (active) {
          setLoaded(null)
          setNotice(String(e))
        }
      })
    return () => {
      active = false
    }
  }, [a.id, revision, saveError, selection])
  function openFile(name: string, line?: number) {
    setSelection({ name, line })
  }
  function send() {
    const t = text.trim()
    if (chatBusy || !t) return
    if (
      !a.confirmed &&
      /^(确认范围和交付物[，, ]*开始调研|确认[，, ]*开始调研)[。！! ]*$/.test(t)
    ) {
      if (!ready || draftVersion.current !== (revision ?? a.updated)) {
        setNotice('调研约定已更新，请查看当前范围和交付物，再点击确认。')
        return
      }
      set('')
      void confirmResearch(a).catch((e) => setNotice(String(e)))
      return
    }
    set('')
    void discuss(a.id, t)
  }
  return (
    <>
      <article
        data-owner-phase={a.directory?.error ? 'pending-save' : r.phase}
        data-owner-id={a.id}
      >
        <button onClick={back}>‹ 我的事务</button>
        <h1>{title}</h1>
        {a.directory && (
          <section>
            <button
              onClick={() =>
                void window.cclinkStudio.ownerDirectories
                  .reveal(a.id)
                  .catch((e) => setNotice(String(e)))
              }
            >
              打开事务目录
            </button>{' '}
            <small>{a.directory.path}</small>
            {a.directory.error && (
              <p role="alert">
                {a.directory.error}{' '}
                <button
                  onClick={() => void retryDirectory(a.id).catch((e) => setNotice(String(e)))}
                >
                  重试保存文件
                </button>
                {hasDirectoryConflict(a.id) && (
                  <button
                    onClick={() => void useSavedDirectory(a.id).catch((e) => setNotice(String(e)))}
                  >
                    放弃本次未保存修改，载入目录版本
                  </button>
                )}
              </p>
            )}
            {!a.directory.error && (
              <>
                {(!a.directory.files.includes('调度.md') ||
                  !a.directory.files.includes('事务配置.md')) && (
                  <button
                    onClick={() =>
                      void window.cclinkStudio.ownerDirectories
                        .upgrade(a.id, a.directory!.revision)
                        .then(acceptDirectory)
                        .catch((e) => setNotice(String(e)))
                    }
                  >
                    补齐配置与调度文档
                  </button>
                )}
                <details>
                  <summary>事务文件 · {a.directory.files.length}</summary>
                  {a.directory.files.map((name) => (
                    <p key={name}>
                      <button onClick={() => void openFile(name)}>{name}</button>
                    </p>
                  ))}
                </details>
                {a.directory.reportFile && (
                  <button
                    className="own-primary"
                    onClick={() => void openFile(a.directory!.reportFile!)}
                  >
                    打开交付物
                  </button>
                )}
              </>
            )}
            {preview && !a.directory.error && (
              <section>
                <h3>{preview.name}</h3>
                <button
                  onClick={() => {
                    setSelection(null)
                    setLoaded(null)
                  }}
                >
                  关闭预览
                </button>
                {preview.name.startsWith('资料/') && a.directory.reportFile && (
                  <button onClick={() => void openFile(a.directory!.reportFile!)}>返回报告</button>
                )}
                {preview.name.startsWith('资料/') ? (
                  <EvidencePreview content={preview.content} line={preview.line} />
                ) : (
                  <ConversationMarkdown
                    source={withLegacyAnchors(preview.content)}
                    resolveLocalLink={(href) => {
                      const target = localReference(preview.name, href, a.directory!.files)
                      return target ? () => void openFile(target.name, target.line) : undefined
                    }}
                  />
                )}
              </section>
            )}
          </section>
        )}
        <div className="own-call">
          <small>{label}</small>
          <h2>
            {a.directory?.error
              ? r.report
                ? '引文已核对，报告待保存'
                : '事务文件待保存'
              : waitingForReentry
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
                    ? a.directory?.error
                      ? '报告待保存'
                      : '可以交付'
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
        {r.report && !a.directory?.error && (
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
            {r.plan.timing && (
              <p>
                <b>时间约定　</b>
                {r.plan.timing}
              </p>
            )}
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
        {(r.phase === 'error' || waitingForReentry) && !a.directory?.error && !active && (
          <button
            onClick={() =>
              void (a.confirmed
                ? research(a.id)
                : discuss(a.id, '请根据刚才的要求重新提出调研约定。'))
            }
          >
            {unfinishedWorker(r) ? '核对原委托并继续' : '从这里继续'}
          </button>
        )}
        {r.phase === 'error' && !a.directory?.error && !active && unfinishedWorker(r) && (
          <button onClick={() => void research(a.id, true)}>结束等待，授权 Owner 重新取证</button>
        )}
      </article>
      <aside>
        <h2>Owner 主对话</h2>
        <small>当前事务 · {title}</small>
        {a.directory?.error && <strong role="status">待保存 · 请在看板重试保存文件</strong>}
        <div className="own-thread">
          {r.chat.map((m, i) => (
            <div key={m.questionId ?? i}>
              <b>{m.who}</b>
              <p>
                {m.who === 'Owner' && m.text === r.report?.conclusion
                  ? a.directory?.error
                    ? '引文已核对。原报告待保存，重试时会直接写入这份报告。'
                    : '调研简报已放在中间看板。已核对 ' +
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
        {ready && !a.directory?.error && (
          <button
            className="own-primary"
            onClick={() => void confirmResearch(a).catch((e) => setNotice(String(e)))}
          >
            确认范围和交付物，开始调研
          </button>
        )}
        {notice && <p role="status">{notice}</p>}
        <textarea
          aria-label="和 Owner 沟通"
          value={text}
          maxLength={1500}
          onChange={(e) => {
            if (!text.trim()) draftVersion.current = revision ?? a.updated
            set(e.target.value)
          }}
          placeholder={
            a.confirmed ? '问 Owner 当前进展或补查原因…' : '调整对象、比较维度或交付形式…'
          }
        />
        <button disabled={chatBusy || !!a.directory?.error || !text.trim()} onClick={send}>
          {chatBusy ? '等待 Owner 答复' : '发送给 Owner'}
        </button>
      </aside>
    </>
  )
}
