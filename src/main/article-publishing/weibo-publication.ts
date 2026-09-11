import type { Page, Request, Response } from 'playwright-core'

export function parseWeiboPublicationUrl(raw: string) {
  try {
    const url = new URL(raw)
    const match = /^\/(\d{5,20})\/([a-zA-Z0-9]{6,20})\/?$/u.exec(url.pathname)
    if (url.origin !== 'https://weibo.com' || url.username || url.password || !match) return null
    return { uid: match[1], id: match[2], url: `${url.origin}/${match[1]}/${match[2]}` }
  } catch {
    return null
  }
}

/** Platform media filename, not a content hash. Preview sizes/hosts can change. */
export function weiboImageIdentity(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^wx\d+\.sinaimg\.cn$/u.test(url.hostname)
    )
      return null
    return (
      /^([a-zA-Z0-9]+)\.(?:jpe?g|png|gif)$/iu.exec(url.pathname.split('/').at(-1) ?? '')?.[1] ??
      null
    )
  } catch {
    return null
  }
}

export async function readWeiboPublication(page: Page) {
  const anchor = parseWeiboPublicationUrl(page.url())
  if (!anchor) throw new Error('不是可核验的微博单篇正文地址')
  return page.evaluate((anchor) => {
    const articles = document.querySelectorAll('article.woo-panel-main')
    const article = articles.length === 1 ? articles[0] : null
    const bodies = article?.querySelectorAll('div[class*="wbtext"]')
    const body = bodies?.length === 1 ? bodies[0] : null
    const authorIds = [
      ...new Set(
        Array.from(article?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []).flatMap((a) => {
          if (!body || !(a.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING))
            return []
          const u = new URL(a.href)
          return u.origin === 'https://weibo.com'
            ? (/^\/u\/(\d{5,20})\/?$/u.exec(u.pathname)?.[1] ?? [])
            : []
        }),
      ),
    ]
    let prefix = ''
    if (article && body) {
      const range = document.createRange()
      range.selectNodeContents(article)
      range.setEndBefore(body)
      prefix = range.toString()
    }
    const clone = body?.cloneNode(true) as Element | undefined
    for (const br of clone?.querySelectorAll('br') ?? [])
      br.replaceWith(document.createTextNode('\n'))
    for (const emoji of clone?.querySelectorAll('img[alt]') ?? [])
      emoji.replaceWith(document.createTextNode(emoji.getAttribute('alt') ?? ''))
    const text = clone?.textContent ?? ''
    const images = Array.from(article?.querySelectorAll<HTMLImageElement>('img') ?? [])
      .filter((img) => /^https:\/\/wx\d+\.sinaimg\.cn\//u.test(img.currentSrc || img.src))
      .map((img) => ({
        src: (img.currentSrc || img.src).split('?')[0],
        alt: '',
        loaded: img.complete && img.naturalWidth > 0,
      }))
    return {
      observedAt: new Date().toISOString(),
      url: anchor.url,
      id: anchor.id,
      uid: authorIds.length === 1 ? authorIds[0] : undefined,
      text,
      images,
      imageEnumerationComplete: !!article && !!body,
      recognized: !!body && authorIds.length === 1 && authorIds[0] === anchor.uid,
      public: /公开/u.test(prefix) && !/仅自己|好友圈|粉丝可见/u.test(prefix),
    }
  }, anchor)
}

export interface WeiboSubmissionTarget {
  uid: string
  text: string
  imageIds: string[]
}

/** Only the armed, exact text+gallery POST may supply this submission receipt.
 * No arbitrary network log, cookies, request headers or response body is persisted. */
export function observeWeiboSubmission(page: Page, expected: WeiboSubmissionTarget) {
  let armed = false
  let disposed = false
  let matchedRequest: Request | undefined
  let resolve: (receipt: { uid: string; id: string; url: string }) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const result = new Promise<{ uid: string; id: string; url: string }>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A rejection can precede the caller's finish() after click returns.
  void result.catch(() => undefined)
  const same = (left: unknown, right: string[]) =>
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((id, i) => String(id) === right[i])
  const requestMatches = (request: Request) => {
    if (request.method() !== 'POST' || new URL(request.url()).origin !== 'https://weibo.com')
      return false
    const raw = request.postData()
    if (!raw) return false
    let data: Record<string, unknown>
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      const form = new URLSearchParams(raw)
      data = { status: form.get('status'), pic_ids: form.get('pic_ids')?.split(',') ?? [] }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const ids = typeof data.pic_ids === 'string' ? data.pic_ids.split(',') : data.pic_ids
    return data.status === expected.text && same(ids, expected.imageIds)
  }
  const onRequest = (request: Request) => {
    if (!armed || disposed || !requestMatches(request)) return
    if (matchedRequest) {
      reject(new Error('一次授权观察到多个同稿提交请求，结果未知，禁止重发'))
      return
    }
    matchedRequest = request
  }
  const onResponse = (response: Response) => {
    if (!armed || disposed || response.request() !== matchedRequest) return
    void (async () => {
      const value = (await response.json()) as {
        ok?: number
        data?: {
          mblogid?: string
          bid?: string
          user?: { idstr?: string; id?: number }
          pic_ids?: string[]
        }
      }
      const data = value.data
      const uid = data?.user?.idstr ?? String(data?.user?.id ?? '')
      const id = data?.mblogid ?? data?.bid
      const anchor = id ? parseWeiboPublicationUrl(`https://weibo.com/${uid}/${id}`) : null
      if (
        value.ok !== 1 ||
        !anchor ||
        uid !== expected.uid ||
        !same(data?.pic_ids, expected.imageIds)
      )
        throw new Error('平台提交回执未能同时证明账号、文章 ID 与逐图标识；只核验，不重发')
      if (!disposed) resolve(anchor)
    })().catch((error) =>
      reject(error instanceof Error ? error : new Error('微博提交回执不可核验')),
    )
  }
  const timeout = setTimeout(
    () => reject(new Error('微博提交回执超时，结果未知，禁止再次发送')),
    30_000,
  )
  timeout.unref?.()
  page.on('request', onRequest)
  page.on('response', onResponse)
  return {
    arm: () => {
      armed = true
    },
    finish: () => result,
    dispose: () => {
      disposed = true
      clearTimeout(timeout)
      page.off('request', onRequest)
      page.off('response', onResponse)
    },
  }
}
