import { describe, expect, it } from 'vitest'
import { calculateNextRunAt } from './schedule-calculator'

describe('calculateNextRunAt', () => {
  it('calculates the next daily wall-clock occurrence in the declared timezone', () => {
    const after = Date.parse('2026-07-29T00:00:00.000Z')
    expect(
      calculateNextRunAt({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, after),
    ).toBe(Date.parse('2026-07-29T01:00:00.000Z'))
  })

  it('skips weekends for weekday schedules', () => {
    const fridayAfterRun = Date.parse('2026-07-31T03:00:00.000Z')
    expect(
      calculateNextRunAt(
        { kind: 'weekdays', time: '09:00', timezone: 'Asia/Shanghai' },
        fridayAfterRun,
      ),
    ).toBe(Date.parse('2026-08-03T01:00:00.000Z'))
  })

  it('returns null after a one-time occurrence has passed', () => {
    expect(
      calculateNextRunAt(
        {
          kind: 'once',
          runAt: Date.parse('2026-07-28T01:00:00.000Z'),
          timezone: 'Asia/Shanghai',
        },
        Date.parse('2026-07-29T00:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it('moves a nonexistent DST wall-clock time to the next valid minute', () => {
    expect(
      calculateNextRunAt(
        { kind: 'daily', time: '02:30', timezone: 'America/New_York' },
        Date.parse('2026-03-08T05:00:00.000Z'),
      ),
    ).toBe(Date.parse('2026-03-08T07:00:00.000Z'))
  })
})
