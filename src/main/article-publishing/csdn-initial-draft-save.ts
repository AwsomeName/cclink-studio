import type { Page, Request, Response } from 'playwright-core'

const SAVE_URL = 'https://bizapi.csdn.net/blog-console-api/v1/postedit/saveArticle'

/** Observe the website's own first save. Never issue a request or infer an ID from a title. */
export function observeCsdnInitialDraftSave(page: Page, expectedTitle: string) {
  let armed = false
  let request: Request | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let resolve!: (value: { draftId?: string; error?: string }) => void
  const result = new Promise<{ draftId?: string; error?: string }>((done) => {
    resolve = done
  })
  const finish = (value: { draftId?: string; error?: string }) => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    resolve(value)
  }
  const onRequest = (candidate: Request) => {
    if (!armed || candidate.url() !== SAVE_URL) return
    try {
      if (candidate.frame() !== page.mainFrame()) return
    } catch {
      // A service-worker request has no owning Frame; it is not this editor's proof.
      return
    }
    if (request) return finish({ error: '首次保存出现多个请求，必须对账，禁止再次创建草稿' })
    request = candidate
    try {
      const data = candidate.postDataJSON() as Record<string, unknown>
      if (
        candidate.method() !== 'POST' ||
        data.status !== 2 ||
        data.article_id !== '' ||
        typeof data.title !== 'string' ||
        data.title !== expectedTitle.replace(/\s+/gu, ' ') ||
        typeof data.content !== 'string' ||
        data.content.length >= 100
      )
        finish({ error: '首次保存请求不符合空白原稿授权，不能认领返回的草稿' })
    } catch {
      finish({ error: '首次保存请求不可核验' })
    }
  }
  const onResponse = async (response: Response) => {
    if (response.request() !== request || settled) return
    try {
      const body = (await response.json()) as { code?: unknown; data?: { article_id?: unknown } }
      const draftId = String(body.data?.article_id ?? '')
      finish(
        response.ok() && body.code === 200 && /^\d+$/u.test(draftId)
          ? { draftId }
          : { error: '首次保存没有返回可核验的草稿编号，禁止再次创建' },
      )
    } catch {
      finish({ error: '首次保存响应丢失，结果未知，禁止再次创建' })
    }
  }
  const onFailed = (candidate: Request) => {
    if (candidate === request) finish({ error: '首次保存请求断开，结果未知，禁止再次创建' })
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onFailed)
  return {
    arm() {
      armed = true
      timer = setTimeout(
        () => finish({ error: '首次保存响应超时，结果未知，禁止再次创建' }),
        15_000,
      )
    },
    result,
    dispose() {
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('requestfailed', onFailed)
      if (timer) clearTimeout(timer)
      finish({ error: '首次保存观察结束，未确认结果' })
    },
  }
}
