import { create } from 'zustand'
import type { AndroidDeviceInfo, EmulatorState, PhysicalDevice } from '@shared/ipc/android'

export type { EmulatorState } from '@shared/ipc/android'

/** 应用商店引导安装阶段 */
export type StoreInstallPhase = 'idle' | 'installing' | 'done' | 'failed'

/** 当前活跃设备类型（emulator 为历史快照兼容值，当前只主动连接 physical 真机） */
export type DeviceMode = 'emulator' | 'physical' | null

/** 发现的物理真机（adb，含 unauthorized 便于 UI 引导授权） */
export type PhysicalDeviceInfo = PhysicalDevice

/**
 * Android Store
 *
 * 管理 Android 设备状态。模拟器字段保留用于历史快照兼容，当前主流程只连接物理真机。
 */
interface AndroidState {
  /** 模拟器状态 */
  emulatorState: EmulatorState
  /** 设备信息 */
  deviceInfo: AndroidDeviceInfo | null
  /** 当前 AVD 名称 */
  avdName: string | null
  /** 可用 AVD 列表 */
  avdList: string[]
  /** scrcpy 是否已连接（画面流） */
  mirrorConnected: boolean
  /** 设备屏幕分辨率 */
  screenSize: { width: number; height: number } | null
  /** 应用商店引导安装状态（提升到 store 层，避免 Tab 未挂载时漏事件） */
  storeInstall: {
    phase: StoreInstallPhase
    message?: string
  }
  /** 当前活跃设备类型（emulator / physical / null） */
  deviceMode: DeviceMode
  /** 发现的物理真机列表 */
  physicalDevices: PhysicalDeviceInfo[]

  // Actions
  setEmulatorState: (state: EmulatorState) => void
  setDeviceInfo: (info: AndroidState['deviceInfo']) => void
  setAvdName: (name: string | null) => void
  setAvdList: (list: string[]) => void
  setMirrorConnected: (connected: boolean) => void
  setScreenSize: (size: { width: number; height: number } | null) => void
  setStoreInstall: (state: { phase: StoreInstallPhase; message?: string }) => void
  setDeviceMode: (mode: DeviceMode) => void
  setPhysicalDevices: (devices: PhysicalDeviceInfo[]) => void
  reset: () => void
}

const initialState = {
  emulatorState: 'stopped' as EmulatorState,
  deviceInfo: null,
  avdName: null,
  avdList: [],
  mirrorConnected: false,
  screenSize: null,
  storeInstall: { phase: 'idle' as StoreInstallPhase },
  deviceMode: null as DeviceMode,
  physicalDevices: [],
}

export const useAndroidStore = create<AndroidState>((set) => ({
  ...initialState,

  setEmulatorState: (state) => set({ emulatorState: state }),
  setDeviceInfo: (info) => set({ deviceInfo: info }),
  setAvdName: (name) => set({ avdName: name }),
  setAvdList: (list) => set({ avdList: list }),
  setMirrorConnected: (connected) => set({ mirrorConnected: connected }),
  setScreenSize: (size) => set({ screenSize: size }),
  setStoreInstall: (storeInstall) => set({ storeInstall }),
  setDeviceMode: (mode) => set({ deviceMode: mode }),
  setPhysicalDevices: (physicalDevices) => set({ physicalDevices }),
  reset: () => set(initialState),
}))
