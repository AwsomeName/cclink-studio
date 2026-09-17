import type { Page, Request, Response } from 'playwright-core'

const JIKE_POST_ID = /^[0-9a-f]{24}$/iu

export function parseJikePublicationUrl(raw: string) {
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.protocol !== 'https:') return null
    if (url.origin === 'https://m.okjike.com') {
      const match = /^\/originalPosts\/([0-9a-f]{24})\/?$/iu.exec(url.pathname)
      return match ? { id: match[1], url: `${url.origin}/originalPosts/${match[1]}` } : null
    }
    if (url.origin !== 'https://web.okjike.com') return null
    const match = /^\/u\/([^/]+)\/post\/([0-9a-f]{24})\/?$/iu.exec(url.pathname)
    return match
      ? {
          username: decodeURIComponent(match[1]),
          id: match[2],
          url: `${url.origin}/u/${encodeURIComponent(decodeURIComponent(match[1]))}/post/${match[2]}`,
        }
      : null
  } catch {
    return null
  }
}

export function jikeImageIdentity(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['cdnv2.ruguoapp.com', 'cdn.ruguoapp.com', 'avatar.ruguoapp.com'].includes(url.hostname)
    )
      return null
    const key = decodeURIComponent(url.pathname.replace(/^\//u, ''))
    return key && !key.includes('/') ? key : null
  } catch {
    return null
  }
}

