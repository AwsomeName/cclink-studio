import {
  existsSync,
  mkdirSync,
  rmSync,
  renameSync,
  createWriteStream,
  writeFileSync,
  chmodSync,
  readdirSync,
  statSync,
} from 'fs'
import { join, dirname } from 'path'
import * as https from 'https'
import yauzl from 'yauzl'
import {
  getSdkRoot,
  getPlatformToolsDir,
  getAdbPath,
  getEmulatorPath,
  getSystemImageDir,
  getAvdDir,
  getPlatformToolsSuffix,
  getAbi,
  isWindows,
  withExe,
  DEFAULT_AVD_NAME,
  DEFAULT_API_LEVEL,
} from '../../src/main/android/android-platform'
import { resolveEmulator, resolveSystemImage } from './sdk-repository'

export { getAdbPath } from '../../src/main/android/android-platform'

/**
 * Android SDK 自动安装器（跨平台：macOS / Windows / Linux）
 *
 * 自下载 adb、emulator、系统镜像并创建默认 AVD，用户无需安装 Android Studio。
 * 下载源全部为 Google 官方仓库；emulator/系统镜像下载前需用户接受
 * Android SDK License（见 sdk-repository.ts）。
 */

const REPO_BASE = 'https://dl.google.com/android/repository/'

/** license 接受状态持久化文件 */
function getLicenseFlagPath(): string {
  return join(getSdkRoot(), '.license-accepted')
}

// ─── 状态检查 ───────────────────────────────────────

export function isAdbInstalled(): boolean {
  return existsSync(getAdbPath())
}

export function isEmulatorInstalled(): boolean {
  return existsSync(getEmulatorPath())
}

export function isSystemImageInstalled(): boolean {
  return existsSync(join(getSystemImageDir(), 'system.img'))
}

export function isDefaultAvdCreated(): boolean {
  return existsSync(join(getAvdDir(), `${DEFAULT_AVD_NAME}.avd`, 'config.ini'))
}

/** 是否已接受 Android SDK License */
export function isLicenseAccepted(): boolean {
  return existsSync(getLicenseFlagPath())
}

/** 记录用户已接受 License */
export function acceptLicense(): void {
  const root = getSdkRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  writeFileSync(getLicenseFlagPath(), new Date().toISOString(), 'utf-8')
}

export function getSetupStatus(): {
  adb: boolean
  emulator: boolean
  systemImage: boolean
  avd: boolean
  licenseAccepted: boolean
  ready: boolean
} {
  const adb = isAdbInstalled()
  const emulator = isEmulatorInstalled()
  const systemImage = isSystemImageInstalled()
  const avd = isDefaultAvdCreated()
  return {
    adb,
    emulator,
    systemImage,
    avd,
    licenseAccepted: isLicenseAccepted(),
    ready: adb && emulator && systemImage && avd,
  }
}

/**
 * 获取需要展示给用户同意的 License 正文
 *
 * 从 emulator 包引用的 license 读取（emulator 与系统镜像共用
 * android-sdk-license）。manifest 不可达时返回兜底说明。
 */
export async function getLicense(): Promise<{ id: string; text: string }> {
  try {
    const { license } = await resolveEmulator()
    if (license?.text) return license
  } catch (err) {
    console.warn('[SdkSetup] 获取 License 失败:', err)
  }
  return {
    id: 'android-sdk-license',
    text:
      '安装 Android 模拟器需要下载 Google 官方的 Android 模拟器与系统镜像，' +
      '这些组件受《Android Software Development Kit License Agreement》约束。\n\n' +
      '完整条款见：https://developer.android.com/studio/terms\n\n' +
      '点击「同意并继续」表示你已阅读并接受上述协议。',
  }
}

// ─── 下载 / 解压 ────────────────────────────────────

interface DownloadProgress {
  bytesDownloaded: number
  bytesTotal: number
  percent: number
}

/** 单次连接的下载结果 */
interface ChunkOutcome {
  /** 是否已完整下载完成 */
  done: boolean
}

