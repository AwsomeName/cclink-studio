import { sanitizeDiagnosticText, type DiagnosticLogEntry } from '@shared/diagnostics'
import type { OwnerSourceGrant } from '@shared/ipc/owner-source'
import { getRendererDiagnosticLogSnapshot } from '../diagnostics/renderer-diagnostic-log'
import type { Affair } from './affair'
import { session } from './owner-agent'
import { decisionWorker, workerLabel, workersOf } from './research-model'
import { statusChips } from './owner-status'

export const OWNER_DIAGNOSTIC_INCLUDES = [
  '事务 ID、修订号、三种状态、保存位置',
  '约定（范围、交付物、来源）与确认情况',
  '每次判断与派工：原因、会话与运行 ID、真实终态、交回情况',
  '证据清单（仓库、路径、固定版本、起始行），执行记录、失败原因与待保存文件',
  '最近 50 条相关框架日志（Owner / Agent / 文件）',
]
export const OWNER_DIAGNOSTIC_EXCLUDES = [
  '聊天全文、证据原文、交付物正文、本地参考目录内容',
  '令牌、密钥；本机路径中的用户名已替换为 ~',
]

type RunState = { status: string; errorMessage?: string | null } | null
export type OwnerDiagnosticInput = {
  affair: Affair
  active: boolean
  workerLoading: boolean
  grants: OwnerSourceGrant[] | { error: string }
  runs: Record<string, RunState | { error: string }>
  logs: DiagnosticLogEntry[]
  now: number
}

const clip = (s: string | undefined | null, n = 400) =>
  !s ? '' : s.length > n ? s.slice(0, n) + '…' : s
const when = (t: number) => new Date(t).toISOString()

