import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { UpdateErrorCode } from '../../shared/update'

const execFileAsync = promisify(execFile)
const EXPECTED_BUNDLE_ID = 'com.cclink.studio'

interface CommandResult {
  stdout: string
  stderr: string
}

type RunCommand = (executable: string, args: string[]) => Promise<CommandResult>

export interface MacDmgVerificationInput {
  dmgPath: string
  expectedVersion: string
}

export interface VerifiedDmgInspector {
  verify(input: MacDmgVerificationInput): Promise<void>
}

export interface MacDmgVerifierOptions {
  currentAppBundlePath: string
  runCommand?: RunCommand
}

interface MountedImage {
  mountPoints: string[]
  cleanupRoot: string
}

interface CodeSignatureIdentity {
  identifier: string
  teamIdentifier: string
  developerIdAuthority: string
}

export class UpdateAssetVerificationError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'UpdateAssetVerificationError'
  }
}

export class MacDmgVerifier implements VerifiedDmgInspector {
  private readonly runCommand: RunCommand

  constructor(private readonly options: MacDmgVerifierOptions) {
    this.runCommand = options.runCommand ?? runSystemCommand
  }

  async verify(input: MacDmgVerificationInput): Promise<void> {
    const currentIdentity = await this.readTrustedCurrentIdentity()
    await this.verifyDiskImageSignature(input.dmgPath, currentIdentity.teamIdentifier)

    const mounted = await this.attachReadOnly(input.dmgPath)
    let verificationError: unknown = null
    try {
      const candidateApp = await this.findCandidateApp(mounted.mountPoints)
      await this.verifyCandidateApp(
        candidateApp,
        input.expectedVersion,
        currentIdentity.teamIdentifier,
      )
    } catch (error) {
      verificationError = error
    }

    try {
      await this.detachAll(mounted)
    } catch (_error) {
      if (!verificationError) {
        throw new UpdateAssetVerificationError(
          'install_failed',
          '安装包检查完成，但 macOS 无法安全卸载检查用磁盘映像',
        )
      }
    }
    if (verificationError) throw verificationError
  }

  private async readTrustedCurrentIdentity(): Promise<CodeSignatureIdentity> {
    try {
      const identity = await this.readCodeSignature(this.options.currentAppBundlePath)
      if (
        identity.identifier !== EXPECTED_BUNDLE_ID ||
        !identity.teamIdentifier ||
        !identity.developerIdAuthority
      ) {
        throw new Error('Current application is not a trusted Developer ID build')
      }
      return identity
    } catch {
      throw new UpdateAssetVerificationError(
        'publisher_mismatch',
        '当前安装不是可验证的官方签名版本，不能从应用内打开更新包',
      )
    }
  }

