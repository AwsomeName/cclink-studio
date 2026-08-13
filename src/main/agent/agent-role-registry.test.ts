import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentRoleDraft } from '../../shared/agent-role'
import { AgentRoleRegistry, AgentRoleStore } from './agent-role-registry'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function draft(label = '本地审稿人'): AgentRoleDraft {
  return {
    label,
    description: '从证据和公共影响两个角度审阅内容',
    icon: 'fact-checker',
    goals: ['给出可执行的修改建议'],
    suitableFor: ['文章审阅'],
    unsuitableFor: ['代替事实来源'],
    instructions: ['先区分事实、推断和观点。'],
    boundaries: ['不扩大工具和权限。'],
    examples: [{ input: '审阅这段文字', focus: '标出证据缺口' }],
    soulMarkdown: '# 原则\n\n尊重证据，明确不确定性。',
    recommendedSkillRefs: [{ skillId: 'grill-me', version: 1 }],
  }
}

async function createRegistry(): Promise<{ root: string; registry: AgentRoleRegistry }> {
  const root = await mkdtemp(join(tmpdir(), 'cclink-studio-agent-role-'))
  roots.push(root)
  const registry = new AgentRoleRegistry(new AgentRoleStore(join(root, 'roles.json')))
  await registry.load()
  return { root, registry }
}

describe('AgentRoleRegistry', () => {
  it('creates immutable versions and restores them from the userData store', async () => {
    const { root, registry } = await createRegistry()
    const created = await registry.create(draft())
    expect(created.success).toBe(true)
    expect(created.role?.version).toBe(1)

    const updated = await registry.update(created.role!.roleId, 1, draft('本地审稿人 v2'))
    expect(updated.success).toBe(true)
    expect(updated.role?.version).toBe(2)
    expect(registry.list().filter((role) => role.roleId === created.role!.roleId)).toHaveLength(2)
    expect(registry.resolve(created.role).label).toBe('本地审稿人')
    expect(registry.resolve(updated.role).label).toBe('本地审稿人 v2')
    expect(registry.buildSystemInstructions(registry.resolve(updated.role))).toContain(
      '尊重证据，明确不确定性',
    )
    expect(registry.buildConversationCompatibilityFingerprint('runtime', created.role, 1)).not.toBe(
      registry.buildConversationCompatibilityFingerprint('runtime', updated.role, 1),
    )

    const restored = new AgentRoleRegistry(new AgentRoleStore(join(root, 'roles.json')))
    await restored.load()
    expect(
      restored.list().find((role) => role.roleId === created.role!.roleId && role.version === 1),
    ).toMatchObject({ label: '本地审稿人', isLatest: false })
    expect(
      restored.list().find((role) => role.roleId === created.role!.roleId && role.version === 2),
    ).toMatchObject({ label: '本地审稿人 v2', isLatest: true })
  })

  it('copies built-ins, archives without deleting versions, and keeps them resolvable', async () => {
    const { registry } = await createRegistry()
    const copied = await registry.copy({ roleId: 'critical-challenger', version: 1 })
    expect(copied.success).toBe(true)
    expect(copied.role).toMatchObject({ source: 'local', version: 1, archived: false })

    const archived = await registry.setArchived(copied.role!.roleId, true)
    expect(archived.role?.archived).toBe(true)
    expect(registry.resolve(copied.role).label).toContain('副本')
  })

  it('restores a legacy archived default without changing its role reference', async () => {
    const { registry } = await createRegistry()
    const created = await registry.create(draft())
    await registry.setArchived(created.role!.roleId, true)

    await expect(registry.restoreArchivedDefault(created.role!)).resolves.toMatchObject({
      success: true,
      role: {
        roleId: created.role!.roleId,
        version: created.role!.version,
        archived: false,
      },
    })
    expect(registry.list().find((role) => role.roleId === created.role!.roleId)).toMatchObject({
      archived: false,
    })
  })

  it('exports and imports a package with the same content fingerprint', async () => {
    const source = await createRegistry()
    const target = await createRegistry()
    const created = await source.registry.create(draft())
    const exportParent = join(source.root, 'exports')
    await mkdir(exportParent)

    const exported = await source.registry.export(created.role!, exportParent)
    expect(exported.success).toBe(true)
    const roleJsonPath = join(exported.directoryPath!, 'role.json')
    expect(JSON.parse(await readFile(roleJsonPath, 'utf8'))).not.toHaveProperty('role.systemPrompt')

    const preview = await target.registry.previewImport(roleJsonPath)
    expect(preview.success).toBe(true)
    expect(preview.preview).toMatchObject({
      conflict: 'none',
      role: { contentHash: created.role!.contentHash },
      skillStatuses: [{ skillId: 'grill-me', version: 1, available: true }],
    })
    const imported = await target.registry.commitImport(preview.preview!.token, 'update')
    expect(imported.success).toBe(true)
    expect(imported.role?.contentHash).toBe(created.role!.contentHash)
    expect(target.registry.resolve(imported.role).label).toBe('本地审稿人')
  })

  it('requires explicit conflict handling and can import as a copy', async () => {
    const source = await createRegistry()
    const created = await source.registry.create(draft())
    const exportParent = join(source.root, 'exports')
    await mkdir(exportParent)
    const exported = await source.registry.export(created.role!, exportParent)

    const first = await source.registry.previewImport(join(exported.directoryPath!, 'role.json'))
    expect(first.preview?.conflict).toBe('same-content')
    const duplicate = await source.registry.commitImport(first.preview!.token, 'copy')
    expect(duplicate.role?.roleId).not.toBe(created.role!.roleId)
    expect(duplicate.role?.label).toContain('导入副本')

    const manifestPath = join(exported.directoryPath!, 'role.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    manifest.contentHash = '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(manifest))
    const rejected = await source.registry.previewImport(manifestPath)
    expect(rejected).toMatchObject({ success: false })
  })

  it('previews missing recommended Skills without blocking import', async () => {
    const source = await createRegistry()
    const target = await createRegistry()
    const created = await source.registry.create({
      ...draft(),
      recommendedSkillRefs: [{ skillId: 'not-installed', version: 3 }],
    })
    const exportParent = join(source.root, 'exports')
    await mkdir(exportParent)
    const exported = await source.registry.export(created.role!, exportParent)

    const preview = await target.registry.previewImport(join(exported.directoryPath!, 'role.json'))
    expect(preview.preview?.skillStatuses).toEqual([
      { skillId: 'not-installed', version: 3, available: false },
    ])
    expect(preview.preview?.warnings.join('\n')).toContain('角色仍可导入')
    const imported = await target.registry.commitImport(preview.preview!.token, 'update')
    expect(imported.success).toBe(true)
  })

  it('rejects executable or remote SOUL content', async () => {
    const { registry } = await createRegistry()
    await expect(
      registry.create({ ...draft(), soulMarkdown: '<script>alert(1)</script>' }),
    ).resolves.toMatchObject({ success: false })
    await expect(
      registry.create({ ...draft(), soulMarkdown: '![remote](https://example.com/a.png)' }),
    ).resolves.toMatchObject({ success: false })
  })
})
