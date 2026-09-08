import { parseCsdnDraftAnchor } from './csdn-draft-anchor'

export function parsePlatformDraftAnchor(rawUrl: string) {
  const csdn = parseCsdnDraftAnchor(rawUrl)
  if (csdn) return { ...csdn, adapterId: 'csdn' as const }
  try {
    const url = new URL(rawUrl)
    const match = /^\/p\/(\d+)\/edit\/?$/u.exec(url.pathname)
    if (url.origin !== 'https://zhuanlan.zhihu.com' || !match || url.username || url.password)
      return null
    return {
      adapterId: 'zhihu' as const,
      draftId: match[1],
      url: `${url.origin}/p/${match[1]}/edit`,
    }
  } catch {
    return null
  }
}
export function isSamePlatformDraft(left: string, right: string) {
  const a = parsePlatformDraftAnchor(left)
  const b = parsePlatformDraftAnchor(right)
  return Boolean(a && b && a.adapterId === b.adapterId && a.draftId === b.draftId)
}

export function isPlatformImageUrl(platform: 'csdn' | 'zhihu', rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    return platform === 'csdn'
      ? url.hostname.endsWith('.csdnimg.cn')
      : url.hostname === 'pic-private.zhihu.com' || url.hostname.endsWith('.zhimg.com')
  } catch {
    return false
  }
}
