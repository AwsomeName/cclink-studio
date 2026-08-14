import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CclinkAuthService } from './auth-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CclinkAuthService identity persistence boundary', () => {
  it('启动时不读取或保留旧用户资料，要求用 refresh token 重新取得身份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-auth-'))
    roots.push(root)
    const legacyPath = join(root, 'cclink-user.json')
    await writeFile(legacyPath, '{"id":"user-1","phone":"13800000000"}\n', { mode: 0o600 })

    const service = new CclinkAuthService(null, root)
    service.initialize()

    expect(service.getUser()).toBeNull()
    const names = await readdir(root)
    expect(names).not.toContain('cclink-user.json')
    expect(names.some((name) => name.startsWith('cclink-user.'))).toBe(false)
  })
})