export async function readJikePublication(page: Page) {
  const anchor = parseJikePublicationUrl(page.url())
  if (!anchor) throw new Error('不是可核验的即刻单篇动态地址')
  return page.evaluate((anchor) => {
    const visible = (e: Element) => {
      const rect = e.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    type PostData = {
      id?: string
      type?: string
      status?: string
      content?: string
      pictures?: Array<{ key?: string }>
      user?: { username?: string }
    }
    let post: PostData | undefined
    const allImages = Array.from(document.querySelectorAll<HTMLImageElement>('img')).filter(visible)
    for (const image of allImages) {
      const fiberKey = Object.keys(image).find((key) => key.startsWith('__reactFiber$'))
      let fiber = fiberKey ? (image as unknown as Record<string, unknown>)[fiberKey] : undefined
      for (let depth = 0; fiber && depth < 24; depth += 1) {
        const current = fiber as { memoizedProps?: { data?: PostData }; return?: unknown }
        const data = current.memoizedProps?.data
        if (
          data?.id === anchor.id &&
          data.type === 'ORIGINAL_POST' &&
          data.status === 'NORMAL' &&
          typeof data.content === 'string' &&
          typeof data.user?.username === 'string' &&
          Array.isArray(data.pictures)
        ) {
          post = data
          break
        }
        fiber = current.return
      }
      if (post) break
    }
    const imageKey = (raw: string) => {
      try {
        const url = new URL(raw)
        if (!['cdnv2.ruguoapp.com', 'cdn.ruguoapp.com'].includes(url.hostname)) return undefined
        const key = decodeURIComponent(url.pathname.replace(/^\//u, ''))
        return key && !key.includes('/') ? key : undefined
      } catch {
        return undefined
      }
    }
    const images = (post?.pictures ?? []).flatMap((picture) => {
      if (!picture.key) return []
      const matches = allImages.filter(
        (image) => imageKey(image.currentSrc || image.src) === picture.key,
      )
      return matches.length === 1
        ? [
            {
              src: (matches[0].currentSrc || matches[0].src).split('?')[0],
              alt: matches[0].alt,
              loaded: matches[0].complete && matches[0].naturalWidth > 0,
            },
          ]
        : []
    })
    const imageEnumerationComplete = Boolean(
      post?.pictures?.length === images.length && images.every((image) => image.loaded),
    )
    return {
      observedAt: new Date().toISOString(),
      url: location.href,
      id: anchor.id,
      accountId: post?.user?.username,
      text: post?.content ?? '',
      images,
      imageEnumerationComplete,
      recognized: Boolean(post && imageEnumerationComplete),
    }
  }, anchor)
}

export interface JikeSubmissionTarget {
  accountId: string
  text: string
  imageKeys: string[]
}

export interface JikeFeedRecoveryTarget {
  accountId: string
  articleHtml: string
  imageKeys: string[]
  dispatchedAt: string
}

/**
 * Recover one already-dispatched post from the visible Jike feed. The live card must expose the
 * same account, full frozen text, ordered picture keys, and a creation time at the dispatch edge.
 * This is read-only and intentionally rejects zero or multiple matches.
 */
export async function readExactJikeFeedPublication(
  page: Page,
  expected: JikeFeedRecoveryTarget,
) {
  if (page.url() !== 'https://web.okjike.com/following')
    throw new Error('即刻结果恢复只允许读取原账号当前信息流')
  const candidates = await page.evaluate((expected) => {
    const normalize = (value: string) => value.replace(/[\s\u200b]/gu, '')
    const doc = new DOMParser().parseFromString(expected.articleHtml, 'text/html')
    doc.querySelectorAll('img').forEach((img) => img.remove())
    const expectedText = normalize(doc.body.textContent ?? '')
    const dispatchedAt = Date.parse(expected.dispatchedAt)
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const keyFromImage = (raw: string) => {
      try {
        const url = new URL(raw)
        if (!['cdnv2.ruguoapp.com', 'cdn.ruguoapp.com'].includes(url.hostname)) return undefined
        const key = decodeURIComponent(url.pathname.replace(/^\//u, ''))
        return key && !key.includes('/') ? key : undefined
      } catch {
        return undefined
      }
    }
    const matches = new Map<
      string,
      { accountId: string; id: string; createdAt: string; url: string; imageKeys: string[] }
    >()
    for (const root of Array.from(
      document.querySelectorAll<HTMLElement>('[data-clickable-feedback="true"]'),
    ).filter(visible)) {
      const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'))
      let fiber = fiberKey ? (root as unknown as Record<string, unknown>)[fiberKey] : undefined
      for (let depth = 0; fiber && depth < 24; depth += 1) {
        const current = fiber as {
          memoizedProps?: {
            data?: {
              id?: unknown
              type?: unknown
              status?: unknown
              content?: unknown
              createdAt?: unknown
              pictures?: Array<{ key?: unknown }>
              user?: { username?: unknown }
            }
          }
          return?: unknown
        }
        const data = current.memoizedProps?.data
        const id = typeof data?.id === 'string' ? data.id : ''
        const accountId = typeof data?.user?.username === 'string' ? data.user.username : ''
        const content = typeof data?.content === 'string' ? data.content : ''
        const createdAt = typeof data?.createdAt === 'string' ? data.createdAt : ''
        const imageKeys = Array.isArray(data?.pictures)
          ? data.pictures.flatMap((picture) =>
              typeof picture.key === 'string' ? [picture.key] : [],
            )
          : []
        const liveImageKeys = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
          .filter((image) => visible(image) && !image.closest('a[href^="/u/"]'))
          .flatMap((image) => keyFromImage(image.currentSrc || image.src) ?? [])
        const createdAtMs = Date.parse(createdAt)
        if (
          /^[0-9a-f]{24}$/iu.test(id) &&
          data?.type === 'ORIGINAL_POST' &&
          data.status === 'NORMAL' &&
          accountId === expected.accountId &&
          normalize(content) === expectedText &&
          Number.isFinite(dispatchedAt) &&
          Number.isFinite(createdAtMs) &&
          createdAtMs + 5_000 >= dispatchedAt &&
          createdAtMs <= Date.now() + 5_000 &&
          imageKeys.length === expected.imageKeys.length &&
          imageKeys.every((key, index) => key === expected.imageKeys[index]) &&
          liveImageKeys.length === expected.imageKeys.length &&
          liveImageKeys.every((key, index) => key === expected.imageKeys[index])
        ) {
          matches.set(id, {
            accountId,
            id,
            createdAt,
            url: `https://web.okjike.com/u/${encodeURIComponent(accountId)}/post/${id}`,
            imageKeys,
          })
          break
        }
        fiber = current.return
      }
    }
    return [...matches.values()]
  }, expected)
  if (candidates.length !== 1)
    throw new Error(`即刻信息流未唯一匹配本次冻结图文（实际 ${candidates.length} 条）`)
  const candidate = candidates[0]
  const parsed = parseJikePublicationUrl(candidate.url)
  if (!parsed || parsed.id !== candidate.id)
    throw new Error('即刻信息流候选作品地址不可核验')
  return { ...candidate, url: parsed.url }
}

/** Observe only the one exact create request armed immediately before the Studio Agent click. */
export function observeJikeSubmission(page: Page, expected: JikeSubmissionTarget) {
  let armed = false
  let disposed = false
  let matchedRequest: Request | undefined
  let resolve: (receipt: { accountId: string; id: string; username: string; url: string }) => void =
    () => undefined
  let reject: (error: Error) => void = () => undefined
  const result = new Promise<{ accountId: string; id: string; username: string; url: string }>(
    (yes, no) => {
      resolve = yes
      reject = no
    },
  )
  void result.catch(() => undefined)
  const same = (left: unknown, right: string[]) =>
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => String(value) === right[index])
  const requestMatches = (request: Request) => {
    const url = new URL(request.url())
    if (
      request.method() !== 'POST' ||
      url.origin !== 'https://api.ruguoapp.com' ||
      url.pathname !== '/1.0/originalPosts/create'
    )
      return false
    try {
      const body = request.postDataJSON() as Record<string, unknown>
      return body.content === expected.text && same(body.pictureKeys, expected.imageKeys)
    } catch {
      return false
    }
  }
  const onRequest = (request: Request) => {
    if (!armed || disposed || !requestMatches(request)) return
    if (matchedRequest) {
      reject(new Error('一次授权观察到多个即刻同稿提交请求，结果未知，禁止重发'))
      return
    }
    matchedRequest = request
  }
  const onResponse = (response: Response) => {
    if (!armed || disposed || response.request() !== matchedRequest) return
    void (async () => {
      const value = (await response.json()) as {
        data?: {
          id?: string
          content?: string
          pictures?: Array<{ key?: string }>
          user?: { id?: string; username?: string }
        }
      }
      const data = value.data
      const id = data?.id ?? ''
      const accountId = data?.user?.id ?? ''
      const username = data?.user?.username ?? ''
      if (
        !JIKE_POST_ID.test(id) ||
        accountId !== expected.accountId ||
        !username ||
        data?.content !== expected.text ||
        !same(data?.pictures?.map((picture) => picture.key), expected.imageKeys)
      )
        throw new Error('即刻提交回执未能同时证明账号、正文、文章 ID 与逐图标识')
      if (!disposed)
        resolve({
          accountId,
          id,
          username,
          url: `https://web.okjike.com/u/${encodeURIComponent(username)}/post/${id}`,
        })
    })().catch((error) =>
      reject(error instanceof Error ? error : new Error('即刻提交回执不可核验')),
    )
  }
  const timeout = setTimeout(
    () => reject(new Error('即刻提交回执超时，结果未知，禁止再次发送')),
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
