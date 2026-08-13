import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CclinkSessionStore } from './session-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CclinkSessionStore', () => {
  it('只用权限收紧的本地文件持久化 refresh token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-session-'))
    roots.push(root)
    const store = new CclinkSessionStore(root)
    store.save('refresh-token-value', Date.now() + 60_000)

    expect(store.load()?.refreshToken).toBe('refresh-token-value')
    expect(statSync(join(root, 'cclink-session.json')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(root, 'cclink-session.json'), 'utf8')).not.toContain('accessToken')
    expect(readFileSync(join(root, 'cclink-session.json'), 'utf8')).not.toContain('imUserSig')
  })

  it('隔离未知或旧密文，不尝试解密迁移', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-session-'))
    roots.push(root)
    writeFileSync(join(root, 'cclink-session.json'), '{"ciphertext":"legacy"}', { mode: 0o600 })
    const store = new CclinkSessionStore(root)

    expect(store.load()).toBeNull()
    expect(existsSync(join(root, 'cclink-session.json'))).toBe(false)
    expect((await readdir(root)).some((name) => name.startsWith('cclink-session.relogin-'))).toBe(
      true,
    )
  })
})