/** 空闲多久（无数据）判定为卡死并重连，单位毫秒 */
const IDLE_TIMEOUT_MS = 25000
/** 最大重试次数（含首次） */
const MAX_ATTEMPTS = 8

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 健壮下载：断点续传 + 空闲重连
 *
 * 国内连 Google CDN 经常在中途被掐断（socket 静默不再发数据），
 * 因此每次连接都带 Range 从已下载字节继续，空闲超时即销毁重连，
 * 最多重试 MAX_ATTEMPTS 次，避免「卡在 91%」这类永久挂起。
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const dir = dirname(destPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // 幂等：最终文件已存在（上次已下完）则直接复用，避免重下大文件
  if (existsSync(destPath)) {
    console.log(`[SdkSetup] 已存在完整文件，跳过下载: ${destPath}`)
    return
  }
  const tempPath = destPath + '.downloading'

  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startByte = existsSync(tempPath) ? statSync(tempPath).size : 0
    try {
      const outcome = await downloadChunk(url, tempPath, startByte, onProgress)
      if (outcome.done) {
        renameSync(tempPath, destPath)
        return
      }
    } catch (err: any) {
      lastErr = err
      console.warn(`[SdkSetup] 下载中断（第 ${attempt}/${MAX_ATTEMPTS} 次，已存 ${startByte} 字节）：${err.message}，准备续传...`)
      await sleep(Math.min(2000 * attempt, 8000))
    }
  }
  throw new Error(`下载失败（已重试 ${MAX_ATTEMPTS} 次）：${lastErr?.message ?? '未知错误'}`)
}

/**
 * 单次连接下载（支持从 startByte 续传）
 */
function downloadChunk(
  url: string,
  tempPath: string,
  startByte: number,
  onProgress?: (p: DownloadProgress) => void,
): Promise<ChunkOutcome> {
  return new Promise<ChunkOutcome>((resolve, reject) => {
    const request = (currentUrl: string, redirects = 0): void => {
      if (redirects > 5) {
        reject(new Error('重定向次数过多'))
        return
      }

      const mod = currentUrl.startsWith('https') ? https : require('http')
      const headers: Record<string, string> = {}
      if (startByte > 0) headers['Range'] = `bytes=${startByte}-`

      const req = mod.get(currentUrl, { timeout: 30000, headers }, (response: any) => {
        const status = response.statusCode

        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume()
          request(response.headers.location, redirects + 1)
          return
        }

        // 416：请求范围超界，说明已下完整文件
        if (status === 416) {
          response.resume()
          resolve({ done: true })
          return
        }

        if (status !== 200 && status !== 206) {
          response.resume()
          reject(new Error(`HTTP ${status}`))
          return
        }

        // 服务器是否真正支持续传：发了 Range 却回 200 表示忽略，需从头来
        const resuming = startByte > 0 && status === 206
        if (startByte > 0 && status === 200) {
          rmSync(tempPath, { force: true })
        }

        // 计算总大小：优先 Content-Range 的 total
        let totalBytes = 0
        const contentRange = response.headers['content-range'] as string | undefined
        const contentLength = parseInt(response.headers['content-length'] ?? '0', 10)
        if (contentRange) {
          const m = /\/(\d+)\s*$/.exec(contentRange)
          if (m) totalBytes = parseInt(m[1]!, 10)
        }
        if (!totalBytes) {
          totalBytes = resuming ? startByte + contentLength : contentLength
        }

        let downloaded = resuming ? startByte : 0
        const file = createWriteStream(tempPath, { flags: resuming ? 'a' : 'w' })

        let idleTimer: NodeJS.Timeout
        const resetIdle = (): void => {
          clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            req.destroy(new Error(`空闲超时（${IDLE_TIMEOUT_MS / 1000}s 无数据）`))
          }, IDLE_TIMEOUT_MS)
        }
        resetIdle()

        response.on('data', (chunk: Buffer) => {
          resetIdle()
          downloaded += chunk.length
          if (onProgress && totalBytes > 0) {
            onProgress({
              bytesDownloaded: downloaded,
              bytesTotal: totalBytes,
              percent: Math.min(100, Math.round((downloaded / totalBytes) * 100)),
            })
          }
        })

        response.pipe(file)

        file.on('finish', () => {
          clearTimeout(idleTimer)
          file.close()
          // 校验是否真的下完
          const finalSize = existsSync(tempPath) ? statSync(tempPath).size : 0
          if (totalBytes > 0 && finalSize < totalBytes) {
            reject(new Error(`数据不完整（${finalSize}/${totalBytes}）`))
          } else {
            resolve({ done: true })
          }
        })

        file.on('error', (err: Error) => {
          clearTimeout(idleTimer)
          reject(err)
        })

        response.on('error', (err: Error) => {
          clearTimeout(idleTimer)
          file.close()
          reject(err)
        })
      })

      req.on('timeout', () => {
        req.destroy(new Error('连接超时'))
      })
      req.on('error', reject)
    }

    request(url)
  })
}

/**
 * 跨平台流式解压 ZIP（不依赖系统 unzip 命令）
 *
 * 用 yauzl 逐条目以流方式写盘，绝不把单个条目整体读进内存——
 * 系统镜像里的 system.img/userdata.img 解压后可达数 GB，
 * 内存型解压（adm-zip）会触发 ERR_BUFFER_TOO_LARGE。
 */
