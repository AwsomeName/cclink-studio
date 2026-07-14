import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { AdbServerClient } from '@yume-chan/adb'
import { getAdbPath as getBundledAdbPath, getExternalSdkRoots, withExe, isWindows } from './android-platform'
import { NodeAdbServerConnector } from './node-adb-connector'
import type { AndroidDeviceInfo } from '../../shared/ipc/android'

/**
 * ADB 命令执行结果
 */
export interface AdbResult {
  stdout: string
  stderr: string
}

export type DeviceInfo = AndroidDeviceInfo

/**
 * ADB 桥接
 *
 * 封装 adb 二进制的发现与命令执行。
 * 对标 playwright-bridge.ts（连接 Android 设备而非浏览器）。
 *
 * 安全设计：所有命令通过 execFile + 参数数组执行，
 * 不经过 shell 解析，天然防止命令注入。
 */
export class AdbBridge {
  private adbPath: string | null = null
  /** 绑定的设备 serial（由 PhysicalDeviceManager 下发，不再自己发现） */
  private serial: string | null = null
  /** 历史字段：模拟器封存前用于 AVD self-heal 重绑 */
  private avdName: string | null = null
  /** ADB 是否已连接到设备 */
  private connected = false
  /** @yume-chan adb 客户端（懒初始化，用于 getDevices 等设备列表操作） */
  private adbClient: AdbServerClient | null = null
  /** serial 被重绑时的监听器列表（AgentDeviceManager 等注册） */
  private serialReboundListeners: Array<(newSerial: string) => void> = []

  /** 注册 serial 重绑监听器，返回取消注册函数 */
  addSerialReboundListener(cb: (newSerial: string) => void): () => void {
    this.serialReboundListeners.push(cb)
    return () => {
      this.serialReboundListeners = this.serialReboundListeners.filter((fn) => fn !== cb)
    }
  }

  /**
   * 发现 adb 二进制路径（跨平台）
   * 优先级：DeepInk 自管理 SDK → 用户已有 SDK（ANDROID_HOME 等）→ PATH
   */
  async discoverAdb(): Promise<string> {
    if (this.adbPath) return this.adbPath

    const candidates: string[] = [getBundledAdbPath()]
    for (const root of getExternalSdkRoots()) {
      candidates.push(join(root, 'platform-tools', withExe('adb')))
    }
    if (!isWindows()) {
      candidates.push('/usr/local/bin/adb', '/opt/homebrew/bin/adb')
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        this.adbPath = candidate
        console.log(`[AdbBridge] 找到 adb: ${candidate}`)
        return candidate
      }
    }

    // 最后尝试从 PATH 解析（which / where）
    try {
      const locator = isWindows() ? 'where adb' : 'which adb'
      const { stdout } = await this.exec(locator)
      const path = stdout.trim().split('\n')[0]?.trim()
      if (path && existsSync(path)) {
        this.adbPath = path
        console.log(`[AdbBridge] 找到 adb (PATH): ${path}`)
        return path
      }
    } catch {
      // 解析失败，忽略
    }

