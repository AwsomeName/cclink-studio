import { describe, expect, it } from 'vitest'
import type { StoredScheduledTaskDefinitionV2 } from '../../shared/scheduled-task/scheduled-task-types'
import { computeScheduledTaskExecutionDigest } from './scheduled-task-definition-digest'

function definition(): StoredScheduledTaskDefinitionV2 {
  return {
    schemaVersion: 2,
    id: '12345678-1234-1234-1234-123456789abc',
    revision: 1,
    title: '周报',
    instruction: '生成周报',
    schedule: { kind: 'weekly', time: '09:00', weekdays: [5, 1], timezone: 'Asia/Shanghai' },
    resources: [{ kind: 'workspace' }, { kind: 'directory', path: 'docs' }],
    outputPolicy: {
      directory: 'docs/周报',
      fileNameTemplate: 'weekly.md',
      mode: 'create-only',
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('computeScheduledTaskExecutionDigest', () => {
  it('ignores display metadata and normalizes weekly weekdays', () => {
    const first = definition()
    const second = {
      ...first,
      revision: 99,
      title: '新标题',
      createdAt: 20,
      updatedAt: 30,
      schedule: { ...first.schedule, weekdays: [1, 5] },
    } as StoredScheduledTaskDefinitionV2

    expect(computeScheduledTaskExecutionDigest(second)).toBe(
      computeScheduledTaskExecutionDigest(first),
    )
  })

  it('changes when executable semantics change', () => {
    const first = definition()
    expect(computeScheduledTaskExecutionDigest({ ...first, instruction: '生成新的周报' })).not.toBe(
      computeScheduledTaskExecutionDigest(first),
    )
  })
})