function unzip(zipPath: string, destDir: string): Promise<void> {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('无法打开 zip 文件'))
        return
      }

      zipfile.on('error', reject)
      zipfile.on('end', () => resolve())

      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        const outPath = join(destDir, entry.fileName)

        // 目录条目（以 / 结尾）
        if (/[/\\]$/.test(entry.fileName)) {
          mkdirSync(outPath, { recursive: true })
          zipfile.readEntry()
          return
        }

        mkdirSync(dirname(outPath), { recursive: true })
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            reject(streamErr ?? new Error(`无法读取条目: ${entry.fileName}`))
            return
          }
          const ws = createWriteStream(outPath)
          ws.on('error', reject)
          readStream.on('error', reject)
          readStream.on('end', () => zipfile.readEntry())
          readStream.pipe(ws)
        })
      })
    })
  })
}

/** 递归赋予可执行权限（Windows 无需） */
function chmodTreeExecutable(dir: string): void {
  if (isWindows() || !existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      chmodTreeExecutable(full)
    } else {
      try {
        chmodSync(full, 0o755)
      } catch {
        // 忽略个别文件权限设置失败
      }
    }
  }
}

// ─── 安装步骤 ───────────────────────────────────────

/**
 * Step 1: 下载 platform-tools（含 adb），约 10MB
 */
export async function installAdb(onProgress?: (p: DownloadProgress) => void): Promise<string> {
  console.log('[SdkSetup] 下载 platform-tools (adb)...')
  const sdkRoot = getSdkRoot()
  if (!existsSync(sdkRoot)) mkdirSync(sdkRoot, { recursive: true })

  const zipUrl = `${REPO_BASE}platform-tools-latest-${getPlatformToolsSuffix()}.zip`
  const zipPath = join(sdkRoot, 'platform-tools.zip')

  await downloadFile(zipUrl, zipPath, onProgress)
  await unzip(zipPath, sdkRoot)
  rmSync(zipPath, { force: true })
  chmodTreeExecutable(getPlatformToolsDir())

  console.log(`[SdkSetup] adb 安装完成: ${getAdbPath()}`)
  return getAdbPath()
}

/**
 * Step 2: 下载 emulator（约 300MB+），URL 从官方 manifest 解析
 */
export async function installEmulator(onProgress?: (p: DownloadProgress) => void): Promise<string> {
  console.log('[SdkSetup] 解析 emulator 下载地址...')
  const { archive } = await resolveEmulator()
  const sdkRoot = getSdkRoot()
  if (!existsSync(sdkRoot)) mkdirSync(sdkRoot, { recursive: true })

  const zipPath = join(sdkRoot, 'emulator.zip')
  await downloadFile(archive.url, zipPath, onProgress)
  // emulator.zip 内自带 emulator/ 顶层目录，解压到 sdkRoot 即可
  await unzip(zipPath, sdkRoot)
  rmSync(zipPath, { force: true })
  chmodTreeExecutable(join(sdkRoot, 'emulator'))

  console.log(`[SdkSetup] emulator 安装完成: ${getEmulatorPath()}`)
  return getEmulatorPath()
}

/**
 * Step 3: 下载系统镜像（约 1GB），ABI 按当前架构自动选择
 */
export async function installSystemImage(
  onProgress?: (p: DownloadProgress) => void,
  api: number = DEFAULT_API_LEVEL,
): Promise<string> {
  console.log(`[SdkSetup] 解析系统镜像下载地址（${getAbi()} / API ${api}）...`)
  const { archive } = await resolveSystemImage(api)
  const sdkRoot = getSdkRoot()
  const imageDir = getSystemImageDir(api)

  const zipPath = join(sdkRoot, 'system-image.zip')
  await downloadFile(archive.url, zipPath, onProgress)

  // 镜像归档内顶层是一个 ABI 目录（如 arm64-v8a/），需提升一层到 imageDir
  const tmpExtract = join(sdkRoot, '.sysimg-extract')
  rmSync(tmpExtract, { recursive: true, force: true })
  await unzip(zipPath, tmpExtract)
  rmSync(zipPath, { force: true })

  if (!existsSync(dirname(imageDir))) mkdirSync(dirname(imageDir), { recursive: true })
  rmSync(imageDir, { recursive: true, force: true })

  // 找到含 system.img 的目录作为镜像根
  const innerRoot = findImageRoot(tmpExtract)
  renameSync(innerRoot, imageDir)
  rmSync(tmpExtract, { recursive: true, force: true })

  console.log(`[SdkSetup] 系统镜像安装完成: ${imageDir}`)
  return imageDir
}

/** 在解压目录里找到含 system.img 的目录 */
function findImageRoot(dir: string): string {
  if (existsSync(join(dir, 'system.img'))) return dir
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      try {
        return findImageRoot(full)
      } catch {
        // 继续找下一个子目录
      }
    }
  }
  throw new Error('解压后的系统镜像中未找到 system.img')
}

