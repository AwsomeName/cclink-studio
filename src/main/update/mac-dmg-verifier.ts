import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { verifyPureArm64Executable } from './mach-o-architecture'
import { UpdateAssetVerificationError, verificationFailure } from './update-verification-error'

export { UpdateAssetVerificationError } from './update-verification-error'

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

export class MacDmgVerifier implements VerifiedDmgInspector {
  private readonly runCommand: RunCommand

  constructor(private readonly options: MacDmgVerifierOptions) {
    this.runCommand = options.runCommand ?? runSystemCommand
  }

  async verify(input: MacDmgVerificationInput): Promise<void> {
    await this.inspect(input)
  }

  async stage(input: MacDmgVerificationInput, destination: string): Promise<string> {
    return this.inspect(input, destination)
  }

  private async inspect(input: MacDmgVerificationInput, destination?: string): Promise<string> {
    const currentIdentity = await this.readTrustedCurrentIdentity()
    await this.verifyDiskImageSignature(input.dmgPath, currentIdentity.teamIdentifier)

    const mounted = await this.attachReadOnly(input.dmgPath)
    let verificationError: unknown = null
    let step = '挂载候选定位'
    try {
      const candidateApp = await this.findCandidateApp(mounted.mountPoints)
      await this.verifyCandidateApp(
        candidateApp,
        input.expectedVersion,
        currentIdentity.teamIdentifier,
        '挂载候选',
      )
      if (destination) {
        step = '候选复制'
        await this.runCommand('/usr/bin/ditto', [candidateApp, destination])
        await this.verifyCandidateApp(
          destination,
          input.expectedVersion,
          currentIdentity.teamIdentifier,
          '暂存候选',
        )
      }
    } catch (error) {
      verificationError = verificationFailure(step, error)
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
    return currentIdentity.teamIdentifier
  }

  private async readTrustedCurrentIdentity(): Promise<CodeSignatureIdentity> {
    try {
      const identity = await this.readCodeSignature(this.options.currentAppBundlePath)
      if (
        identity.identifier !== EXPECTED_BUNDLE_ID ||
        !identity.teamIdentifier ||
        !identity.developerIdAuthority
      ) {
        throw new UpdateAssetVerificationError(
          'install_blocked',
          '当前安装无法作为可信更新来源，请先手工安装官方基线后再更新',
        )
      }
      return identity
    } catch (error) {
      throw verificationFailure('当前应用身份读取', error)
    }
  }

  private async verifyDiskImageSignature(dmgPath: string, expectedTeamId: string): Promise<void> {
    let step = 'DMG签名检查'
    try {
      await this.runCommand('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', dmgPath])
      step = 'DMG安全评估'
      await this.runCommand('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        '--verbose=4',
        dmgPath,
      ])
      step = 'DMG身份读取'
      const identity = await this.readCodeSignature(dmgPath)
      if (identity.teamIdentifier !== expectedTeamId || !identity.developerIdAuthority) {
        throw new UpdateAssetVerificationError(
          'publisher_mismatch',
          '更新安装包的 Apple 签名或发布者身份不匹配',
        )
      }
    } catch (error) {
      throw verificationFailure(step, error)
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
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw verificationFailure('DMG只读挂载', error)
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
    target: '挂载候选' | '暂存候选',
  ): Promise<void> {
    let step = `${target}：应用签名检查`
    try {
      await this.runCommand('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        '--verbose=2',
        appPath,
      ])
      step = `${target}：应用安全评估`
      await this.runCommand('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'execute',
        '--verbose=4',
        appPath,
      ])
      step = `${target}：应用身份读取`
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

      step = `${target}：应用声明读取`
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
      step = `${target}：可执行文件检查`
      const executableStat = await fs.lstat(executablePath)
      if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
        throw new UpdateAssetVerificationError('release_invalid', '更新应用的可执行文件无效')
      }
      step = `${target}：应用架构读取`
      await verifyPureArm64Executable(executablePath, step)
    } catch (error) {
      throw verificationFailure(step, error)
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
    if (!value || /[\0\r\n]/.test(value)) {
      throw new UpdateAssetVerificationError('release_invalid', '更新应用的声明字段无效')
    }
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
