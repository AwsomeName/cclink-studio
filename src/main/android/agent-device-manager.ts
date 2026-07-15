/**
 * AgentDeviceManager —— agent-device 库的会话管理与降级封装
 *
 * agent-device（Callstack）提供 Android 无障碍树语义快照 + ref 定位操作，
 * 是 CCLink Studio 本地 Android 自动化的「UI 感知层」，补强现有 AdbBridge.dumpUi
 * （裸 uiautomator dump，常漏元素）。
 *
 * 职责：
 *  - 持有 agent-device client + 当前 session + serial 绑定
 *  - lazy 建立 session（第一次工具调用时），随活跃设备变化联动
 *  - daemon 的 Electron 适配（首次 spawn 临时注入 ELECTRON_RUN_AS_NODE）
 *  - 全链路降级：import 失败 / daemon 起不来 / 超时 → 返回 null/false，
 *    上层（ToolModule）据此提示 Agent 退回 android_dump_ui / android_tap
 *
 * agent-device 是纯 ESM 包，CCLink Studio 主进程是 CJS → 必须【动态 import】。
 * 类型用 import type（编译期，不产生运行时 require）。
 *
 * 详见 docs/与 plan：/Users/apple/.claude/plans/jazzy-doodling-dijkstra.md
 */
import path from 'node:path'
import type { ActiveDeviceManager } from './active-device-manager'
import type { AdbBridge } from './adb-bridge'

// agent-device 类型：仅用于推导 client 字段类型（编译期擦除，不产生 require）
import type { createAgentDeviceClient } from 'agent-device'
type AgentDeviceClient = ReturnType<typeof createAgentDeviceClient>

/** snapshot 返回的最小结构（不依赖 agent-device 内部类型导出，保持稳健） */
export interface AgentDeviceSnapshotResult {
  nodes: Array<Record<string, unknown>>
  truncated: boolean
  appName?: string
  warnings?: string[]
}

/** click 目标：语义 ref 或坐标（二选一） */
export type AgentDeviceClickTarget =
  | { ref: string }
  | { x: number; y: number }

const SNAPSHOT_TIMEOUT_MS = 30_000 // 首次含 helper 安装 + daemon 冷启动
const ACTION_TIMEOUT_MS = 8_000 // click/swipe/type

export class AgentDeviceManager {
  private activeDeviceManager: ActiveDeviceManager
  private adbBridge: AdbBridge

  /** feature flag（PR4 接 SettingsService，默认开启） */
  private enabled = true
  /** agent-device 库是否 import 成功（不可用时全量降级） */
  private available = false

  private client: AgentDeviceClient | null = null
  private currentSerial: string | null = null
  private sessionName: string | null = null
  private sessionOpen = false
  /** daemon 是否已成功 spawn 过（仅首次 spawn 需注入 ELECTRON_RUN_AS_NODE） */
  private daemonInitialized = false
  /** ensureSession 串行锁，避免并发首次 spawn */
  private sessionPromise: Promise<boolean> | null = null

  /** 活跃设备变化的取消函数（init 时注册） */
  private offActiveChanged: (() => void) | null = null
  private offSerialRebound: (() => void) | null = null

  constructor(activeDeviceManager: ActiveDeviceManager, adbBridge: AdbBridge) {
    this.activeDeviceManager = activeDeviceManager
    this.adbBridge = adbBridge
  }

  /**
   * 初始化：注入 adb 环境、动态 import agent-device、注册状态联动。
   * 任何环节失败都仅置 available=false，不抛错（保证不阻塞主进程启动）。
   */
  async init(): Promise<void> {
    // 1. 注入 adb 路径到 PATH / ANDROID_HOME，让 daemon 能找到 CCLink Studio 自管理的 adb
    await this.injectAdbEnv()

    // 2. 动态 import agent-device（ESM），失败则全量降级
    try {
      const mod = await import('agent-device')
      this.client = mod.createAgentDeviceClient({ debug: false })
      this.available = true
      console.log('[AgentDeviceManager] init 成功，agent-device 可用')
    } catch (err) {
      this.available = false
      this.client = null
      console.error('[AgentDeviceManager] import agent-device 失败，将降级到裸 ADB:', err)
    }

    // 3. 注册活跃设备联动：设备出现时记录 serial（lazy，不立即 open）；消失时关 session
    this.offActiveChanged = this.activeDeviceManager.onChanged((device) => {
      if (device) {
        // lazy：仅记录 serial 待用，不立即 open
        this.currentSerial = device.serial
      } else {
        // 活跃设备清除（模拟器停止 / 真机断开）→ 关闭 session 释放 lease
        void this.unbind()
      }
    })
    this.offSerialRebound = this.adbBridge.addSerialReboundListener(() => {
      // serial 被 self-heal 重绑 → 当前 session 失效，下次 ensureSession 重建
      this.sessionOpen = false
    })
  }

