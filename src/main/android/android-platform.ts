import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Android SDK 跨平台路径与标识工具
 *
 * 集中处理 macOS / Windows / Linux 与 arm64 / x86_64 之间的差异，
 * 避免在下载器、模拟器管理器、ADB 桥接等多处重复写平台判断。
 */

/** Google manifest 中使用的 host-os 标识 */
export type HostOs = 'macosx' | 'windows' | 'linux'

/** Google 系统镜像使用的 ABI 标识 */
export type Abi = 'arm64-v8a' | 'x86_64'

/**
 * 当前进程对应的 Google host-os 标识
 */
export function getHostOs(): HostOs {
  switch (process.platform) {
    case 'darwin':
      return 'macosx'
    case 'win32':
      return 'windows'
    default:
      // linux 以及其它类 Unix 一律按 linux 处理
      return 'linux'
  }
}

/**
 * platform-tools 稳定下载链接使用的平台后缀
 * （adb 包有 `-latest-{darwin|windows|linux}.zip` 别名）
 */
export function getPlatformToolsSuffix(): 'darwin' | 'windows' | 'linux' {
  switch (process.platform) {
    case 'darwin':
      return 'darwin'
    case 'win32':
      return 'windows'
    default:
      return 'linux'
  }
}

/**
 * 当前机器适配的系统镜像 ABI
 *
 * - Apple Silicon（darwin + arm64）→ arm64-v8a，走原生虚拟化
 * - Windows ARM（win32 + arm64）→ arm64-v8a
 * - 其余（x64 的 Mac/Windows/Linux）→ x86_64
 *
 * 关键：x86 硬件上跑 arm64 镜像是全软件翻译，慢到不可用，必须用 x86_64。
 */
export function getAbi(): Abi {
  return process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'
}

/** 是否 Windows */
export function isWindows(): boolean {
  return process.platform === 'win32'
}

/** 给二进制名加上 Windows 的 .exe 后缀 */
export function withExe(name: string): string {
  return isWindows() ? `${name}.exe` : name
}

// ─── 目录布局 ───────────────────────────────────────

/** CCLink Studio 自管理的 Android SDK 根目录 */
export function getSdkRoot(): string {
  return join(app.getPath('userData'), 'android-sdk')
}

/** platform-tools 目录（含 adb） */
export function getPlatformToolsDir(): string {
  return join(getSdkRoot(), 'platform-tools')
}

/** adb 二进制路径（自管理 SDK 内） */
export function getAdbPath(): string {
  return join(getPlatformToolsDir(), withExe('adb'))
}

/** emulator 目录 */
export function getEmulatorDir(): string {
  return join(getSdkRoot(), 'emulator')
}

/** emulator 二进制路径（自管理 SDK 内） */
export function getEmulatorPath(): string {
  return join(getEmulatorDir(), withExe('emulator'))
}

/**
 * 系统镜像目录
 *
 * 与 Android SDK 标准布局一致：
 * system-images/android-<api>/google_apis/<abi>/
 */
export function getSystemImageDir(api: number = DEFAULT_API_LEVEL): string {
  return join(getSdkRoot(), 'system-images', `android-${api}`, 'google_apis', getAbi())
}

/** AVD 目录（用户 home 下的 .android/avd/） */
export function getAvdDir(): string {
  return join(homedir(), '.android', 'avd')
}

// ─── 常量 ───────────────────────────────────────────

/** 默认 AVD 名称 */
export const DEFAULT_AVD_NAME = 'CCLink_Studio_Phone'

/** 默认目标 API 级别（Android 14） */
export const DEFAULT_API_LEVEL = 34

/**
 * 系统外部 Android SDK 的常见根目录候选
 *
 * 用于「优先复用用户已有 SDK」的发现逻辑。
 */
export function getExternalSdkRoots(): string[] {
  const roots: string[] = []
  if (process.env['ANDROID_HOME']) roots.push(process.env['ANDROID_HOME'])
  if (process.env['ANDROID_SDK_ROOT']) roots.push(process.env['ANDROID_SDK_ROOT'])

  switch (process.platform) {
    case 'darwin':
      roots.push(join(homedir(), 'Library', 'Android', 'sdk'))
      break
    case 'win32':
      if (process.env['LOCALAPPDATA']) {
        roots.push(join(process.env['LOCALAPPDATA'], 'Android', 'Sdk'))
      }
      break
    default:
      roots.push(join(homedir(), 'Android', 'Sdk'))
      break
  }
  return roots
}
