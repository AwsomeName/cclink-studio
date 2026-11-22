import { useRef, useState } from 'react'
import { FloatingSurface } from '../../components/common/FloatingSurface'
import { IconCheck, IconChevronDown, IconFitWidth, IconZoomIn } from '../../components/common/Icons'
import type { Tab } from '../../types'
import {
  desktopStatusLabel,
  getDesktopController,
  isDesktopSessionLive,
  useDesktopSessionStore,
  type DesktopSessionView,
} from './desktop-session-store'
import './remote-desktop.css'

export const DESKTOP_FULLSCREEN_SHORTCUT = '⌃⌥⌘F'

function dotState(view: DesktopSessionView): string {
  if (view.phase === 'connected') return 'connected'
  if (isDesktopSessionLive(view)) return 'pending'
  return view.interrupted ? 'interrupted' : 'idle'
}

function ViewItems({
  tab,
  view,
  close,
}: {
  tab: Tab
  view: DesktopSessionView
  close(): void
}): React.ReactElement {
  const controller = getDesktopController(tab.id)
  const current = tab.desktopView ?? 'fit'
  const connected = view.phase === 'connected'
  const item = (label: string, checked: boolean, run: () => void, hint?: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={!connected}
      onClick={() => {
        close()
        run()
      }}
    >
      <span className="remote-desktop-menu-check">{checked && <IconCheck size={11} />}</span>
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
  return (
    <>
      {item('适应窗口', current === 'fit' && !view.fullscreen, () => {
        controller?.setFullscreen(false)
        controller?.setView('fit')
      })}
      {item('原始大小', current === 'original' && !view.fullscreen, () => {
        controller?.setFullscreen(false)
        controller?.setView('original')
      })}
      {item(
        '全屏',
        view.fullscreen,
        () => controller?.setFullscreen(true),
        DESKTOP_FULLSCREEN_SHORTCUT,
      )}
      <div className="remote-desktop-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={view.largePointer}
        disabled={!connected}
        onClick={() => {
          close()
          controller?.setLargePointer(!view.largePointer)
        }}
      >
        <span className="remote-desktop-menu-check">
          {view.largePointer && <IconCheck size={11} />}
        </span>
        超大箭头
      </button>
    </>
  )
}

/** Status dot and view-mode button rendered inside a remote desktop workbench tab. */
export function RemoteDesktopTabControls({ tab }: { tab: Tab }): React.ReactElement | null {
  const view = useDesktopSessionStore((state) => state.sessions[tab.id])
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  if (!view || view.phase === 'idle') return null
  const state = dotState(view)
  const mode = tab.desktopView ?? 'fit'
  return (
    <>
      <span
        className={`remote-desktop-dot ${state}`}
        aria-label={desktopStatusLabel(view)}
        title={desktopStatusLabel(view)}
      />
      {view.phase === 'connected' && (
        <span ref={anchorRef} className="remote-desktop-tab-mode-wrap">
          <button
            type="button"
            className="remote-desktop-tab-mode"
            aria-haspopup="menu"
            aria-expanded={open}
            title={`显示方式：${mode === 'fit' ? '适应窗口' : '原始大小'}`}
            onPointerDown={(event) => event.stopPropagation()}
            // The tab handles Enter/Space/arrows itself and would swallow the button's activation.
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(!open)
            }}
          >
            {mode === 'fit' ? <IconFitWidth size={12} /> : <IconZoomIn size={12} />}
            <IconChevronDown size={10} />
          </button>
          <FloatingSurface
            anchorRef={anchorRef}
            open={open}
            placement="bottom-start"
            role="menu"
            className="remote-desktop-menu"
            onRequestClose={() => setOpen(false)}
          >
            {/* Portaled, but React still bubbles to the tab's drag, click and arrow-key handlers. */}
            <div
              className="remote-desktop-menu-body"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
            >
              <ViewItems tab={tab} view={view} close={() => setOpen(false)} />
            </div>
          </FloatingSurface>
        </span>
      )}
    </>
  )
}

/** Status bar item for the active remote desktop tab; all connection actions live in its menu. */
export function RemoteDesktopStatusItem({ tab }: { tab: Tab }): React.ReactElement | null {
  const view = useDesktopSessionStore((state) => state.sessions[tab.id])
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // Shown while connecting/connected, and after an unexpected drop so reconnect is one click away.
  if (!view || (!isDesktopSessionLive(view) && !view.interrupted)) return null
  const controller = getDesktopController(tab.id)
  const label = desktopStatusLabel(view)
  const live = isDesktopSessionLive(view)
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`status-bar-item remote-desktop-status ${dotState(view)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${view.deviceName} · ${view.endpoint}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`remote-desktop-dot ${dotState(view)}`} aria-hidden="true" />
        <span className="status-bar-text">
          {view.deviceName} · {label}
          {view.interrupted && !live ? ' · 重新连接' : ''}
        </span>
      </button>
      <FloatingSurface
        anchorRef={anchorRef}
        open={open}
        placement="top-start"
        role="menu"
        className="remote-desktop-menu"
        onRequestClose={() => setOpen(false)}
      >
        <div className="remote-desktop-menu-title">
          {view.deviceName} · {view.endpoint}
        </div>
        <ViewItems tab={tab} view={view} close={() => setOpen(false)} />
        <div className="remote-desktop-menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false)
            controller?.reconnect()
          }}
        >
          <span className="remote-desktop-menu-check" />
          <span>重新连接</span>
        </button>
        {live && (
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false)
              controller?.disconnect()
            }}
          >
            <span className="remote-desktop-menu-check" />
            <span>{view.phase === 'connected' ? '断开' : '取消连接'}</span>
          </button>
        )}
      </FloatingSurface>
    </>
  )
}
