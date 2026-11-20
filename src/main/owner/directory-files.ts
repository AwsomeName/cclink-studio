import { basename } from 'node:path'
import { checkReport, researchStatus } from '../../shared/owner/research'
import type { AffairRecord } from '../../shared/owner/affair'

export const shortName = (value: string) =>
  Array.from(
    value
      .replace(/[^\p{L}\p{N} ._-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, 45)
    .join('')
    .replace(/^[. ]+|[. ]+$/g, '') || '调研'
export type History = { at: number; text: string }[]
export function additions(before: AffairRecord | undefined, next: AffairRecord) {
  const r = next.research!
  const prev = before?.research
  const entries: string[] = []
  if (!before) entries.push('收到交办：' + next.goal)
  if (next.confirmed && !before?.confirmed)
    entries.push('用户确认范围和交付物：' + r.plan?.scope + '；' + r.plan?.output)
  const previous = prev?.log ?? []
  let overlap = Math.min(previous.length, r.log.length)
  while (overlap && !previous.slice(-overlap).every((v, i) => v === r.log[i])) overlap--
  entries.push(...r.log.slice(overlap))
  const d = r.decisions?.at(-1)
  if (d && JSON.stringify(r.decisions) !== JSON.stringify(prev?.decisions))
    entries.push(
      { read: '委派会话 A', more: '续用会话 A 补查', deliver: 'Owner 判定可以交付' }[d.kind] +
        '：' +
        d.reason,
    )
  return entries.map((text) => ({ at: next.updated, text }))
}

export function directoryFiles(a: AffairRecord, history: History) {
  const r = a.research!
  if ((r.phase === 'done') !== !!r.report || (r.report && !a.confirmed))
    throw Error('交付状态与已确认的报告不符')
  const files: Record<string, string> = {}
  const names = r.docs.map((d, i) => {
    const name =
      '资料/' +
      String(i + 1).padStart(2, '0') +
      '-' +
      shortName(basename(d.path || 'README')) +
      '.md'
    const line = d.startLine ? '#L' + d.startLine : ''
    const fence = '`'.repeat(
      Math.max(3, ...Array.from(d.text.matchAll(/`+/g), (m) => m[0].length + 1)),
    )
    files[name] =
      [
        '# ' + d.repo + ' · ' + (d.path || 'README'),
        '[固定版本的原文](' + d.url + line + ')',
        '读取时间 ' + new Date(d.at).toISOString() + '　·　文件版本 ' + d.sha,
        '片段起始行 ' + (d.startLine ?? '未知'),
        fence + 'text\n' + d.text + '\n' + fence,
      ].join('\n\n') + '\n'
    return name
  })
  let reportFile: string | undefined
  if (r.report) {
    const report = checkReport(r, r.report)
    const title =
      report.conclusion.match(/^#\s+(.+)$/m)?.[1] ||
      (r.plan?.repos.length === 1 ? r.plan.repos[0].split('/')[1] + ' 调研报告' : '调研报告')
    reportFile = '交付物/' + shortName(title) + '.md'
    const citations = report.items.map((item, i) => {
      const hit = r.docs.findIndex(
        (d) =>
          d.repo === item.repo &&
          d.url === item.url &&
          d.text.replace(/\s+/g, ' ').includes(item.quote.replace(/\s+/g, ' ')) &&
          (!item.line ||
            !d.startLine ||
            (item.line >= d.startLine && item.line < d.startLine + d.text.split('\n').length)),
      )
      if (hit < 0) throw Error('缺少对应本地证据：' + item.finding)
      return (
        '### ' +
        (i + 1) +
        '. ' +
        item.finding +
        '\n\n> ' +
        item.quote.replaceAll('\n', '\n> ') +
        '\n\n[本地证据](../' +
        encodeURI(names[hit]) +
        (item.line ? '#L' + item.line : '') +
        ') · [仓库原文](' +
        item.url +
        (item.line ? '#L' + item.line : '') +
        ')'
      )
    })
    files[reportFile] =
      report.conclusion + '\n\n## 核对过的出处\n\n' + citations.join('\n\n') + '\n'
  }
  const [status, detail] = researchStatus(r, true)
  files['工作记录.md'] =
    '# 工作记录\n\n' +
    history.map((e) => '- ' + new Date(e.at).toISOString() + '　' + e.text).join('\n') +
    '\n'
  files['事务.md'] =
    [
      '# ' + a.title,
      '## 目标',
      a.goal,
      '## ' + (a.confirmed ? '已确认的约定' : '待确认的约定'),
      r.plan
        ? [r.plan.scope, r.plan.output, r.plan.repos.join('、')].join('\n\n')
        : '等待 Owner 提出范围与交付物。',
      '## 最近一次记录的状态',
      status + ' · ' + (a.issue || detail),
      r.decisions?.at(-1)?.reason,
      reportFile ? '[打开交付物](' + encodeURI(reportFile) + ')' : '[查看工作记录](工作记录.md)',
    ]
      .filter(Boolean)
      .join('\n\n') + '\n'
  return { files, reportFile }
}