/** Pure formatter: one affair's facts, never chat or evidence text. */
export function formatOwnerDiagnostics(input: OwnerDiagnosticInput): string {
  const { affair: a, active } = input
  const r = a.research
  const out: string[] = ['# Owner 诊断', '', '- 生成时间：' + when(input.now)]
  out.push('', '## 事务')
  out.push('- 事务 ID：' + a.id, '- 标题：' + a.title, '- 最近更新：' + when(a.updated))
  if (r) {
    const c = statusChips(a, active, input.workerLoading)
    out.push(
      '- 事务状态：' + c.state,
      '- Owner 当前动作：' + c.owner,
      '- 执行会话 A：' + c.worker,
      '- 阶段：' + r.phase + ' · 已确认：' + (a.confirmed ? '是' : '否'),
      '- 本窗口正在执行：' + (active ? '是' : '否'),
    )
  } else out.push('- 类型：资料摘录事务（旧版）')
  if (a.directory) {
    out.push('- 修订号：' + a.directory.revision, '- 保存位置：' + a.directory.path)
    out.push('- 已落地文件：' + (a.directory.files.join('、') || '无'))
    if (a.directory.reportFile) out.push('- 交付物：' + a.directory.reportFile)
    if (a.directory.error) out.push('- 待保存：' + a.directory.error)
  } else out.push('- 事务目录：无（仅保存在 Studio）')
  if (a.issue) out.push('- 需要处理：' + clip(a.issue, 1200))
  out.push('- Owner 主会话：' + session(a, 'main'))
  if (r)
    for (const w of workersOf(r))
      out.push(
        '- 执行会话 ' +
          workerLabel(w.key) +
          '：' +
          session(a, w.key) +
          ' · 负责：' +
          clip(w.purpose, 200) +
          (w.agent ? ' · ' + w.agent : '') +
          ' · 开设原因：' +
          clip(w.reason, 200),
      )

  if (r) {
    out.push('', '## 约定')
    if (r.plan) {
      out.push('- 范围：' + clip(r.plan.scope, 600), '- 交付与验收：' + clip(r.plan.output, 600))
      out.push('- 时间：' + (r.plan.timing ?? '无硬截止'), '- 仓库：' + r.plan.repos.join('、'))
    } else out.push('- 尚未形成约定')

    out.push('', '## 判断与派工')
    const decisions = r.decisions ?? []
    if (!decisions.length) out.push('- 尚无')
    decisions.forEach((d, i) => {
      out.push(
        '### ' +
          (i + 1) +
          '. ' +
          d.kind +
          (d.kind !== 'deliver' && (d.workerRunId || d.worker)
            ? ' · 执行会话 ' +
              workerLabel(decisionWorker(d)) +
              (d.workerChoice === 'new'
                ? '（新开）'
                : d.workerChoice === 'continue'
                  ? '（续用）'
                  : '')
            : ''),
      )
      if (d.choiceReason) out.push('- 会话选择原因：' + clip(d.choiceReason))
      if (d.ask) out.push('- 本步问题：' + clip(d.ask))
      if (d.doneWhen) out.push('- 完成标准：' + clip(d.doneWhen))
      if (d.verdict)
        out.push('- 验收：' + (d.verdict.met ? '满足' : '未满足') + ' · ' + clip(d.verdict.note))
      out.push('- 原因：' + clip(d.reason))
      if (d.requests?.length)
        out.push(
          '- 检索：' + d.requests.map((q) => q.repo + ' [' + q.terms.join(', ') + ']').join('；'),
        )
      if (d.workerFiles?.length)
        out.push('- 选取文件：' + d.workerFiles.map((f) => f.repo + ':' + f.path).join('；'))
      if (d.workerTicket) out.push('- 委托票据：' + d.workerTicket)
      if (d.workerRunId) {
        const run = input.runs[d.workerRunId]
        const state = !run
          ? '未查询'
          : 'error' in run
            ? '查询失败：' + run.error
            : run.status + (run.errorMessage ? ' · ' + clip(run.errorMessage) : '')
        out.push('- 运行：' + d.workerRunId + ' · ' + state)
      }
      out.push(
        '- 已交回：' +
          (d.workerReturned ? '是' : '否') +
          ' · 已处理文件：' +
          (d.filesProcessed ?? 0) +
          ' · 取证结束：' +
          (d.collectionClosed ? '是' : '否'),
      )
    })

    out.push('', '## 证据')
    if (!r.docs.length) out.push('- 尚无')
    for (const d of r.docs)
      out.push(
        '- ' +
          d.repo +
          ' · ' +
          (d.path ?? 'README') +
          ' · ' +
          d.sha.slice(0, 10) +
          (d.startLine ? ' · 起始行 ' + d.startLine : '') +
          ' · ' +
          d.text.length +
          ' 字符 · ' +
          when(d.at),
      )
    out.push('', '## 交付')
    out.push(
      r.report ? '- 已核对引文 ' + r.report.items.length + ' 条（正文未包含）' : '- 尚无交付物',
    )

    out.push('', '## 执行记录')
    if (!r.log.length) out.push('- 尚无')
    r.log.forEach((l, i) => out.push(i + 1 + '. ' + clip(l)))

    const questions = r.chat.filter((m) => m.questionId)
    out.push('', '## 主对话（不含正文）')
    out.push('- 消息数：' + r.chat.length + ' · 执行中提问：' + questions.length)
    for (const q of questions.filter((q) => q.answerError))
      out.push('- 提问失败：' + clip(q.answerError, 300))
  }

  out.push('', '## 本地参考目录')
  if ('error' in input.grants) out.push('- 读取失败：' + input.grants.error)
  else if (!input.grants.length) out.push('- 无')
  else
    for (const g of input.grants)
      out.push('- ' + g.label + ' · ' + g.path + (g.error ? ' · 不可用：' + g.error : ' · 可用'))

  out.push('', '## 相关框架日志（最近 50 条）')
  if (!input.logs.length) out.push('- 无')
  for (const e of input.logs)
    out.push('- ' + e.timestamp + ' · ' + e.level + ' · ' + e.source + ' · ' + clip(e.message, 600))

  return out.map((line) => sanitizeDiagnosticText(line, 2_000)).join('\n') + '\n'
}

const RELEVANT = /owner|事务|agent|会话|run-|参考目录|preferences/i
export function relevantLogs(entries: DiagnosticLogEntry[], affairId: string) {
  return entries
    .filter((e) => e.message.includes(affairId) || RELEVANT.test(e.message))
    .sort((x, y) => x.timestamp.localeCompare(y.timestamp))
    .slice(-50)
}

/** Gathers live facts for one affair and formats them. Every source fails independently. */
export async function collectOwnerDiagnostics(
  a: Affair,
  active: boolean,
  workerLoading: boolean,
): Promise<string> {
  const api = window.cclinkStudio
  const grants = await api.ownerSources.list(a.id).catch((e: unknown) => ({ error: String(e) }))
  const runs: OwnerDiagnosticInput['runs'] = {}
  for (const d of a.research?.decisions ?? []) {
    if (!d.workerRunId) continue
    runs[d.workerRunId] = await api.agent
      .getRunStatus(session(a, decisionWorker(d)), d.workerRunId)
      .then((s) => (s ? { status: s.status, errorMessage: s.errorMessage } : null))
      .catch((e: unknown) => ({ error: String(e) }))
  }
  const main = await api.diagnostics
    .getMainLogSnapshot()
    .then((s) => s.entries)
    .catch(() => [] as DiagnosticLogEntry[])
  const logs = relevantLogs([...main, ...getRendererDiagnosticLogSnapshot().entries], a.id)
  return formatOwnerDiagnostics({
    affair: a,
    active,
    workerLoading,
    grants,
    runs,
    logs,
    now: Date.now(),
  })
}
