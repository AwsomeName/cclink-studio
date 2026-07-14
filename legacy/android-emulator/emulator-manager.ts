import { spawn, execFile, type ChildProcess } from 'child_process'
import type { ScrcpyBridge } from '../../src/main/android/scrcpy-bridge'
import { promisify } from 'util'
import { existsSync, unlinkSync, statSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'
import { AdbBridge } from '../../src/main/android/adb-bridge'
import { ensureStoreInstalled } from '../../src/main/android/store-installer'
import type { EmulatorState } from '../../src/shared/ipc/android'
import {
  getEmulatorPath as getBundledEmulatorPath,
  getExternalSdkRoots,
  getSdkRoot,
  withExe,
  isWindows,
} from '../../src/main/android/android-platform'

const execFileAsync = promisify(execFile)

export type { EmulatorState } from '../../src/shared/ipc/android'

/**
 * Android 模拟器管理器
 *
 * 管理 AVD 子进程的生命周期（启动/停止/状态）。
 * 对标 browser/browser-manager.ts（管理显示而非子进程）。
 */
export class EmulatorManager {
  private process: ChildProcess | null = null
  private mainWindow: BrowserWindow
  private adbBridge: AdbBridge
  private scrcpyBridge: ScrcpyBridge
  private state: EmulatorState = 'stopped'
  private avdName: string | null = null
  /** 绑定的设备 serial（由 stdout 解析或设备差集确定） */
  private serial: string | null = null
  /** 状态变化监听器（AgentDeviceManager 等注册，用于联动 session 生命周期） */
  private stateListeners: Array<(state: EmulatorState) => void> = []

  // ─── Reconcile 定期校验 ───
  private static RECONCILE_MS = 5000
  private static MISS_THRESHOLD = 3
  private reconcileTimer: NodeJS.Timeout | null = null
  private missCount = 0
  /** 应用商店引导安装是否正在进行（防止并发）。IPC 重试时也检查。 */
  /** 应用商店引导安装是否正在进行（防止并发）。IPC 重试时也检查。 */
  private storeBootstrapInProgress = false
  isStoreBootstrapInProgress(): boolean { return this.storeBootstrapInProgress }

  constructor(mainWindow: BrowserWindow, adbBridge: AdbBridge, scrcpyBridge: ScrcpyBridge) {
    this.mainWindow = mainWindow
    this.adbBridge = adbBridge
    this.scrcpyBridge = scrcpyBridge
    // AdbBridge self-heal 重绑时同步 serial
    this.adbBridge.addSerialReboundListener((newSerial) => {
      this.serial = newSerial
    })
  }

  /**
   * 发现 Android Emulator 二进制（跨平台）
   * 优先级：DeepInk 自管理 SDK → 用户已有 SDK
   */
  discoverEmulator(): string | null {
    const candidates: string[] = [getBundledEmulatorPath()]
    for (const root of getExternalSdkRoots()) {
      candidates.push(join(root, 'emulator', withExe('emulator')))
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  /**
   * 列出可用的 AVD
   */
  async listAvds(): Promise<string[]> {
    const emulatorPath = this.discoverEmulator()
    if (!emulatorPath) return []

    return new Promise((resolve) => {
      const proc = spawn(emulatorPath, ['-list-avds'])
      let stdout = ''
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.on('close', () => {
        const avds = stdout
          .trim()
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        resolve(avds)
      })
      proc.on('error', () => resolve([]))
    })
  }

  /**
   * 启动 AVD 模拟器
   */
  async launch(avdName: string): Promise<void> {
    // 仅在「启动中 / 运行中」拒绝重复启动；'stopped' 和 'error' 都允许（重新）启动。
    // 关键修复：之前启动超时后状态卡在 'error'，再次点击直接被拒，必须重启整个 app。
    if (this.state === 'booting' || this.state === 'running') {
      throw new Error(`模拟器正在${this.state === 'booting' ? '启动' : '运行'}中，请先停止`)
    }

    // 重试前清掉上次遗留的子进程，避免端口/锁冲突
    if (this.process) {
      await this.forceKillProcess()
    }

    // 启动前清理同名 AVD 的残留进程：DeepInk 崩溃/强杀后可能留下孤儿
    // emulator 进程占用 5554/5555，导致新实例被挤到非标准端口、ADB 连错。
    await this.cleanupStaleProcesses(avdName)

    // 启动前检查：同 AVD 已有在线实例 → 拒绝（不收养外来进程）
    const existing = await this.adbBridge.findSerialByAvd(avdName)
    if (existing) {
      throw new Error(`AVD ${avdName} 已在运行 (${existing})，请先停止`)
    }

    // 启动前清理：删除上次异常退出遗留的 lock 文件和空 userdata
    // （emulator 卡死后 userdata 是 0B，不删会再次进入死循环）
    this.cleanupStaleFiles(avdName)
    // 启动前调优 AVD 配置（RAM 加大，软件渲染下 boot 更快）
    this.tuneAvdConfig(avdName)

    const emulatorPath = this.discoverEmulator()
    if (!emulatorPath) {
      throw new Error(
        '未找到 Android Emulator。请安装 Android Studio 或设置 ANDROID_HOME。',
      )
    }

    this.avdName = avdName
    this.setState('booting')
    console.log(`[EmulatorManager] 启动 AVD: ${avdName}`)
    console.log(`[EmulatorManager] emulator 二进制: ${emulatorPath}`)
    console.log(`[EmulatorManager] DeepInk SDK: ${getSdkRoot()}`)

    // 首次正常冷启动；若 boot 超时（多半是 userdata 被上次异常退出写坏，
    // 导致 system_server 反复重启的 boot loop），自动清空 userdata 后用
    // -wipe-data 重试一次。实测：损坏 userdata 会 boot loop，wipe 后 ~30s 正常起来。
    try {
      await this.spawnAndWait(emulatorPath, avdName, false)
      this.setState('running')
      this.startReconcile()
      this.minimizeEmulatorWindow() // boot 完成后保底再最小化一次
      console.log('[EmulatorManager] 模拟器就绪')
    } catch (firstErr) {
      console.warn(`[EmulatorManager] 首次启动失败（${(firstErr as Error).message}），清空 userdata 后重试...`)
      await this.forceKillProcess()
      this.serial = null
      this.adbBridge.clearSerial()
      this.wipeUserData(avdName)
      try {
        await this.spawnAndWait(emulatorPath, avdName, true)
        this.setState('running')
        this.startReconcile()
        this.minimizeEmulatorWindow() // boot 完成后保底再最小化一次
        console.log('[EmulatorManager] 模拟器就绪（wipe-data 重试后）')
      } catch (secondErr) {
        console.error('[EmulatorManager] 模拟器启动失败（重试后仍失败）:', secondErr)
        await this.forceKillProcess()
        this.serial = null
        this.adbBridge.clearSerial()
        this.setState('error')
        throw secondErr
      }
    }

    // 模拟器就绪后，后台引导安装默认应用商店（方案 A）。
    // 不 await：商店安装不应阻塞「模拟器就绪」信号；进度与结果通过 IPC 推送。
    void this.bootstrapStore()
  }

  /**
   * 后台引导安装默认应用商店（方案 A）
   *
   * boot 完成后触发，幂等自检：已装则跳过，否则下载 + adb install。
   * 进度与结果通过 IPC 推送渲染进程（android:storeInstallProgress / :storeInstallResult），
   * 失败时由 UI 引导用户手动安装。异常全部内部消化，绝不影响模拟器主流程。
   */
  private async bootstrapStore(): Promise<void> {
    if (this.storeBootstrapInProgress) {
      console.log('[EmulatorManager] 应用商店引导已在进行中，跳过重复调用')
      return
    }
    this.storeBootstrapInProgress = true
    try {
      const result = await ensureStoreInstalled(this.adbBridge, (msg) => {
        console.log(`[EmulatorManager] 应用商店引导: ${msg}`)
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('android:storeInstallProgress', msg)
        }
      })
      console.log(
        `[EmulatorManager] 应用商店引导结果: ${result.status}${result.message ? ' — ' + result.message : ''}`,
      )
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('android:storeInstallResult', result)
      }
    } catch (err: any) {
      console.error('[EmulatorManager] 应用商店引导异常:', err.message)
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('android:storeInstallResult', {
          status: 'failed',
          storeId: '',
          displayName: '',
          message: `引导异常: ${err.message}`,
        })
      }
    } finally {
      this.storeBootstrapInProgress = false
    }
  }

  /**
   * 启动 emulator 子进程并等待 boot 完成
   *
   * 核心改动：serial 由 stdout 自报或设备差集确定，不再盲取 adb devices 第一行。
   *
   * @param wipe 是否带 -wipe-data 冷启动（清空用户数据）
   */
  private async spawnAndWait(
    emulatorPath: string,
    avdName: string,
    wipe: boolean,
  ): Promise<void> {
    // 关键：必须强制覆盖 ANDROID_HOME / ANDROID_SDK_ROOT 为 DeepInk 自管理 SDK，
    // 否则用户机器上 Android Studio 的 ANDROID_HOME 会让 emulator 找不到 system-images。
    const sdkRoot = getSdkRoot()
    const args = [
      '-avd', avdName,
      // 强制硬件 GPU（'host'）：实测在 Apple Silicon 上 -no-window / -gpu auto
      // 都会退回软件渲染，软件渲染跑 Android 14 会 boot loop；只有 -gpu host
      // 真正启用硬件后端（Vulkan:host / GLES:host），冷启动 ~30s。
      '-gpu', 'host',
      '-no-audio',
      '-no-boot-anim',
      '-no-snapshot',
      '-verbose',
    ]
    if (wipe) args.push('-wipe-data')

    // 记录 spawn 前的设备列表（用于差集确定"我的设备"）
    const beforeDevices = await this.adbBridge.listOnlineDevices()
    this.serial = null // 重置，等待 stdout 或差集解析

    const child = spawn(emulatorPath, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        USER: process.env['USER'] ?? '',
        LANG: process.env['LANG'] ?? 'en_US.UTF-8',
        TMPDIR: process.env['TMPDIR'] ?? '',
        SHELL: process.env['SHELL'] ?? '',
        ANDROID_SDK_ROOT: sdkRoot,
        ANDROID_HOME: sdkRoot,
      },
    })
    this.process = child

    // 启动后尽快最小化模拟器原生窗口（投屏已内嵌工作区，原生 SDL 窗口属冗余干扰）。
    // 非阻塞轮询：窗口在 spawn 后 1~3s 才出现，不最小化会一直盖在 DeepInk 前面。
    this.minimizeWindowWhenReady()

    let stderrBuffer = ''
    let stdoutBuffer = ''

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      stdoutBuffer += text
      const lines = text.split('\n').filter((l) => /warn|error|fail|emulator|warning/i.test(l))
      for (const line of lines) {
        if (line.trim()) console.log(`[emulator:out] ${line.trim()}`)
      }

      // 解析 serial（stdout 自报优先，精确归属无竞态）
      // 注意：不能用宽松的 /console.*?port.*?(\d+)/ 兜底——-verbose 会把整串
      // QEMU 参数打到 stdout，里面有 -chardev socket,port=55488,id=modem（modem 端口），
      // 会被误匹配成 emulator-55488（adb 根本不存在），导致 wait-for-device 永久超时。
      // 只认模拟器自报的精确 serial 行；拿不到就交给 resolveSerial 的设备差集兜底。
      if (!this.serial) {
        const match = text.match(/serial number.*?emulator-(\d{4,5})/i)
        if (match) {
          this.serial = `emulator-${match[1]}`
          console.log(`[EmulatorManager] stdout 解析 serial: ${this.serial}`)
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrBuffer += text
      const lines = text.split('\n').filter(Boolean)
      for (const line of lines) {
        if (line.trim()) console.error(`[emulator:err] ${line.trim()}`)
      }
    })

    child.on('error', (err) => {
      console.error('[EmulatorManager] 模拟器进程错误:', err)
    })

    child.on('exit', (code, signal) => {
      console.log(`[EmulatorManager] 模拟器进程退出 (code: ${code}, signal: ${signal})`)
      if (code !== 0 && code !== null) {
        const tail = (stderrBuffer || stdoutBuffer).slice(-2048)
        console.error(`[EmulatorManager] 模拟器崩溃日志（尾部 2KB）:\n${tail}`)
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('android:emulatorError', { code, signal, message: tail })
        }
      }
      // 仅当当前进程就是它时才清空引用（避免重试时误清）
      if (this.process === child) {
        this.process = null
        this.serial = null
        this.adbBridge.clearSerial()
        this.stopReconcile()
        if (this.state !== 'error') this.setState('stopped')
      }
    })

    // 解析 serial（stdout 优先 → 设备差集 + AVD 消歧兜底）
    await this.resolveSerial(child, beforeDevices, avdName, 120)
    const serial = this.serial
    if (!serial) {
      throw new Error('无法确定模拟器 serial')
    }
    console.log(`[EmulatorManager] 绑定 serial: ${serial}`)

    // 下发 serial 到 AdbBridge
    this.adbBridge.setSerial(serial, avdName)

    // 等待设备上线（确认指定 serial 在 adb devices 中状态 device）
    await this.adbBridge.waitForSerialOnline(serial, 120)

    // 等待 Android 启动完成
    await this.adbBridge.waitForBoot(240)
  }

  /**
   * 解析模拟器 serial
   *
   * 优先级：stdout 自报（需经 adb 验证） → 设备差集（只有一个新设备直接用，多个则 AVD 消歧） → 超时失败。
   * stdout 解析在 spawnAndWait 的 stdout handler 中设置 this.serial，
   * 此方法每 3 秒轮询：先校验 stdout 值是否真实存在于 adb（防止 QEMU 选项串误匹配），
   * 不真实则丢弃交给设备差集兜底。
   */
  private async resolveSerial(
    _child: ChildProcess,
    beforeDevices: string[],
    avdName: string,
    timeoutSec: number,
  ): Promise<void> {
    const startTime = Date.now()
    const maxWait = timeoutSec * 1000
    let stdoutSerialRejected = false

    while (Date.now() - startTime < maxWait) {
      // Path 1: stdout 解析出 serial —— 必须验证它真实存在于 adb 设备列表（任意状态）
      // 防止 -verbose 的 QEMU 选项串让正则误匹配到 modem 端口（如 emulator-55488）
      if (this.serial && !stdoutSerialRejected) {
        try {
          if (await this.adbBridge.isSerialKnown(this.serial)) {
            return // stdout 值经 adb 验证，可用
          }
          // 还没在 adb 出现：可能太早（adb 尚未注册），也可能是误匹配。
          // 先不急着 discard，让下面差集有机会跑；差集命中会覆盖错误值。
        } catch {
          // adb 暂时不可用，下轮再验
        }
      }

      // Path 2: 设备差集（adb 源真相）
      try {
        const current = await this.adbBridge.listOnlineDevices()
        const newSerials = current.filter((s) => !beforeDevices.includes(s))

        if (newSerials.length === 1) {
          // 只有一个新 emulator → 直接绑定（覆盖可能误匹配的 stdout 值）
          this.serial = newSerials[0]!
          return
        }
        if (newSerials.length > 1) {
          // 多个新设备 → AVD 身份消歧
          const found = await this.adbBridge.findSerialByAvd(avdName)
          if (found) {
            this.serial = found
            return
          }
        }
      } catch {
        // getDevices 失败（adb server 不稳），下次重试
      }

      await new Promise((r) => setTimeout(r, 3000))
    }

    throw new Error(`无法确定模拟器 serial（超时 ${timeoutSec}s）。请检查模拟器是否正常启动。`)
  }

  /**
   * 清空 AVD 的 userdata / 运行时 overlay
   *
   * 上次异常退出（被 kill）可能把 userdata-qemu.img.qcow2 写成损坏的非空文件，
   * cleanupStaleFiles 只删 0B 文件删不掉它，必须整体清掉让 -wipe-data 重建。
   */
  private wipeUserData(avdName: string): void {
    const avdDir = join(homedir(), '.android', 'avd', `${avdName}.avd`)
    if (!existsSync(avdDir)) return
    const targets = [
      'userdata-qemu.img',
      'userdata-qemu.img.qcow2',
      'userdata.img.qcow2',
      'cache.img.qcow2',
      'encryptionkey.img.qcow2',
      'sdcard.img.qcow2',
    ]
    for (const f of targets) {
      const p = join(avdDir, f)
      if (existsSync(p)) {
        try {
          unlinkSync(p)
          console.log(`[EmulatorManager] 清空 userdata: ${f}`)
        } catch (err: any) {
          console.warn(`[EmulatorManager] 清空 ${f} 失败: ${err.message}`)
        }
      }
    }
  }

  /**
   * 强制杀掉 emulator 子进程（兜底，防止僵尸 qemu 烧 CPU）
   */
  private async forceKillProcess(): Promise<void> {
    const proc = this.process
    if (!proc || proc.killed) {
      this.process = null
      return
    }
    console.warn('[EmulatorManager] 强制终止 emulator 子进程...')
    try {
      proc.kill('SIGTERM')
    } catch {
      // 忽略
    }
    // 给 5 秒优雅退出，否则 SIGKILL
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // 忽略
        }
        resolve()
      }, 5000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.process = null
  }

  /**
   * 停止模拟器
   *
   * 修正：主杀手段用 `adb -s <serial> emu kill`（控制台命令），
   * 而非旧的 `adb -s <serial> shell emu kill`（guest shell 命令，从未生效）。
   */
  async terminate(): Promise<void> {
    this.stopReconcile()

    const hadSerial = !!this.serial
    const hadProcess = !!this.process && this.state !== 'stopped'

    if (hadProcess || hadSerial) {
      console.log('[EmulatorManager] 正在停止模拟器...')

      // 主手段：adb 控制台命令（让 emulator 自行关闭 qemu 子进程）
      if (this.serial) {
        try {
          await this.adbBridge.execAdbWithSerial(this.serial, ['emu', 'kill'])
          console.log('[EmulatorManager] 已发送 emu kill 控制台命令')
        } catch {
          // 控制台命令失败（设备不响应），走兜底
        }
        // 等待 serial 从 adb devices 中消失
        try {
          await this.adbBridge.waitForSerialGone(this.serial, 10000)
        } catch {
          // 超时不阻塞
        }
      }

      // 兜底：SIGTERM → SIGKILL 杀进程
      if (this.process) {
        await this.forceKillProcess()
      }

      this.process = null
      this.serial = null
      this.adbBridge.clearSerial()
      await this.scrcpyBridge.disconnect()
      this.setState('stopped')
    }
  }

  /**
   * 获取当前状态
   */
  getState(): EmulatorState {
    return this.state
  }

  /**
   * 获取当前模拟器子进程 PID
   *
   * 供 Agent 备忘录展示，让 Agent 知道"就是这个进程，勿手动 kill"。
   */
  getPid(): number | null {
    return this.process?.pid ?? null
  }

  /**
   * 清理同名 AVD 的残留进程（Mac/Linux，Windows 暂不处理）
   *
   * DeepInk 崩溃/强杀后可能留下孤儿 emulator 进程，占用标准端口 5554/5555，
   * 导致下次启动的同名实例被挤到非标准端口、ADB 连到错的（卡死）实例。
   * 启动前先杀掉所有命令行带 "-avd <avdName>" 的 emulator 进程，保证干净单实例。
   */
  private async cleanupStaleProcesses(avdName: string): Promise<void> {
    if (isWindows()) return // Windows 用 tasklist + taskkill，待补
    let pids: string[] = []
    try {
      const { stdout } = await execFileAsync('pgrep', ['-f', `emulator.*-avd ${avdName}`])
      pids = stdout
        .trim()
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean)
    } catch (err: any) {
      // pgrep 退出码 1 = 无匹配（正常）；ENOENT = 系统无 pgrep
      if (err?.code !== 1 && err?.code !== 'ENOENT') {
        console.warn(`[EmulatorManager] 扫描残留进程失败: ${err.message}`)
      }
      return
    }
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM')
        console.log(`[EmulatorManager] 清理残留 emulator 进程: ${pid}`)
      } catch {
        // 进程可能已退出，忽略
      }
    }
    if (pids.length > 0) {
      // 给被杀进程退出 + 释放端口的时间，避免新实例仍抢不到 5554/5555
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  /**
   * 获取当前 AVD 名称
   */
  getAvdName(): string | null {
    return this.avdName
  }

  /**
   * 获取绑定的 serial
   */
  getSerial(): string | null {
    return this.serial
  }

  // ─── Reconcile 定期校验（设备在线为权威信号） ───

  /**
   * 启动定期 reconcile
   *
   * 每 5 秒检查绑定 serial 是否仍在线，连续 3 次不在线（~15s）则判定设备丢失。
   * 使用 @yume-chan getDevices() TCP 查询，不 spawn adb 进程。
   */
  private startReconcile(): void {
    this.stopReconcile()
    this.missCount = 0
    this.reconcileTimer = setInterval(
      () => this.reconcile().catch((err) => {
        console.warn('[EmulatorManager] reconcile 出错:', (err as Error).message)
      }),
      EmulatorManager.RECONCILE_MS,
    )
  }

  /** 停止 reconcile */
  private stopReconcile(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer)
      this.reconcileTimer = null
    }
    this.missCount = 0
  }

  /**
   * 一次 reconcile 检查
   *
   * 权威信号：绑定 serial 是否在 adb devices 中且状态 device。
   * this.process 活着只作辅助（launcher/qemu 分裂时进程活但设备不在线）。
   */
  private async reconcile(): Promise<void> {
    if (this.state !== 'running' || !this.serial) return

    const online = await this.adbBridge.isSerialOnline(this.serial)
    if (online) {
      this.missCount = 0
      return
    }

    this.missCount++
    console.warn(`[EmulatorManager] reconcile: serial ${this.serial} 不在线 (${this.missCount}/${EmulatorManager.MISS_THRESHOLD})`)

    if (this.missCount >= EmulatorManager.MISS_THRESHOLD) {
      await this.handleDeviceLost()
    }
  }

  /**
   * 设备丢失处理
   *
   * 连续 MISS_THRESHOLD 次确认不在线后触发：
   * 清理所有状态 → 断开 scrcpy → 推 deviceLost 事件。
   */
  private async handleDeviceLost(): Promise<void> {
    console.warn('[EmulatorManager] 设备丢失，执行清理')
    this.stopReconcile()
    this.serial = null
    this.process = null
    this.adbBridge.clearSerial()
    await this.scrcpyBridge.disconnect()
    this.setState('stopped')

    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('android:deviceLost', { reason: 'device gone' })
    }
  }

  /**
   * 立即执行一次 reconcile（不等定时器），用于 reconnect IPC
   *
   * 当 serial 丢失时尝试 AVD 身份重绑。
   * @returns true 如果 serial 仍在线（或重绑成功）
   */
  async reconcileNow(): Promise<boolean> {
    // serial 仍在线 → 无需处理
    if (this.serial && await this.adbBridge.isSerialOnline(this.serial)) {
      return true
    }

    // serial 丢失 → 尝试 AVD 重绑
    if (this.avdName) {
      const rebound = await this.adbBridge.findSerialByAvd(this.avdName)
      if (rebound) {
        console.log(`[EmulatorManager] reconcileNow 重绑: ${this.serial} → ${rebound}`)
        this.serial = rebound
        this.adbBridge.setSerial(rebound, this.avdName)
        return true
      }
    }

    return false
  }

  /**
   * 更新状态并通知渲染进程
   */
  private setState(state: EmulatorState): void {
    this.state = state
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('android:stateChanged', state)
    }
    console.log(`[EmulatorManager] 状态: ${state}`)
    // 通知内部监听器（AgentDeviceManager 等，用于联动 session 生命周期）
    for (const cb of this.stateListeners) {
      try {
        cb(state)
      } catch (err) {
        console.error('[EmulatorManager] stateListener 执行失败', err)
      }
    }
  }

  /** 注册状态变化监听器，返回取消注册函数 */
  onStateChanged(cb: (state: EmulatorState) => void): () => void {
    this.stateListeners.push(cb)
    return () => {
      this.stateListeners = this.stateListeners.filter((fn) => fn !== cb)
    }
  }

  /**
   * 启动前清理上次异常退出遗留的文件
   *
   * - lock 文件：上次 emulator 异常退出后会残留，下次启动检测到会拒绝启动
   * - 空 userdata：qemu 卡死时 userdata 是 0B，不删会再次进入死循环
   */
  private cleanupStaleFiles(avdName: string): void {
    const avdDir = join(homedir(), '.android', 'avd', `${avdName}.avd`)
    if (!existsSync(avdDir)) return

    const staleFiles = [
      'hardware-qemu.ini.lock',
      'multiinstance.lock',
    ]

    for (const file of staleFiles) {
      const p = join(avdDir, file)
      if (existsSync(p)) {
        try {
          unlinkSync(p)
          console.log(`[EmulatorManager] 清理遗留 lock: ${file}`)
        } catch (err: any) {
          console.warn(`[EmulatorManager] 清理 ${file} 失败: ${err.message}`)
        }
      }
    }

    // 检查 userdata 是否为 0B（卡死留下的空文件）
    const userdataQcow2 = join(avdDir, 'userdata-qemu.img.qcow2')
    if (existsSync(userdataQcow2)) {
      try {
        const size = statSync(userdataQcow2).size
        // qcow2 刚创建应该有 192K+ 的元数据，如果太小是损坏的
        if (size < 1024) {
          unlinkSync(userdataQcow2)
          console.log(`[EmulatorManager] 清理损坏 userdata-qemu.img.qcow2 (${size}B)`)
        }
      } catch {
        // 忽略
      }
    }
    const userdataRaw = join(avdDir, 'userdata-qemu.img')
    if (existsSync(userdataRaw)) {
      try {
        const size = statSync(userdataRaw).size
        if (size === 0) {
          unlinkSync(userdataRaw)
          console.log(`[EmulatorManager] 清理空 userdata-qemu.img`)
        }
      } catch {
        // 忽略
      }
    }
  }

  /**
   * 启动前调优 AVD 配置
   *
   * 软件渲染（-gpu off）下 Android 14 冷启动对 RAM 敏感，
   * 默认 2GB 会拖慢甚至卡住 boot。改成 4GB（仅需改一次，持久化）。
   */
  private tuneAvdConfig(avdName: string): void {
    const configPath = join(homedir(), '.android', 'avd', `${avdName}.avd`, 'config.ini')
    if (!existsSync(configPath)) return

    try {
      const content = readFileSync(configPath, 'utf-8')
      let changed = false
      // 按行处理资源调优：
      //  - RAM 至少 4GB（默认 2GB 跑 Android 14 偏紧）
      //  - CPU 核数至少 4（默认 2 核会在首次 boot 的全量 dexopt 期间把 system_server 卡到 ANR，
      //    表现为「Process system isn't responding」+ 触摸无响应 + 画面冻结 no frame）
      const lines = content.split('\n').map((line) => {
        if (/^hw\.ramSize\s*=/.test(line)) {
          const current = parseInt(line.split('=')[1]?.trim() ?? '0', 10)
          if (current < 4096) {
            console.log(`[EmulatorManager] AVD RAM ${current}MB → 4096MB`)
            changed = true
            return 'hw.ramSize=4096'
          }
        }
        if (/^hw\.cpu\.ncore\s*=/.test(line)) {
          const current = parseInt(line.split('=')[1]?.trim() ?? '0', 10)
          if (current < 4) {
            console.log(`[EmulatorManager] AVD CPU ${current} 核 → 4 核`)
            changed = true
            return 'hw.cpu.ncore=4'
          }
        }
        return line
      })
      const newContent = lines.join('\n')
      if (changed) {
        writeFileSync(configPath, newContent, 'utf-8')
      }
    } catch (err: any) {
      console.warn(`[EmulatorManager] 调优 AVD 配置失败: ${err.message}`)
    }
  }

  /**
   * 轮询最小化模拟器原生窗口（启动期）
   *
   * SDL 显示窗口在 spawn 后 1~3s 才创建，boot 的 ~30s 内若不最小化会一直
   * 盖在 DeepInk 前面。每 2s 尝试一次：命中窗口（成功最小化）即停；
   * 未命中则继续，最多 6 次（~12s）。非阻塞、不 await。
   *
   * 进程退出后自动停（tick 内判 this.process）。
   */
  private minimizeWindowWhenReady(): void {
    let attempts = 0
    const maxAttempts = 6
    const tick = (): void => {
      if (!this.process || attempts >= maxAttempts) return
      attempts++
      this.minimizeEmulatorWindow((hit, fatal) => {
        // 命中过窗口，或遇到致命错误（如未授辅助功能权限）→ 停止轮询
        if (hit > 0 || fatal) return
        if (this.process && attempts < maxAttempts) {
          setTimeout(tick, 2000)
        }
      })
    }
    setTimeout(tick, 2000) // 等 SDL 窗口创建
  }

  /**
   * 最小化模拟器原生窗口（仅 macOS）
   *
   * 投屏已内嵌在 DeepInk 工作区，模拟器自己的 SDL 窗口属冗余干扰。
   * 通过 AppleScript 把 emulator / qemu-* 进程的所有窗口最小化到 Dock。
   * 非破坏性：失败（如未授辅助功能权限）仅记日志，绝不影响 boot 主流程；
   * 用户可点 Dock 图标随时恢复窗口。
   *
   * @param onResult (hitCount, fatal) 回调：hitCount>0 表示已最小化至少一个窗口；
   *                 fatal=true 表示遇到不可恢复错误（如权限缺失），调用方应停止重试。
   */
  private minimizeEmulatorWindow(
    onResult?: (hitCount: number, fatal: boolean) => void,
  ): void {
    if (process.platform !== 'darwin') {
      onResult?.(0, true)
      return
    }
    // 统计并最小化所有 emulator / qemu-* 进程的窗口
    const script = [
      'tell application "System Events"',
      '  set hits to 0',
      '  repeat with p in (every process whose name contains "emulator" or name starts with "qemu")',
      '    try',
      '      set miniaturized of every window of p to true',
      '      set hits to hits + 1',
      '    end try',
      '  end repeat',
      '  return hits',
      'end tell',
    ].join('\n')
    execFile('/usr/bin/osascript', ['-e', script], (err, stdout) => {
      if (err) {
        const msg = (err as Error).message || ''
        // 辅助功能未授权：仅提示一次可操作的修复路径，不刷屏
        if (/not authorized|not allowed|assistive|accessibility|-1743|Apple Event/i.test(msg)) {
          console.warn(
            '[EmulatorManager] 最小化模拟器窗口需「辅助功能」权限：系统设置 → 隐私与安全性 → 辅助功能 → 勾选 DeepInk（授权后重启模拟器生效）',
          )
        } else {
          console.warn(`[EmulatorManager] 最小化模拟器窗口失败: ${msg}`)
        }
        onResult?.(0, true)
        return
      }
      const hits = parseInt((stdout ?? '').trim(), 10) || 0
      onResult?.(hits, false)
    })
  }

  /**
   * 销毁（窗口关闭时调用）
   */
  async destroy(): Promise<void> {
    this.stopReconcile()
    await this.terminate()
  }
}