  /** PR4 注入：运行时开关 agent-device */
  setEnabled(value: boolean): void {
    this.enabled = value
    if (!value) void this.unbind()
  }

  /** 工具层判断是否可用（flag 开 + 库 import 成功） */
  isAvailable(): boolean {
    return this.enabled && this.available && this.client !== null
  }

  // ─── 工具层入口（每个方法失败返回 null/false，由 ToolModule 提示 Agent 降级） ───

  /** 抓取当前界面的语义化无障碍树（含 ref）。失败返回 null。 */
  async captureSnapshot(
    options: { interactiveOnly?: boolean; depth?: number; timeoutMs?: number } = {},
  ): Promise<AgentDeviceSnapshotResult | null> {
    if (!(await this.ensureSession())) return null
    try {
      const result = await this.withTimeout(
        this.client!.capture.snapshot({
          session: this.sessionName!,
          ...(options.interactiveOnly !== undefined ? { interactiveOnly: options.interactiveOnly } : {}),
          ...(options.depth !== undefined ? { depth: options.depth } : {}),
        }),
        options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS,
        'agent_device_snapshot',
      )
      return result as unknown as AgentDeviceSnapshotResult
    } catch (err) {
      console.error('[AgentDeviceManager] snapshot 失败:', err)
      return null
    }
  }

  /** 语义点击（ref）或坐标点击（x,y）。失败返回 false。 */
  async click(target: AgentDeviceClickTarget): Promise<boolean> {
    if (!(await this.ensureSession())) return false
    try {
      await this.withTimeout(
        this.client!.interactions.click({ session: this.sessionName!, ...target }),
        ACTION_TIMEOUT_MS,
        'agent_device_click',
      )
      return true
    } catch (err) {
      console.error('[AgentDeviceManager] click 失败:', err)
      return false
    }
  }

  /** 滑动手势（坐标式，agent-device swipe 不支持 ref）。失败返回 false。 */
  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<boolean> {
    if (!(await this.ensureSession())) return false
    try {
      await this.withTimeout(
        this.client!.interactions.swipe({
          session: this.sessionName!,
          from,
          to,
          ...(durationMs !== undefined ? { durationMs } : {}),
        }),
        ACTION_TIMEOUT_MS,
        'agent_device_swipe',
      )
      return true
    } catch (err) {
      console.error('[AgentDeviceManager] swipe 失败:', err)
      return false
    }
  }

  /**
   * 输入文本。传 ref 时用 fill（语义定位输入框），否则 type（当前焦点）。
   * 失败返回 false。
   */
  async inputText(text: string, ref?: string): Promise<boolean> {
    if (!(await this.ensureSession())) return false
    try {
      if (ref) {
        // fill 支持 InteractionTarget（含 ref），定位输入框后填入
        await this.withTimeout(
          this.client!.interactions.fill({ session: this.sessionName!, ref, text }),
          ACTION_TIMEOUT_MS,
          'agent_device_fill',
        )
      } else {
        await this.withTimeout(
          this.client!.interactions.type({ session: this.sessionName!, text }),
          ACTION_TIMEOUT_MS,
          'agent_device_type',
        )
      }
      return true
    } catch (err) {
      console.error('[AgentDeviceManager] type 失败:', err)
      return false
    }
  }

  // ─── session 生命周期 ───

  /**
   * 确保 session 已建立且绑定当前 serial。幂等 + 串行。
   * 失败返回 false（上层降级）。
   */
  async ensureSession(): Promise<boolean> {
    if (!this.isAvailable()) return false
    const serial = this.activeDeviceManager.getSerial()
    if (!serial) return false
    // 已开且 serial 一致 → 直接复用
    if (this.sessionOpen && this.currentSerial === serial) return true
    // 串行：并发的 ensureSession 复用同一个 in-flight Promise
    if (!this.sessionPromise) {
      this.sessionPromise = this.doEnsureSession(serial).finally(() => {
        this.sessionPromise = null
      })
    }
    return this.sessionPromise
  }

