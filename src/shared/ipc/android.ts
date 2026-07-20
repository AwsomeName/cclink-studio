export interface AndroidDeviceLostPayload {
  reason: string
}

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

export interface AndroidApiContract {
  reconnect(): Promise<void>
  onDeviceLost(callback: (info: AndroidDeviceLostPayload) => void): () => void

  listPhysicalDevices(): Promise<PhysicalDevice[]>
  connectPhysical(serial: string): Promise<AndroidPhysicalConnectResult>
  disconnectPhysical(): Promise<AndroidActionSuccess>
  onPhysicalConnected(callback: (data: AndroidPhysicalConnectedPayload) => void): () => void
  onPhysicalDisconnected(callback: () => void): () => void

  onStoreInstallProgress(callback: (msg: string) => void): () => void
  onStoreInstallResult(callback: (result: StoreInstallResult) => void): () => void
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
  onVideoFrame(callback: (frame: ScrcpyVideoFrame) => void): void
  onMirrorError(callback: (error: string) => void): void
  onMirrorDisconnected(callback: () => void): () => void
}
