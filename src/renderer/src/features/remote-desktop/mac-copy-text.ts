import type RFB from '@novnc/novnc'

const plainTextTypes = new Set([
  'public.utf8-plain-text',
  'public.plain-text',
  'NSStringPboardType',
  'text/plain',
  'text/plain;charset=utf-8',
])

/** Apple packed pasteboard items contain a list of UTI-tagged representations. */
export function unpackMacText(scrap: Uint8Array): string | null {
  const data = new DataView(scrap.buffer, scrap.byteOffset, scrap.byteLength)
  let offset = 0
  const word = () => {
    const result = data.getUint32(offset)
    offset += 4
    return result
  }
  const field = () => {
    const length = word()
    if (length > data.byteLength - offset) throw new RangeError()
    const result = scrap.subarray(offset, offset + length)
    offset += length
    return result
  }
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  const items: string[] = []
  try {
    while (offset < data.byteLength) {
      const count = word()
      if (count > 4096) return null
      let text: string | undefined
      for (let i = 0; i < count; i++) {
        let uti = utf8.decode(field())
        word() // flavor flags
        const tags = word()
        if (tags > 4096) return null
        for (let j = 0; j < tags; j++) {
          field()
          const tag = utf8.decode(field())
          if (!uti && plainTextTypes.has(tag)) uti = tag
        }
        const value = field()
        if (plainTextTypes.has(uti)) text = utf8.decode(value)
        else if (uti === 'public.utf16-plain-text' && text === undefined) {
          const little = value[0] === 0xff && value[1] === 0xfe
          text = new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(value)
        }
      }
      if (text) items.push(text)
    }
    const result = items.join('\n')
    return result && result.length <= 1024 * 1024 ? result : null
  } catch {
    return null
  }
}

export function installMacCopyText(
  viewer: RFB,
  screen: HTMLElement,
  active: () => boolean,
  transfer: (sequence: number, text: string | null) => Promise<boolean>,
  report: (text: string) => void,
): () => void {
  let sequence = 0
  let pending = 0
  let timer: ReturnType<typeof setTimeout>
  const key = (event: KeyboardEvent) => {
    if (
      !event.isTrusted ||
      event.repeat ||
      !active() ||
      viewer.capabilities.appleImageClipboard === undefined ||
      !event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.code !== 'KeyC' && event.code !== 'KeyX')
    )
      return
    sequence++
    pending = sequence
    viewer.armAppleCopy(sequence)
    void transfer(sequence, null).catch(() => false)
    clearTimeout(timer)
    timer = setTimeout(() => {
      pending = 0
      if (active()) report('未收到可同步的远端文字，仍可在远端粘贴。')
    }, 8000)
  }
  const receive = (event: Event) => {
    if (!pending || !active()) return
    const detail = (event as CustomEvent).detail
    if (event.type === 'appleclipboard' && detail.id !== pending) return
    const text = event.type === 'appleclipboard' ? unpackMacText(detail.scrap) : detail.text
    if (typeof text !== 'string' || !text.length || text.length > 1024 * 1024) return
    const id = pending
    pending = 0
    clearTimeout(timer)
    void transfer(id, text)
      .catch(() => false)
      .then((ok) => {
        if (active() && sequence === id)
          report(ok ? '远端文字已复制到本机。' : '本机剪贴板已变化或复制已结束，未覆盖本机内容。')
      })
  }
  screen.addEventListener('keydown', key, true)
  viewer.addEventListener('appleclipboard', receive)
  viewer.addEventListener('clipboard', receive)
  return () => {
    pending = 0
    sequence++
    clearTimeout(timer)
    viewer.removeEventListener('clipboard', receive)
    viewer.removeEventListener('appleclipboard', receive)
    screen.removeEventListener('keydown', key, true)
  }
}
