import { describe, expect, it } from 'vitest'
import {
  buildLedger,
  financeFields,
  healthFields,
  parseDiaryFields,
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

describe('diary ledger', () => {
  it('shifts across month and year boundaries', () => {
    expect(shiftDate('2026-12-01', -1)).toBe('2026-11-30')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('reads header fields, dating 昨日 lines to the day before and skipping blanks', () => {
    expect(parseDiaryFields(diary, '2026-11-25', healthFields)).toEqual([
      { date: '2026-11-25', label: '体重', value: '没称' },
      { date: '2026-11-24', label: '睡眠', value: '12点睡的，7点醒的' },
    ])
    expect(parseDiaryFields(diary, '2026-11-25', financeFields)).toEqual([
      { date: '2026-11-24', label: '花销', value: '记有喇叭 25 元' },
    ])
  })

  it('merges days across files, newest first, keeping each value’s source diary', () => {
    const rows = buildLedger(
      [
        { date: '2026-11-25', content: diary },
        { date: '2026-11-24', content: '今日体重：70.2kg\n昨日睡眠：11点睡' },
      ],
      healthFields,
    )
    expect(rows.map((row) => row.date)).toEqual(['2026-11-25', '2026-11-24', '2026-11-23'])
    expect(rows[1].cells).toEqual({
      体重: { value: '70.2kg', sourceDate: '2026-11-24' },
      睡眠: { value: '12点睡的，7点醒的', sourceDate: '2026-11-25' },
    })
  })
})
