import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type RFB from '@novnc/novnc'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { getWorkspaceStateKey, getWorkspaceStateOwnerKey } from '../../utils/workspace-state'
import { flushPendingWorkbenchTabWrites } from '../../utils/workbench-tab-model'
import { DesktopChannel } from './desktop-channel'
import { applyMacServerModifiers } from './mac-keys'
import { installMacWheel } from './mac-scroll'
import { createDesktopDiagnostics } from './desktop-diagnostics'
import './remote-desktop.css'

type Phase = 'idle' | 'connecting' | 'credentials' | 'connected' | 'ended'
export function RemoteDesktopTab({
  tab,
  active,
}: {
  tab: Tab
  active: boolean
}): React.ReactElement {
  const [name, setName] = useState(tab.title === '远程桌面' ? '' : tab.title)
  const [host, setHost] = useState(tab.desktopTarget?.host ?? '')
  const [port, setPort] = useState(tab.desktopTarget?.port ?? 5900)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [usernameRequired, setUsernameRequired] = useState(false)
  const [fit, setFit] = useState(true)
  const target = useRef<HTMLDivElement>(null)
  const client = useRef<RFB | null>(null)
  const generation = useRef(0)
  const handshakeTimer = useRef<number | undefined>(undefined)
  const releaseDiagnostics = useRef<(() => void) | undefined>(undefined)
  const activeRef = useRef(active)
  activeRef.current = active
  const stop = (): void => {
    generation.current++
    window.clearTimeout(handshakeTimer.current)
    releaseDiagnostics.current?.()
    releaseDiagnostics.current = undefined
    const rfb = client.current
    client.current = null
    rfb?.disconnect()
  }
  useEffect(() => stop, [])
  useLayoutEffect(() => {
    const rfb = client.current
    if (rfb) {
      if (!active) rfb.blur()
      rfb.viewOnly = !active
      // Keys only reach the remote when the canvas has focus; take it on connect/return.
      if (active && phase === 'connected') rfb.focus({ preventScroll: true })
      rfb.scaleViewport = fit
    }
  }, [active, fit, phase])
  const begin = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    stop()
    const attempt = generation.current
    const title = name.trim() || host.trim()
    const input = {
      sessionId: crypto.randomUUID(),
      tabId: tab.id,
      workspaceKey: getWorkspaceStateKey(),
      ownerKey: getWorkspaceStateOwnerKey(),
      host: host.trim(),
      port,
    }
    useTabStore.getState().setDesktopTarget(tab.id, title, { host: input.host, port })
    setPhase('connecting')
    setMessage('')
    const fail = (explanation: string): void => {
      if (generation.current !== attempt) return
      stop()
      setMessage(explanation)
      setPhase('ended')
    }
    try {
      const [{ default: Viewer }] = await Promise.all([
        import('@novnc/novnc'),
        flushPendingWorkbenchTabWrites(),
      ])
      if (generation.current !== attempt || !target.current) return
      const channel = new DesktopChannel(input)
      const rfb = new Viewer(target.current, channel, { shared: true })
      client.current = rfb
      const diag = createDesktopDiagnostics(`${input.host}:${input.port}`)
      diag.stage('connecting')
      const unwatch = diag.watchInput(target.current, () => activeRef.current)
      const unwheel = installMacWheel(rfb, target.current, diag.wheelSteps)
      if (!unwheel) console.warn('[RemoteDesktop] 无法校正触控板滚动步长')
      releaseDiagnostics.current = () => {
        unwatch()
        unwheel?.()
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
      handshakeTimer.current = window.setTimeout(
        () => fail('握手超时，请检查目标 Mac 是否已唤醒并开启屏幕共享。'),
        20000,
      )

      on('credentialsrequired', (e) => {
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
        setPhase('credentials')
      })
      on('securityfailure', (e) => {
        const detail = (e as CustomEvent<{ status?: number; reason?: string }>).detail
        diag.stage(`security failure status=${detail?.status} reason=${detail?.reason ?? ''}`)
        disconnectMessage = '屏幕共享认证失败，请检查账号、密码和共享权限。'
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
  function authenticate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const credentials = {
      password: String(fields.get('password') ?? ''),
      ...(usernameRequired ? { username: String(fields.get('username') ?? '') } : {}),
    }
    form.reset()
    setPhase('connecting')
    handshakeTimer.current = window.setTimeout(() => {
      stop()
      setPhase('ended')
      setMessage('认证响应超时，请重新连接。')
    }, 20000)
    client.current?.sendCredentials(credentials)
  }
  const busy = phase !== 'idle' && phase !== 'ended'
  return (
    <section className="remote-desktop" hidden={!active} aria-label="远程桌面">
      {busy && (
        <div className="remote-desktop-bar">
          <span role="status">
            {phase === 'connected' ? '已连接' : phase === 'credentials' ? '等待认证' : '正在连接'}
          </span>
          <strong>{tab.title}</strong>
          {phase === 'connected' && (
            <button onClick={() => setFit(!fit)}>{fit ? '适应窗口' : '原始大小'}</button>
          )}
          <button
            onClick={() => {
              stop()
              setMessage('已断开，远端应用仍在运行。')
              setPhase('ended')
            }}
          >
            {phase === 'connected' ? '断开' : '取消'}
          </button>
        </div>
      )}
      <div
        className="remote-desktop-screen"
        data-remote-desktop-screen
        ref={target}
        hidden={phase !== 'connected'}
      />
      {!busy && (
        <form className="remote-desktop-form" onSubmit={begin}>
          <h2>连接 Mac 桌面</h2>
          <p>在目标 Mac 的「系统设置 → 通用 → 共享」中开启屏幕共享，通过可信网络连接。</p>
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
          {message && <p role="status">{message}</p>}
          <button className="desktop-primary">{phase === 'ended' ? '重新连接' : '连接'}</button>
        </form>
      )}
      {phase === 'credentials' && (
        <form className="remote-desktop-form" onSubmit={authenticate} autoComplete="off">
          <h2>屏幕共享认证</h2>
          <p>{host} · 凭据仅用于本次连接。</p>
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
          <button className="desktop-primary">确认连接</button>
        </form>
      )}
    </section>
  )
}
