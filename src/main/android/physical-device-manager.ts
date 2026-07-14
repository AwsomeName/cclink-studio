/**
 * PhysicalDeviceManager —— 物理真机的发现与连接管理
 *
 * 本类管理通过 USB ADB 连接的物理真机。不持有进程，只负责：
 * 发现设备、把真机 serial 注入 AdbBridge + 注册为活跃设备、
 * 断开。设备在线/离线由物理连接决定，本类不做定时 reconcile（MVP 靠 scrcpy 断开
 * 事件 + 手动重连；定时探活留后）。
 *
 * MVP 范围：仅 USB。WiFi ADB（adb tcpip + connect）留后。
 */
import type { AdbBridge, DeviceInfo } from './adb-bridge'
import type { ActiveDeviceManager } from './active-device-manager'
import type { PhysicalDevice } from '../../shared/ipc/android'

export type { PhysicalDevice } from '../../shared/ipc/android'

export class PhysicalDeviceManager {
  constructor(
    private adbBridge: AdbBridge,
    private activeDeviceManager: ActiveDeviceManager,
  ) {}

  /**
   * 发现所有物理真机（非 emulator-*，含 unauthorized 便于 UI 引导授权）
   *
   * 返回的 model 仅对 state==='device' 的设备填充（unauthorized/offline 取不到属性）。
   */
  async listPhysicalDevices(): Promise<PhysicalDevice[]> {
    const devices = await this.adbBridge.listAllDevices()
    const physical = devices.filter((d) => !d.isEmulator)
    const result: PhysicalDevice[] = []
    for (const d of physical) {
      let model: string | undefined
      if (d.state === 'device') {
        try {
          model = (await this.adbBridge.execAdbWithSerial(d.serial, [
            'shell',
            'getprop',
            'ro.product.model',
          ])).stdout.trim()
        } catch {
          // 取型号失败不影响发现
        }
      }
      result.push({ serial: d.serial, state: d.state, isEmulator: false, ...(model ? { model } : {}) })
    }
    return result
  }

  /**
   * 连接指定真机：注入 serial + 注册为活跃设备
   *
   * 注册到 ActiveDeviceManager 会触发下游联动（AgentDeviceManager 记录 serial、
   * scrcpy 由调用方按需 connect）。
   */
  async connect(serial: string): Promise<{ deviceInfo: DeviceInfo }> {
    this.adbBridge.setSerial(serial, null) // avdName=null 标识真机
    const deviceInfo = await this.adbBridge.getDeviceInfo()
    this.activeDeviceManager.set(serial, 'physical')
    return { deviceInfo }
  }

  /** 断开真机：清除活跃设备（联动 unbind session + scrcpy disconnect）+ 解绑 serial */
  async disconnect(): Promise<void> {
    this.activeDeviceManager.clear()
    this.adbBridge.clearSerial()
  }

  /** 检查指定真机是否在线（状态 device） */
  async isOnline(serial: string): Promise<boolean> {
    return this.adbBridge.isSerialOnline(serial)
  }
}
