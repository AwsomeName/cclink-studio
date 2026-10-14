import { mkdtemp, rm, stat, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentMessageImageStore } from './agent-message-image-store'

const roots: string[] = []
const image = {
  id: 'image-1',
  name: 'screen.png',
  mediaType: 'image/png' as const,
  data: 'AQID',
  size: 3,
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studio-message-image-'))
  roots.push(root)
  return { root, store: new AgentMessageImageStore(root) }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AgentMessageImageStore', () => {
  it('restores images after recreating the store and scopes access to the original conversation', async () => {
    const { store, root } = await fixture()
    const [asset] = await store.save('conversation-a', [image])
    expect(await new AgentMessageImageStore(root).read('conversation-a', asset.assetId)).toBe(
      'data:image/png;base64,AQID',
    )
    await expect(store.read('conversation-b', asset.assetId)).rejects.toThrow()
    const directory = join(root, createHash('sha256').update('conversation-a').digest('hex'))
    expect((await stat(join(directory, asset.assetId))).mode & 0o777).toBe(0o600)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
  })

  it('rejects mismatched image sizes, traversal, modified files and symbolic links', async () => {
    const { store, root } = await fixture()
    await expect(store.save('conversation-a', [{ ...image, size: 4 }])).rejects.toThrow('大小无效')
    await expect(store.read('conversation-a', '../../secret')).rejects.toThrow('引用无效')
    const [asset] = await store.save('conversation-a', [image])
    const directory = join(root, createHash('sha256').update('conversation-a').digest('hex'))
    const path = join(directory, asset.assetId)
    await writeFile(path, Buffer.from([4, 5, 6]))
    await expect(store.read('conversation-a', asset.assetId)).rejects.toThrow('内容校验失败')
    await rm(path)
    const other = join(root, 'other.png')
    await writeFile(other, Buffer.from([1, 2, 3]))
    await symlink(other, path)
    await expect(store.read('conversation-a', asset.assetId)).rejects.toThrow()
  })
})
