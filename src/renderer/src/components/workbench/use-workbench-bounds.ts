import { useEffect, type RefObject } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import type { BrowserWorkbenchBounds } from '@shared/ipc/browser'

interface BoundsStabilizerScheduler {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  setTimer: (callback: () => void, delay: number) => number
  clearTimer: (handle: number) => void
}

/**
 * Electron 的 renderer zoom 与原生 contentView 布局不是同一时刻完成。
 * 在 resize/zoom 的后续帧继续上报，避免新缩放因子配上旧 CSS bounds 后永久错位。
 */
export function createBoundsStabilizer(
  report: () => void,
  scheduler: BoundsStabilizerScheduler = {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (handle) => window.clearTimeout(handle),
  },
): { schedule: () => void; dispose: () => void } {
  let frameHandle: number | null = null
  let timerHandles: number[] = []

  const cancelPending = (): void => {
    if (frameHandle !== null) scheduler.cancelFrame(frameHandle)
    frameHandle = null
    for (const handle of timerHandles) scheduler.clearTimer(handle)
    timerHandles = []
  }

  const schedule = (): void => {
    cancelPending()
    report()
    let remainingFrames = 3
    const reportNextFrame = (): void => {
      frameHandle = scheduler.requestFrame(() => {
        frameHandle = null
        report()
        remainingFrames -= 1
        if (remainingFrames > 0) reportNextFrame()
      })
    }
    reportNextFrame()
    timerHandles = [50, 150, 350, 700].map((delay) => scheduler.setTimer(() => report(), delay))
  }

  return { schedule, dispose: cancelPending }
}

interface ElementBounds {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** renderer 先裁一次，保证上报值本身不会越过 Tab 栏和浏览器工具栏。 */
export function resolveSafeWorkbenchBounds(
  content: ElementBounds,
  tabBar: ElementBounds,
): BrowserWorkbenchBounds {
  const protectedTop = Math.max(Math.ceil(tabBar.bottom), Math.ceil(content.top))
  const y = Math.max(Math.round(content.top), protectedTop)
  const bottom = Math.round(content.bottom)
  return {
    x: Math.round(content.left),
    y,
    width: Math.max(0, Math.round(content.width)),
    height: Math.max(0, bottom - y),
    protectedTop,
  }
}

/** 将 React 内容区域尺寸同步给主进程 WebContentsView。 */
export function useWorkbenchBounds(
  contentRef: RefObject<HTMLDivElement | null>,
  tabBarRef: RefObject<HTMLDivElement | null>,
): void {
  const appZoomLevel = useSettingsStore((state) => state.settings.appZoomLevel)

  useEffect(() => {
    const el = contentRef.current
    const tabBar = tabBarRef.current
    if (!el || !tabBar) return

    const reportBounds = (): void => {
      window.cclinkStudio.reportWorkbenchBounds(
        resolveSafeWorkbenchBounds(el.getBoundingClientRect(), tabBar.getBoundingClientRect()),
      )
    }

    const stabilizer = createBoundsStabilizer(reportBounds)
    const observer = new ResizeObserver(stabilizer.schedule)
    observer.observe(el)
    observer.observe(tabBar)
    stabilizer.schedule()
    window.addEventListener('resize', stabilizer.schedule)
    window.addEventListener('focus', stabilizer.schedule)
    window.addEventListener('pageshow', stabilizer.schedule)

    return () => {
      stabilizer.dispose()
      window.removeEventListener('resize', stabilizer.schedule)
      window.removeEventListener('focus', stabilizer.schedule)
      window.removeEventListener('pageshow', stabilizer.schedule)
      observer.disconnect()
    }
  }, [appZoomLevel, contentRef, tabBarRef])
}
