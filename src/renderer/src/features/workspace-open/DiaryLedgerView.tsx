import { useEffect, useState } from 'react'
import { useDiaryCalendar } from './diary-calendar-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import { buildLedger, type DiaryLedgerField, type DiaryLedgerRow } from './diary-ledger'

/** Most recent diaries read for the table; older days stay in the diaries themselves. */
const LEDGER_DIARY_LIMIT = 120

const label = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

/**
 * 财务 / 健康: the diary's header lines for these fields, one row per day. Values are read from
 * the diary files on each visit; editing happens in the diary, opened by clicking a value.
 */
export function DiaryLedgerView({
  title,
  fields,
  diaries,
  revision,
}: {
  title: string
  fields: DiaryLedgerField[]
  diaries: Array<{ path: string; year: string; month: string; day: string }>
  revision: number
}): React.ReactElement {
  const [rows, setRows] = useState<DiaryLedgerRow[] | null>(null)
  const [error, setError] = useState('')
  const recent = diaries.slice(0, LEDGER_DIARY_LIMIT)
  const key = recent.map((file) => file.path).join('\n')
  useEffect(() => {
    let alive = true
    setError('')
    void Promise.all(
      recent.map(async (file) => {
        const result = await window.cclinkStudio.fs.readFile(file.path)
        return {
          date: `${file.year}-${file.month}-${file.day}`,
          content: result.encoding === 'utf-8' ? result.content : '',
        }
      }),
    )
      .then((items) => {
        if (alive) setRows(buildLedger(items, fields))
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
    // `key` stands for the file list; `fields` are module constants.
  }, [key, revision])
  const openDay = (date: string): void => {
    useDiaryCalendar.getState().select(date)
    useDiaryNavigation.getState().setPage('日记')
  }
  const names = fields.map((field) => field.label).join('、')
  return (
    <div className="diary-ledger" aria-label={title}>
      <p className="muted">
        汇总日记开头的{names}记录（最近 {recent.length} 篇日记）。点击内容打开所在日记修改。
      </p>
      {error && <p role="alert">{error}</p>}
      {!rows && !error && (
        <p className="muted" role="status">
          正在读取…
        </p>
      )}
      {rows && !rows.length && (
        <p className="muted">还没有{names}记录。在日记开头对应的行填写后会出现在这里。</p>
      )}
      {rows && rows.length > 0 && (
        <table className="diary-ledger-table">
          <thead>
            <tr>
              <th scope="col">日期</th>
              {fields.map((field) => (
                <th key={field.label} scope="col">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date}>
                <th scope="row">{label(row.date)}</th>
                {fields.map((field) => {
                  const cell = row.cells[field.label]
                  return (
                    <td key={field.label}>
                      {cell && (
                        <button
                          type="button"
                          title={`打开 ${label(cell.sourceDate)} 的日记`}
                          onClick={() => openDay(cell.sourceDate)}
                        >
                          {cell.value}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
