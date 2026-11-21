import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSetCredentialInput } from '../../shared/ipc/credentials-schema'
import { RemoteDesktopDeviceStore } from './device-store'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cclink-remote-desktop-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('RemoteDesktopDeviceStore', () => {
  it('creates, reuses by host and port, and updates by id', async () => {
    let clock = 1
    const store = new RemoteDesktopDeviceStore(dir, () => clock++)
    const first = await store.save({ id: null, name: ' 美国 Mac ', host: 'Mac.Local', port: 5900 })
    expect(first).toMatchObject({ name: '美国 Mac', host: 'mac.local', port: 5900 })

    // A migrated legacy Tab with the same address reuses the device instead of duplicating it.
    const again = await store.save({ id: null, name: 'other', host: 'mac.local', port: 5900 })
    expect(again.id).toBe(first.id)

    const moved = await store.save({ id: first.id, name: '美国 Mac', host: '10.0.0.8', port: 5901 })
    expect(moved.id).toBe(first.id)
    expect(await store.list()).toHaveLength(1)

    // Persisted for the next launch, without any credential field, with owner-only permissions.
    const file = join(dir, 'devices.json')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    expect(raw.devices[0]).toEqual({
      id: first.id,
      name: '美国 Mac',
      host: '10.0.0.8',
      port: 5901,
      createdAt: first.createdAt,
      updatedAt: moved.updatedAt,
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await new RemoteDesktopDeviceStore(dir).get(first.id)).toMatchObject({ port: 5901 })
  })

  it('treats a corrupt file as empty without overwriting it on read', async () => {
    const file = join(dir, 'devices.json')
    await writeFile(file, '{not json')
    const store = new RemoteDesktopDeviceStore(dir)
    expect(await store.list()).toEqual([])
    expect(await readFile(file, 'utf8')).toBe('{not json')
  })
})

describe('remote desktop credential ids', () => {
  const id = 'remote-desktop:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
  it('accepts per-device ids and keeps passwords exact', () => {
    const parsed = parseSetCredentialInput({
      id,
      kind: 'basic',
      fields: { username: 'apple', password: ' with spaces ' },
    })
    expect(parsed.fields.password).toBe(' with spaces ')
  })
  it('rejects ids that are not a device uuid', () => {
    expect(() =>
      parseSetCredentialInput({ id: 'remote-desktop:../x', kind: 'basic', fields: { a: 'b' } }),
    ).toThrow()
  })
})
