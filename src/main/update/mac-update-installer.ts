import { spawn, execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  MacDmgVerifier,
  UpdateAssetVerificationError,
  type MacDmgVerificationInput,
} from './mac-dmg-verifier'
import type { StagedUpdateInstallation, UpdateInstaller } from './update-installer'

const run = promisify(execFile)
interface Options {
  currentAppBundlePath: string
  currentVersion: string
  cacheRoot: string
  helperPath: string
  verifier: MacDmgVerifier
}

export class MacUpdateInstaller implements UpdateInstaller {
  constructor(private readonly options: Options) {}

  async isAvailable(): Promise<boolean> {
    try {
      const identity = await run('/usr/bin/codesign', [
        '--display',
        '--verbose=4',
        this.options.currentAppBundlePath,
      ])
      const details = `${identity.stdout}\n${identity.stderr}`
      const team = details.match(/^TeamIdentifier=([A-Z0-9]{10})$/m)?.[1]
      if (
        !team ||
        !/^Identifier=com\.cclink\.studio$/m.test(details) ||
        !/^Authority=Developer ID Application:/m.test(details)
      )
        return false
      await run('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '-R',
        `=anchor apple generic and certificate leaf[subject.OU] = "${team}"`,
        this.options.helperPath,
      ])
      return true
    } catch {
      return false
    }
  }

  async previousFailure(): Promise<string | null> {
    const installationRoot = join(this.options.cacheRoot, 'installations')
    const entries = await fs.readdir(installationRoot).catch(() => [])
    const failures: Array<{ time: number; message: string }> = []
    for (const nonce of entries) {
      if (!/^[0-9a-f-]{36}$/.test(nonce)) continue
      const root = join(installationRoot, nonce)
      try {
        const directory = await fs.lstat(root)
        if (
          !directory.isDirectory() ||
          directory.isSymbolicLink() ||
          directory.mode & 0o077 ||
          directory.uid !== process.getuid?.()
        )
          continue
        const transaction = await readPrivateJson(join(root, 'transaction.json'))
        const result = await readPrivateJson(join(root, 'result.json'))
        if (
          transaction.nonce !== nonce ||
          transaction.targetPath !== (await fs.realpath(this.options.currentAppBundlePath)) ||
          transaction.currentVersion !== this.options.currentVersion
        )
          continue
        if (['rolled_back', 'failed', 'recovery_required'].includes(String(result.status))) {
          const info = await fs.stat(join(root, 'result.json'))
          failures.push({
            time: info.mtimeMs,
            message:
              result.status === 'rolled_back'
                ? '新版未能完成启动，已自动恢复旧版。请重试，或使用手工安装。'
                : '上次自动安装失败；旧版和安装证据已保留，请重试或使用手工安装。',
          })
        }
      } catch {
        /* Do not let stale or invalid receipts block the local workbench. */
      }
    }
    return failures.sort((left, right) => right.time - left.time)[0]?.message ?? null
  }

  async stage(input: MacDmgVerificationInput): Promise<StagedUpdateInstallation> {
    const targetPath = resolve(this.options.currentAppBundlePath)
    if (
      targetPath !== (await fs.realpath(targetPath)) ||
      targetPath.includes('/AppTranslocation/') ||
      targetPath.startsWith('/Volumes/')
    ) {
      throw new UpdateAssetVerificationError(
        'install_blocked',
        '请先将 Studio 安装到本机可写目录，再使用自动更新',
      )
    }
    await fs.access(dirname(targetPath), constants.W_OK)
    // The helper must belong to the intact current App, not merely be any binary from the same team.
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', targetPath])
    const nonce = randomUUID()
    const stagePath = join(dirname(targetPath), `.cclink-update-${nonce}`)
    const root = join(this.options.cacheRoot, 'installations', nonce)
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    await fs.chmod(root, 0o700)
    // mkdir is also the authoritative write-permission check; no elevation is attempted.
    await fs.mkdir(stagePath, { mode: 0o700 })
    let helper: ReturnType<typeof spawn> | null = null
    try {
      const candidatePath = join(stagePath, 'candidate.app')
      const disk = await fs.statfs(stagePath)
      const dmg = await fs.stat(input.dmgPath)
      if (disk.bavail * disk.bsize < dmg.size * 5 + 512 * 1024 * 1024) {
        throw new UpdateAssetVerificationError(
          'disk_space_insufficient',
          '安装目录剩余空间不足，请释放空间后重试',
        )
      }
      const teamId = await this.options.verifier.stage(input, candidatePath)
      await run('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '-R',
        `=anchor apple generic and certificate leaf[subject.OU] = "${teamId}"`,
        this.options.helperPath,
      ])
      const helperPath = join(root, 'install-helper')
      await fs.copyFile(this.options.helperPath, helperPath, constants.COPYFILE_EXCL)
      await fs.chmod(helperPath, 0o700)
      await run('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '-R',
        `=anchor apple generic and certificate leaf[subject.OU] = "${teamId}"`,
        helperPath,
      ])
      await writePrivateJson(join(root, 'transaction.json'), {
        nonce,
        targetPath,
        candidatePath,
        teamId,
        parentPid: process.pid,
        currentVersion: this.options.currentVersion,
        targetVersion: input.expectedVersion,
      })
      let armed = false
      let committed = false
      let failureListener: (() => void) | undefined
      const cancel = async (): Promise<void> => {
        if (committed) return
        if (helper && helper.exitCode === null) {
          await writePrivateJson(join(root, 'cancel.json'), { nonce })
          const deadline = Date.now() + 10_000
          while (helper.exitCode === null && Date.now() < deadline)
            await new Promise((done) => setTimeout(done, 100))
          // Keep the private evidence if the helper has not exited; never race its filesystem use.
          if (helper.exitCode === null) return
        }
        await fs.rm(stagePath, { recursive: true, force: true })
        await fs.rm(root, { recursive: true, force: true })
      }
      return {
        observeFailure: (listener) => {
          failureListener = listener
        },
        arm: async () => {
          if (armed) throw new Error('Install helper already armed')
          armed = true
          let launchError: Error | null = null
          helper = spawn(helperPath, [root], { detached: true, stdio: 'ignore' })
          helper.on('error', (error) => {
            launchError = error
          })
          helper.on('exit', () => {
            if (committed) failureListener?.()
          })
          helper.unref()
          const deadline = Date.now() + 30_000
          while (Date.now() < deadline) {
            if (launchError || helper.exitCode !== null)
              throw new Error('Install helper failed to start')
            const ready = await readPrivateJson(join(root, 'ready.json')).catch(() => null)
            if (ready?.nonce === nonce) return
            await new Promise((done) => setTimeout(done, 100))
          }
          throw new Error('Install helper readiness timed out')
        },
        commit: async () => {
          if (
            !armed ||
            committed ||
            !helper ||
            helper.exitCode !== null ||
            helper.signalCode !== null
          )
            throw new Error('Invalid install commit')
          await writePrivateJson(join(root, 'commit.json'), { nonce })
          committed = true
        },
        cancel,
      }
    } catch (error) {
      await fs.rm(stagePath, { recursive: true, force: true }).catch(() => undefined)
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Called only after main bootstrap and a real renderer flush acknowledgement. */
  async acknowledgeStartup(argv: string[]): Promise<void> {
    const nonce = argv
      .find((value) => value.startsWith('--cclink-update='))
      ?.slice('--cclink-update='.length)
    if (!nonce || !/^[0-9a-f-]{36}$/.test(nonce)) return
    const root = join(this.options.cacheRoot, 'installations', nonce)
    const info = await fs.lstat(root)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.mode & 0o077 ||
      info.uid !== process.getuid?.()
    )
      throw new Error('Invalid update receipt directory')
    const transaction = await readPrivateJson(join(root, 'transaction.json'))
    if (
      transaction.nonce !== nonce ||
      transaction.targetPath !== (await fs.realpath(this.options.currentAppBundlePath)) ||
      transaction.targetVersion !== this.options.currentVersion
    )
      throw new Error('Update startup receipt mismatch')
    await writePrivateJson(join(root, 'started.json'), {
      nonce,
      version: this.options.currentVersion,
      pid: process.pid,
    })
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const result = await readPrivateJson(join(root, 'result.json')).catch(() => null)
      if (result?.status === 'succeeded') return
      if (result) throw new Error('Install helper did not confirm startup')
      await new Promise((done) => setTimeout(done, 100))
    }
    throw new Error('Install helper startup confirmation timed out')
  }
}

async function readPrivateJson(path: string): Promise<Record<string, unknown>> {
  const info = await fs.lstat(path)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 16_384 ||
    info.mode & 0o077 ||
    info.uid !== process.getuid?.()
  )
    throw new Error('Invalid installation record')
  return JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, unknown>
}

async function writePrivateJson(path: string, record: Record<string, unknown>): Promise<void> {
  const handle = await fs.open(path, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(record), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}