    throw new Error(
      '未找到 adb 二进制。请在 DeepInk 中一键安装 Android 环境，或设置 ANDROID_HOME 环境变量。',
    )
  }

  // ─── @yume-chan adb 客户端（TCP 直连 adb server，不 spawn 进程） ───

  private getAdbClient(): AdbServerClient {
    if (!this.adbClient) {
      this.adbClient = new AdbServerClient(new NodeAdbServerConnector())
    }
    return this.adbClient
  }

  /** 确保 adb server 在运行 */
  private async ensureAdbServer(): Promise<void> {
    try {
      await this.doExecAdb(['start-server'], { timeout: 10000 })
    } catch {
      // adb server 启动失败不阻塞（可能已在运行）
    }
  }

  // ─── serial 管理（由 PhysicalDeviceManager 持有并下发） ───

  /** 设置绑定的 serial + AVD 名称 */
  setSerial(serial: string | null, avdName: string | null): void {
    this.serial = serial
    this.avdName = avdName
    this.connected = !!serial
    if (serial) {
      console.log(`[AdbBridge] 绑定 serial: ${serial} (AVD: ${avdName})`)
    }
  }

  /** 清空绑定 */
  clearSerial(): void {
    this.serial = null
    this.avdName = null
    this.connected = false
  }

  // ─── 设备列表（@yume-chan TCP 直连，不 spawn adb 进程） ───

  /** 获取所有在线设备（含 offline/unauthorized） */
  private async fetchAllDevices(): Promise<Array<{ serial: string; state: string }>> {
    try {
      await this.ensureAdbServer()
      const devices = await this.getAdbClient().getDevices(['device', 'offline', 'unauthorized'])
      return devices.map((d) => ({ serial: d.serial, state: d.state as string }))
    } catch {
      return []
    }
  }

  /** 列出所有在线的 emulator-* 设备（状态 device） */
  async listOnlineDevices(): Promise<string[]> {
    const devices = await this.fetchAllDevices()
    return devices
      .filter((d) => d.serial.startsWith('emulator-') && d.state === 'device')
      .map((d) => d.serial)
  }

  /**
   * 列出所有设备（含物理真机），返回 serial/state/isEmulator
   *
   * 供 PhysicalDeviceManager 发现真机用（listOnlineDevices 只列 emulator-*）。
   * 含 offline/unauthorized 状态，便于 UI 引导授权。
   */
  async listAllDevices(): Promise<Array<{ serial: string; state: string; isEmulator: boolean }>> {
    const devices = await this.fetchAllDevices()
    return devices.map((d) => ({
      serial: d.serial,
      state: d.state,
      isEmulator: d.serial.startsWith('emulator-'),
    }))
  }

  /** 检查指定 serial 是否在线且状态 device */
  async isSerialOnline(serial: string): Promise<boolean> {
    const devices = await this.fetchAllDevices()
    return devices.some((d) => d.serial === serial && d.state === 'device')
  }

  /**
   * 检查 serial 是否出现在 adb 设备列表中（任意状态：device/offline/unauthorized）
   *
   * 用于校验 stdout 解析出的 serial 是否真实——避免 -verbose 的 QEMU 选项串
   * 让正则误匹配到 modem socket 端口等无关数字（如 emulator-55488）。
   */
  async isSerialKnown(serial: string): Promise<boolean> {
    const devices = await this.fetchAllDevices()
    return devices.some((d) => d.serial === serial)
  }

  /**
   * 等待指定 serial 上线（状态 device）
   *
   * 替代旧的 waitForDevice（盲取第一行），现在等待指定的 serial。
   */
  async waitForSerialOnline(serial: string, timeoutSec = 120): Promise<void> {
    console.log(`[AdbBridge] 等待设备 ${serial} 上线 (超时 ${timeoutSec}s)...`)
    const startTime = Date.now()
    const maxWait = timeoutSec * 1000

    while (Date.now() - startTime < maxWait) {
      if (await this.isSerialOnline(serial)) {
        console.log(`[AdbBridge] 设备已上线: ${serial}`)
        return
      }
      await new Promise((r) => setTimeout(r, 3000))
    }

    throw new Error(`等待设备 ${serial} 上线超时 (${timeoutSec}s)`)
  }

  /** 等待指定 serial 从 adb devices 中消失 */
  async waitForSerialGone(serial: string, timeoutSec = 10): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutSec * 1000) {
      const devices = await this.fetchAllDevices()
      if (!devices.some((d) => d.serial === serial)) {
        console.log(`[AdbBridge] serial ${serial} 已消失`)
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    console.warn(`[AdbBridge] 等待 serial ${serial} 消失超时 (${timeoutSec}s)`)
  }

  /**
   * 按 AVD 名称查找对应的 emulator serial
   *
   * 遍历所有在线 emulator-* 设备，逐个执行 `adb -s <serial> emu avd name` 匹配。
   * 用于 serial 解析的消歧、自愈重绑、启动前检查。
   */
  async findSerialByAvd(avdName: string): Promise<string | null> {
    const emulators = await this.listOnlineDevices()
    for (const serial of emulators) {
      try {
        const { stdout } = await this.execAdbWithSerial(serial, ['emu', 'avd', 'name'])
        if (stdout.trim() === avdName) {
          return serial
        }
      } catch {
        // 该 emulator 控制台未就绪或不匹配，跳过
      }
    }
    return null
  }

  /**
   * 对指定 serial 执行 adb 命令（绕过 this.serial，不经过 buildArgs）
   *
   * 用于 findSerialByAvd、terminate 的 emu kill 等需要指定特定 serial 的场景。
   */
  async execAdbWithSerial(serial: string, args: string[], options?: { timeout?: number }): Promise<AdbResult> {
    const adb = await this.discoverAdb()
    const fullArgs = ['-s', serial, ...args]

    return new Promise((resolve, reject) => {
      execFile(
        adb,
        fullArgs,
        {
          timeout: options?.timeout ?? 15000,
          maxBuffer: 50 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`adb ${args.join(' ')} 失败: ${err.message}\n${stderr}`))
          } else {
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
          }
        },
      )
    })
  }

  /**
   * 等待 Android 启动完成
   *
   * 软件渲染（-gpu off）下 Android 14 冷启动较慢，默认给 360s。
   * 轮询时打印 boot 阶段，方便看到系统在响应（避免"卡死"的错觉）。
   */
  async waitForBoot(timeout = 360): Promise<void> {
    const startTime = Date.now()
    const maxWait = timeout * 1000
    let lastStage = ''

    while (Date.now() - startTime < maxWait) {
      try {
        const { stdout } = await this.shell('getprop sys.boot_completed')
        if (stdout.trim() === '1') {
          console.log('[AdbBridge] Android 启动完成')
          return
        }

        // 打印当前 boot 阶段（仅在变化时打印，避免日志爆炸）
        const stage = await this.getBootStage()
        if (stage !== lastStage) {
          const elapsed = Math.round((Date.now() - startTime) / 1000)
          console.log(`[AdbBridge] boot 中: ${stage} (${elapsed}s)`)
          lastStage = stage
        }
      } catch {
        // 设备暂时不可达（boot 早期），忽略继续等
      }
      await new Promise((r) => setTimeout(r, 3000))
    }

    throw new Error(`Android 启动超时 (${timeout}s)。软件渲染下首次冷启动可能较慢，可重试。`)
  }

  /**
   * 获取当前 boot 阶段（init 阶段名 / boot_completed）
   */
  private async getBootStage(): Promise<string> {
    try {
      const { stdout } = await this.shell('getprop init.svc.bootanim')
      const anim = stdout.trim()
      if (anim === 'running') return '启动动画中'
      if (anim === 'stopped') return '启动动画结束'
    } catch {
      // 忽略
    }
    return '初始化中'
  }

  /**
   * 执行 adb shell 命令
   *
   * 注意：command 作为单个参数传给 execFile，
   * 不会经过宿主 shell 解析，防止注入。
   */
  async shell(command: string): Promise<AdbResult> {
    return this.execAdb(['shell', command])
  }

  /**
   * 执行 adb exec-out 命令并返回原始二进制输出（用于截图等）
   */
  async execOut(args: string[]): Promise<Buffer> {
    const adb = await this.discoverAdb()
    const fullArgs = this.buildArgs(['exec-out', ...args])

    return new Promise((resolve, reject) => {
      execFile(adb, fullArgs, { encoding: 'buffer', timeout: 30000 }, (err, stdout) => {
        if (err) {
          reject(new Error(`adb exec-out ${args.join(' ')} 失败: ${err.message}`))
        } else {
          resolve(stdout)
        }
      })
    })
  }

  // ─── 设备操控（MCP 工具和 IPC 调用） ─────────────────────

  /** 点击坐标 */
  async tap(x: number, y: number): Promise<void> {
    await this.execAdb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))])
  }

  /** 滑动手势 */
  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs?: number,
  ): Promise<void> {
    const args = [
      'shell', 'input', 'swipe',
      String(Math.round(x1)), String(Math.round(y1)),
      String(Math.round(x2)), String(Math.round(y2)),
    ]
    if (durationMs !== undefined) {
      args.push(String(durationMs))
    }
    await this.execAdb(args)
  }

  /** 按键 */
  async pressKey(keyCode: number): Promise<void> {
    await this.execAdb(['shell', 'input', 'keyevent', String(keyCode)])
  }

  /**
   * 输入文本（ASCII/基础 Unicode）
   *
   * execFile 不经过 shell，只需处理 Android input text 的空格转义（%s）。
   */
  async typeText(text: string): Promise<void> {
    const escaped = text.replace(/ /g, '%s')
    await this.execAdb(['shell', 'input', 'text', escaped])
  }

  /** 截图，返回 PNG Buffer */
  async screenshot(): Promise<Buffer> {
    return this.execOut(['screencap', '-p'])
  }

  /** 导出 UI 层级 XML */
  async dumpUi(): Promise<string> {
    // 先 dump 到设备临时文件，再 cat 出来
    await this.execAdb(['shell', 'uiautomator', 'dump', '/data/local/tmp/ui.xml'])
    const { stdout } = await this.shell('cat /data/local/tmp/ui.xml')
    return stdout
  }

  /** 获取设备属性 */
  async getDeviceInfo(): Promise<DeviceInfo> {
    const [model, androidVersion, sdkVersion, manufacturer] = await Promise.all([
      this.shell('getprop ro.product.model'),
      this.shell('getprop ro.build.version.release'),
      this.shell('getprop ro.build.version.sdk'),
      this.shell('getprop ro.product.manufacturer'),
    ])
    return {
      model: model.stdout.trim(),
      androidVersion: androidVersion.stdout.trim(),
      sdkVersion: sdkVersion.stdout.trim(),
      manufacturer: manufacturer.stdout.trim(),
    }
  }

  /** 列出已安装包。filter 仅允许字母/数字/点/下划线（包名字符），防止 shell 注入。 */
  async listPackages(filter?: string): Promise<string[]> {
    let cmd = 'pm list packages'
    if (filter && /^[a-zA-Z0-9._]+$/.test(filter)) {
      cmd = `pm list packages ${filter}`
    }
    const { stdout } = await this.shell(cmd)
    return stdout
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('package:'))
      .map((l) => l.replace('package:', '').trim())
  }

  /**
   * 获取当前前台 Activity
   *
   * 不在 adb shell 里用管道（execFile 不经 shell 解析，且设备端 toybox
   * 行为不一致），改在 Node 端按行过滤 "ACTIVITY" 前缀。
   */
  async currentActivity(): Promise<string> {
    const { stdout } = await this.shell('dumpsys activity top')
    const line = stdout
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('ACTIVITY'))
    return line ?? ''
  }

  /**
   * 启动应用
   *
   * 用 am start 启动，比 monkey 更可靠且语义正确：
   *   1. cmd package resolve-activity 拿到 launcher activity
   *   2. am start -n <pkg>/<activity> 显式启动
   *
   * packageName 通过 execFile 参数数组传递，不走 shell 解析，含特殊字符
   * 也不会被注入。回退到 monkey 是兜底，理论不会触发。
   */
  async launchPackage(packageName: string): Promise<string> {
    // 优先：解析 launcher activity 显式启动
    try {
      const { stdout: resolveOut } = await this.shell(
        `cmd package resolve-activity --brief ${packageName}`,
      )
      const activity = resolveOut.trim().split('\n').pop()?.trim()
      if (activity && activity.includes('/')) {
        const { stdout } = await this.shell(`am start -n ${activity}`)
        return stdout.trim()
      }
    } catch {
      // 回退到 monkey
    }

    // 回退：monkey 命令（兼容老版本）
    const { stdout } = await this.shell(
      `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`,
    )
    return stdout.trim()
  }

  /** 安装 APK — 参数数组直接传递，路径含空格也安全 */
  async installApk(path: string): Promise<string> {
    const { stdout } = await this.execAdb(['install', '-r', path])
    return stdout.trim()
  }

  /** 卸载包 */
  async uninstallPackage(packageName: string): Promise<string> {
    const { stdout } = await this.execAdb(['uninstall', packageName])
    return stdout.trim()
  }

  /** 推送文件 — 参数数组直接传递，路径含空格也安全 */
  async pushFile(local: string, remote: string): Promise<string> {
    const { stdout } = await this.execAdb(['push', local, remote])
    return stdout.trim()
  }

  // ─── 内部工具方法 ──────────────────────────────────────

  /** 获取绑定的 serial（保持签名兼容） */
  getDeviceId(): string | null {
    return this.serial
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * 设置 adb 路径（由自动安装器调用）
   */
  setAdbPath(path: string): void {
    this.adbPath = path
    console.log(`[AdbBridge] adb 路径已更新: ${path}`)
  }

  /**
   * 构建 adb 参数数组（自动加 -s serial）
   *
   * 所有 adb 命令统一使用参数数组，execFile 直接传参，
   * 不经过 shell 解析，天然防止命令注入。
   */
  private buildArgs(parts: string[]): string[] {
    const base: string[] = []
    if (this.serial) {
      base.push('-s', this.serial)
    }
    return [...base, ...parts]
  }

  /**
   * 执行 adb 命令（原始版，不带 self-heal）
   *
   * 被 execAdb（带 self-heal）内部调用，以及 ensureAdbServer 等不需要自愈的场景使用。
   */
  private async doExecAdb(args: string[], options?: { timeout?: number }): Promise<AdbResult> {
    const adb = await this.discoverAdb()
    const fullArgs = this.buildArgs(args)

    return new Promise((resolve, reject) => {
      execFile(
        adb,
        fullArgs,
        {
          timeout: options?.timeout ?? 15000,
          maxBuffer: 50 * 1024 * 1024, // 50MB，截图可能较大
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`adb ${args.join(' ')} 失败: ${err.message}\n${stderr}`))
          } else {
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
          }
        },
      )
    })
  }

  /**
   * 执行 adb 命令（带 self-heal：设备丢失时自动按 AVD 重绑 + 重试一次）
   *
   * 所有 adb 操作统一通过此方法执行。当检测到 device not found / offline 时，
   * 尝试按 AVD 身份重新绑定 serial，然后重试原命令。找不到则让错误冒泡。
   */
  private async execAdb(args: string[], options?: { timeout?: number }): Promise<AdbResult> {
    try {
      return await this.doExecAdb(args, options)
    } catch (err) {
      if (!this.isDeviceGoneError(err) || !this.serial || !this.avdName) throw err
      // AVD 身份重绑
      const rebound = await this.findSerialByAvd(this.avdName)
      if (!rebound) throw err
      console.log(`[AdbBridge] 自愈重绑: ${this.serial} → ${rebound}`)
      this.serial = rebound
      for (const cb of this.serialReboundListeners) cb(rebound)
      return await this.doExecAdb(args, options)
    }
  }

  /** 判断错误是否为设备丢失/离线（用于触发 self-heal） */
  private isDeviceGoneError(err: unknown): boolean {
    return err instanceof Error && /device.*not found|device offline/i.test(err.message)
  }

  /**
   * 执行通用命令（非 adb，仅用于 which/where adb 发现，跨平台）
   */
  private exec(command: string): Promise<AdbResult> {
    return new Promise((resolve, reject) => {
      const [shell, flag] = isWindows() ? ['cmd', '/c'] : ['sh', '-c']
      execFile(shell, [flag, command], { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`命令执行失败: ${err.message}`))
        } else {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
        }
      })
    })
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.serial = null
    this.avdName = null
    this.connected = false
    console.log('[AdbBridge] 已断开连接')
  }
}
