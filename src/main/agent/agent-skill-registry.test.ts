import { describe, expect, it } from 'vitest'
import { BuiltinAgentSkillRegistry } from './agent-skill-registry'

describe('BuiltinAgentSkillRegistry', () => {
  it('owns the built-in Skill catalog used by roles and Composer', () => {
    const registry = new BuiltinAgentSkillRegistry()

    expect(registry.list()).toEqual([
      expect.objectContaining({
        skillId: 'grill-me',
        version: 1,
        source: 'builtin',
        available: true,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ])
    expect(registry.resolve({ skillId: 'grill-me', version: 1 })).toMatchObject({
      label: '方案拷问',
      markdown: expect.stringContaining('## Workflow'),
    })
    expect(registry.resolve({ skillId: 'missing', version: 1 })).toBeNull()
    expect(() => registry.resolveRequired({ skillId: 'missing', version: 1 })).toThrow(
      'Skill 不可用',
    )
    expect(
      registry.resolveMany([
        { skillId: 'grill-me', version: 1 },
        { skillId: 'grill-me', version: 1 },
      ]),
    ).toHaveLength(1)
  })
})
