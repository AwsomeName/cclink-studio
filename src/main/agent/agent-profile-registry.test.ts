import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_ROLE_REF } from '../../shared/agent-role'
import {
  AGENT_PROFILE_PROMPT_COMPILER_VERSION,
  BuiltinAgentProfileRegistry,
} from './agent-profile-registry'

describe('BuiltinAgentProfileRegistry', () => {
  it('exposes seven versioned, uniquely identified built-in profiles', () => {
    const profiles = new BuiltinAgentProfileRegistry().list()

    expect(profiles).toHaveLength(7)
    expect(new Set(profiles.map((profile) => profile.roleId)).size).toBe(7)
    expect(profiles[0]).toMatchObject({
      ...DEFAULT_AGENT_ROLE_REF,
      label: '默认助手',
    })
  })

  it('keeps political profiles framed as analysis lenses', () => {
    const registry = new BuiltinAgentProfileRegistry()

    expect(registry.resolve({ roleId: 'public-governance', version: 1 })).toMatchObject({
      disclaimer: expect.stringContaining('分析框架'),
      systemInstructions: expect.stringContaining('真实政府'),
    })
    expect(registry.resolve({ roleId: 'civil-rights-advocate', version: 1 })).toMatchObject({
      disclaimer: expect.stringContaining('分析框架'),
      systemInstructions: expect.stringContaining('真实组织'),
    })
  })

  it('exposes a versioned SOUL and recommended Skill for the challenger role', () => {
    const registry = new BuiltinAgentProfileRegistry()
    const challenger = registry.list().find((role) => role.roleId === 'critical-challenger')
    const resolved = registry.resolve({ roleId: 'critical-challenger', version: 1 })

    expect(challenger).toMatchObject({
      goals: [expect.stringContaining('脆弱点')],
      recommendedSkillRefs: [{ skillId: 'grill-me', version: 1 }],
      soul: {
        format: 'markdown',
        source: 'builtin',
        markdown: expect.stringContaining('# Identity'),
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(registry.buildSystemInstructions(resolved)).toContain('经过版本化的 SOUL.md')
    expect(registry.buildSystemInstructions(resolved)).toContain('不攻击稻草人')
  })

  it('exposes a complete, versioned content model for every built-in role', () => {
    const registry = new BuiltinAgentProfileRegistry()

    for (const role of registry.list()) {
      expect(role.goals, role.roleId).not.toHaveLength(0)
      expect(role.suitableFor, role.roleId).not.toHaveLength(0)
      expect(role.unsuitableFor, role.roleId).not.toHaveLength(0)
      expect(role.boundaries, role.roleId).not.toHaveLength(0)
      expect(role.examples, role.roleId).not.toHaveLength(0)
      expect(role.soul, role.roleId).toMatchObject({
        format: 'markdown',
        source: 'builtin',
        markdown: expect.stringContaining('# Identity'),
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(role.contentHash, role.roleId).toMatch(/^[a-f0-9]{64}$/)

      const resolved = registry.resolve(role)
      expect(registry.buildSystemInstructions(resolved), role.roleId).toContain(
        '经过版本化的 SOUL.md',
      )
    }
  })

  it('does not invent recommended Skills for roles without a registered workflow', () => {
    const roles = new BuiltinAgentProfileRegistry().list()

    expect(
      roles.filter((role) => role.recommendedSkillRefs.length > 0).map((role) => role.roleId),
    ).toEqual(['critical-challenger'])
  })

  it('rejects unknown identifiers and versions instead of silently falling back', () => {
    const registry = new BuiltinAgentProfileRegistry()

    expect(() => registry.resolve({ roleId: 'missing', version: 1 })).toThrow('角色不可用')
    expect(() => registry.resolve({ roleId: 'default-assistant', version: 2 })).toThrow(
      '角色不可用',
    )
  })

  it('creates a distinct conversation fingerprint per role', () => {
    const registry = new BuiltinAgentProfileRegistry()
    const runtimeFingerprint = 'a'.repeat(64)
    const defaultFingerprint = registry.buildConversationCompatibilityFingerprint(
      runtimeFingerprint,
      DEFAULT_AGENT_ROLE_REF,
      1,
    )
    const challengerFingerprint = registry.buildConversationCompatibilityFingerprint(
      runtimeFingerprint,
      { roleId: 'critical-challenger', version: 1 },
      1,
    )

    expect(AGENT_PROFILE_PROMPT_COMPILER_VERSION).toBe(2)
    expect(defaultFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(challengerFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(challengerFingerprint).not.toBe(defaultFingerprint)

    const skillFingerprint = registry.buildConversationCompatibilityFingerprint(
      runtimeFingerprint,
      DEFAULT_AGENT_ROLE_REF,
      1,
      [`grill-me@1:${'b'.repeat(64)}`],
    )
    expect(skillFingerprint).not.toBe(defaultFingerprint)
  })
})
