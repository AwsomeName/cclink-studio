import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getExternalSdkRoots, withExe } from '../../src/main/android/android-platform'

/**
 * AVD（Android Virtual Device）管理器
 *
 * 管理 AVD 的创建、列表、系统镜像下载等。
 * 依赖 Android SDK 的 avdmanager 和 sdkmanager 工具。
 */
export class AvdManager {
  /**
   * 发现 sdkmanager 二进制
   */
  discoverSdkmanager(): string | null {
    // Windows 下 sdkmanager 是 .bat 脚本
    const binName = withExe('sdkmanager').replace('.exe', process.platform === 'win32' ? '.bat' : '')
    const candidates: string[] = []
    for (const root of getExternalSdkRoots()) {
      candidates.push(join(root, 'cmdline-tools', 'latest', 'bin', binName))
      candidates.push(join(root, 'tools', 'bin', binName))
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  /**
   * 列出已安装的系统镜像
   */
  async listSystemImages(): Promise<string[]> {
    const sdkmanager = this.discoverSdkmanager()
    if (!sdkmanager) return []

    return new Promise((resolve) => {
      execFile(sdkmanager, ['--list_installed'], { timeout: 30000 }, (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        const images = stdout
          .split('\n')
          .filter((l) => l.includes('system-images'))
          .map((l) => l.trim().split(' ')[0]!)
          .filter(Boolean)
        resolve(images)
      })
    })
  }

  /**
   * 列出可用的系统镜像（远程）
   */
  async listAvailableImages(): Promise<string[]> {
    const sdkmanager = this.discoverSdkmanager()
    if (!sdkmanager) return []

    return new Promise((resolve) => {
      execFile(sdkmanager, ['--list'], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        const images = stdout
          .split('\n')
          .filter((l) => l.includes('system-images') && l.includes('arm64-v8a'))
          .map((l) => l.trim().split('|')[0]?.trim())
          .filter(Boolean) as string[]
        resolve(images)
      })
    })
  }

  /**
   * 下载系统镜像
   */
  async installSystemImage(image: string): Promise<void> {
    const sdkmanager = this.discoverSdkmanager()
    if (!sdkmanager) throw new Error('未找到 sdkmanager')

    return new Promise((resolve, reject) => {
      execFile(sdkmanager, ['--install', image], { timeout: 600000 }, (err) => {
        if (err) reject(new Error(`安装系统镜像失败: ${err.message}`))
        else resolve()
      })
    })
  }
}
