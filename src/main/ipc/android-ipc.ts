import type { BrowserWindow } from 'electron'
import { androidIpcContracts, scrcpyTouchSchema } from '../../shared/ipc/android-contract'
import { androidIpcEvents } from '../../shared/ipc/android'
import type { AdbBridge } from '../android/adb-bridge'
import type { ScrcpyBridge } from '../android/scrcpy-bridge'
import type { ActiveDeviceManager } from '../android/active-device-manager'
import type { PhysicalDeviceManager } from '../android/physical-device-manager'
import { executeAndroidAction } from '../android/android-actions'
import { ensureStoreInstalled } from '../android/store-installer'
import {
  registerTrustedIpcContract,
  registerTrustedIpcListener,
  type TrustedRendererGuard,
} from './trusted-renderer-guard'

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
  // ─── ADB 操控（通过共享 Action Executor） ───

  /** 获取 deviceId（scrcpy 连接需要） */
  registerTrustedIpcContract(androidIpcContracts.getDeviceId, trustedRendererGuard, () => {
    return adbBridge.getDeviceId()
  })

  /** 点击 */
  registerTrustedIpcContract(
    androidIpcContracts.tap,
    trustedRendererGuard,
    async (_event, x, y) => {
      return executeAndroidAction(adbBridge, {
        type: 'tap',
        x,
        y,
      })
    },
  )

  /** 滑动 */
  registerTrustedIpcContract(
    androidIpcContracts.swipe,
    trustedRendererGuard,
    async (_event, x1, y1, x2, y2, duration) => {
      return executeAndroidAction(adbBridge, {
        type: 'swipe',
        x1,
        y1,
        x2,
        y2,
        duration,
      })
    },
  )

  /** 按键 */
  registerTrustedIpcContract(
    androidIpcContracts.pressKey,
    trustedRendererGuard,
    async (_event, key) => executeAndroidAction(adbBridge, { type: 'pressKey', key }),
  )

  /** 输入文本（优先 scrcpy 通道，支持中文） */
  registerTrustedIpcContract(
    androidIpcContracts.typeText,
    trustedRendererGuard,
    async (_event, text) => {
      return executeAndroidAction(adbBridge, { type: 'typeText', text }, scrcpyBridge)
    },
  )

  /** 截图 */
  registerTrustedIpcContract(androidIpcContracts.screenshot, trustedRendererGuard, async () => {
    return executeAndroidAction(adbBridge, { type: 'screenshot' })
  })

  /** 获取设备信息 */
  registerTrustedIpcContract(androidIpcContracts.getDeviceInfo, trustedRendererGuard, async () => {
    return executeAndroidAction(adbBridge, { type: 'deviceInfo' })
  })

  /** 列出已安装应用 */
  registerTrustedIpcContract(
    androidIpcContracts.listPackages,
    trustedRendererGuard,
    async (_event, filter) => {
      return executeAndroidAction(adbBridge, {
        type: 'listPackages',
        filter,
      })
    },
  )

  // ─── 新增：缺失的 IPC Handler ───

  /** 导出 UI 层级 XML */
  registerTrustedIpcContract(androidIpcContracts.dumpUi, trustedRendererGuard, async () => {
    return executeAndroidAction(adbBridge, { type: 'dumpUi' })
  })

  /** 安装 APK */
  registerTrustedIpcContract(
    androidIpcContracts.installApk,
    trustedRendererGuard,
    async (_event, path) => {
      return executeAndroidAction(adbBridge, {
        type: 'installApk',
        path,
      })
    },
  )

  /**
   * 手动重试应用商店引导安装
   *
   * 开机自检失败后，用户在 UI 点「重试」时调用；
   * 复用 ensureStoreInstalled，进度通过 android:storeInstallProgress 推送，
   * 返回最终结果（渲染进程据此更新提示）。
   */
  registerTrustedIpcContract(
    androidIpcContracts.retryStoreInstall,
    trustedRendererGuard,
    async () => {
      return ensureStoreInstalled(adbBridge, (msg) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(androidIpcEvents.storeInstallProgress, msg)
        }
      })
    },
  )

  // ─── 物理真机 ───

  /** 发现物理真机（非 emulator-*，含 unauthorized 便于 UI 引导授权） */
  registerTrustedIpcContract(
    androidIpcContracts.listPhysicalDevices,
    trustedRendererGuard,
    async () => {
      return await physicalDeviceManager.listPhysicalDevices()
    },
  )

  /**
   * 连接物理真机。
   * 连接后 activeDeviceManager 切到 physical，AgentDeviceManager / scrcpy 联动。
   */
  registerTrustedIpcContract(
    androidIpcContracts.connectPhysical,
    trustedRendererGuard,
    async (_event, serial) => {
      const { deviceInfo } = await physicalDeviceManager.connect(serial)
      return { success: true, serial, deviceInfo }
    },
  )

  /** 断开物理真机 */
  registerTrustedIpcContract(
    androidIpcContracts.disconnectPhysical,
    trustedRendererGuard,
    async () => {
      await physicalDeviceManager.disconnect()
      return { success: true }
    },
  )

  // ─── Scrcpy 投屏 ───

  /**
   * 重连当前物理真机，再 scrcpy connect。
   */
  registerTrustedIpcContract(androidIpcContracts.reconnect, trustedRendererGuard, async () => {
    const serial = activeDeviceManager.getSerial()
    if (!serial) {
      throw new Error('真机未连接，请到设置页扫描并连接 USB 或 Wi-Fi ADB 设备')
    }
    await scrcpyBridge.connect(serial)
  })

  /** 连接 scrcpy 投屏 */
  registerTrustedIpcContract(
    androidIpcContracts.connectMirror,
    trustedRendererGuard,
    async (_event, deviceId) => scrcpyBridge.connect(deviceId),
  )

  /** 断开 scrcpy 投屏 */
  registerTrustedIpcContract(
    androidIpcContracts.disconnectMirror,
    trustedRendererGuard,
    async () => {
      await scrcpyBridge.disconnect()
    },
  )

  /** 触摸事件（渲染进程 → 主进程，用于注入到设备） */
  registerTrustedIpcListener(androidIpcEvents.touch, trustedRendererGuard, (_event, data) => {
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
