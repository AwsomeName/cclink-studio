import type { Page, Request, Response } from 'playwright-core'

export interface XiaohongshuSubmissionTarget {
  title: string
  description: string
  fileIds: string[]
}

/** Read only the exact submission response belonging to the frozen image-note request. */
export function matchesXiaohongshuSubmission(body: unknown, expected: XiaohongshuSubmissionTarget) {
  const value = body as {
    common?: { type?: string; note_id?: string; title?: string; desc?: string }
    image_info?: { images?: Array<{ file_id?: string }> }
  } | null
  const images = value?.image_info?.images
  return (
    value?.common?.type === 'normal' &&
    !value.common.note_id &&
    value.common.title === expected.title &&
    value.common.desc === expected.description &&
    Array.isArray(images) &&
    images.length === expected.fileIds.length &&
    images.every((image, index) => image.file_id === expected.fileIds[index])
  )
}

export function xiaohongshuSubmittedId(value: unknown): string | null {
  const body = value as {
    code?: number
    success?: boolean
    data?: { id?: string; note_id?: string; noteId?: string }
    id?: string
    note_id?: string
    noteId?: string
  } | null
  if (!body || (body.code !== 0 && body.success !== true)) return null
  const data = body.data ?? body
  const id = data.id ?? data.note_id ?? data.noteId
  return typeof id === 'string' && /^[a-f\d]{24}$/iu.test(id) ? id : null
}

export function observeXiaohongshuSubmission(page: Page, expected: XiaohongshuSubmissionTarget) {
  let armed = false
  let request: Request | undefined
  let settled = false
  let resolve!: (id: string) => void
  const result = new Promise<string>((r) => {
    resolve = r
  })
  let completion: Promise<string> | undefined
  const onRequest = (candidate: Request) => {
    if (!armed || request || candidate.method() !== 'POST') return
    const url = new URL(candidate.url())
    if (url.origin !== 'https://edith.xiaohongshu.com' || url.pathname !== '/web_api/sns/v2/note')
      return
    try {
      if (matchesXiaohongshuSubmission(candidate.postDataJSON(), expected)) request = candidate
    } catch {
      /* Unknown request shape cannot be attested. */
    }
  }
  const onResponse = async (response: Response) => {
    if (!request || response.request() !== request || settled || !response.ok()) return
    try {
      const id = xiaohongshuSubmittedId(await response.json())
      if (id) {
        settled = true
        resolve(id)
      }
    } catch {
      /* Preserve unknown; never repeat submission. */
    }
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  return {
    arm: () => {
      armed = true
    },
    finish: () =>
      (completion ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            result,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      '小红书提交回执未能与本次原稿及逐图请求唯一对应，只能核验，禁止再次发布',
                    ),
                  ),
                15000,
              )
            }),
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      })()),
    dispose: () => {
      page.off('request', onRequest)
      page.off('response', onResponse)
    },
  }
}
