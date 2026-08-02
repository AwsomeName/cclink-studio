import { useEffect, type RefObject } from 'react'
import { useSettingsStore } from '../../stores/settings-store'

/** 将 React 内容区域尺寸同步给主进程 WebContentsView。 */
export function useWorkbenchBounds(contentRef: RefObject<HTMLDivElement | null>): void {
  const appZoomLevel = useSettingsStore((state) => state.settings.appZoomLevel)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const reportBounds = (): void => {
      const rect = el.getBoundingClientRect()
      window.cclinkStudio.reportWorkbenchBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }

    const observer = new ResizeObserver(reportBounds)
    observer.observe(el)
    const animationFrame = requestAnimationFrame(reportBounds)
    window.addEventListener('resize', reportBounds)

    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', reportBounds)
      observer.disconnect()
    }
  }, [appZoomLevel, contentRef])
}
