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
      }),
    ])
    expect(registry.resolve({ skillId: 'grill-me', version: 1 })).toMatchObject({
      label: '方案拷问',
    })
    expect(registry.resolve({ skillId: 'missing', version: 1 })).toBeNull()
  })
})
