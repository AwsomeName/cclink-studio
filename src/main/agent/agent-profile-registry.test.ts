import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_PROFILE_REF } from '../../shared/agent-profile'
import {
  AGENT_PROFILE_PROMPT_COMPILER_VERSION,
  BuiltinAgentProfileRegistry,
} from './agent-profile-registry'

describe('BuiltinAgentProfileRegistry', () => {
  it('exposes seven versioned, uniquely identified built-in profiles', () => {
    const profiles = new BuiltinAgentProfileRegistry().list()

    expect(profiles).toHaveLength(7)
    expect(new Set(profiles.map((profile) => profile.profileId)).size).toBe(7)
    expect(profiles[0]).toMatchObject({
      ...DEFAULT_AGENT_PROFILE_REF,
      label: '默认助手',
    })
  })

  it('keeps political profiles framed as analysis lenses', () => {
    const registry = new BuiltinAgentProfileRegistry()

    expect(registry.resolve({ profileId: 'public-governance', version: 1 })).toMatchObject({
      disclaimer: expect.stringContaining('分析框架'),
      systemInstructions: expect.stringContaining('真实政府'),
    })
    expect(registry.resolve({ profileId: 'civil-rights-advocate', version: 1 })).toMatchObject({
      disclaimer: expect.stringContaining('分析框架'),
      systemInstructions: expect.stringContaining('真实组织'),
    })
  })

  it('rejects unknown identifiers and versions instead of silently falling back', () => {
    const registry = new BuiltinAgentProfileRegistry()

    expect(() => registry.resolve({ profileId: 'missing', version: 1 })).toThrow('角色不可用')
    expect(() => registry.resolve({ profileId: 'default-assistant', version: 2 })).toThrow(
      '角色不可用',
    )
  })

  it('creates a distinct conversation fingerprint per role', () => {
    const registry = new BuiltinAgentProfileRegistry()
    const runtimeFingerprint = 'a'.repeat(64)
    const defaultFingerprint = registry.buildConversationCompatibilityFingerprint(
      runtimeFingerprint,
      DEFAULT_AGENT_PROFILE_REF,
    )
    const challengerFingerprint = registry.buildConversationCompatibilityFingerprint(
      runtimeFingerprint,
      { profileId: 'critical-challenger', version: 1 },
    )

    expect(AGENT_PROFILE_PROMPT_COMPILER_VERSION).toBe(1)
    expect(defaultFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(challengerFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(challengerFingerprint).not.toBe(defaultFingerprint)
  })
})
