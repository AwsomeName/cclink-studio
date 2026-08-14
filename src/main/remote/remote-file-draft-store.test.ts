import { readdir, stat } from 'node:fs/promises'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteFileDraftStore } from './remote-file-draft-store'

const roots: string[] = []
const ref = {
  kind: 'remote' as const,
  transport: 'cclink' as const,
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/srv/project',
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RemoteFileDraftStore', () => {
  it('以 0600 文件跨实例恢复草稿并支持目录重命名和删除', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-drafts-'))
    roots.push(root)
    const filePath = join(root, 'nested', 'file-drafts.json')
    const store = new RemoteFileDraftStore(filePath)
    await store.save({
      ref,
      path: '/srv/project/src/a.ts',
      content: 'changed',
      savedContent: 'saved',
      sha256: 'a'.repeat(64),
      updatedAt: 1,
    })
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)

    const restored = new RemoteFileDraftStore(filePath)
    expect(await restored.get(ref, '/srv/project/src/a.ts')).toMatchObject({ content: 'changed' })
    await restored.rebasePrefix(ref, '/srv/project/src', '/srv/project/lib')
    expect(await restored.get(ref, '/srv/project/src/a.ts')).toBeNull()
    expect(await restored.get(ref, '/srv/project/lib/a.ts')).toMatchObject({ content: 'changed' })
    await restored.deletePrefix(ref, '/srv/project/lib')
    expect(await restored.get(ref, '/srv/project/lib/a.ts')).toBeNull()
  })

  it('损坏状态会隔离而不是覆盖', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-drafts-'))
    roots.push(root)
    const filePath = join(root, 'file-drafts.json')
    await writeFile(filePath, '{broken', 'utf8')
    const store = new RemoteFileDraftStore(filePath)
    expect(await store.get(ref, '/srv/project/a.ts')).toBeNull()
    expect((await readdir(root)).some((name) => name.startsWith('file-drafts.json.corrupt-'))).toBe(
      true,
    )
  })

  it('一次写入失败不会毒化后续保存队列', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-drafts-'))
    roots.push(root)
    const blockedParent = join(root, 'blocked')
    await writeFile(blockedParent, 'not-a-directory', 'utf8')
    const store = new RemoteFileDraftStore(join(blockedParent, 'file-drafts.json'))
    const draft = {
      ref,
      path: '/srv/project/a.ts',
      content: 'changed',
      savedContent: 'saved',
      sha256: 'a'.repeat(64),
      updatedAt: 1,
    }

    await expect(store.save(draft)).rejects.toThrow()
    await rm(blockedParent)
    await mkdir(blockedParent)
    await expect(store.save({ ...draft, content: 'changed-again' })).resolves.toBeUndefined()
    expect(
      (await new RemoteFileDraftStore(join(blockedParent, 'file-drafts.json')).get(ref, draft.path))
        ?.content,
    ).toBe('changed-again')
  })
})
