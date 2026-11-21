import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type RFB from '@novnc/novnc'
import type { DesktopCredential, RemoteDesktopDevice } from '@shared/ipc/remote-desktop'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { getWorkspaceStateKey, getWorkspaceStateOwnerKey } from '../../utils/workspace-state'
import { flushPendingWorkbenchTabWrites } from '../../utils/workbench-tab-model'
import { DesktopChannel } from './desktop-channel'
import { applyMacServerModifiers } from './mac-keys'
import { installMacWheel } from './mac-scroll'
import { installNoVncProbe } from './novnc-probe'
import { createDesktopDiagnostics } from './desktop-diagnostics'
import {
  registerDesktopController,
  useDesktopSessionStore,
  type DesktopPhase,
  type DesktopSessionController,
} from './desktop-session-store'
import { DESKTOP_FULLSCREEN_SHORTCUT } from './desktop-controls'
import './remote-desktop.css'

type Phase = DesktopPhase
const NEW_DEVICE = ''
const api = (): typeof window.cclinkStudio.remoteDesktop => window.cclinkStudio.remoteDesktop

export function RemoteDesktopTab({
  tab,
  active,
}: {
  tab: Tab
  active: boolean
}): React.ReactElement {
  const [devices, setDevices] = useState<RemoteDesktopDevice[] | null>(null)
  const [deviceId, setDeviceId] = useState(tab.desktopTarget?.deviceId ?? NEW_DEVICE)
  const [name, setName] = useState(tab.title === '远程桌面' ? '' : tab.title)
  const [host, setHost] = useState(tab.desktopTarget?.host ?? '')
  const [port, setPort] = useState(tab.desktopTarget?.port ?? 5900)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [usernameRequired, setUsernameRequired] = useState(false)
  const fit = (tab.desktopView ?? 'fit') === 'fit'
  const [fullscreen, setFullscreen] = useState(false)
  const [interrupted, setInterrupted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  /** Resolves to the native window fullscreen state before we entered; null when not entered. */
  const windowWasFullscreen = useRef<Promise<boolean | null> | null>(null)
  const revealTimer = useRef<number | undefined>(undefined)
  const target = useRef<HTMLDivElement>(null)
  const client = useRef<RFB | null>(null)
  const generation = useRef(0)
  const handshakeTimer = useRef<number | undefined>(undefined)
  const releaseDiagnostics = useRef<(() => void) | undefined>(undefined)
  const sessionRef = useRef<string | null>(null)
  /** Credentials typed with "remember" ticked; saved only after the RFB session connects. */
  const pendingRemember = useRef<DesktopCredential | null>(null)
  /** Devices whose saved password was rejected; skip autofill until the user saves a new one. */
  const rejectedSaved = useRef(new Set<string>())
  const activeRef = useRef(active)
  activeRef.current = active
  const selected = devices?.find((device) => device.id === deviceId)

  const stop = (): void => {
    generation.current++
    window.clearTimeout(handshakeTimer.current)
    releaseDiagnostics.current?.()
    releaseDiagnostics.current = undefined
    pendingRemember.current = null
    sessionRef.current = null
    const rfb = client.current
    client.current = null
    rfb?.disconnect()
  }
  useEffect(() => stop, [])

  const fillFrom = (device: RemoteDesktopDevice): void => {
    setDeviceId(device.id)
    setName(device.name)
    setHost(device.host)
    setPort(device.port)
  }

  // Load the Studio-local catalog; migrate a legacy Tab that still stores host/port.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let list = await api().listDevices()
        const legacy = tab.desktopTarget
        if (!legacy?.deviceId && legacy?.host) {
          try {
            const migrated = await api().saveDevice({
              id: null,
              name: tab.title.trim() || legacy.host,
              host: legacy.host,
              port: legacy.port ?? 5900,
            })
            useTabStore
              .getState()
              .setDesktopTarget(tab.id, migrated.name, { deviceId: migrated.id })
            list = await api().listDevices()
            if (!cancelled) fillFrom(migrated)
          } catch (error) {
            // Keep the legacy address in the form so the user can correct it and connect.
            console.warn('[RemoteDesktop] 旧标签地址迁移失败', String(error))
          }
        } else if (legacy?.deviceId) {
          const known = list.find((device) => device.id === legacy.deviceId)
          if (!cancelled && known) fillFrom(known)
          else if (!cancelled) {
            setDeviceId(NEW_DEVICE)
            setMessage('本机未配置这台设备，请填写地址后连接。')
          }
        }
        if (!cancelled) setDevices(list)
      } catch (error) {
        console.warn('[RemoteDesktop] 读取远程设备列表失败', String(error))
        if (!cancelled) setDevices([])
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once per Tab; later changes go through this component.
  }, [tab.id])

  useLayoutEffect(() => {
    const rfb = client.current
    if (rfb) {
      if (!active) rfb.blur()
      rfb.viewOnly = !active
      // Keys only reach the remote when the canvas has focus; take it on connect/return.
      if (active && phase === 'connected') rfb.focus({ preventScroll: true })
      // Fullscreen always scales the remote screen to the display.
      rfb.scaleViewport = fit || fullscreen
    }
  }, [active, fit, fullscreen, phase])

  const refreshDevices = async (): Promise<void> => {
    try {
      setDevices(await api().listDevices())
    } catch {
      /* keep the previous list */
    }
  }

  const forgetSaved = async (): Promise<void> => {
    if (!selected) return
    await api().forgetCredential(selected.id)
    rejectedSaved.current.delete(selected.id)
    await refreshDevices()
    setMessage('已删除本机保存的密码。')
  }

  const connect = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (!host.trim()) {
      setMessage('请填写主机名或 IP。')
      return
    }
    stop()
    const attempt = generation.current
    setInterrupted(false)
    setPhase('connecting')
    setMessage('')
    const fail = (explanation: string): void => {
      if (generation.current !== attempt) return
      stop()
      setInterrupted(true)
      setMessage(explanation)
      setPhase('ended')
    }
    let device: RemoteDesktopDevice
    try {
      device = await api().saveDevice({
        id: deviceId || null,
        name: name.trim() || host.trim(),
        host: host.trim(),
        port,
      })
    } catch {
      fail('设备地址无效，请检查主机名、IP 和端口。')
      return
    }
    if (generation.current !== attempt) return
    fillFrom(device)
    void refreshDevices()
    useTabStore.getState().setDesktopTarget(tab.id, device.name, { deviceId: device.id })
    const sessionId = crypto.randomUUID()
    const input = {
      sessionId,
      tabId: tab.id,
      workspaceKey: getWorkspaceStateKey(),
      ownerKey: getWorkspaceStateOwnerKey(),
      deviceId: device.id,
    }
    try {
      const [{ default: Viewer }] = await Promise.all([
        import('@novnc/novnc'),
        flushPendingWorkbenchTabWrites(),
      ])
      if (generation.current !== attempt || !target.current) return
      sessionRef.current = sessionId
      const channel = new DesktopChannel(input)
      const rfb = new Viewer(target.current, channel, { shared: true })
      client.current = rfb
      const diag = createDesktopDiagnostics(`${device.host}:${device.port}`)
      diag.stage('connecting')
      const unwatch = diag.watchInput(target.current, () => activeRef.current)
      const unwheel = installMacWheel(rfb, target.current, diag.wheelSteps)
      if (!unwheel) console.warn('[RemoteDesktop] 无法校正触控板滚动步长')
      const unprobe = installNoVncProbe(rfb, diag)
      if (!unprobe) console.warn('[RemoteDesktop] 无法安装画面性能探针')
      // macOS hides the pointer while typing and then sends a transparent cursor shape.
      rfb.showDotCursor = true
      releaseDiagnostics.current = () => {
        unwatch()
        unwheel?.()
        unprobe?.()
        diag.summary('closed')
      }
      if (!applyMacServerModifiers(rfb, diag.keysymSent)) {
        console.warn('[RemoteDesktop] 无法校正 Mac 修饰键映射')
      }
      rfb.scaleViewport = fit
      rfb.viewOnly = !active
      const on = (name: string, fn: (e: Event) => void): void => {
        rfb.addEventListener(name, (e) => {
          if (generation.current === attempt) fn(e)
        })
      }
      let disconnectMessage = '未能建立桌面连接，请检查地址、屏幕共享设置和认证方式。'
      channel.onrefused = (reason) => {
        diag.stage(`open refused: ${reason}`)
        disconnectMessage =
          reason === 'device-missing'
            ? '本机未找到这台设备，请重新填写地址。'
            : '当前标签无法连接，请切回该标签后重试。'
      }
      handshakeTimer.current = window.setTimeout(
        () => fail('握手超时，请检查目标 Mac 是否已唤醒并开启屏幕共享。'),
        20000,
      )

      let usedSaved = false
      let credentialsHandled = false
      on('credentialsrequired', (e) => {
        // noVNC re-emits this while waiting for more bytes; handle it once per attempt.
        if (credentialsHandled) return
        credentialsHandled = true
        window.clearTimeout(handshakeTimer.current)
        const fields = (e as CustomEvent<{ types: string[] }>).detail.types
        diag.stage(`credentials required: ${fields.join(',')}`)
        if (fields.some((field) => !['username', 'password'].includes(field))) {
          fail('此屏幕共享认证方式暂不支持。')
          return
        }
        // macOS Screen Sharing drops an unanswered auth challenge after a few minutes.
        disconnectMessage = '等待认证期间远端已关闭连接，请重新连接后再输入凭据。'
        setUsernameRequired(fields.includes('username'))
        const showForm = (): void => {
          if (generation.current === attempt) setPhase('credentials')
        }
        if (!device.savedCredential || rejectedSaved.current.has(device.id)) {
          showForm()
          return
        }
        void api()
          .savedCredential(sessionId)
          .then((saved) => {
            if (generation.current !== attempt) return
            if (!saved) {
              diag.stage('saved credential unavailable; asking user')
              showForm()
              return
            }
            usedSaved = true
            diag.stage('using saved credential')
            armAuthTimeout()
            rfb.sendCredentials(fields.includes('username') ? saved : { password: saved.password })
          })
          .catch(showForm)
      })
      on('securityfailure', (e) => {
        const detail = (e as CustomEvent<{ status?: number; reason?: string }>).detail
        diag.stage(`security failure status=${detail?.status} reason=${detail?.reason ?? ''}`)
        if (usedSaved) {
          rejectedSaved.current.add(device.id)
          disconnectMessage = '已保存的密码未通过认证，请重新连接并手动输入。'
        } else {
          disconnectMessage = '屏幕共享认证失败，请检查账号、密码和共享权限。'
        }
      })
      on('serververification', () => {
        diag.stage('server verification requested')
        fail('该服务器要求额外的身份验证，本次连接已结束。')
      })
      on('connect', () => {
        window.clearTimeout(handshakeTimer.current)
        disconnectMessage = '与远端桌面的连接已中断。'
        const canvas = target.current?.querySelector('canvas')
        diag.stage(
          `connected framebuffer=${canvas?.width}x${canvas?.height} viewOnly=${rfb.viewOnly}`,
        )
        const remember = pendingRemember.current
        pendingRemember.current = null
        if (remember) {
          void api()
            .rememberCredential(sessionId, remember)
            .then((ok) => {
              diag.stage(ok ? 'credential saved on this Mac' : 'credential not saved')
              if (ok) rejectedSaved.current.delete(device.id)
              return refreshDevices()
            })
            .catch(() => diag.stage('credential save failed'))
        }
        setPhase('connected')
      })
      on('disconnect', (e) => {
        diag.stage(`disconnect clean=${(e as CustomEvent<{ clean?: boolean }>).detail?.clean}`)
        client.current = null
        fail(disconnectMessage)
      })
      void channel.start()
    } catch {
      fail('无法启动远程桌面，请重新连接。')
    }
  }

  function armAuthTimeout(): void {
    window.clearTimeout(handshakeTimer.current)
    handshakeTimer.current = window.setTimeout(() => {
      stop()
      setInterrupted(true)
      setPhase('ended')
      setMessage('认证响应超时，请重新连接。')
    }, 20000)
  }

  function authenticate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const password = String(fields.get('password') ?? '')
    const username = String(fields.get('username') ?? '')
    const credentials = usernameRequired ? { username, password } : { password }
    pendingRemember.current =
      fields.get('remember') === 'on' && username && password ? { username, password } : null
    form.reset()
    setPhase('connecting')
    armAuthTimeout()
    client.current?.sendCredentials(credentials)
  }

  function disconnect(): void {
    stop()
    setInterrupted(false)
    setMessage('已断开，远端应用仍在运行。')
    setPhase('ended')
  }

  function enterFullscreen(): void {
    if (phase !== 'connected' || fullscreen) return
    setFullscreen(true)
    setRevealed(false)
    windowWasFullscreen.current = window.cclinkStudio.window
      .setFullscreen(true)
      .then((result) => result.previous ?? null)
      .catch(() => null)
  }

  function exitFullscreen(): void {
    setFullscreen(false)
    setRevealed(false)
    restoreWindow()
  }

  /** Undo our native fullscreen, unless the user already had the window fullscreen before. */
  function restoreWindow(): void {
    const pending = windowWasFullscreen.current
    windowWasFullscreen.current = null
    // Awaiting the enter request also covers an exit that races ahead of it.
    void pending?.then((previous) => {
      if (previous === false) void window.cclinkStudio.window.setFullscreen(false)
    })
  }
  const restoreWindowRef = useRef(restoreWindow)
  restoreWindowRef.current = restoreWindow
  // Closing the Tab or switching workspace while fullscreen must not strand the window.
  useEffect(() => () => restoreWindowRef.current(), [])

  // The reveal zone is thin; hide the bar shortly after the pointer leaves zone and bar alike.
  const showBar = (): void => {
    window.clearTimeout(revealTimer.current)
    setRevealed(true)
  }
  const hideBarSoon = (): void => {
    window.clearTimeout(revealTimer.current)
    revealTimer.current = window.setTimeout(() => setRevealed(false), 400)
  }
  useEffect(() => () => window.clearTimeout(revealTimer.current), [])

  // Controller for the status bar and tab bar; refreshed every render so it sees current state.
  const controllerImpl = useRef<DesktopSessionController | null>(null)
  controllerImpl.current = {
    setView: (view) => useTabStore.getState().setDesktopView(tab.id, view),
    setFullscreen: (on) => (on ? enterFullscreen() : exitFullscreen()),
    reconnect: () => void connect(),
    disconnect,
  }
  useEffect(
    () =>
      registerDesktopController(tab.id, {
        setView: (view) => controllerImpl.current?.setView(view),
        setFullscreen: (on) => controllerImpl.current?.setFullscreen(on),
        reconnect: () => controllerImpl.current?.reconnect(),
        disconnect: () => controllerImpl.current?.disconnect(),
      }),
    [tab.id],
  )

  const publish = useDesktopSessionStore((state) => state.publish)
  useEffect(() => {
    publish(tab.id, {
      phase,
      deviceName: name.trim() || host.trim() || '远程桌面',
      endpoint: `${host.trim()}:${port}`,
      interrupted,
      fullscreen,
    })
  }, [publish, tab.id, phase, name, host, port, interrupted, fullscreen])
  useEffect(() => () => publish(tab.id, null), [publish, tab.id])

  // Leave fullscreen whenever the session is no longer usable or the Tab is hidden.
  useEffect(() => {
    if (fullscreen && (phase !== 'connected' || !active)) exitFullscreen()
    // exitFullscreen only touches refs and state setters.
  }, [fullscreen, phase, active])

  const fullscreenRef = useRef(fullscreen)
  fullscreenRef.current = fullscreen
  // ⌃⌥⌘F is the one chord Studio keeps; capture it before noVNC forwards it to the remote.
  useEffect(() => {
    const screen = target.current
    if (!screen) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey && event.altKey && event.metaKey && event.code === 'KeyF')) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && !event.repeat)
        controllerImpl.current?.setFullscreen(!fullscreenRef.current)
    }
    screen.addEventListener('keydown', onKey, true)
    screen.addEventListener('keyup', onKey, true)
    return () => {
      screen.removeEventListener('keydown', onKey, true)
      screen.removeEventListener('keyup', onKey, true)
    }
  }, [])
  const busy = phase !== 'idle' && phase !== 'ended'
  return (
    <section
      className={`remote-desktop ${fullscreen ? 'fullscreen' : ''}`}
      hidden={!active}
      aria-label="远程桌面"
    >
      {phase === 'connecting' && (
        <div className="remote-desktop-form" role="status">
          <h2>正在连接 {name.trim() || host}</h2>
          <p>
            {host}:{port}
          </p>
          <button type="button" onClick={disconnect}>
            取消
          </button>
        </div>
      )}
      {fullscreen && (
        <>
          <div
            className="remote-desktop-reveal-zone"
            aria-hidden="true"
            onMouseEnter={showBar}
            onMouseLeave={hideBarSoon}
          />
          <div
            className={`remote-desktop-fullscreen-bar ${revealed ? 'revealed' : ''}`}
            onMouseEnter={showBar}
            onMouseLeave={hideBarSoon}
          >
            <span className="remote-desktop-dot connected" aria-hidden="true" />
            <span>{name.trim() || host} · 已连接</span>
            <button type="button" onClick={() => exitFullscreen()}>
              退出全屏 <kbd>{DESKTOP_FULLSCREEN_SHORTCUT}</kbd>
            </button>
            <button type="button" className="danger" onClick={disconnect}>
              断开
            </button>
          </div>
        </>
      )}
      <div
        className="remote-desktop-screen"
        data-remote-desktop-screen
        ref={target}
        hidden={phase !== 'connected'}
      />
      {!busy && (
        <form className="remote-desktop-form" onSubmit={(event) => void connect(event)}>
          <h2>连接 Mac 桌面</h2>
          <p>在目标 Mac 的「系统设置 → 通用 → 共享」中开启屏幕共享，通过可信网络连接。</p>
          {devices && devices.length > 0 && (
            <label>
              本机设备
              <select
                value={deviceId}
                onChange={(e) => {
                  const next = devices.find((device) => device.id === e.target.value)
                  if (next) fillFrom(next)
                  else {
                    setDeviceId(NEW_DEVICE)
                    setName('')
                    setHost('')
                    setPort(5900)
                  }
                }}
              >
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} · {device.host}
                  </option>
                ))}
                <option value={NEW_DEVICE}>新设备…</option>
              </select>
            </label>
          )}
          <label>
            设备名称
            <input
              value={name}
              placeholder="美国 Mac"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            主机名或 IP
            <input
              required
              value={host}
              placeholder="mac-mini.local"
              maxLength={253}
              onChange={(e) => setHost(e.target.value)}
            />
          </label>
          <details>
            <summary>端口 · {port}</summary>
            <input
              aria-label="屏幕共享端口"
              type="number"
              min={5900}
              max={5999}
              required
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </details>
          {selected?.savedCredential && (
            <p className="remote-desktop-saved">
              本机已保存这台设备的密码，连接时自动使用。
              <button type="button" onClick={() => void forgetSaved()}>
                删除已保存的密码
              </button>
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button className="desktop-primary">{phase === 'ended' ? '重新连接' : '连接'}</button>
        </form>
      )}
      {phase === 'credentials' && (
        <form className="remote-desktop-form" onSubmit={authenticate} autoComplete="off">
          <h2>屏幕共享认证</h2>
          <p>{name.trim() || host} · 输入目标 Mac 上的账号和密码。</p>
          {usernameRequired && (
            <label>
              Mac 用户名
              <input name="username" required autoComplete="off" />
            </label>
          )}
          <label>
            密码
            <input name="password" required type="password" autoComplete="off" />
          </label>
          {usernameRequired && (
            <label className="remote-desktop-check">
              <input type="checkbox" name="remember" />
              在本机记住密码（连接成功后保存到 Studio 本地凭证文件，不进入项目）
            </label>
          )}
          <div className="remote-desktop-actions">
            <button type="button" onClick={disconnect}>
              取消
            </button>
            <button className="desktop-primary">确认连接</button>
          </div>
        </form>
      )}
    </section>
  )
}
