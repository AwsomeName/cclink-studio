import type { AffairRecord } from '../../shared/owner/affair'
import type { Research } from '../../shared/owner/research'

export const configurationFile = '事务配置.md'
export const scheduleFile = '调度.md'

export function configurationDocument(a: AffairRecord, path: string, revision: number) {
  const r = a.research!
  return (
    [
      documentHeader('owner-configuration', a.id, revision, '事务配置'),
      '## ' + (a.confirmed ? '已确认的约定 · v1' : '待确认草案'),
      a.goal,
      '## 范围',
      r.plan?.scope ?? '等待 Owner 提出范围。',
      '## 交付物与验收标准',
      r.plan?.output ?? '等待双方明确交付要求。',
      '## 取证范围',
      '公开 GitHub 仓库：' +
        (r.plan?.repos.join('、') || '待拟定') +
        (a.confirmed ? '（已确认）' : '（尚未授权执行）'),
      '本地参考目录：无。',
      '## 时间安排',
      r.plan?.timing ?? '未单独约定截止时间或投入上限。',
      '## 实际保存位置',
      path,
    ].join('\n\n') + '\n'
  )
}

export function documentHeader(kind: string, id: string, revision: number, title: string) {
  return [
    '---',
    'kind: ' + kind,
    'format: 1',
    'affair_id: ' + id,
    'revision: ' + revision,
    '---',
    '',
    '# ' + title,
  ].join('\n')
}

function dispatchState(r: Research, confirmed: boolean, issue: string) {
  if (r.phase === 'error')
    return ['需要处理', issue || '上一步未完成。', '处理原因后，从本事务恢复。']
  if (!confirmed)
    return [
      '尚未派工',
      r.phase === 'ready' ? '等待你确认当前范围与交付物。' : 'Owner 与你拟定调研约定。',
      '约定经你确认并保存后，Owner 才能派工。',
    ]
  if (r.phase === 'done')
    return [
      '无后续派工',
      'Owner 已核对 ' + r.report!.items.length + ' 条引文。',
      '已完成取证；保存失败时只重试原报告。',
    ]
  if (r.phase === 'reading') {
    const d = r.decisions?.at(-1)
    if (d?.workerReturned)
      return ['Studio · 读取原文', 'A 已返回选取的资料。', '资料返回后由 Owner 核对原文。']
    if (d?.workerRunId)
      return [
        '会话 A · 已接收委托',
        '等待本轮结构化回执。',
        '收到匹配的会话回执后，读取 A 选取的原文并交给 Owner 核对。',
      ]
    if (d?.workerTicket)
      return [
        'Owner · 等待接单回执',
        '已登记本轮委托，尚未取得 A 的运行编号。',
        '先核对原委托，再决定是否需要重新取证。',
      ]
    return [
      'Owner · 准备取证',
      '查找本轮委托所需的候选资料。',
      '找到候选文件后交给会话 A；找不到则由 Owner 复核缺口。',
    ]
  }
  if (r.phase === 'writing')
    return ['会话 A · 整理结果', '等待原会话交回结果。', 'Owner 逐项核对后决定补查或交付。']
  return [
    'Owner · 核对证据',
    '对照已确认的目标、交付标准与现有原文。',
    '证据不足时说明原因并继续取证；全部关键结论有出处后写报告。',
  ]
}

export function scheduleDocument(a: AffairRecord, revision: number) {
  const r = a.research!
  const [actor, waiting, next] = dispatchState(r, a.confirmed, a.issue)
  const decision = r.decisions?.at(-1)
  const assignment = r.decisions
    ?.slice()
    .reverse()
    .find((d) => d.kind !== 'deliver')
  return (
    [
      documentHeader('owner-schedule', a.id, revision, '调度'),
      '## 最近记录的步骤',
      actor + '　·　' + waiting,
      decision && '## Owner 的判断',
      decision &&
        { read: '首次委派 A', more: '续用 A 补查', deliver: '交付依据' }[decision.kind] +
          '：' +
          decision.reason,
      assignment && '## 最近一次委托',
      assignment !== decision && assignment?.reason,
      assignment?.requests
        ?.map(
          (request) => '- ' + request.repo + ' · ' + (request.terms.join('、') || '项目 README'),
        )
        .join('\n'),
      assignment?.workerRunId && '会话：owner-' + a.id + '-a　·　运行：' + assignment.workerRunId,
      '## 继续条件与下一步',
      next,
      '## 触发方式',
      '按本事务的确认与执行回执推进，无定时安排。',
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  )
}