/**
 * Step 4: 创建默认 AVD（直接生成配置文件，不依赖 avdmanager）
 *
 * ABI / CPU 架构按当前机器动态生成，保证 Windows/Intel 用 x86_64、
 * Apple Silicon 用 arm64-v8a。
 */
export async function createDefaultAvd(api: number = DEFAULT_API_LEVEL): Promise<string> {
  const avdName = DEFAULT_AVD_NAME
  const avdDir = join(getAvdDir(), `${avdName}.avd`)
  const iniPath = join(getAvdDir(), `${avdName}.ini`)
  if (!existsSync(avdDir)) mkdirSync(avdDir, { recursive: true })

  const imageDir = getSystemImageDir(api)
  const abi = getAbi()
  const cpuArch = abi === 'arm64-v8a' ? 'arm64' : 'x86_64'

  const avdIni = [
    `avd.ini.encoding=UTF-8`,
    `path=${avdDir}`,
    `path.rel=avd/${avdName}.avd`,
    `target=android-${api}`,
  ].join('\n')
  writeFileSync(iniPath, avdIni, 'utf-8')

  const configLines = [
    `AvdId=${avdName}`,
    `PlayStore.enabled=false`,
    `abi.type=${abi}`,
    `avd.ini.displayname=${avdName}`,
    `avd.ini.encoding=UTF-8`,
    `disk.dataPartition.size=4G`,
    `fastboot.forceColdBoot=no`,
    `hw.accelerometer=yes`,
    `hw.audioInput=yes`,
    `hw.audioOutput=yes`,
    `hw.battery=yes`,
    `hw.camera.back=emulated`,
    `hw.camera.front=emulated`,
    `hw.cpu.arch=${cpuArch}`,
    `hw.dPad=no`,
    `hw.device.manufacturer=Google`,
    `hw.device.name=pixel_6`,
    `hw.gps=yes`,
    `hw.gpu.enabled=yes`,
    `hw.gpu.mode=auto`,
    `hw.initialOrientation=portrait`,
    `hw.keyboard=yes`,
    `hw.lcd.density=420`,
    `hw.lcd.height=2400`,
    `hw.lcd.width=1080`,
    `hw.mainKeys=no`,
    `hw.ramSize=2048`,
    `hw.sensors.orientation=yes`,
    `hw.sensors.proximity=yes`,
    `hw.trackBall=no`,
    `image.sysdir.1=${toSysdir(imageDir, api)}`,
    `runtime.network.latency=none`,
    `runtime.network.speed=full`,
    `showDeviceFrame=no`,
    `skin.dynamic=yes`,
    `skin.name=1080x2400`,
    `skin.path=_no_skin`,
    `tag.display=Google APIs`,
    `tag.id=google_apis`,
    `vm.heapSize=256`,
  ]
  writeFileSync(join(avdDir, 'config.ini'), configLines.join('\n'), 'utf-8')

  console.log(`[SdkSetup] 默认 AVD 创建完成: ${avdName}`)
  return avdName
}

/** image.sysdir.1 期望相对于 SDK 根的路径（带末尾斜杠） */
function toSysdir(imageDir: string, _api: number): string {
  const root = getSdkRoot()
  let rel = imageDir.startsWith(root) ? imageDir.slice(root.length) : imageDir
  rel = rel.replace(/^[/\\]/, '').replace(/\\/g, '/')
  return rel.endsWith('/') ? rel : rel + '/'
}

/**
 * 一键完整安装
 *
 * 总下载量约 ~1.3GB（emulator + 系统镜像），首次需数分钟。
 * 调用前必须已通过 license 校验（由 IPC 层保证）。
 */
export async function fullSetup(options: {
  onProgress?: (step: string, progress: DownloadProgress | null) => void
}): Promise<{ adbPath: string; avdName: string }> {
  const { onProgress } = options

  if (!isAdbInstalled()) {
    onProgress?.('正在下载 adb（约 10MB）...', null)
    await installAdb((p) => onProgress?.('正在下载 adb...', p))
  }

  if (!isEmulatorInstalled()) {
    onProgress?.('正在下载 Android 模拟器（约 300MB）...', null)
    await installEmulator((p) => onProgress?.('正在下载 Android 模拟器...', p))
  }

  if (!isSystemImageInstalled()) {
    onProgress?.('正在下载 Android 系统镜像（约 1GB，请耐心等待）...', null)
    await installSystemImage((p) => onProgress?.('正在下载系统镜像...', p))
  }

  if (!isDefaultAvdCreated()) {
    onProgress?.('正在创建 Android 虚拟设备...', null)
    await createDefaultAvd()
  }

  onProgress?.('设置完成！', null)
  return { adbPath: getAdbPath(), avdName: DEFAULT_AVD_NAME }
}
