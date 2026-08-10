import { describe, expect, it } from 'vitest'
import {
  cadConvertRequestSchema,
  hardwarePackageEntrySchema,
  projectOpsPublicationSchema,
  workspaceStateConversationValueSchema,
  workspaceStateValueSchema,
} from './workbench-ipc-schema'

describe('workbench IPC schemas', () => {
  it('requires absolute CAD paths', () => {
    expect(() => cadConvertRequestSchema.parse({ inputPath: '../part.step' })).toThrow()
    expect(cadConvertRequestSchema.parse({ inputPath: '/tmp/part.step' })).toEqual({
      inputPath: '/tmp/part.step',
    })
  })

  it('rejects archive path traversal', () => {
    expect(() => hardwarePackageEntrySchema.parse('../../secret.txt')).toThrow('路径穿越')
    expect(hardwarePackageEntrySchema.parse('layers/top.gbr')).toBe('layers/top.gbr')
  })

  it('rejects publication URLs carrying credentials', () => {
    expect(() =>
      projectOpsPublicationSchema.parse({
        platformId: 'v2ex',
        status: 'draft',
        url: 'https://user:secret@example.com/draft',
      }),
    ).toThrow('明文凭证')
  })

  it('accepts only standard bounded JSON state', () => {
    expect(() => workspaceStateValueSchema.parse({ value: Number.NaN })).toThrow('非有限数字')
    expect(() => workspaceStateValueSchema.parse(new Date())).toThrow('普通 JSON 对象')
    expect(workspaceStateValueSchema.parse({ tabs: [] })).toEqual({ tabs: [] })
  })

  it('allows bounded long-running Agent history without relaxing other workspace sections', () => {
    const sixMegabytes = { content: 'x'.repeat(6 * 1024 * 1024) }

    expect(() => workspaceStateValueSchema.parse(sixMegabytes)).toThrow('超过大小限制')
    expect(workspaceStateConversationValueSchema.parse(sixMegabytes)).toEqual(sixMegabytes)
  })
})
