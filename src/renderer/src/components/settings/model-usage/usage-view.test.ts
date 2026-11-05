import { describe, expect, it } from 'vitest'
import { dateAt, dayCoverage, midnight, nextDate, periodKey } from './usage-view'
import type { UsagePeriod } from '@shared/model-usage'
it('uses Beijing boundaries across midnight and Monday weeks', () => {
  expect(dateAt(Date.parse('2026-11-05T16:00:00Z'))).toBe('2026-11-06')
  expect(nextDate('2026-10-31')).toBe('2026-11-01')
  expect(periodKey('2026-11-01', 'week')).toBe('2026-10-26')
})
describe('truthful activity coverage', () => {
  const span = (
    from: string,
    to: string,
    state: UsagePeriod['state'] = 'recording',
  ): UsagePeriod => ({ id: from, originId: 'local', from, to, state })
  it('does not turn missing history or a partially observed day into zero activity', () => {
    expect(dayCoverage('2026-11-05', [], 'local')).toBe('unrecorded')
    expect(
      dayCoverage('2026-11-05', [span('2026-11-05T04:00:00Z', '2026-11-05T05:00:00Z')], 'local'),
    ).toBe('partial')
  })
  it('unions overlapping periods, excludes other sources, and honors recording failures', () => {
    const from = new Date(midnight('2026-11-05')).toISOString(),
      to = new Date(midnight('2026-11-06')).toISOString()
    const full = span(from, to)
    expect(dayCoverage('2026-11-05', [full, full], 'local')).toBe('observed')
    expect(dayCoverage('2026-11-05', [{ ...full, originId: 'other' }], 'local')).toBe('unrecorded')
    expect(
      dayCoverage(
        '2026-11-05',
        [full, span('2026-11-05T04:00:00Z', '2026-11-05T05:00:00Z', 'degraded')],
        'local',
      ),
    ).toBe('partial')
  })
})
