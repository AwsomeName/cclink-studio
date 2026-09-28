import {
  readToutiaoPublicationReview,
  TOUTIAO_PUBLICATION_MANAGEMENT_URL,
} from './toutiao-publication-review'
import type { Page, Request, Response } from 'playwright-core'

/** Bounded diagnostics for the first real platform response. No body, cookies,
 * headers, signed URLs or arbitrary string values leave this observer. This is
 * never a publication receipt: public success still requires platform evidence. */
export function toutiaoResponseShape(value: unknown): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 2) return
    for (const [key, val] of Object.entries(node).slice(0, 30)) {
      if (
        !/^[a-zA-Z_][a-zA-Z_0-9]{0,39}$/u.test(key) ||
        /token|sign|secret|cookie|auth|key/iu.test(key)
      )
        continue
      const path = prefix ? `${prefix}.${key}` : key
      if (Object.keys(result).length >= 40) return
      result[path] =
        /^(code|status|status_code|err_no|errno)$/u.test(key) && typeof val === 'number'
          ? val
          : /^(id|gid|item_id|group_id|article_id|pgc_id)$/u.test(key) &&
              typeof val === 'string' &&
              /^\d{1,24}$/u.test(val)
            ? val
            : Array.isArray(val)
              ? `array(${val.length})`
              : typeof val
      walk(val, path, depth + 1)
    }
  }
  walk(value, '', 0)
  return result
}

export function observeToutiaoSubmission(
  page: Page,
  expected: Parameters<typeof readToutiaoPublicationReview>[1],
  isCurrent: () => boolean = () => true,
) {
  let armed = false
  let disposed = false
  const requests = new Set<Request>()
  const observations: string[] = []
  let accepted = false
  let reviewTimer: ReturnType<typeof setTimeout> | undefined
  let wakeReview: (() => void) | undefined
  let notifyResponse: () => void = () => undefined
  const responseReady = new Promise<void>((resolve) => {
    notifyResponse = resolve
  })
  const pending = new Set<Promise<void>>()
  const onRequest = (request: Request) => {
    if (!armed || disposed || requests.size >= 8 || request.method() !== 'POST') return
    const url = new URL(request.url())
    if (
      url.origin !== 'https://mp.toutiao.com' ||
      url.pathname !== '/mp/agw/article/wtt' ||
      !['xhr', 'fetch'].includes(request.resourceType())
    )
      return
    requests.add(request)
  }
  const onResponse = (response: Response) => {
    if (disposed || !requests.has(response.request())) return
    const work = (async () => {
      const url = new URL(response.url())
      const raw = await response.text()
      if (disposed || raw.length > 1_000_000) return
      let requestShape: Record<string, string | number> = {}
      try {
        requestShape = toutiaoResponseShape(JSON.parse(response.request().postData() ?? '{}'))
      } catch {
        /* non-JSON requests are not assumed */
      }
      const data = JSON.parse(raw)
      const shape = toutiaoResponseShape(data)
      accepted = response.status() === 200 && data?.code === 0
      notifyResponse()
      observations.push(
        `${url.pathname.slice(0, 160)} HTTP ${response.status()}；请求结构 ${JSON.stringify(requestShape)}；响应 ${JSON.stringify(shape)}`,
      )
    })().catch(() => undefined)
    pending.add(work)
    void work.finally(() => pending.delete(work))
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  let completion: Promise<{ status: string }> | undefined
  return {
    arm: () => {
      armed = true
    },
    finish: () =>
      (completion ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            responseReady,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 15_000)
            }),
          ])
          await Promise.allSettled([...pending])
          if (disposed || !isCurrent() || requests.size !== 1 || !accepted)
            throw new Error(
              `头条提交回执不能唯一核验；${observations.join('；') || '未读到提交响应'}；禁止重复发布`,
            )
          // The response code alone is not success. Read the submitted card from
          // the actual account's management page and match all image identities.
          await page.waitForURL(TOUTIAO_PUBLICATION_MANAGEMENT_URL, { timeout: 10_000 })
          // Navigation/title visibility can precede thumbnail loading. Reobserve
          // the same page within a bounded window; never resend or infer success.
          const deadline = Date.now() + 10_000
          while (!disposed && isCurrent() && requests.size === 1) {
            const review = await readToutiaoPublicationReview(page, expected)
            if (disposed || !isCurrent() || requests.size !== 1 || !review.current) break
            if (review.candidates.length === 1) return { status: review.candidates[0].status }
            if (review.candidates.length > 1 || Date.now() >= deadline) break
            await new Promise<void>((resolve) => {
              wakeReview = resolve
              reviewTimer = setTimeout(resolve, 250)
            })
          }
          throw new Error(
            '头条回执返回成功，但管理页尚未唯一对应本篇图文或核验已中止；只核验，不重发',
          )
        } finally {
          if (timer) clearTimeout(timer)
          if (reviewTimer) clearTimeout(reviewTimer)
          wakeReview = undefined
        }
      })()),
    dispose: () => {
      disposed = true
      if (reviewTimer) clearTimeout(reviewTimer)
      wakeReview?.()
      page.off('request', onRequest)
      page.off('response', onResponse)
    },
  }
}