  private async doEnsureSession(serial: string): Promise<boolean> {
    if (!this.client) return false
    // serial 变了：先关旧 session
    if (this.sessionOpen) await this.closeSession()
    this.currentSerial = serial
    this.sessionName = `deepink-${serial}`
    try {
      // 首次 daemon spawn 需 ELECTRON_RUN_AS_NODE（Electron 二进制以 Node 模式运行 daemon）
      // daemon 起来后长驻，后续调用无需再设（withDaemonEnv 内部按 daemonInitialized 判断）
      await this.withDaemonEnv(async () => {
        await this.client!.apps.open({
          session: this.sessionName!,
          platform: 'android',
          serial,
        })
      })
      this.sessionOpen = true
      this.daemonInitialized = true
      console.log(`[AgentDeviceManager] session 已建立: ${this.sessionName}`)
      return true
    } catch (err) {
      console.error(`[AgentDeviceManager] 建立 session 失败 (serial=${serial}):`, err)
      this.sessionOpen = false
      return false
    }
  }

  /** 仅在 daemon 首次 spawn 时临时注入 ELECTRON_RUN_AS_NODE，完成后还原主进程 env */
  private async withDaemonEnv<T>(fn: () => Promise<T>): Promise<T> {
    if (this.daemonInitialized) return fn()
    const prev = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      return await fn()
    } finally {
      if (prev === undefined) Reflect.deleteProperty(process.env, 'ELECTRON_RUN_AS_NODE')
      else process.env.ELECTRON_RUN_AS_NODE = prev
    }
  }

  /** 关闭当前 session（释放 lease）。幂等。 */
  private async closeSession(): Promise<void> {
    if (!this.sessionOpen || !this.client || !this.sessionName) return
    try {
      await this.client.sessions.close({ session: this.sessionName })
    } catch (err) {
      console.warn('[AgentDeviceManager] 关闭 session 失败（忽略）:', err)
    }
    this.sessionOpen = false
  }

  /** 模拟器停止时调用：关 session + 清 serial 绑定。同步清除标记防止与新 session 竞态。 */
  async unbind(): Promise<void> {
    // 同步清除标记，防止 fire-and-forget 的 unbind 与新 ensureSession 竞态：
    // 若不在此处同步清除，closeSession 异步期间新的 doEnsureSession 可能读到旧 sessionOpen=true
    this.sessionOpen = false
    const name = this.sessionName
    this.currentSerial = null
    this.sessionName = null
    // closeSession 内部检查 sessionOpen，上面已置 false → 直接跳过
    // 需要手动关一次旧 session
    if (name && this.client) {
      try {
        await this.client.sessions.close({ session: name })
      } catch {
        // 忽略关闭失败
      }
    }
  }

  /** 销毁：移除事件监听，释放资源。主进程 shutdown 时调用。 */
  destroy(): void {
    this.offActiveChanged?.()
    this.offActiveChanged = null
    this.offSerialRebound?.()
    this.offSerialRebound = null
    void this.unbind()
  }

  // ─── 工具 ───

  /** 注入 CCLink Studio 自管理 adb 到 PATH / ANDROID_HOME，让 daemon 能定位 adb 二进制 */
  private async injectAdbEnv(): Promise<void> {
    try {
      const adbPath = await this.adbBridge.discoverAdb()
      if (!adbPath) return
      const platformToolsDir = path.dirname(adbPath)
      const sdkRoot = path.dirname(platformToolsDir)
      // 前置 platform-tools，让 agent-device 的 runCmd('adb') 命中 CCLink Studio 的 adb
      process.env.PATH = `${platformToolsDir}${path.delimiter}${process.env.PATH ?? ''}`
      process.env.ANDROID_HOME = process.env.ANDROID_HOME ?? sdkRoot
      process.env.ANDROID_SDK_ROOT = process.env.ANDROID_SDK_ROOT ?? sdkRoot
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`[AgentDeviceManager] 未注入 adb 环境（可稍后连接本机 adb）：${message}`)
    }
  }

  /** Promise 超时保护：超时则 reject，让上层走降级 */
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 (${ms}ms)`)), ms)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
