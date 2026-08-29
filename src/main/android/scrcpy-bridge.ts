/**
 * Scrcpy 视频流桥接（主进程）
 *
 * 管理设备投屏的完整生命周期：
 *   1. 通过 @yume-chan/adb 连接设备
 *   2. 推送 scrcpy-server.jar 到设备
 *   3. 启动 scrcpy server 并接收 H.264 视频流
 *   4. 通过 IPC 将视频帧转发到渲染进程
 *   5. 接收渲染进程的触摸事件并注入到设备
 *
 * 架构：
 *   [设备] → USB/TCP → [adb server] → [AdbServerClient] → [AdbScrcpyClient]
 *     → H.264 packets → IPC → [Renderer: WebCodecsVideoDecoder → canvas]
 */

import { existsSync, createReadStream, statSync } from 'fs'
import { join } from 'path'
import { app, type BrowserWindow } from 'electron'
import { AdbServerClient, type Adb } from '@yume-chan/adb'
import { AdbScrcpyClient, AdbScrcpyOptions2_3 } from '@yume-chan/adb-scrcpy'
import { AndroidMotionEventAction } from '@yume-chan/scrcpy'
import { androidIpcEvents } from '../../shared/ipc/android'
import { PushReadableStream, type MaybeConsumable } from '@yume-chan/stream-extra'
import { NodeAdbServerConnector } from './node-adb-connector'
import { selectScrcpyServerResource, type ScrcpyServerResource } from './scrcpy-server-resource'

/** scrcpy server JAR 在设备上的路径 */
const DEVICE_SERVER_PATH = '/data/local/tmp/scrcpy-server.jar'

/**
 * 获取 scrcpy-server.jar 的本地路径
 *
 * 生产模式：process.resourcesPath/scrcpy-server.jar
 * 开发模式：项目根目录 resources/scrcpy-server.jar
 */
function getBundledServerJarPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'scrcpy-server.jar')
  }
  return join(app.getAppPath(), 'resources', 'scrcpy-server.jar')
}

/**
 * 将本地文件包装为 @yume-chan 的 ReadableStream<MaybeConsumable<Uint8Array>>
 *
 * 关键：Buffer.slice/from 会从共享 pool 中带出额外数据。用 chunk.slice() 拷贝
 * 出独立的 Uint8Array，避免把内存池里的相邻数据一并送到设备。
 */
function fileToStream(filePath: string): PushReadableStream<MaybeConsumable<Uint8Array>> {
  return new PushReadableStream<MaybeConsumable<Uint8Array>>(async (controller) => {
    const stream = createReadStream(filePath)
    for await (const chunk of stream) {
      // chunk 是 Node Buffer，slice() 拷贝出独立 Uint8Array
      const data = new Uint8Array(chunk) as Uint8Array<ArrayBuffer>
      await controller.enqueue(data)
    }
  })
}

export class ScrcpyBridge {
  private client: AdbScrcpyClient<AdbScrcpyOptions2_3<true>> | null = null
  private adb: Adb | null = null
  private mainWindow: BrowserWindow
  private _connected = false
  /** video 流像素尺寸（由 configuration 包解析得出），供触摸坐标缩放 */
  private videoWidth = 0
  private videoHeight = 0

  constructor(
    mainWindow: BrowserWindow,
    private readonly resolveManagedServer: () => Promise<ScrcpyServerResource | null> = async () =>
      null,
  ) {
    this.mainWindow = mainWindow
  }

  /** 投屏是否已连接 */
  isConnected(): boolean {
    return this._connected
  }

