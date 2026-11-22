import type RFB from '@novnc/novnc'
import type { DesktopImagePasteResult } from '@shared/ipc/remote-desktop'

/** Keep ordinary noVNC input intact outside Apple's negotiated shared console. */
export function installMacImagePaste(
  viewer: RFB,
  screen: HTMLElement,
  isActive: () => boolean,
  sendImage: (supported: boolean) => Promise<DesktopImagePasteResult>,
  report: (message: string) => void,
): () => void {
  let revision = 0
  let pending = false
  const heldCommand = new Set<string>()
  const invalidate = (): void => {
    revision++
  }
  const blur = (): void => {
    heldCommand.clear()
    invalidate()
  }
  const paste = async (): Promise<void> => {
    if (pending) return
    pending = true
    const started = revision
    try {
      const outcome = await sendImage(viewer.capabilities.appleImageClipboard === true)
      if (started !== revision || !isActive() || !screen.contains(document.activeElement)) return
      if (outcome === 'no-image' || outcome === 'sent' || outcome === 'sent-scaled') {
        // The physical Command key may have been released while the PNG was in flight.
        const synthesizeCommand = heldCommand.size === 0
        if (synthesizeCommand) viewer.sendKey(0xffeb, 'MetaLeft', true)
        viewer.sendKey(0x76, 'KeyV')
        if (synthesizeCommand) viewer.sendKey(0xffeb, 'MetaLeft', false)
        report(outcome === 'sent-scaled' ? '截图已缩小并发送。' : '')
      } else if (outcome !== 'cancelled') {
        report(
          outcome === 'unsupported' ? '这台 Mac 未提供图片剪贴板。' : '截图发送失败，请重新粘贴。',
        )
      } else {
        report('粘贴已取消，请点一下远端输入框，再按 ⌘V。')
      }
    } catch {
      if (started === revision) report('截图发送失败，请重新粘贴。')
    } finally {
      pending = false
    }
  }
  const key = (event: KeyboardEvent): void => {
    if (!event.isTrusted || !isActive() || viewer.capabilities.appleImageClipboard === undefined)
      return
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      if (event.type === 'keydown') heldCommand.add(event.code)
      else heldCommand.delete(event.code)
      return
    }
    if (event.type !== 'keydown') return
    if (
      event.code !== 'KeyV' ||
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      invalidate()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) void paste()
  }
  screen.addEventListener('keydown', key, true)
  screen.addEventListener('keyup', key, true)
  screen.addEventListener('pointerdown', invalidate, true)
  screen.addEventListener('focusout', blur)
  window.addEventListener('blur', blur)
  return () => {
    blur()
    screen.removeEventListener('keydown', key, true)
    screen.removeEventListener('keyup', key, true)
    screen.removeEventListener('pointerdown', invalidate, true)
    screen.removeEventListener('focusout', blur)
    window.removeEventListener('blur', blur)
  }
}
