import { describe, expect, it } from 'vitest'
import {
  appendRecord,
  financeLedger,
  healthLedger,
  mergeRows,
  parseAmount,
  parseDiaryRows,
  parseRecordFile,
  parseWeight,
  shiftDate,
} from './diary-ledger'

const diary = `# 2026-11-25 周三

今日体重：没称
昨日睡眠：12点睡的，7点醒的
昨日花销：记有喇叭 25 元
AI 剩余额度：codex还有13%
昨日运动：
昨日收入：

## 昨日总结

昨日花销：这行在正文里，不算
`

describe('diary rows', () => {
  it('shifts across month and year boundaries', () => {
    expect(shiftDate('2026-12-01', -1)).toBe('2026-11-30')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('groups header fields by the day they describe and skips blanks and body lines', () => {
    expect(parseDiaryRows(diary, '2026-11-25', healthLedger.fields)).toEqual([
      {
        date: '2026-11-25',
        source: { kind: 'diary', diaryDate: '2026-11-25' },
        cells: { 体重: '没称' },
      },
      {
        date: '2026-11-24',
        source: { kind: 'diary', diaryDate: '2026-11-25' },
        cells: { 睡眠: '12点睡的，7点醒的' },
      },
    ])
    expect(parseDiaryRows(diary, '2026-11-25', financeLedger.fields)).toEqual([
      {
        date: '2026-11-24',
        source: { kind: 'diary', diaryDate: '2026-11-25' },
        cells: { 花销: '记有喇叭 25 元' },
      },
    ])
  })
})

describe('record file', () => {
  it('creates the file’s table on the first record and appends after its last row', () => {
    const first = appendRecord('', financeLedger, '2026-11-25', { 花销: '午饭 28' })
    expect(first).toBe(
      '# 财务\n\n| 日期 | 花销 | 收入 |\n| --- | --- | --- |\n| 2026-11-25 | 午饭 28 |  |\n',
    )
    const second = appendRecord(first + '\n备注写在表格后面\n', financeLedger, '2026-11-22', {
      收入: '卖键盘 120 | 闲鱼',
    })
    expect(second).toBe(
      '# 财务\n\n| 日期 | 花销 | 收入 |\n| --- | --- | --- |\n| 2026-11-25 | 午饭 28 |  |\n' +
        '| 2026-11-22 |  | 卖键盘 120 \\| 闲鱼 |\n\n备注写在表格后面\n',
    )
    expect(parseRecordFile(second, financeLedger.fields)).toEqual({
      rows: [
        { date: '2026-11-25', source: { kind: 'own' }, cells: { 花销: '午饭 28' } },
        { date: '2026-11-22', source: { kind: 'own' }, cells: { 收入: '卖键盘 120 | 闲鱼' } },
      ],
      unreadable: 0,
    })
  })

  it('follows the file’s own column order and counts rows it cannot read', () => {
    const content =
      '| 日期 | 收入 | 花销 |\n|---|---|---|\n| 2026-11-20 | 300 | 50 |\n| 昨天 | | 8 |\n'
    expect(parseRecordFile(content, financeLedger.fields)).toEqual({
      rows: [{ date: '2026-11-20', source: { kind: 'own' }, cells: { 收入: '300', 花销: '50' } }],
      unreadable: 1,
    })
    expect(appendRecord(content, financeLedger, '2026-11-25', { 花销: '9', 收入: '1' })).toContain(
      '| 2026-11-25 | 1 | 9 |',
    )
  })

  it('keeps one row per source on the same day, newest first', () => {
    const own = { date: '2026-11-25', source: { kind: 'own' as const }, cells: { 运动: '跑步' } }
    const fromDiary = parseDiaryRows(diary, '2026-11-25', healthLedger.fields)
    expect(mergeRows(fromDiary, [own]).map((row) => [row.date, row.source.kind])).toEqual([
      ['2026-11-25', 'own'],
      ['2026-11-25', 'diary'],
      ['2026-11-24', 'diary'],
    ])
  })
})

describe('chart values', () => {
  it('reads weight in kg, halves 斤 and drops what is not a weight', () => {
    expect(parseWeight('70.6kg')).toBe(70.6)
    expect(parseWeight('141 斤')).toBe(70.5)
    expect(parseWeight('没称')).toBeNull()
    expect(parseWeight('早上 7 点称')).toBeNull()
  })

  it('sums money and ignores dates, times, percentages and other units', () => {
    expect(parseAmount('午饭 32，打车 46，晚上喇叭 25')).toBe(103)
    expect(parseAmount('记有喇叭 25 元，与 23 日晚记录是否为同一笔待确认。')).toBe(25)
    expect(parseAmount('8:10 打车 12.5块，跑了 5 公里')).toBe(12.5)
    expect(parseAmount('11/23 买 iPhone15 壳 39')).toBe(39)
    expect(parseAmount('没花钱')).toBeNull()
    expect(parseAmount('打了 9 折')).toBeNull()
  })
})
