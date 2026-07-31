import { promises as fs } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MacDmgVerifier, UpdateAssetVerificationError } from './mac-dmg-verifier'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  )
})

interface FixtureOptions {
  currentTeam?: string
  candidateTeam?: string
  version?: string
  architecture?: string
  bundleId?: string
  candidateCount?: number
}

function createFixture(options: FixtureOptions = {}) {
  const calls: Array<{ executable: string; args: string[] }> = []
  const currentAppBundlePath = '/Applications/CCLink Studio 开源版.app'
  const dmgPath = '/private/update/studio-arm64.dmg'
  const currentTeam = options.currentTeam ?? 'TEAM123456'
  const candidateTeam = options.candidateTeam ?? currentTeam
  const version = options.version ?? '1.2.3'
  const architecture = options.architecture ?? 'arm64'
  const bundleId = options.bundleId ?? 'com.cclink.studio'
  const candidateCount = options.candidateCount ?? 1

  const runCommand = vi.fn(async (executable: string, args: string[]) => {
    calls.push({ executable, args })
    if (executable === '/usr/bin/hdiutil' && args[0] === 'attach') {
      const mountPoint = args[args.indexOf('-mountpoint') + 1]
      cleanupPaths.push(mountPoint.split('/volume')[0])
      for (let index = 0; index < candidateCount; index += 1) {
        const appPath = `${mountPoint}/CCLink Studio ${index}.app`
        await fs.mkdir(`${appPath}/Contents/MacOS`, { recursive: true })
        await fs.writeFile(`${appPath}/Contents/Info.plist`, 'fixture')
        await fs.writeFile(`${appPath}/Contents/MacOS/CCLink Studio`, 'fixture')
      }
      return { stdout: '', stderr: '' }
    }
    if (executable === '/usr/bin/codesign' && args[0] === '--display') {
      const path = args.at(-1) ?? ''
      const team =
        path === currentAppBundlePath || path.endsWith('.dmg') ? currentTeam : candidateTeam
      const identifier = path.endsWith('.dmg') ? 'studio-arm64' : bundleId
      const authority = team ? 'Authority=Developer ID Application: Example Publisher' : ''
      return {
        stdout: '',
        stderr: `Identifier=${identifier}\nTeamIdentifier=${team}\n${authority}\n`,
      }
    }
    if (executable === '/usr/bin/plutil') {
      const key = args[args.indexOf('-extract') + 1]
      const values: Record<string, string> = {
        CFBundleIdentifier: bundleId,
        CFBundleShortVersionString: version,
        CFBundleExecutable: 'CCLink Studio',
      }
      return { stdout: `${values[key] ?? ''}\n`, stderr: '' }
    }
    if (executable === '/usr/bin/lipo') {
      return { stdout: `${architecture}\n`, stderr: '' }
    }
    return { stdout: '', stderr: '' }
  })

  return {
    verifier: new MacDmgVerifier({ currentAppBundlePath, runCommand }),
    runCommand,
    calls,
    input: { dmgPath, expectedVersion: '1.2.3' },
  }
}

describe('MacDmgVerifier', () => {
  it('accepts one notarized arm64 app from the same Developer ID team', async () => {
    const fixture = createFixture()

    await expect(fixture.verifier.verify(fixture.input)).resolves.toBeUndefined()

    expect(fixture.calls).toContainEqual({
      executable: '/usr/bin/hdiutil',
      args: expect.arrayContaining(['attach', '-readonly', '-nobrowse', '-noautoopen']),
    })
    expect(fixture.calls.some((call) => call.args[0] === 'detach')).toBe(true)
    expect(
      fixture.calls.some(
        (call) =>
          call.executable === '/usr/sbin/spctl' &&
          call.args.includes('open') &&
          call.args.includes('context:primary-signature'),
      ),
    ).toBe(true)
  })

  it('rejects a candidate app signed by a different team and still detaches the image', async () => {
    const fixture = createFixture({ candidateTeam: 'OTHERTEAM1' })

    await expect(fixture.verifier.verify(fixture.input)).rejects.toMatchObject({
      code: 'publisher_mismatch',
    })
    expect(fixture.calls.some((call) => call.args[0] === 'detach')).toBe(true)
  })

  it('rejects a version that differs from the signed manifest', async () => {
    const fixture = createFixture({ version: '1.2.4' })

    await expect(fixture.verifier.verify(fixture.input)).rejects.toMatchObject({
      code: 'release_invalid',
    })
  })

  it('rejects a non-arm64 or universal candidate', async () => {
    const fixture = createFixture({ architecture: 'x86_64 arm64' })

    await expect(fixture.verifier.verify(fixture.input)).rejects.toMatchObject({
      code: 'unsupported_arch',
    })
  })

  it('rejects a disk image without exactly one application bundle', async () => {
    const fixture = createFixture({ candidateCount: 2 })

    await expect(fixture.verifier.verify(fixture.input)).rejects.toMatchObject({
      code: 'release_invalid',
    })
  })

  it('does not trust an ad-hoc current build as the publisher identity source', async () => {
    const fixture = createFixture({ currentTeam: '' })

    await expect(fixture.verifier.verify(fixture.input)).rejects.toBeInstanceOf(
      UpdateAssetVerificationError,
    )
    expect(fixture.runCommand).not.toHaveBeenCalledWith(
      '/usr/bin/hdiutil',
      expect.arrayContaining(['attach']),
    )
  })
})