  private async verifyDiskImageSignature(dmgPath: string, expectedTeamId: string): Promise<void> {
    try {
      await this.runCommand('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', dmgPath])
      await this.runCommand('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        '--verbose=4',
        dmgPath,
      ])
      const identity = await this.readCodeSignature(dmgPath)
      if (identity.teamIdentifier !== expectedTeamId || !identity.developerIdAuthority) {
        throw new Error('Disk image publisher does not match')
      }
    } catch {
      throw new UpdateAssetVerificationError(
        'publisher_mismatch',
        '更新安装包的 Apple 签名或发布者身份不匹配',
      )
    }
  }

  private async attachReadOnly(dmgPath: string): Promise<MountedImage> {
    const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'cclink-update-dmg-'))
    const mountPoint = join(temporaryDirectory, 'volume')
    await fs.mkdir(mountPoint, { mode: 0o700 })
    try {
      await this.runCommand('/usr/bin/hdiutil', [
        'attach',
        '-readonly',
        '-nobrowse',
        '-noautoopen',
        '-mountpoint',
        mountPoint,
        dmgPath,
      ])
      return { mountPoints: [mountPoint], cleanupRoot: temporaryDirectory }
    } catch {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw new UpdateAssetVerificationError(
        'release_invalid',
        'macOS 无法以只读方式检查更新安装包',
      )
    }
  }

  private async findCandidateApp(mountPoints: string[]): Promise<string> {
    const candidates: string[] = []
    for (const mountPoint of mountPoints) {
      const entries = await fs.readdir(mountPoint, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.name.endsWith('.app') || !entry.isDirectory() || entry.isSymbolicLink()) continue
        const candidate = join(mountPoint, entry.name)
        const canonicalMount = await fs.realpath(mountPoint)
        const canonicalCandidate = await fs.realpath(candidate)
        if (!isDescendant(canonicalMount, canonicalCandidate)) continue
        candidates.push(candidate)
      }
    }
    if (candidates.length !== 1) {
      throw new UpdateAssetVerificationError(
        'release_invalid',
        '更新安装包中没有唯一、有效的 CCLink Studio 应用',
      )
    }
    return candidates[0]
  }

  private async verifyCandidateApp(
    appPath: string,
    expectedVersion: string,
    expectedTeamId: string,
  ): Promise<void> {
    try {
      await this.runCommand('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--verbose=2',
        appPath,
      ])
      await this.runCommand('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'execute',
        '--verbose=4',
        appPath,
      ])
      const identity = await this.readCodeSignature(appPath)
      if (
        identity.identifier !== EXPECTED_BUNDLE_ID ||
        identity.teamIdentifier !== expectedTeamId ||
        !identity.developerIdAuthority
      ) {
        throw new UpdateAssetVerificationError(
          'publisher_mismatch',
          '更新应用的 Bundle ID 或发布者身份不匹配',
        )
      }

      const infoPlist = join(appPath, 'Contents', 'Info.plist')
      const [bundleId, version, executableName] = await Promise.all([
        this.readPlistString(infoPlist, 'CFBundleIdentifier'),
        this.readPlistString(infoPlist, 'CFBundleShortVersionString'),
        this.readPlistString(infoPlist, 'CFBundleExecutable'),
      ])
      if (bundleId !== EXPECTED_BUNDLE_ID || version !== expectedVersion) {
        throw new UpdateAssetVerificationError(
          'release_invalid',
          '更新应用的产品标识或版本与更新清单不一致',
        )
      }
      if (basename(executableName) !== executableName || /[\0\r\n]/.test(executableName)) {
        throw new UpdateAssetVerificationError('release_invalid', '更新应用的可执行文件声明无效')
      }
      const executablePath = join(appPath, 'Contents', 'MacOS', executableName)
      const executableStat = await fs.lstat(executablePath)
      if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
        throw new UpdateAssetVerificationError('release_invalid', '更新应用的可执行文件无效')
      }
      const { stdout } = await this.runCommand('/usr/bin/lipo', ['-archs', executablePath])
      const architectures = stdout.trim().split(/\s+/).filter(Boolean)
      if (architectures.length !== 1 || architectures[0] !== 'arm64') {
        throw new UpdateAssetVerificationError(
          'unsupported_arch',
          '更新应用不是纯 Apple Silicon arm64 构建',
        )
      }
    } catch (error) {
      if (error instanceof UpdateAssetVerificationError) throw error
      throw new UpdateAssetVerificationError(
        'publisher_mismatch',
        '更新应用未通过 Apple 签名、公证或身份检查',
      )
    }
  }

  private async readCodeSignature(path: string): Promise<CodeSignatureIdentity> {
    const result = await this.runCommand('/usr/bin/codesign', ['--display', '--verbose=4', path])
    const details = `${result.stdout}\n${result.stderr}`
    return {
      identifier: readSignatureValue(details, 'Identifier'),
      teamIdentifier: readSignatureValue(details, 'TeamIdentifier'),
      developerIdAuthority:
        details.match(/^Authority=(Developer ID Application:[^\r\n]+)$/m)?.[1] ?? '',
    }
  }

  private async readPlistString(plistPath: string, key: string): Promise<string> {
    const { stdout } = await this.runCommand('/usr/bin/plutil', [
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      plistPath,
    ])
    const value = stdout.trim()
    if (!value || /[\0\r\n]/.test(value)) throw new Error(`Missing plist key ${key}`)
    return value
  }

  private async detachAll(mounted: MountedImage): Promise<void> {
    let firstError: unknown = null
    for (const mountPoint of [...mounted.mountPoints].reverse()) {
      try {
        await this.runCommand('/usr/bin/hdiutil', ['detach', mountPoint])
      } catch (error) {
        try {
          await this.runCommand('/usr/bin/hdiutil', ['detach', '-force', mountPoint])
        } catch {
          firstError ??= error
        }
      }
    }
    if (!firstError) {
      await fs.rm(mounted.cleanupRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    if (firstError) throw firstError
  }
}

async function runSystemCommand(executable: string, args: string[]): Promise<CommandResult> {
  const result = await execFileAsync(executable, args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  }
}

function readSignatureValue(details: string, key: string): string {
  return details.match(new RegExp(`^${key}=([^\\r\\n]+)$`, 'm'))?.[1]?.trim() ?? ''
}

function isDescendant(parent: string, child: string): boolean {
  const childPath = relative(resolve(parent), resolve(child))
  return Boolean(childPath) && !childPath.startsWith('..') && !childPath.startsWith('/')
}
