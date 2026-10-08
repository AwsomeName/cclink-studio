import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

const commands = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), { [promisify.custom]: commands.run })
  return { execFile, spawn: commands.spawn }
})
import { MacUpdateInstaller } from './mac-update-installer'

const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cclink-install-test-')))
  roots.push(root)
  const currentAppBundlePath = join(root, 'Studio.app')
  const helperPath = join(root, 'helper')
  const dmgPath = join(root, 'update.dmg')
  await fs.mkdir(currentAppBundlePath)
  await fs.writeFile(helperPath, 'helper')
  await fs.writeFile(dmgPath, 'dmg')
  commands.run.mockResolvedValue({
    stdout: '',
    stderr:
      'Identifier=com.cclink.studio\nTeamIdentifier=H4NAWHF52C\nAuthority=Developer ID Application: Example',
  })
  const stage = vi.fn(async (_input, destination: string) => {
    await fs.mkdir(destination)
    return 'H4NAWHF52C'
  })
  const cacheRoot = join(root, 'updates')
  const installer = new MacUpdateInstaller({
    currentAppBundlePath,
    helperPath,
    currentVersion: '1.0.0',
    cacheRoot,
    verifier: { stage } as never,
  })
  return { root, installer, stage, input: { dmgPath, expectedVersion: '1.1.0' }, cacheRoot }
}

describe('MacUpdateInstaller local transaction boundaries', () => {
  it('requires an official publisher and a matching signed helper to expose installation', async () => {
    const { installer } = await fixture()
    expect(await installer.isAvailable()).toBe(true)
    commands.run.mockResolvedValueOnce({
      stdout: '',
      stderr: 'TeamIdentifier=not set\nSignature=adhoc',
    })
    expect(await installer.isAvailable()).toBe(false)
  })

  it('stages privately next to the target and removes only that transaction when cancelled', async () => {
    const { root, installer, stage, input, cacheRoot } = await fixture()
    const staged = await installer.stage(input)
    const candidate = stage.mock.calls[0][1]
    expect(candidate).toMatch(/\.cclink-update-[0-9a-f-]+\/candidate\.app$/)
    expect((await fs.stat(join(candidate, '..'))).mode & 0o077).toBe(0)
    const nonce = (await fs.readdir(join(cacheRoot, 'installations')))[0]
    const record = JSON.parse(
      await fs.readFile(join(cacheRoot, 'installations', nonce, 'transaction.json'), 'utf8'),
    )
    expect(record.parentPid).toBe(process.pid)
    expect(record.targetPath).toBe(join(root, 'Studio.app'))
    await staged.cancel()
    await expect(fs.stat(candidate)).rejects.toThrow()
    expect((await fs.stat(record.targetPath)).isDirectory()).toBe(true)
  })

  it('does not follow a symlink installation path', async () => {
    const { root, input, cacheRoot } = await fixture()
    await fs.symlink(join(root, 'Studio.app'), join(root, 'Link.app'))
    const installer = new MacUpdateInstaller({
      currentAppBundlePath: join(root, 'Link.app'),
      currentVersion: '1.0.0',
      cacheRoot,
      helperPath: join(root, 'helper'),
      verifier: {} as never,
    })
    await expect(installer.stage(input)).rejects.toMatchObject({ code: 'install_blocked' })
    expect(commands.spawn).not.toHaveBeenCalled()
  })

  it('only commits after a matching native-helper readiness receipt', async () => {
    const { installer, input, cacheRoot } = await fixture()
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      unref: vi.fn(),
    })
    commands.spawn.mockImplementation((_helper, args) => {
      void (async () => {
        const record = JSON.parse(await fs.readFile(join(args[0], 'transaction.json'), 'utf8'))
        await fs.writeFile(join(args[0], 'ready.json'), JSON.stringify({ nonce: record.nonce }), {
          mode: 0o600,
        })
      })()
      return child
    })
    const staged = await installer.stage(input)
    await expect(staged.commit()).rejects.toThrow('Invalid install commit')
    await staged.arm()
    await staged.commit()
    const nonce = (await fs.readdir(join(cacheRoot, 'installations')))[0]
    expect(
      JSON.parse(await fs.readFile(join(cacheRoot, 'installations', nonce, 'commit.json'), 'utf8'))
        .nonce,
    ).toBe(nonce)
  })

  it('binds startup acknowledgements to the local transaction, actual path and running version', async () => {
    const { installer, input, cacheRoot, root } = await fixture()
    const staged = await installer.stage(input)
    const nonce = (await fs.readdir(join(cacheRoot, 'installations')))[0]
    await expect(installer.acknowledgeStartup([`--cclink-update=${nonce}`])).rejects.toThrow(
      'receipt mismatch',
    )
    const next = new MacUpdateInstaller({
      currentAppBundlePath: join(root, 'Studio.app'),
      helperPath: join(root, 'helper'),
      currentVersion: '1.1.0',
      cacheRoot,
      verifier: {} as never,
    })
    await fs.writeFile(
      join(cacheRoot, 'installations', nonce, 'result.json'),
      JSON.stringify({ status: 'succeeded' }),
      { mode: 0o600 },
    )
    await next.acknowledgeStartup([`--cclink-update=${nonce}`])
    expect(
      JSON.parse(
        await fs.readFile(join(cacheRoot, 'installations', nonce, 'started.json'), 'utf8'),
      ),
    ).toMatchObject({ nonce, version: '1.1.0', pid: process.pid })
    await staged.cancel()
  })
})
