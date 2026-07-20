import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { AdbBridge } from '../android/adb-bridge'
import type { ScrcpyBridge } from '../android/scrcpy-bridge'
import type { ActiveDeviceManager } from '../android/active-device-manager'
import type { PhysicalDeviceManager } from '../android/physical-device-manager'
import { executeAndroidAction } from '../android/android-actions'
import { ensureStoreInstalled } from '../android/store-installer'
import {
  registerTrustedIpcHandler,
  registerTrustedIpcListener,
  type TrustedRendererGuard,
} from './trusted-renderer-guard'
import {
  androidApkPathSchema,
  androidCoordinateSchema,
  androidDeviceIdSchema,
  androidKeySchema,
  androidPackageFilterSchema,
  androidSwipeDurationSchema,
  androidTextSchema,
  scrcpyTouchSchema,
} from './android-ipc-schema'

/**
 * 注册 Android 相关的 IPC 处理器。
 *
 * Android 只保留用户自有真机连接与操控。
 * 对标 ipc/browser-ipc.ts
 */
export function registerAndroidIpc(
  adbBridge: AdbBridge,
  mainWindow: BrowserWindow,
  scrcpyBridge: ScrcpyBridge,
  activeDeviceManager: ActiveDeviceManager,
  physicalDeviceManager: PhysicalDeviceManager,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void => registerTrustedIpcHandler(channel, trustedRendererGuard, handler)

  // ─── ADB 操控（通过共享 Action Executor） ───

  /** 获取 deviceId（scrcpy 连接需要） */
  handle('android:getDeviceId', () => {
    return adbBridge.getDeviceId()
  })

  /** 点击 */
  handle('android:tap', async (_event, x: number, y: number) => {
    return executeAndroidAction(adbBridge, {
      type: 'tap',
      x: androidCoordinateSchema.parse(x),
      y: androidCoordinateSchema.parse(y),
    })
  })

  /** 滑动 */
  handle(
    'android:swipe',
    async (_event, x1: number, y1: number, x2: number, y2: number, duration?: number) => {
      return executeAndroidAction(adbBridge, {
        type: 'swipe',
        x1: androidCoordinateSchema.parse(x1),
        y1: androidCoordinateSchema.parse(y1),
        x2: androidCoordinateSchema.parse(x2),
        y2: androidCoordinateSchema.parse(y2),
        duration: androidSwipeDurationSchema.parse(duration),
      })
    },
  )

  /** 按键 */
  handle('android:pressKey', async (_event, key: string) => {
    return executeAndroidAction(adbBridge, { type: 'pressKey', key: androidKeySchema.parse(key) })
  })

  /** 输入文本（优先 scrcpy 通道，支持中文） */
  handle('android:typeText', async (_event, text: string) => {
    return executeAndroidAction(
      adbBridge,
      { type: 'typeText', text: androidTextSchema.parse(text) },
      scrcpyBridge,
    )
  })

  /** 截图 */
  handle('android:screenshot', async () => {
    return executeAndroidAction(adbBridge, { type: 'screenshot' })
  })

  /** 获取设备信息 */
  handle('android:getDeviceInfo', async () => {
    return executeAndroidAction(adbBridge, { type: 'deviceInfo' })
  })

  /** 列出已安装应用 */
  handle('android:listPackages', async (_event, filter?: string) => {
    return executeAndroidAction(adbBridge, {
      type: 'listPackages',
      filter: androidPackageFilterSchema.parse(filter),
    })
  })

  // ─── 新增：缺失的 IPC Handler ───

  /** 导出 UI 层级 XML */
  handle('android:dumpUi', async () => {
    return executeAndroidAction(adbBridge, { type: 'dumpUi' })
  })

  /** 安装 APK */
  handle('android:installApk', async (_event, path: string) => {
    return executeAndroidAction(adbBridge, {
      type: 'installApk',
      path: androidApkPathSchema.parse(path),
    })
  })

  /**
   * 手动重试应用商店引导安装
   *
   * 开机自检失败后，用户在 UI 点「重试」时调用；
   * 复用 ensureStoreInstalled，进度通过 android:storeInstallProgress 推送，
   * 返回最终结果（渲染进程据此更新提示）。
   */
  handle('android:retryStoreInstall', async () => {
    return ensureStoreInstalled(adbBridge, (msg) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('android:storeInstallProgress', msg)
      }
    })
  })

  // ─── 物理真机 ───

  /** 发现物理真机（非 emulator-*，含 unauthorized 便于 UI 引导授权） */
  handle('android:listPhysicalDevices', async () => {
    return await physicalDeviceManager.listPhysicalDevices()
  })

  /**
   * 连接物理真机。
   * 连接后 activeDeviceManager 切到 physical，AgentDeviceManager / scrcpy 联动。
   */
  handle('android:connectPhysical', async (_event, serial: string) => {
    const parsedSerial = androidDeviceIdSchema.parse(serial)
    const { deviceInfo } = await physicalDeviceManager.connect(parsedSerial)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('android:physicalConnected', { serial: parsedSerial, deviceInfo })
    }
    return { success: true, serial: parsedSerial, deviceInfo }
  })

  /** 断开物理真机 */
  handle('android:disconnectPhysical', async () => {
    await physicalDeviceManager.disconnect()
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('android:physicalDisconnected')
    }
    return { success: true }
  })

  // ─── Scrcpy 投屏 ───

  /**
   * 重连当前物理真机，再 scrcpy connect。
   */
  handle('android:reconnect', async () => {
    const serial = activeDeviceManager.getSerial()
    if (!serial) {
      throw new Error('真机未连接，请到设置页扫描并连接 USB 或 Wi-Fi ADB 设备')
    }
    await scrcpyBridge.connect(serial)
  })

  /** 连接 scrcpy 投屏 */
  handle('scrcpy:connect', async (_event, deviceId: string) => {
    await scrcpyBridge.connect(androidDeviceIdSchema.parse(deviceId))
  })

  /** 断开 scrcpy 投屏 */
  handle('scrcpy:disconnect', async () => {
    await scrcpyBridge.disconnect()
  })

  /** 触摸事件（渲染进程 → 主进程，用于注入到设备） */
  registerTrustedIpcListener('scrcpy:touch', trustedRendererGuard, (_event, data) => {
    const parsed = scrcpyTouchSchema.safeParse(data)
    if (!parsed.success) {
      console.warn('[AndroidIpc] 已丢弃非法触摸事件')
      return
    }
    scrcpyBridge
      .injectTouch(parsed.data.action, parsed.data.x, parsed.data.y, parsed.data.pressure)
      .catch((err: Error) => {
        console.warn('[AndroidIpc] injectTouch 失败:', err.message)
      })
  })
}