  /**
   * 连接设备并启动 scrcpy 投屏
   *
   * @param deviceId 设备序列号（由 AdbBridge.getDeviceId() 获取）
   */
  async connect(deviceId: string): Promise<void> {
    if (this._connected) {
      throw new Error('Scrcpy 已连接，请先断开')
    }

    console.log(`[ScrcpyBridge] 正在连接设备: ${deviceId}`)

    // 1. 验证 scrcpy-server.jar 存在
    const managedServer = await this.resolveManagedServer()
    const server = selectScrcpyServerResource(managedServer, getBundledServerJarPath())
    try {
      const jarPath = server.path
      if (!existsSync(jarPath)) {
        throw new Error(
          `scrcpy-server.jar 未找到: ${jarPath}。请确保 resources/scrcpy-server.jar 已放置。`,
        )
      }
      const jarSize = statSync(jarPath).size
      console.log(
        `[ScrcpyBridge] scrcpy-server.jar: ${jarPath} (${(jarSize / 1024 / 1024).toFixed(1)}MB, ${server.source})`,
      )

      // 2. 通过 AdbServerClient 连接到本地 adb server
      const adbClient = new AdbServerClient(new NodeAdbServerConnector())
      this.adb = await adbClient.createAdb({ serial: deviceId })
      console.log('[ScrcpyBridge] ADB 连接已建立')

      // 3. 推送 scrcpy-server.jar 到设备
      const jarStream = fileToStream(jarPath)
      await AdbScrcpyClient.pushServer(this.adb, jarStream)
      console.log('[ScrcpyBridge] scrcpy-server.jar 已推送到设备')
    } finally {
      managedServer?.release?.()
    }

    // 4. 配置 scrcpy 选项
    // clientOptions.version 必须与 resources/scrcpy-server.jar 的实际版本一致，
    // 否则 server 启动时会抛 "The server version (x) does not match the client (y)"
    // patch 版本之间协议兼容，所以 jar 是 2.3.1 时这里传 "2.3.1"
    const options = new AdbScrcpyOptions2_3(
      {
        video: true,
        audio: false,
        control: true,
        tunnelForward: true,
        sendFrameMeta: true,
        maxFps: 30,
        videoBitRate: 4_000_000, // 4 Mbps
        cleanup: true,
        powerOn: true,
        logLevel: 'warn',
      },
      { version: server.version },
    )

    // 5. 启动 scrcpy
    this.client = await AdbScrcpyClient.start(this.adb, DEVICE_SERVER_PATH, options)
    console.log('[ScrcpyBridge] scrcpy server 已启动')

    // 6. 获取并转发视频流
    const videoStream = await this.client.videoStream
    if (!videoStream) {
      throw new Error('scrcpy 视频流不可用')
    }
    this.forwardVideoFrames(videoStream.stream)

    // 7. 记录 video 像素尺寸：scrcpy server 注入触摸时，需要按 videoWidth/videoHeight
    //    把客户端传入的坐标（video 像素空间）缩放到真实设备屏幕。
    //    若传 0，坐标会被除以 0 → 落在屏幕外，表现为点击无反应。
    videoStream.sizeChanged(({ width, height }: { width: number; height: number }) => {
      this.videoWidth = width
      this.videoHeight = height
    })

    this._connected = true
    console.log('[ScrcpyBridge] 投屏连接成功')
  }

  /**
   * 转发视频帧到渲染进程
   *
   * 将 ScrcpyMediaStreamPacket 序列化为可跨 IPC 传输的格式：
   * - Uint8Array → ArrayBuffer（零拷贝转移）
   * - bigint → string（IPC 不原生支持 bigint）
   */
  private forwardVideoFrames(stream: any): void {
    const reader = stream.getReader()

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (this.mainWindow.isDestroyed()) break

          // 序列化帧数据
          const frame: {
            type: 'configuration' | 'data'
            data: ArrayBuffer
            keyframe?: boolean
            pts?: string
          } = {
            type: value.type,
            // 将 Uint8Array 拷贝为独立 ArrayBuffer（IPC 结构化克隆安全传输）
            data: new Uint8Array(value.data).buffer as ArrayBuffer,
          }

          if (value.type === 'data') {
            frame.keyframe = value.keyframe
            frame.pts = value.pts?.toString()
          }

          if (!this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(androidIpcEvents.videoFrame, frame)
          }
        }
      } catch (err: any) {
        console.error('[ScrcpyBridge] 视频流错误:', err.message)
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(androidIpcEvents.mirrorError, err.message)
        }
      } finally {
        this._connected = false
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(androidIpcEvents.mirrorDisconnected)
        }
      }
    }

    pump()
  }

  /**
   * 注入触摸事件到设备
   *
   * @param action 0=DOWN, 1=UP, 2=MOVE
   * @param x X 坐标（设备像素）
   * @param y Y 坐标（设备像素）
   * @param pressure 压力值（0.0-1.0）
   */
  async injectTouch(action: number, x: number, y: number, pressure: number): Promise<void> {
    const controller = this.client?.controller
    if (!controller) return

    // 将 action number 映射为 AndroidMotionEventAction 枚举值
    const actionMap: Record<
      number,
      (typeof AndroidMotionEventAction)[keyof typeof AndroidMotionEventAction]
    > = {
      0: AndroidMotionEventAction.Down,
      1: AndroidMotionEventAction.Up,
      2: AndroidMotionEventAction.Move,
    }

    await controller.injectTouch({
      action: actionMap[action] ?? AndroidMotionEventAction.Down,
      pointerId: BigInt(0),
      pointerX: x,
      pointerY: y,
      // 用真实 video 尺寸，让 server 端正确缩放触摸坐标到设备屏幕
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
      pressure,
      actionButton: 0,
      buttons: 0,
    })
  }

  /**
   * 注入文本到设备（支持中文/Unicode）
   *
   * scrcpy 协议的 injectText 直接发送 UTF-8 字节流到设备，绕过
   * adb input text 的 ASCII 限制。当 scrcpy 投屏未连接时返回 false，
   * 调用方应回退到 ADB（仅 ASCII 可用）。
   *
   * @param text 要输入的文本
   * @returns 是否成功（false 表示 scrcpy 未连接）
   */
  async injectText(text: string): Promise<boolean> {
    const controller = this.client?.controller
    if (!controller) return false
    await controller.injectText(text)
    return true
  }

  /**
   * 断开 scrcpy 连接
   */
  async disconnect(): Promise<void> {
    try {
      await this.client?.close()
    } catch (err: any) {
      console.warn('[ScrcpyBridge] 断开连接时出错:', err.message)
    }
    this.client = null
    this.adb = null
    this.videoWidth = 0
    this.videoHeight = 0
    this._connected = false
    console.log('[ScrcpyBridge] 已断开连接')
  }
}
