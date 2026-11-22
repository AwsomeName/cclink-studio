import { describe, expect, it } from 'vitest'
import {
  renderScheduledTaskFileName,
  renderScheduledTaskDirectory,
} from './scheduled-task-file-name'

describe('renderScheduledTaskFileName', () => {
  it('renders Chinese weekday and compact month-day in the task timezone', () => {
    expect(
      renderScheduledTaskFileName({
        template: '{monthDay}_{weekday}_{time}.md',
        timestamp: Date.parse('2026-08-15T16:30:00.000Z'),
        timezone: 'Asia/Shanghai',
        taskId: 'task-1',
        runId: 'run-1',
      }),
    ).toBe('0816_周日_0030.md')
  })

  it('uses the same occurrence with a different local date in another timezone', () => {
    expect(
      renderScheduledTaskFileName({
        template: '{date}_{monthDay}_{weekday}_{taskId}_{runId}.md',
        timestamp: Date.parse('2026-08-16T01:00:00.000Z'),
        timezone: 'America/Los_Angeles',
        taskId: 'task-1',
        runId: 'run-1',
      }),
    ).toBe('2026-08-15_0815_周六_task-1_run-1.md')
  })
})

it('renders dynamic directory by task timezone across year boundary without changing static directories', () => {
  const timestamp = Date.parse('2026-12-31T17:00:00Z')
  expect(renderScheduledTaskDirectory('个人/{year}/{month}', timestamp, 'Asia/Shanghai')).toBe(
    '个人/2027/01',
  )
  expect(renderScheduledTaskDirectory('个人/2026/11', timestamp, 'Asia/Shanghai')).toBe(
    '个人/2026/11',
  )
})

it('names the next week by ISO week year and the next month by target calendar year', () => {
  const input = {
    timestamp: Date.parse('2024-12-29T13:00:00Z'),
    timezone: 'Asia/Shanghai',
    taskId: 'task',
    runId: 'run',
  }
  expect(renderScheduledTaskFileName({ ...input, template: '{nextWeekYear}-W{nextWeek}.md' })).toBe(
    '2025-W01.md',
  )
  expect(
    renderScheduledTaskFileName({ ...input, template: '{nextMonthYear}/{nextMonth}/{nextYear}' }),
  ).toBe('2025/2025-01/2025')
})
