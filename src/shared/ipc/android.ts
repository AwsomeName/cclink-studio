import { defineIpcCall } from './contract'

export interface AndroidDeviceInfo {
  model: string
  androidVersion: string
  sdkVersion: string
  manufacturer: string
}

export interface PhysicalDevice {
  serial: string
  state: string
  isEmulator: boolean
  model?: string
}

export interface AndroidPhysicalConnectedPayload {
  serial: string
  deviceInfo: AndroidDeviceInfo
}

export interface AndroidPhysicalConnectResult extends AndroidPhysicalConnectedPayload {
  success: boolean
}

export interface AndroidActionSuccess {
  success: boolean
  error?: string
}

export interface AndroidTypeTextResult extends AndroidActionSuccess {
  channel: 'scrcpy' | 'adb'
}

export interface AndroidScreenshotResult {
  image: string
  mimeType: string
}

export interface AndroidPackageListResult {
  packages: string[]
}

export interface AndroidDumpUiResult {
  xml: string
}

export interface AndroidCommandResult {
  result: string
}

export type StoreInstallStatus = 'already-installed' | 'installed' | 'failed'

export interface StoreInstallResult {
  status: StoreInstallStatus
  storeId: string
  displayName: string
  message?: string
}

export interface ScrcpyTouchPayload {
  action: number
  x: number
  y: number
  pressure: number
}

export interface ScrcpyVideoFrame {
  type: 'configuration' | 'data'
  data: ArrayBuffer
  keyframe?: boolean
  pts?: string
}

const MAX_ANDROID_EVENT_MESSAGE_LENGTH = 10_000
const MAX_SCRCPY_FRAME_BYTES = 64 * 1024 * 1024

export function parseAndroidEventMessage(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_ANDROID_EVENT_MESSAGE_LENGTH
    ? value
    : null
}

export function parseScrcpyVideoFrame(value: unknown): ScrcpyVideoFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const frame = value as Partial<ScrcpyVideoFrame>
  if (frame.type !== 'configuration' && frame.type !== 'data') return null
  if (!(frame.data instanceof ArrayBuffer) || frame.data.byteLength > MAX_SCRCPY_FRAME_BYTES) {
    return null
  }
  if (frame.keyframe !== undefined && typeof frame.keyframe !== 'boolean') return null
  if (frame.pts !== undefined && !/^-?\d{1,32}$/u.test(frame.pts)) return null
  return value as ScrcpyVideoFrame
}

export interface AndroidApiContract {
  reconnect(): Promise<void>

  listPhysicalDevices(): Promise<PhysicalDevice[]>
  connectPhysical(serial: string): Promise<AndroidPhysicalConnectResult>
  disconnectPhysical(): Promise<AndroidActionSuccess>

  onStoreInstallProgress(callback: (msg: string) => void): () => void
  retryStoreInstall(): Promise<StoreInstallResult>

  tap(x: number, y: number): Promise<AndroidActionSuccess>
  swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration?: number,
  ): Promise<AndroidActionSuccess>
  pressKey(key: string): Promise<AndroidActionSuccess>
  typeText(text: string): Promise<AndroidTypeTextResult>
  screenshot(): Promise<AndroidScreenshotResult>
  getDeviceInfo(): Promise<AndroidDeviceInfo>
  listPackages(filter?: string): Promise<AndroidPackageListResult>

  getDeviceId(): Promise<string | null>
  dumpUi(): Promise<AndroidDumpUiResult>
  installApk(path: string): Promise<AndroidCommandResult>

  connectMirror(deviceId: string): Promise<void>
  disconnectMirror(): Promise<void>
  sendTouch(data: ScrcpyTouchPayload): void
  onVideoFrame(callback: (frame: ScrcpyVideoFrame) => void): () => void
  onMirrorError(callback: (error: string) => void): () => void
  onMirrorDisconnected(callback: () => void): () => void
}

export const androidIpc = {
  reconnect: defineIpcCall<[], void>('android:reconnect'),
  listPhysicalDevices: defineIpcCall<[], PhysicalDevice[]>('android:listPhysicalDevices'),
  connectPhysical: defineIpcCall<[serial: string], AndroidPhysicalConnectResult>(
    'android:connectPhysical',
  ),
  disconnectPhysical: defineIpcCall<[], AndroidActionSuccess>('android:disconnectPhysical'),
  retryStoreInstall: defineIpcCall<[], StoreInstallResult>('android:retryStoreInstall'),
  tap: defineIpcCall<[x: number, y: number], AndroidActionSuccess>('android:tap'),
  swipe: defineIpcCall<
    [x1: number, y1: number, x2: number, y2: number, duration: number | undefined],
    AndroidActionSuccess
  >('android:swipe'),
  pressKey: defineIpcCall<[key: string], AndroidActionSuccess>('android:pressKey'),
  typeText: defineIpcCall<[text: string], AndroidTypeTextResult>('android:typeText'),
  screenshot: defineIpcCall<[], AndroidScreenshotResult>('android:screenshot'),
  getDeviceInfo: defineIpcCall<[], AndroidDeviceInfo>('android:getDeviceInfo'),
  listPackages: defineIpcCall<[filter: string | undefined], AndroidPackageListResult>(
    'android:listPackages',
  ),
  getDeviceId: defineIpcCall<[], string | null>('android:getDeviceId'),
  dumpUi: defineIpcCall<[], AndroidDumpUiResult>('android:dumpUi'),
  installApk: defineIpcCall<[path: string], AndroidCommandResult>('android:installApk'),
  connectMirror: defineIpcCall<[deviceId: string], void>('scrcpy:connect'),
  disconnectMirror: defineIpcCall<[], void>('scrcpy:disconnect'),
} as const

export const androidIpcEvents = {
  storeInstallProgress: 'android:storeInstallProgress',
  touch: 'scrcpy:touch',
  videoFrame: 'scrcpy:videoFrame',
  mirrorError: 'scrcpy:error',
  mirrorDisconnected: 'scrcpy:disconnected',
} as const
