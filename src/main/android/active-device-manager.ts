/**
 * ActiveDeviceManager —— 当前活跃设备的唯一真相源
 *
 * 模拟器 / 云手机路线已封存，当前只允许用户主动连接自己的物理真机。
 * 本类持有「当前活跃设备的 serial + source」，所有下游统一从这里取 serial。
 *
 * 互斥切换模型：切换活跃设备时，旧设备由下游 manager 自治断开（AgentDeviceManager
 * unbind session、scrcpy disconnect），本类只负责广播「serial 变了 / 没了」。
 */

export type DeviceSource = 'physical'

export interface ActiveDevice {
  serial: string
  source: DeviceSource
  avdName?: string
}

export class ActiveDeviceManager {
  private active: ActiveDevice | null = null
  private listeners: Array<(device: ActiveDevice | null) => void> = []

  /** 设置当前活跃设备（覆盖式：serial/source 变化才广播，避免重复通知） */
  set(serial: string, source: DeviceSource, meta?: { avdName?: string }): void {
    const prev = this.active
    if (prev && prev.serial === serial && prev.source === source) return
    this.active = {
      serial,
      source,
      ...(meta?.avdName ? { avdName: meta.avdName } : {}),
    }
    console.log(`[ActiveDeviceManager] 活跃设备: ${serial} (source=${source})`)
    this.emit()
  }

  /** 清除当前活跃设备 */
  clear(): void {
    if (!this.active) return
    console.log(`[ActiveDeviceManager] 清除活跃设备: ${this.active.serial}`)
    this.active = null
    this.emit()
  }

  getSerial(): string | null {
    return this.active?.serial ?? null
  }

  getSource(): DeviceSource | null {
    return this.active?.source ?? null
  }

  getActive(): ActiveDevice | null {
    return this.active
  }

  /** 注册活跃设备变化监听，返回取消函数 */
  onChanged(cb: (device: ActiveDevice | null) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== cb)
    }
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.active)
      } catch (err) {
        console.error('[ActiveDeviceManager] listener 执行失败', err)
      }
    }
  }

  destroy(): void {
    this.listeners = []
    this.active = null
  }
}
