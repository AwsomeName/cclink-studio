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
  grantSkip,
  declineSkip,
} from './research-work'
import { citationPlace, freshResearch, isLocalKey, sourceLabel, webLimit } from './research-model'
import { OWNER_WEB_EXTRA } from '@shared/ipc/owner-web'
import { OwnerSidebar } from './owner-sidebar'
import { OwnerDocument } from './owner-document'
import { CopyOwnerDiagnostics } from './owner-diagnostics-button'
import {
  AgreementCard,
  AuthorizationCard,
  DeliveryCard,
  RosterCard,
  SessionsCard,
  SkippedCard,
  StatusChips,
  StepsCard,
  WebEvidenceCard,
} from './owner-board'
import { DEFAULT_AGENT_RUNTIME_BINDING } from '@shared/agent-runtime'
import { affairSteps, authorization, pendingCount, runtimeName } from './affair-plan'
import { currentWorker } from './owner-status'
import { BOARD, ownerView, tabKey, tabTitle, useOwnerView } from './owner-view-store'
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
function useSourceGrantCount(id: string, enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const refresh = () =>
      window.cclinkStudio.ownerSources
        .list(id)
        .then((g) => live && setCount(g.filter((x) => !x.error).length))
        .catch(() => {})
    void refresh()
    const timer = setInterval(refresh, 4000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [id, enabled])
  return count
}
export function ResearchView({ a, back }: { a: Affair; back: () => void }) {
  const r = a.research!,
    [text, set] = useState(''),
    [notice, setNotice] = useState(''),
    active = useSyncExternalStore(subscribeWork, () => !interrupted(a.id)),
    questionId = useSyncExternalStore(subscribeWork, () => activeQuestion(a.id)),
    bottom = useRef<HTMLDivElement>(null)
  const draftVersion = useRef<number | undefined>(undefined)
  const revision = a.directory?.revision
  const view = useOwnerView((s) => ownerView(s, a.id))
  const activeDoc = view.tabs.find((t) => tabKey(t) === view.active)
  const { open: openTab, close: closeTab, activate } = useOwnerView.getState()
  const [label, detail] = next(a, active)
  const title =
    a.title === a.goal.slice(0, 60) ? a.title.split(/[，。；！？]/u)[0] || a.title : a.title
  const waitingForReentry = label === '待恢复'
  const ready = !active && !a.confirmed && r.phase === 'ready' && !!r.plan
  const workerKey = currentWorker(a)
  const workerRun = useAgentStore((s) => s.conversations[session(a, workerKey)]?.activeRunId)
  const workerLoading = useAgentStore((s) => s.conversations[session(a, workerKey)]?.loading)
  const sourceGrants = useSourceGrantCount(a.id, !!a.directory && !a.directory.error)
  const perms = useAgentStore((s) => s.pendingConfirmations)
  // A conversation without an explicit binding runs on Studio's default runtime.
  const ownerRuntime = useAgentStore((s) => {
    const c = s.conversations[session(a, 'main')]
    return c ? (c.runtimeBinding ?? DEFAULT_AGENT_RUNTIME_BINDING).kind : undefined
  })
  const mine = perms.filter((p) => !!p.conversationId?.startsWith('owner-' + a.id + '-'))
  const canConfirm = ready && !a.directory?.error
  const resumable = (r.phase === 'error' || waitingForReentry) && !a.directory?.error && !active
  const needsRecovery = !!a.directory?.error || resumable
  const needsUpgrade =
    !!a.directory &&
    !a.directory.error &&
    (!a.directory.files.includes('调度.md') || !a.directory.files.includes('事务配置.md'))
  const waiting = pendingCount(a, canConfirm, mine.length, needsRecovery ? 1 : 0)
  const steps = affairSteps(a, {
    ownerRuntime: runtimeName(ownerRuntime),
    active,
    workerRun: active && r.phase === 'reading' ? (workerRun ?? undefined) : undefined,
  })
  const tiers = authorization(a).caps
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [r.chat.length, questionId])
  const chatBusy = a.confirmed ? !!questionId : active
  function openFile(name: string, line?: number) {
    openTab(a.id, { kind: 'affair', name, line })
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
      <OwnerSidebar a={a} title={title} back={back} notify={setNotice} />
      <main className="own-center">
        <div className="own-tabs" role="tablist" aria-label="Owner 中间标签">
          <button
            role="tab"
            aria-selected={view.active === BOARD}
            className={view.active === BOARD ? 'active' : ''}
            onClick={() => activate(a.id, BOARD)}
          >
            ▤ 事务进度
          </button>
          {view.tabs.map((t) => {
            const key = tabKey(t)
            return (
              <span key={key} className={'own-tab' + (view.active === key ? ' active' : '')}>
                <button
                  role="tab"
                  aria-selected={view.active === key}
                  title={t.kind === 'affair' ? t.name : t.label + '/' + t.rel}
                  onClick={() => activate(a.id, key)}
                >
                  {tabTitle(t)}
                </button>
                <button
                  className="own-tab-x"
                  aria-label={'关闭 ' + tabTitle(t)}
                  onClick={() => closeTab(a.id, key)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
        {activeDoc && <OwnerDocument a={a} tab={activeDoc} key={tabKey(activeDoc)} />}
        <article
          hidden={!!activeDoc}
          data-owner-phase={a.directory?.error ? 'pending-save' : r.phase}
          data-owner-id={a.id}
        >
          <small className="own-crumb">Owner　›　{title}</small>
          <div className="own-title-row">
            <h1>{title}</h1>
            <span className="own-flex" />
            <CopyOwnerDiagnostics a={a} active={active} workerLoading={!!workerLoading} />
          </div>
          {a.directory?.error && <p role="alert">{a.directory.error} </p>}
          <StatusChips a={a} active={active} workerLoading={!!workerLoading} />
          {waiting > 0 && (
            <p className="own-pointer" role="status">
              有 {waiting} 件事等你，在右侧事务官对话里处理 <span aria-hidden>→</span>
            </p>
          )}
          {['待保存', '需要处理', '待恢复'].includes(label) && (
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
                      (r.phase === 'reading'
                        ? '取证中 · 已取得 ' + r.docs.length + ' 份原文'
                        : detail)}
              </h2>
            </div>
          )}
          {!a.confirmed && (
            <>
              <AgreementCard a={a} sourceGrants={sourceGrants} />
              <AuthorizationCard a={a} />
              <RosterCard steps={steps} />
            </>
          )}
          <StepsCard steps={steps} />
          <WebEvidenceCard a={a} />
          <SessionsCard a={a} running={workerLoading ? workerKey : undefined} />
          <DeliveryCard
            a={a}
            openReport={() => openFile(a.directory!.reportFile!)}
            reveal={() =>
              void window.cclinkStudio.ownerDirectories
                .reveal(a.id)
                .catch((e) => setNotice(String(e)))
            }
          />
          {r.report && !a.directory?.error && (
            <section>
              <h3>调研简报</h3>
              <ConversationMarkdown source={r.report.conclusion} />
              {r.report.items.map((it, i) => (
                <div key={i}>
                  <h3>{sourceLabel(r.plan, it.repo, r.files)}</h3>
                  <p>{it.finding}</p>
                  <blockquote>{it.quote}</blockquote>
                  <small>{citationPlace(r, it)}</small>
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
                            sourceLabel(r.plan, v.repo, r.files) +
                            '\n\n' +
                            v.finding +
                            '\n\n> ' +
                            v.quote +
                            '\n\n' +
                            citationPlace(r, v),
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
          {a.confirmed && (
            <details className="own-more">
              <summary>已确认的约定、授权与分工</summary>
              <AgreementCard a={a} sourceGrants={sourceGrants} />
              <AuthorizationCard a={a} />
              <RosterCard steps={steps} />
            </details>
          )}
          {!!r.decisions?.length && (
            <details className="own-more">
              <summary>Owner 的全部判断 · {r.decisions.length}</summary>
              {r.decisions.map((d, i) => (
                <div key={i} className={'own-decision ' + d.kind}>
                  <b>
                    {d.kind === 'read'
                      ? '首次委派'
                      : d.kind === 'more'
                        ? '续用 A 补查'
                        : '可以交付'}
                  </b>
                  <p>{d.reason}</p>
                </div>
              ))}
            </details>
          )}
          {r.log.length > 0 && (
            <details className="own-more">
              <summary>执行记录 · {r.log.length}</summary>
              <ol className="own-progress">
                {r.log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </details>
          )}
          {r.docs.length > 0 && (
            <details className="own-more">
              <summary>已获得的来源 · {r.docs.length}</summary>
              {r.docs.map((d, i) => (
                <details key={i}>
                  <summary>
                    {sourceLabel(r.plan, d.repo, r.files)} · {d.path ?? 'README'}
                  </summary>
                  {!isLocalKey(d.repo) && <p>{d.url}</p>}
                  <small>
                    读取于 {new Date(d.at).toLocaleString()} ·{' '}
                    {isLocalKey(d.repo) ? 'SHA-256 ' : '内容版本 '}
                    {d.sha.slice(0, 10)}
                  </small>
                  <pre>{d.text}</pre>
                </details>
              ))}
            </details>
          )}
        </article>
      </main>
      <aside data-owner-officer>
        <div className="own-officer-head">
          <h2>事务官</h2>
          <span className={'own-st ' + (waiting ? 'wait' : 'done')} data-owner-waiting={waiting}>
            {waiting ? '等你 ' + waiting : '无待办'}
          </span>
        </div>
        <small>当前事务 · {title} · 你说的话会写进事务文件</small>
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
        {mine.map((p) => (
          <div key={p.id} className="own-perm" data-owner-permission={p.toolName}>
            <b>
              {p.toolName === 'owner_read_local_file'
                ? 'Owner 想读取一个不在参考目录中的文件'
                : p.toolName === 'owner_web_more'
                  ? '联网次数已用完（' + (r.web?.used ?? 0) + ' / ' + webLimit(r) + '）'
                  : p.toolName + ' · ' + p.riskLevel}
            </b>
            {p.toolName === 'owner_read_local_file' && (
              <small>只读、仅此文件、仅本事务；60 秒无回应将跳过，其余步骤继续。</small>
            )}
            {p.toolName === 'owner_web_more' ? (
              <small>
                追加 {OWNER_WEB_EXTRA} 次，仅本事务。60 秒无回应就停止联网，用已有资料继续。
              </small>
            ) : (
              p.summary.map((s, i) => (
                <p key={i}>
                  {s.label}：{s.value}
                </p>
              ))
            )}
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
                {p.toolName === 'owner_read_local_file'
                  ? v
                    ? '允许读取'
                    : '跳过'
                  : p.toolName === 'owner_web_more'
                    ? v
                      ? '追加 ' + OWNER_WEB_EXTRA + ' 次'
                      : '不追加'
                    : v
                      ? '仅允许这次'
                      : '拒绝'}
              </button>
            ))}
          </div>
        ))}
        {(needsRecovery || needsUpgrade) && (
          <div className="own-perm own-act" data-owner-recover>
            <b>
              {a.directory?.error
                ? r.report
                  ? '引文已核对，报告待保存'
                  : '事务文件待保存'
                : needsRecovery
                  ? waitingForReentry
                    ? '上次操作中断，未自动重派'
                    : '运行出错，等你决定怎么继续'
                  : '这件事务缺少配置与调度文档'}
            </b>
            {a.directory?.error && <small>{a.directory.error}</small>}
            <div className="own-card-actions">
              {a.directory?.error && (
                <button
                  className="own-primary"
                  onClick={() => void retryDirectory(a.id).catch((e) => setNotice(String(e)))}
                >
                  重试保存文件
                </button>
              )}
              {a.directory?.error && hasDirectoryConflict(a.id) && (
                <button
                  onClick={() => void useSavedDirectory(a.id).catch((e) => setNotice(String(e)))}
                >
                  放弃本次未保存修改，载入目录版本
                </button>
              )}
              {resumable && (
                <button
                  className="own-primary"
                  onClick={() =>
                    void (a.confirmed
                      ? research(a.id)
                      : discuss(a.id, '请根据刚才的要求重新提出调研约定。'))
                  }
                >
                  {unfinishedWorker(r) ? '核对原委托并继续' : '从这里继续'}
                </button>
              )}
              {resumable && r.phase === 'error' && unfinishedWorker(r) && (
                <button onClick={() => void research(a.id, true)}>
                  结束等待，授权 Owner 重新取证
                </button>
              )}
              {needsUpgrade && (
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
              {needsRecovery && (
                <CopyOwnerDiagnostics a={a} active={active} workerLoading={!!workerLoading} />
              )}
            </div>
          </div>
        )}
        <SkippedCard
          a={a}
          busy={active}
          grant={(skipId) => void grantSkip(a.id, skipId).catch((e) => setNotice(String(e)))}
          decline={(skipId) => void declineSkip(a.id, skipId).catch((e) => setNotice(String(e)))}
        />
        {canConfirm && (
          <div className="own-perm own-act" data-owner-confirm>
            <b>确认约定</b>
            <small>
              直接做 {tiers.filter((c) => c.tier === 'direct').length} 项 · 先问我{' '}
              {tiers.filter((c) => c.tier === 'ask').length} 项 · 不做{' '}
              {tiers.filter((c) => c.tier === 'never').length}{' '}
              项。确认即授权，约定内的步骤不再逐项问你。
            </small>
            <button
              className="own-primary"
              onClick={() => void confirmResearch(a).catch((e) => setNotice(String(e)))}
            >
              确认约定，开始
            </button>
          </div>
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
