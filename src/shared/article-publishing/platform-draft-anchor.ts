import { parseCsdnDraftAnchor } from './csdn-draft-anchor'

export function parsePlatformDraftAnchor(rawUrl: string, localDraftId?: string) {
  const csdn = parseCsdnDraftAnchor(rawUrl)
  if (csdn) return { ...csdn, adapterId: 'csdn' as const }
  try {
    const url = new URL(rawUrl)
    if (
      url.origin === 'https://creator.xiaohongshu.com' &&
      !url.username &&
      !url.password &&
      url.pathname === '/publish/publish' &&
      localDraftId &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(localDraftId)
    )
      return {
        adapterId: 'xiaohongshu' as const,
        draftId: localDraftId,
        url: 'https://creator.xiaohongshu.com/publish/publish?target=image',
      }
    if (url.origin === 'https://juejin.cn' && !url.username && !url.password) {
      const draft = /^\/editor\/drafts\/(\d+)\/?$/u.exec(url.pathname)
      if (draft)
        return {
          adapterId: 'juejin' as const,
          draftId: draft[1],
          url: `${url.origin}/editor/drafts/${draft[1]}`,
        }
    }
    if (
      url.origin === 'https://mp.toutiao.com' &&
      !url.username &&
      !url.password &&
      url.pathname === '/profile_v4/weitoutiao/publish' &&
      url.searchParams.getAll('draft_id').length === 1
    ) {
      const draftId = url.searchParams.get('draft_id')!
      if (/^\d{1,24}$/u.test(draftId))
        return {
          adapterId: 'toutiao' as const,
          draftId,
          url: `${url.origin}${url.pathname}?draft_id=${draftId}`,
        }
    }
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
export function isSamePlatformDraft(left: string, right: string, localDraftId?: string) {
  const a = parsePlatformDraftAnchor(left, localDraftId)
  const b = parsePlatformDraftAnchor(right, localDraftId)
  return Boolean(a && b && a.adapterId === b.adapterId && a.draftId === b.draftId)
}

export function isPlatformImageUrl(
  platform: 'csdn' | 'zhihu' | 'juejin' | 'xiaohongshu' | 'weibo' | 'toutiao' | 'bilibili',
  rawUrl: string,
): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    if (platform === 'bilibili')
      return (
        /^i[012]\.hdslb\.com$/u.test(url.hostname) &&
        /^\/bfs\/new_dyn\/[^/]+\.(?:png|jpe?g|webp)$/iu.test(url.pathname) &&
        !url.search &&
        !url.hash
      )
    if (platform === 'toutiao')
      return (
        url.hostname === 'p3-sign.toutiaoimg.com' &&
        /^\/tos-cn-i-ezhpy3drpa\/[a-f0-9]{32}$/u.test(url.pathname) &&
        !url.search &&
        !url.hash
      )
    if (platform === 'weibo')
      return (
        /^[a-z0-9-]+\.sinaimg\.cn$/u.test(url.hostname) &&
        /\/[^/]+\.(?:jpg|jpeg|png)$/iu.test(url.pathname)
      )
    if (platform === 'xiaohongshu')
      return (
        url.hostname === 'sns-creator-preview.xhscdn.com' && url.pathname.startsWith('/spectrum/')
      )
    if (platform === 'juejin')
      return (
        url.hostname === 'p0-xtjj-private.juejin.cn' ||
        /^p\d+-juejin\.byteimg\.com$/u.test(url.hostname) ||
        /^p\d+-jj\.byteimg\.com$/u.test(url.hostname)
      )
    return platform === 'csdn'
      ? url.hostname.endsWith('.csdnimg.cn')
      : url.hostname === 'pic-private.zhihu.com' || url.hostname.endsWith('.zhimg.com')
  } catch {
    return false
  }
}
