import { useMemo, useState } from 'react'
import type { WebAffair, WebAffairNode } from '@shared/web-affairs/web-affair-types'
import type { WebResourceSnapshot } from '@shared/web-resources/web-resource-types'
import { useAgentStore, useWorkspaceStore } from '../../stores'
import { useUIStore } from '../../stores/ui-store'
import { createConversationRunController } from '../agent-conversations/conversation-run-controller'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'

export function WebAffairNodeActions({
  affair,
  node,
  resources,
  onChanged,
  onError,
}: {
  affair: WebAffair
  node: WebAffairNode
  resources: WebResourceSnapshot
  onChanged: (affair: WebAffair) => void
  onError: (message: string | null) => void
}): React.ReactElement {
  const activeWorkspaceRef = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const workspaceRef = affair.workspaceRef ?? activeWorkspaceRef
  const [busy, setBusy] = useState(false)
  const [preflight, setPreflight] = useState(false)
  const [loginConfirmed, setLoginConfirmed] = useState(false)
  const [note, setNote] = useState('')
  const [nextCheckAt, setNextCheckAt] = useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString().slice(0, 16),
  )

  const attempts = affair.attempts.filter((item) => item.nodeId === node.id)
  const attempt = attempts[attempts.length - 1]
  const waitPlan = affair.waitPlans.find((item) => item.nodeId === node.id)
  const account = resources.accounts.find((item) => node.accountIds.includes(item.id))
  const website = resources.websites.find((item) => item.id === account?.websiteId)
  const principal = resources.principals.find((item) => item.id === affair.principalId)
  const pendingProposals = affair.flowProposals.filter((item) => item.status === 'pending')
  const isDueCheck =
    node.status === 'waiting-external' &&
    Boolean(waitPlan && (waitPlan.status === 'due' || waitPlan.status === 'missed'))
  const materialNames = affair.materials
    .filter((item) => node.materialIds.includes(item.id))
    .map((item) => item.name)
  const accountReadyToStart =
    (node.status === 'ready' || node.status === 'failed' || isDueCheck) &&
    Boolean(account && website && principal)
  const canStart = accountReadyToStart
  const isAttemptActive =
    attempt &&
    !['waiting-external', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(
      attempt.status,
    )

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    onError(null)
    try {
      await operation()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const startAi = async (): Promise<void> => {
    if (!account || !website || !principal || !loginConfirmed) return
    const started = await window.cclinkStudio.webAffairs.startAttempt({
      workspaceRef,
      affairId: affair.id,
      nodeId: node.id,
      accountId: account.id,
    })
    if (!started.success) throw new Error(started.error.message)
    const createdAttempt = started.data.attempts[started.data.attempts.length - 1]
    if (!createdAttempt) throw new Error('事务 Attempt 创建失败')
    onChanged(started.data)

    try {
      const agentStore = useAgentStore.getState()
      const conversationId = agentStore.createConversation({
        runtime: createConversationRuntimeForWorkspace(workspaceRef),
        activate: true,
      })
      useUIStore.getState().setAgentPanelMode('right', 'user')
      const result = await createConversationRunController({ conversationId }).send(
        buildAttemptPrompt(
          affair,
          node,
          createdAttempt.id,
          account.label,
          website.entryUrl,
          isDueCheck,
        ),
      )
      if (result.status !== 'accepted' || !result.runId) {
        throw new Error(result.status === 'failed' ? result.error : 'Agent 未接受事务节点')
      }
      const browserTask = await waitForConversationBrowserTask(conversationId, account.id)
      const bound = await window.cclinkStudio.webAffairs.bindAttempt({
        workspaceRef,
        affairId: affair.id,
        attemptId: createdAttempt.id,
        tabId: browserTask.tabId,
        conversationId,
        agentRunId: result.runId,
        browserTaskRunId: browserTask.id,
      })
      if (!bound.success) throw new Error(bound.error.message)
      onChanged(bound.data)
      setPreflight(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      const failed = await window.cclinkStudio.webAffairs.finishAttempt({
        workspaceRef,
        affairId: affair.id,
        attemptId: createdAttempt.id,
        outcome: 'failed',
        summary: `AI 启动失败：${message}`,
      })
      if (failed.success) onChanged(failed.data)
      throw new Error(message)
    }
  }

  const handoff = async (): Promise<void> => {
    if (!attempt) return
    if (attempt.browserTaskRunId)
      await window.cclinkStudio.browser.pauseTask(attempt.browserTaskRunId)
    const result = await window.cclinkStudio.webAffairs.handoffAttempt({
      workspaceRef,
      affairId: affair.id,
      attemptId: attempt.id,
      reason: note.trim() || '用户主动接管网页',
    })
    if (!result.success) throw new Error(result.error.message)
    onChanged(result.data)
    setNote('')
  }

  const returnToAi = async (): Promise<void> => {
    if (!attempt?.tabId || !attempt.conversationId) return
    const url = await window.cclinkStudio.browser.getCurrentURL(attempt.tabId)
    const observationSummary = note.trim()
    if (!observationSummary) throw new Error('请说明人工操作后的页面状态，AI 才能重新观察')
    const returned = await window.cclinkStudio.webAffairs.returnAttempt({
      workspaceRef,
      affairId: affair.id,
      attemptId: attempt.id,
      observationSummary,
      url,
    })
    if (!returned.success) throw new Error(returned.error.message)
    if (attempt.browserTaskRunId)
      await window.cclinkStudio.browser.resumeTask(attempt.browserTaskRunId)
    const send = await createConversationRunController({
      conversationId: attempt.conversationId,
    }).send(
      `用户已经完成接管操作。请重新读取当前 URL 和页面状态，不要沿用接管前假设。人工说明：${observationSummary}。验证后继续事务 ${affair.id} 的节点 ${node.id}；最终外部提交仍须停下等待产品级确认。`,
    )
    if (send.status === 'failed') throw new Error(send.error)
    onChanged(returned.data)
    setNote('')
  }

  const finishManually = async (outcome: 'succeeded' | 'failed'): Promise<void> => {
    if (!attempt) return
    const summary = note.trim()
    if (!summary) throw new Error('请填写可审计的结果说明')
    const url = attempt.tabId
      ? await window.cclinkStudio.browser.getCurrentURL(attempt.tabId).catch(() => undefined)
      : undefined
    if (outcome === 'succeeded' && node.catalogId === 'final-confirmation') {
      const confirmed = await window.cclinkStudio.webAffairs.confirmFinalAction({
        workspaceRef,
        affairId: affair.id,
        attemptId: attempt.id,
        summary: `用户已人工完成最终动作：${summary}`,
      })
      if (!confirmed.success) throw new Error(confirmed.error.message)
    }
    const result = await window.cclinkStudio.webAffairs.finishAttempt({
      workspaceRef,
      affairId: affair.id,
      attemptId: attempt.id,
      outcome,
      summary,
      url,
      evidenceKind: outcome === 'succeeded' ? 'page-result' : 'user-note',
    })
    if (!result.success) throw new Error(result.error.message)
    if (attempt.browserTaskRunId) {
      if (outcome === 'succeeded')
        await window.cclinkStudio.browser.finishTask(attempt.browserTaskRunId)
      else await window.cclinkStudio.browser.cancelTask(attempt.browserTaskRunId)
    }
    onChanged(result.data)
    setNote('')
  }

  const scheduleCheck = async (): Promise<void> => {
    const result = await window.cclinkStudio.webAffairs.scheduleCheck({
      workspaceRef,
      affairId: affair.id,
      nodeId: node.id,
      nextCheckAt: new Date(nextCheckAt).toISOString(),
      intervalMinutes: 24 * 60,
      maxIntervalMinutes: 7 * 24 * 60,
      maxChecks: 12,
    })
    if (!result.success) throw new Error(result.error.message)
    if (attempt?.browserTaskRunId) {
      await window.cclinkStudio.browser.finishTask(attempt.browserTaskRunId).catch(() => undefined)
    }
    onChanged(result.data)
  }

  const completeCheck = async (outcome: 'unchanged' | 'approved' | 'rejected'): Promise<void> => {
    if (!note.trim()) throw new Error('请填写官网显示的状态或官方原文摘要')
    const url = attempt?.tabId
      ? await window.cclinkStudio.browser.getCurrentURL(attempt.tabId).catch(() => undefined)
      : undefined
    const result = await window.cclinkStudio.webAffairs.completeCheck({
      workspaceRef,
      affairId: affair.id,
      nodeId: node.id,
      outcome,
      summary: note.trim(),
      url,
    })
    if (!result.success) throw new Error(result.error.message)
    if (attempt?.browserTaskRunId) {
      await window.cclinkStudio.browser.finishTask(attempt.browserTaskRunId).catch(() => undefined)
    }
    onChanged(result.data)
    setNote('')
  }

  const decideProposal = async (
    proposalId: string,
    decision: 'accept' | 'reject',
  ): Promise<void> => {
    const result = await window.cclinkStudio.webAffairs.decideFlowProposal({
      workspaceRef,
      affairId: affair.id,
      proposalId,
      decision,
    })
    if (!result.success) throw new Error(result.error.message)
    onChanged(result.data)
  }

  const attemptStatus = useMemo(() => attempt?.status.replaceAll('-', ' ') ?? '尚未创建', [attempt])

  return (
    <div className="web-affair-node-actions">
      <strong>执行与交接</strong>
      {attempt ? (
        <small>
          Attempt #{attempt.number} · {attemptStatus}
        </small>
      ) : null}

      {canStart && !isAttemptActive ? (
        preflight ? (
          <div className="web-affair-confirm-card">
            <h4>执行前账号核验</h4>
            <p>
              <b>主体：</b>
              {principal?.name ?? '失效'}
            </p>
            <p>
              <b>账号：</b>
              {account?.label}
            </p>
            <p>
              <b>入口：</b>
              {website?.entryUrl}
            </p>
            <label>
              <input
                type="checkbox"
                checked={loginConfirmed}
                onChange={(event) => setLoginConfirmed(event.target.checked)}
              />
              我已在“网站与账号”中核验当前账号的登录状态和业务主体
            </label>
            <div>
              <button type="button" onClick={() => setPreflight(false)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !loginConfirmed}
                onClick={() => void run(startAi)}
              >
                {busy ? '启动中…' : isDueCheck ? '确认并交给 AI 检查' : '确认并交给 AI'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="primary" onClick={() => setPreflight(true)}>
            {isDueCheck ? '开始复查' : '交给 AI'}
          </button>
        )
      ) : null}

      {isAttemptActive ? (
        <>
          <textarea
            rows={3}
            maxLength={2_000}
            placeholder="填写接管原因、人工操作后的页面状态、确认摘要或结果证据"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="web-affair-node-action-row">
            {attempt.status === 'waiting-human' ? (
              <button type="button" disabled={busy} onClick={() => void run(returnToAi)}>
                交还 AI 并重新观察
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void run(handoff)}>
                接管网页
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => finishManually('succeeded'))}
            >
              记录成功证据
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => finishManually('failed'))}
            >
              记录失败
            </button>
          </div>
          <small>提交、发布、支付、删除、签署等最终动作只能由用户在可见网页中完成。</small>
        </>
      ) : null}

      {node.type === 'wait-external' || node.status === 'waiting-external' || waitPlan ? (
        <div className="web-affair-wait-card">
          <h4>外部等待与重新检查</h4>
          {waitPlan ? (
            <p>
              {waitPlan.status} · 第 {waitPlan.checkCount}/{waitPlan.maxChecks} 次 · 下次{' '}
              {new Date(waitPlan.nextCheckAt).toLocaleString()}
            </p>
          ) : (
            <label>
              下次检查时间
              <input
                type="datetime-local"
                value={nextCheckAt}
                onChange={(event) => setNextCheckAt(event.target.value)}
              />
              <button type="button" disabled={busy} onClick={() => void run(scheduleCheck)}>
                进入等待
              </button>
            </label>
          )}
          {waitPlan && ['due', 'missed', 'exhausted'].includes(waitPlan.status) ? (
            <>
              <textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="官网状态或官方原文摘要"
              />
              <div className="web-affair-node-action-row">
                <button type="button" onClick={() => void run(() => completeCheck('unchanged'))}>
                  状态未变化
                </button>
                <button type="button" onClick={() => void run(() => completeCheck('approved'))}>
                  已通过
                </button>
                <button type="button" onClick={() => void run(() => completeCheck('rejected'))}>
                  被驳回并补正
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {pendingProposals.length > 0 ? (
        <div className="web-affair-proposals">
          <h4>待确认流程变更</h4>
          {pendingProposals.map((proposal) => (
            <div key={proposal.id}>
              <strong>{proposal.reason}</strong>
              <p>{proposal.impacts.join('；') || '仅新增非重大步骤'}</p>
              <small>
                {proposal.operations.length} 项变更 · 基于 v{proposal.baseVersion}
              </small>
              <div>
                <button
                  type="button"
                  onClick={() => void run(() => decideProposal(proposal.id, 'reject'))}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void run(() => decideProposal(proposal.id, 'accept'))}
                >
                  确认应用
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="web-affair-confirm-card compact">
        <small>最终确认卡固定展示</small>
        <p>
          <b>主体：</b>
          {principal?.name ?? '失效'} · <b>账号：</b>
          {account?.label ?? '未关联'}
        </p>
        <p>
          <b>URL：</b>
          {website?.entryUrl ?? '未关联'}
        </p>
        <p>
          <b>字段/判据：</b>
          {node.successCriteria.join('；')}
        </p>
        <p>
          <b>文件：</b>
          {materialNames.join('、') || '无'}
        </p>
      </div>
    </div>
  )
}

function buildAttemptPrompt(
  affair: WebAffair,
  node: WebAffairNode,
  attemptId: string,
  accountLabel: string,
  entryUrl: string,
  isDueCheck: boolean,
): string {
  return [
    `你正在执行网页事务 ${affair.id} 的节点 ${node.id}，Attempt ${attemptId}。`,
    `事务目标：${affair.objective}`,
    `节点：${node.title}`,
    `账号：${accountLabel}；入口：${entryUrl}`,
    `第一步必须调用 web_account_open，accountId=${node.accountIds[0] ?? ''}。不要自行新建 Tab 或猜测登录环境。`,
    `成功判据：${node.successCriteria.join('；')}`,
    '先用 web_affair_get 重新读取主进程事实，再观察当前网页。只执行低风险、可撤销的填写或查询。',
    '遇到扫码、验证码、主体不确定、材料变化或页面不确定时停止并要求用户接管。',
    '任何不可逆外部提交必须停止并要求用户接管；即使用户交还，也不能由 Agent 执行最终动作。',
    '页面流程与当前流程不一致时，用 web_affair_propose_flow_diff 提交建议，不要直接覆盖历史。',
    isDueCheck
      ? '这是一次到期复查。读取官网当前状态后，用 web_affair_complete_check 记录状态未变化、已通过或被驳回；必须附官网原文摘要和当前 URL。'
      : '取得明确后置条件证据后，用 web_affair_finish_attempt 记录结果；没有回执或可验证页面状态时不得成功。',
  ].join('\n')
}

async function waitForConversationBrowserTask(conversationId: string, accountId: string) {
  for (let index = 0; index < 80; index += 1) {
    const task = (await window.cclinkStudio.browser.listTasks())
      .slice()
      .reverse()
      .find(
        (candidate) =>
          candidate.correlation?.conversationId === conversationId &&
          candidate.correlation.accountId === accountId &&
          (candidate.status === 'running' || candidate.status === 'paused'),
      )
    if (task) return task
    await delay(100)
  }
  throw new Error('Agent 未能打开并绑定指定登记账号')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
