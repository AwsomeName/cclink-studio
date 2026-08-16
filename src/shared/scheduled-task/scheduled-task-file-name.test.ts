import { describe, expect, it } from 'vitest'
import { renderScheduledTaskFileName } from './scheduled-task-file-name'

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
