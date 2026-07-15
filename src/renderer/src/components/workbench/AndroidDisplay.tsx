import { useRef, useEffect, useCallback, useState } from 'react'
import { useAndroidStore } from '../../stores/android-store'

/**
 * Android 真机画面显示。
 *
 * 模拟器 / SDK / AVD 路线已封存：此组件只在用户主动连接 USB / Wi-Fi ADB 真机后
 * 连接 scrcpy 投屏，不再触发 SDK 安装、AVD 枚举或 emulator 启动。
 */
export function AndroidDisplay(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decoderRef = useRef<any>(null)
  const streamControllerRef = useRef<ReadableStreamDefaultController<any> | null>(null)
  const [mirrorStatus, setMirrorStatus] = useState<
    'disconnected' | 'connecting' | 'connected' | 'error'
  >('disconnected')
  const [mirrorError, setMirrorError] = useState<string | null>(null)

  const storeInstall = useAndroidStore((s) => s.storeInstall)
  const setStoreInstall = useAndroidStore((s) => s.setStoreInstall)
  const deviceMode = useAndroidStore((s) => s.deviceMode)
  const setMirrorConnected = useAndroidStore((s) => s.setMirrorConnected)

  /** 连接到 scrcpy 投屏（主进程只允许当前已连接真机重连） */
  const connectMirror = useCallback(async () => {
    if (mirrorStatus === 'connecting' || mirrorStatus === 'connected') return
    setMirrorStatus('connecting')
    setMirrorError(null)

    try {
      await window.deepink.android.reconnect()

      const canvas = canvasRef.current
      if (!canvas) throw new Error('Canvas 不可用')

      const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs')
      const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs')
      const { ScrcpyVideoCodecId } = await import('@yume-chan/scrcpy')

      const renderer = new WebGLVideoFrameRenderer(canvas)
      const decoder = new WebCodecsVideoDecoder({
        codec: ScrcpyVideoCodecId.H264,
        renderer,
      })
      decoderRef.current = decoder

      let controller: ReadableStreamDefaultController<any>
      const bridgeStream = new ReadableStream({
        start(c) {
          controller = c
        },
      })
      streamControllerRef.current = controller!

      bridgeStream.pipeTo(decoder.writable).catch(() => {
        // 断开连接时 pipe 中断属于正常路径
      })

      window.deepink.android.onVideoFrame(
        (frame: {
          type: 'configuration' | 'data'
          data: ArrayBuffer
          keyframe?: boolean
          pts?: string
        }) => {
          if (!streamControllerRef.current) return
          try {
            const packet =
              frame.type === 'configuration'
                ? { type: 'configuration' as const, data: new Uint8Array(frame.data) }
                : {
                    type: 'data' as const,
                    data: new Uint8Array(frame.data),
                    keyframe: frame.keyframe,
                    pts: frame.pts ? BigInt(frame.pts) : undefined,
                  }
            streamControllerRef.current.enqueue(packet)
          } catch {
            // stream 可能已关闭
          }
        },
      )

      decoder.sizeChanged(({ width, height }: { width: number; height: number }) => {
        if (canvasRef.current) {
          canvasRef.current.width = width
          canvasRef.current.height = height
        }
      })

      window.deepink.android.onMirrorError((error: string) => {
        setMirrorStatus('error')
        setMirrorError(error)
        setMirrorConnected(false)
      })

      setMirrorStatus('connected')
      setMirrorConnected(true)
    } catch (err: any) {
      console.error('[AndroidDisplay] 连接失败:', err)
      setMirrorStatus('error')
      setMirrorError(err.message)
      setMirrorConnected(false)
    }
  }, [mirrorStatus, setMirrorConnected])

  /** 断开投屏 */
  const disconnectMirror = useCallback(async () => {
    try {
      streamControllerRef.current?.close()
    } catch {
      /* ignore */
    }
    streamControllerRef.current = null

    try {
      decoderRef.current?.dispose()
    } catch {
      /* ignore */
    }
    decoderRef.current = null

    try {
      await window.deepink.android.disconnectMirror()
    } catch {
      /* ignore */
    }

    setMirrorStatus('disconnected')
    setMirrorConnected(false)
  }, [setMirrorConnected])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mirrorStatus !== 'connected') return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height
      window.deepink.android.sendTouch({ action: 0, x, y, pressure: 1.0 })
    },
    [mirrorStatus],
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mirrorStatus !== 'connected') return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height
      window.deepink.android.sendTouch({ action: 1, x, y, pressure: 0.0 })
    },
    [mirrorStatus],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mirrorStatus !== 'connected' || !(e.buttons & 1)) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * canvas.width
      const y = ((e.clientY - rect.top) / rect.height) * canvas.height
      window.deepink.android.sendTouch({ action: 2, x, y, pressure: 1.0 })
    },
    [mirrorStatus],
  )

  useEffect(() => {
    const offLost = window.deepink.android.onDeviceLost(() => {
      setMirrorStatus('error')
      setMirrorError('设备已断开')
      setMirrorConnected(false)
    })
    const offDisconnected = window.deepink.android.onMirrorDisconnected(() => {
      setMirrorStatus('disconnected')
      setMirrorConnected(false)
    })
    return () => {
      offLost()
      offDisconnected()
    }
  }, [setMirrorConnected])

  useEffect(() => {
    if (deviceMode === 'physical' && mirrorStatus === 'disconnected') {
      connectMirror()
    }
  }, [deviceMode, mirrorStatus, connectMirror])

  useEffect(() => {
    return () => {
      try {
        streamControllerRef.current?.close()
      } catch {
        /* ignore */
      }
      try {
        decoderRef.current?.dispose()
      } catch {
        /* ignore */
      }
      window.deepink.android.disconnectMirror().catch(() => {})
      setMirrorConnected(false)
    }
  }, [setMirrorConnected])

  const handleRetryStoreInstall = useCallback(async () => {
    setStoreInstall({ phase: 'installing', message: '正在重试...' })
    try {
      const result = await window.deepink.android.retryStoreInstall()
      if (result.status === 'failed') {
        setStoreInstall({ phase: 'failed', message: result.message })
      } else {
        setStoreInstall({
          phase: 'done',
          message:
            result.status === 'installed'
              ? `已安装 ${result.displayName}`
              : `${result.displayName} 已就绪`,
        })
        setTimeout(() => setStoreInstall({ phase: 'idle' }), 4000)
      }
    } catch (err: any) {
      setStoreInstall({ phase: 'failed', message: err.message })
    }
  }, [setStoreInstall])

  const handleManualInstallStore = useCallback(async () => {
    try {
      const picked = await window.deepink.dialog.showOpenDialog({
        title: '选择应用商店 APK',
        filters: [{ name: 'Android APK', extensions: ['apk'] }],
      })
      if (picked.canceled || picked.filePaths.length === 0) return
      const apkPath = picked.filePaths[0]
      if (!apkPath) return
      setStoreInstall({ phase: 'installing', message: '正在安装所选 APK...' })
      await window.deepink.android.installApk(apkPath)
      setStoreInstall({ phase: 'done', message: '应用商店已安装' })
      setTimeout(() => setStoreInstall({ phase: 'idle' }), 4000)
    } catch (err: any) {
      setStoreInstall({ phase: 'failed', message: `安装失败：${err.message}` })
    }
  }, [setStoreInstall])

  if (deviceMode !== 'physical') {
    return (
      <CenterMessage>
        <div style={{ marginBottom: '12px' }}>Android 模拟器已封存</div>
        <div style={{ fontSize: '12px', color: '#888', maxWidth: '420px', lineHeight: 1.6 }}>
          CCLink Studio 不再安装或启动 Android SDK / AVD / 模拟器。请在设置页扫描并连接自己的
          USB 或 Wi-Fi ADB 真机。
        </div>
      </CenterMessage>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1e1e1e',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          cursor: 'pointer',
          display: mirrorStatus === 'connected' ? 'block' : 'none',
        }}
      />

      {mirrorStatus === 'disconnected' && (
        <CenterOverlay>
          <div style={{ marginBottom: '12px' }}>📱 真机已连接</div>
          <button
            onClick={connectMirror}
            style={{
              padding: '8px 24px',
              background: '#0e639c',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            连接画面
          </button>
        </CenterOverlay>
      )}

      {mirrorStatus === 'connecting' && <CenterOverlay>⏳ 正在连接 Android 画面...</CenterOverlay>}

      {mirrorStatus === 'error' && (
        <CenterOverlay>
          <div style={{ color: '#f48771', marginBottom: '8px' }}>❌ 连接失败</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>
            {mirrorError}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={connectMirror}
              style={{
                padding: '6px 16px',
                background: '#0e639c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              重试
            </button>
            <button
              onClick={disconnectMirror}
              style={{
                padding: '6px 16px',
                background: '#333',
                color: '#ccc',
                border: '1px solid #555',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              断开
            </button>
          </div>
        </CenterOverlay>
      )}

      {mirrorStatus === 'connected' && (
        <button
          onClick={disconnectMirror}
          title="断开投屏"
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            padding: '4px 8px',
            background: 'rgba(0,0,0,0.6)',
            color: '#ccc',
            border: '1px solid #555',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '11px',
          }}
        >
          断开
        </button>
      )}

      {storeInstall.phase !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            maxWidth: '260px',
            padding: '8px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            lineHeight: 1.4,
            textAlign: 'left',
            background:
              storeInstall.phase === 'failed' ? 'rgba(244,135,113,0.18)' : 'rgba(0,0,0,0.65)',
            border: `1px solid ${storeInstall.phase === 'failed' ? '#f48771' : '#555'}`,
            color: storeInstall.phase === 'failed' ? '#f48771' : '#ccc',
          }}
        >
          {storeInstall.phase === 'installing' && (
            <span>⏳ {storeInstall.message ?? '正在准备应用商店...'}</span>
          )}
          {storeInstall.phase === 'done' && (
            <span style={{ color: '#4ec9b0' }}>✓ {storeInstall.message}</span>
          )}
          {storeInstall.phase === 'failed' && (
            <>
              <div style={{ marginBottom: '4px' }}>⚠️ 应用商店获取失败</div>
              {storeInstall.message && (
                <div style={{ color: '#999', marginBottom: '6px', fontSize: '10px' }}>
                  {storeInstall.message}
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={handleRetryStoreInstall}
                  style={{
                    padding: '3px 10px',
                    background: '#0e639c',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  重试
                </button>
                <button
                  onClick={handleManualInstallStore}
                  style={{
                    padding: '3px 10px',
                    background: '#333',
                    color: '#ccc',
                    border: '1px solid #555',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  选择 APK
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CenterOverlay({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        textAlign: 'center',
        color: '#888',
        fontSize: '14px',
        background: '#1e1e1e',
      }}
    >
      {children}
    </div>
  )
}

function CenterMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1e1e1e',
        color: '#888',
        fontSize: '14px',
        flexDirection: 'column',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}
