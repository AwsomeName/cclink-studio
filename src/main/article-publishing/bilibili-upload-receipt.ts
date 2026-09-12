import type { Page, Request, Response } from 'playwright-core'
import { bilibiliImageUrl } from './bilibili-publication'

/** Only project non-secret native receipt fields into the existing operation failure. */
export function bilibiliUploadReceiptFailure(value: unknown): string {
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const data =
    object.data && typeof object.data === 'object' ? (object.data as Record<string, unknown>) : {}
  const code = typeof object.code === 'number' ? String(object.code) : '缺失'
  const dimension = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '缺失'
  let address = '缺失或不可安全展示'
  if (typeof data.image_url === 'string') {
    try {
      const url = new URL(data.image_url)
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /^i[012]\.hdslb\.com$/u.test(url.hostname) &&
        /^\/bfs\/[\w./-]+$/u.test(url.pathname)
      )
        address = `${url.origin}${url.pathname}`.slice(0, 400)
    } catch {
      /* Never put raw platform payloads or credential URLs in diagnostics. */
    }
  }
  return `B站上传回执未通过核验：code=${code}；图片地址=${address}；尺寸=${dimension(data.image_width)}×${dimension(data.image_height)}；保留结果未知，禁止重传`
}

/** Native uploader endpoint and response fields, verified against the platform's shipped client. */
export function observeBilibiliImageUpload(page: Page) {
  let armed = false
  let disposed = false
  let ambiguous = false
  let request: Request | undefined
  let resolve!: (url: string) => void
  let reject!: (error: Error) => void
  const result = new Promise<string>((yes, no) => {
    resolve = yes
    reject = no
  })
  void result.catch(() => undefined)
  const onRequest = (r: Request) => {
    if (!armed || disposed || r.method() !== 'POST') return
    const url = new URL(r.url())
    if (
      url.origin !== 'https://api.bilibili.com' ||
      url.pathname !== '/x/dynamic/feed/draw/upload_bfs'
    )
      return
    if (request) {
      ambiguous = true
      reject(new Error('单图操作出现多个上传请求，无法唯一对应，禁止重传'))
      return
    }
    request = r
  }
  const onResponse = (r: Response) => {
    if (!armed || disposed || !request || r.request() !== request) return
    void (async () => {
      const value = await r.json()
      const url = bilibiliImageUrl(value?.data?.image_url ?? '')
      if (
        value?.code !== 0 ||
        !url ||
        !(value.data.image_width > 0) ||
        !(value.data.image_height > 0)
      )
        throw new Error(bilibiliUploadReceiptFailure(value))
      if (!disposed) resolve(url)
    })().catch((error) => reject(error instanceof Error ? error : new Error('B站上传回执不可读')))
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  const timer = setTimeout(
    () => reject(new Error('未取得本次 B站上传回执；只核验，不重传')),
    30_000,
  )
  timer.unref?.()
  return {
    arm: () => {
      armed = true
    },
    finish: () => result,
    assertUnique: () => {
      if (ambiguous || !request || disposed) throw new Error('本次图片上传回执不再唯一或已失效')
    },
    dispose: () => {
      disposed = true
      clearTimeout(timer)
      page.off('request', onRequest)
      page.off('response', onResponse)
    },
  }
}
