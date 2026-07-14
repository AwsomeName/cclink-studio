import { ipcMain, BrowserWindow } from 'electron'
import { AdbBridge } from '../android/adb-bridge'
import { ScrcpyBridge } from '../android/scrcpy-bridge'
import { ActiveDeviceManager } from '../android/active-device-manager'
import { PhysicalDeviceManager } from '../android/physical-device-manager'
import { executeAndroidAction } from '../android/android-actions'
import { ensureStoreInstalled } from '../android/store-installer'

const ANDROID_EMULATOR_ARCHIVED_MESSAGE =
  'Android 模拟器 / SDK 一键安装已封存。DeepInk 后续只支持用户自有真机的 USB 或 Wi-Fi ADB 连接。'

/**
 * 注册 Android 相关的 IPC 处理器。
 *
 * 2026-07-14 起，SDK/AVD/模拟器路径封存：IPC 仍保留兼容旧前端和历史快照，
 * 但不会下载 SDK、创建 AVD 或启动 emulator。Android 只保留真机连接与操控。
 * 对标 ipc/browser-ipc.ts
 */
export function registerAndroidIpc(
  adbBridge: AdbBridge,
  mainWindow: BrowserWindow,
  scrcpyBridge: ScrcpyBridge,
  activeDeviceManager: ActiveDeviceManager,
  physicalDeviceManager: PhysicalDeviceManager,
): void {
  // ─── 已封存：SDK 设置 / AVD / 模拟器生命周期 ───

  /** 获取安装状态 */
  ipcMain.handle('android:getSetupStatus', () => {
    return {
      adb: false,
      emulator: false,
      systemImage: false,
      avd: false,
      licenseAccepted: false,
      ready: false,
      archived: true,
      message: ANDROID_EMULATOR_ARCHIVED_MESSAGE,
    }
  })

  /** 获取需用户同意的 Android SDK License 正文 */
  ipcMain.handle('android:getLicense', () => {
    return {
      id: 'android-emulator-archived',
      text: ANDROID_EMULATOR_ARCHIVED_MESSAGE,
    }
  })

  /** 记录用户已接受 License */
  ipcMain.handle('android:acceptLicense', () => {
    return { success: false, error: ANDROID_EMULATOR_ARCHIVED_MESSAGE }
  })

  /** 一键安装：下载 adb + emulator + 系统镜像 + 创建默认 AVD */
  ipcMain.handle('android:setup', async () => {
    return { success: false, error: ANDROID_EMULATOR_ARCHIVED_MESSAGE }
  })

  /** 列出可用 AVD */
  ipcMain.handle('android:listAvds', async () => {
    return []
  })

  /** 启动 AVD */
  ipcMain.handle('android:launch', async (_event, avdName: string) => {
    throw new Error(`${ANDROID_EMULATOR_ARCHIVED_MESSAGE} 已忽略启动请求：${avdName}`)
  })

  /** 停止模拟器 */
  ipcMain.handle('android:terminate', async () => {
    return
  })

  /** 获取模拟器状态 */
  ipcMain.handle('android:getState', () => {
    return 'stopped'
  })

  // ─── ADB 操控（通过共享 Action Executor） ───

  /** 获取 deviceId（scrcpy 连接需要） */
  ipcMain.handle('android:getDeviceId', () => {
    return adbBridge.getDeviceId()
  })

  /** 点击 */
  ipcMain.handle('android:tap', async (_event, x: number, y: number) => {
    return executeAndroidAction(adbBridge, { type: 'tap', x, y })
  })

  /** 滑动 */
  ipcMain.handle(
    'android:swipe',
    async (_event, x1: number, y1: number, x2: number, y2: number, duration?: number) => {
      return executeAndroidAction(adbBridge, { type: 'swipe', x1, y1, x2, y2, duration })
    },
  )

  /** 按键 */
  ipcMain.handle('android:pressKey', async (_event, key: string) => {
    return executeAndroidAction(adbBridge, { type: 'pressKey', key })
  })

  /** 输入文本（优先 scrcpy 通道，支持中文） */
  ipcMain.handle('android:typeText', async (_event, text: string) => {
    return executeAndroidAction(adbBridge, { type: 'typeText', text }, scrcpyBridge)
  })

  /** 截图 */
  ipcMain.handle('android:screenshot', async () => {
    return executeAndroidAction(adbBridge, { type: 'screenshot' })
  })

  /** 获取设备信息 */
  ipcMain.handle('android:getDeviceInfo', async () => {
    return executeAndroidAction(adbBridge, { type: 'deviceInfo' })
  })

  /** 列出已安装应用 */
  ipcMain.handle('android:listPackages', async (_event, filter?: string) => {
    return executeAndroidAction(adbBridge, { type: 'listPackages', filter })
  })

  // ─── 新增：缺失的 IPC Handler ───

  /** 导出 UI 层级 XML */
  ipcMain.handle('android:dumpUi', async () => {
    return executeAndroidAction(adbBridge, { type: 'dumpUi' })
  })

  /** 安装 APK */
  ipcMain.handle('android:installApk', async (_event, path: string) => {
    return executeAndroidAction(adbBridge, { type: 'installApk', path })
  })

  /**
   * 手动重试应用商店引导安装
   *
   * 开机自检失败后，用户在 UI 点「重试」时调用；
   * 复用 ensureStoreInstalled，进度通过 android:storeInstallProgress 推送，
   * 返回最终结果（渲染进程据此更新提示）。
   */
  ipcMain.handle('android:retryStoreInstall', async () => {
    return ensureStoreInstalled(adbBridge, (msg) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('android:storeInstallProgress', msg)
      }
    })
  })

  /** 卸载包 */
  ipcMain.handle('android:uninstallPackage', async (_event, packageName: string) => {
    return executeAndroidAction(adbBridge, { type: 'uninstallPackage', packageName })
  })

  /** 推送文件 */
  ipcMain.handle('android:pushFile', async (_event, local: string, remote: string) => {
    return executeAndroidAction(adbBridge, { type: 'pushFile', local, remote })
  })

  /** 执行 shell 命令 */
  ipcMain.handle('android:shell', async (_event, command: string) => {
    return executeAndroidAction(adbBridge, { type: 'shell', command })
  })

  // ─── 物理真机 ───

  /** 发现物理真机（非 emulator-*，含 unauthorized 便于 UI 引导授权） */
  ipcMain.handle('android:listPhysicalDevices', async () => {
    return await physicalDeviceManager.listPhysicalDevices()
  })

  /**
   * 连接物理真机。
   * 连接后 activeDeviceManager 切到 physical，AgentDeviceManager / scrcpy 联动。
   */
  ipcMain.handle('android:connectPhysical', async (_event, serial: string) => {
    const { deviceInfo } = await physicalDeviceManager.connect(serial)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('android:physicalConnected', { serial, deviceInfo })
    }
    return { success: true, serial, deviceInfo }
  })

  /** 断开物理真机 */
  ipcMain.handle('android:disconnectPhysical', async () => {
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
  ipcMain.handle('android:reconnect', async () => {
    const serial = activeDeviceManager.getSerial()
    if (!serial) {
      throw new Error('真机未连接，请到设置页扫描并连接 USB 或 Wi-Fi ADB 设备')
    }
    await scrcpyBridge.connect(serial)
  })

  /** 连接 scrcpy 投屏 */
  ipcMain.handle('scrcpy:connect', async (_event, deviceId: string) => {
    await scrcpyBridge.connect(deviceId)
  })

  /** 断开 scrcpy 投屏 */
  ipcMain.handle('scrcpy:disconnect', async () => {
    await scrcpyBridge.disconnect()
  })

  /** 触摸事件（渲染进程 → 主进程，用于注入到设备） */
  ipcMain.on('scrcpy:touch', (_event, data: { action: number; x: number; y: number; pressure: number }) => {
    scrcpyBridge.injectTouch(data.action, data.x, data.y, data.pressure).catch((err: Error) => {
      console.warn('[AndroidIpc] injectTouch 失败:', err.message)
    })
  })
}
