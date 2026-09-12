import type { Page, Request, Response } from 'playwright-core'

/** Observed native dynamic URLs; keep the long platform ID as text. */
export function parseBilibiliPublicationUrl(raw: string) {
  try {
    const u = new URL(raw)
    const id = /^\/(\d{10,22})\/?$/u.exec(u.pathname)?.[1]
    if (u.origin !== 'https://t.bilibili.com' || u.username || u.password || !id) return null
    if ([...u.searchParams.keys()].some((k) => k !== 'spm_id_from')) return null
    return { id, url: `https://t.bilibili.com/${id}` }
  } catch {
    return null
  }
}

/** Normalize only B站's native image rendition suffix, never another host or path. */
export function bilibiliImageUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (
      !['https:', 'http:'].includes(u.protocol) ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !/^i[012]\.hdslb\.com$/u.test(u.hostname)
    )
      return null
    const path = /^(\/bfs\/new_dyn\/[^/@]+\.(?:png|jpe?g|webp))(?:@[\w_!.]+)?$/iu.exec(
      u.pathname,
    )?.[1]
    // The native upload receipt returns HTTP. Normalize only the allowed CDN
    // origin to HTTPS; availability still requires a separate result check.
    return path ? `https://${u.hostname}${path}` : null
  } catch {
    return null
  }
}

export async function readBilibiliPublication(page: Page) {
  const anchor = parseBilibiliPublicationUrl(page.url())
  if (!anchor) throw new Error('不是本次 B站动态详情地址')
  const live = await page.evaluate(() => {
    const roots = document.querySelectorAll('.bili-dyn-item')
    const root = roots.length === 1 ? roots[0] : null
    const cards = root?.querySelectorAll('.dyn-card-opus')
    const card = cards?.length === 1 && !root?.querySelector('.dyn-orig-author') ? cards[0] : null
    const paragraphs = card?.querySelectorAll('.opus-paragraph-children')
    const recognized = Boolean(card && paragraphs?.length && !card.querySelector('.folded'))
    const headings = card?.querySelectorAll('h1,h2,h3,[class*="__title"]')
    const title = headings?.length === 1 ? (headings[0].textContent?.trim() ?? '') : ''
    const text = [...(paragraphs ?? [])].map((p) => (p as HTMLElement).innerText).join('\n')
    const images = [...(card?.querySelectorAll<HTMLImageElement>('img') ?? [])].map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.alt,
      loaded: img.complete && img.naturalWidth > 0,
    }))
    const author = root
      ?.querySelector('.bili-dyn-item__header .bili-dyn-title__text')
      ?.textContent?.trim()
    return {
      recognized,
      title,
      text,
      images,
      author,
      observedAt: new Date().toISOString(),
      url: location.href,
    }
  })
  return {
    ...live,
    id: anchor.id,
    images: live.images.map((i) => ({ ...i, src: bilibiliImageUrl(i.src) ?? i.src })),
    imageEnumerationComplete:
      live.recognized && live.images.every((i) => !!bilibiliImageUrl(i.src)),
  }
}

/** Passive observer of this single guarded native click; no network write or credentials. */
export function observeBilibiliSubmission(
  page: Page,
  expected: { uid: string; text: string; images: string[] },
) {
  if (
    !/^\d{5,20}$/u.test(expected.uid) ||
    !expected.text.trim() ||
    !expected.images.length ||
    expected.images.some((src) => !bilibiliImageUrl(src))
  )
    throw new Error('B站提交观察缺少已核验账号、正文或平台图片地址')
  let armed = false,
    disposed = false
  let request: Request | undefined
  let submissionSeen = false
  let settled = false
  let resolve!: (v: { uid: string; id: string; url: string }) => void
  let reject!: (e: Error) => void
  const result = new Promise<{ uid: string; id: string; url: string }>((yes, no) => {
    resolve = (value) => {
      settled = true
      yes(value)
    }
    reject = (error) => {
      settled = true
      no(error)
    }
  })
  void result.catch(() => undefined)
  const norm = (s: string) => s.replace(/[\s\u200b]/gu, '')
  const onRequest = (r: Request) => {
    if (
      !armed ||
      disposed ||
      r.method() !== 'POST' ||
      new URL(r.url()).origin !== 'https://api.bilibili.com' ||
      new URL(r.url()).pathname !== '/x/dynamic/feed/create/dyn'
    )
      return
    // Even a mismatched native submission forbids a second send.
    submissionSeen = true
    try {
      const data = r.postDataJSON()?.dyn_req
      if (!data || !Array.isArray(data.content?.contents) || !Array.isArray(data.pics)) return
      if (data.content.contents.some((c: { raw_text?: unknown }) => typeof c.raw_text !== 'string'))
        return
      const text = data.content.contents.map((c: { raw_text: string }) => c.raw_text).join('')
      if (
        norm(text) !== norm(expected.text) ||
        data.pics.length !== expected.images.length ||
        data.pics.some(
          (p: { img_src?: string }, i: number) =>
            bilibiliImageUrl(p.img_src ?? '') !== bilibiliImageUrl(expected.images[i]),
        )
      )
        return
      if (request) {
        reject(new Error('B站出现多个同稿请求，结果未知，禁止重发'))
        return
      }
      request = r
    } catch {
      /* An unrelated request cannot establish a receipt. */
    }
  }
  const onResponse = (r: Response) => {
    if (!armed || disposed || !request || r.request() !== request) return
    void (async () => {
      const data = await r.json()
      const id = data?.data?.dyn_id_str
      const anchor =
        typeof id === 'string' ? parseBilibiliPublicationUrl(`https://t.bilibili.com/${id}`) : null
      if (data?.code !== 0 || !anchor) throw new Error('B站提交回执未能证明动态 ID；只核验，不重发')
      if (!disposed) resolve({ ...anchor, uid: expected.uid })
    })().catch((e) => reject(e instanceof Error ? e : new Error('B站回执不可核验')))
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  const timer = setTimeout(
    () => reject(new Error('B站提交结果未取得可核验回执；禁止重复发送')),
    30_000,
  )
  timer.unref?.()
  return {
    arm: () => {
      armed = true
    },
    finish: () => result,
    hasSubmissionRequest: () => submissionSeen,
    canConfirm: () => armed && !disposed && !settled && !submissionSeen,
    dispose: () => {
      disposed = true
      clearTimeout(timer)
      page.off('request', onRequest)
      page.off('response', onResponse)
    },
  }
}

export interface BilibiliConfirmationProgress {
  id: 'bilibili.agreement.inspect' | 'bilibili.agreement.confirm' | 'bilibili.submission.receipt'
  status: 'running' | 'completed' | 'skipped' | 'unknown'
  evidence: string
  reason?: string
}

/** The first native 发布 can open terms instead of submitting. This continuation
 * belongs to that same guarded operation, never to a retry or unknown-result run. */
export async function finishBilibiliSubmission(
  page: Page,
  observer: ReturnType<typeof observeBilibiliSubmission>,
  guard: {
    isCurrent: () => boolean
    revalidate: () => Promise<void>
    record: (result: BilibiliConfirmationProgress) => Promise<void>
  },
) {
  const confirm = page.getByRole('button', { name: '确认并发送', exact: true })
  const outcome = await Promise.race([
    observer.finish().then((receipt) => ({ kind: 'receipt' as const, receipt })),
    confirm.waitFor({ state: 'visible', timeout: 30_000 }).then(() => ({ kind: 'terms' as const })),
  ])
  const recordReceipt = async (receipt: { uid: string; id: string; url: string }) => {
    // Cancellation can invalidate plan writes after the platform accepted the
    // post. Still return the receipt for the owner's durable identity binding.
    await guard
      .record({
        id: 'bilibili.submission.receipt',
        status: 'completed',
        evidence: `原生提交回执返回同稿动态 ID ${receipt.id}；公开内容尚待核验`,
      })
      .catch(() => undefined)
    return receipt
  }
  if (outcome.kind === 'receipt') {
    await guard
      .record({
        id: 'bilibili.agreement.inspect',
        status: 'completed',
        evidence: '原生首次点击直接取得同稿提交回执，不需要确认分支',
      })
      .catch(() => undefined)
    await guard
      .record({
        id: 'bilibili.agreement.confirm',
        status: 'skipped',
        evidence: '本次点击已经提交；不得追加确认或再次发送',
      })
      .catch(() => undefined)
    return recordReceipt(outcome.receipt)
  }
  const assertAllowed = () => {
    if (!guard.isCurrent() || !observer.canConfirm())
      throw new Error('B站确认前 Runtime 或回执观察已失效，或已经出现提交请求；只核验，不再发送')
  }
  const checkDialog = async () => {
    if (page.url() !== 'https://t.bilibili.com/') throw new Error('B站首次确认页面已变化')
    const recognized = await page
      .evaluate(() => {
        const visible = (e: Element) => {
          const r = e.getBoundingClientRect()
          const s = getComputedStyle(e)
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
        }
        const frames = [...document.querySelectorAll('iframe')].filter(
          (f) => f.src === 'https://t.bilibili.com/h5/dynamic/specification' && visible(f),
        )
        const buttons = [...document.querySelectorAll('button')].filter(
          (b) => visible(b) && b.textContent?.trim() === '确认并发送' && !b.disabled,
        )
        if (frames.length !== 1 || buttons.length !== 1) return false
        // Require the real specification document and its bounded modal, not an
        // arbitrary page button carrying the same label.
        const heading = frames[0].contentDocument?.querySelector('h1')?.textContent ?? ''
        if (!heading.includes('哔哩哔哩动态使用规范')) return false
        let container = frames[0].parentElement
        while (container && container !== document.body) {
          if (container.contains(buttons[0]))
            return (
              !container.querySelector('main') &&
              container.querySelectorAll('iframe').length === 1 &&
              [...container.querySelectorAll('button')].some(
                (b) => visible(b) && b.textContent?.trim() === '取消',
              )
            )
          container = container.parentElement
        }
        return false
      })
      .catch(() => undefined)
    if (!recognized) throw new Error('B站首次规范确认弹窗身份不完整；保留现场，不发送')
  }
  assertAllowed()
  await checkDialog()
  await guard.record({
    id: 'bilibili.agreement.inspect',
    status: 'completed',
    evidence: '实际读到原生动态使用规范 iframe、标题、确认并发送和取消；尚未观察到提交请求',
  })
  await guard.revalidate()
  await guard.record({
    id: 'bilibili.agreement.confirm',
    status: 'running',
    evidence: '同账号、冻结正文、标题和逐图复核通过；准备确认本次已授权发送',
  })
  await checkDialog()
  assertAllowed()
  try {
    await confirm.click({ timeout: 5_000 })
    await guard
      .record({
        id: 'bilibili.agreement.confirm',
        status: 'completed',
        evidence: '原生确认并发送按钮已点击一次；结果由提交回执独立核验',
      })
      .catch(() => undefined)
    await guard.record({
      id: 'bilibili.submission.receipt',
      status: 'running',
      evidence: '等待本次冻结正文和逐图对应的原生创建请求及响应',
    })
    // A click is not a receipt; the same request/response observer remains armed.
    const receipt = await observer.finish()
    return recordReceipt(receipt)
  } catch (error) {
    // A click can throw after the server accepted it. Only read the existing
    // observer here; never dispatch a confirmation from an exception path.
    const receipt = await observer.finish().catch(() => null)
    if (receipt) return recordReceipt(receipt)
    await guard
      .record({
        id: 'bilibili.submission.receipt',
        status: 'unknown',
        evidence: '已尝试原生确认发送，未能完成回执核验',
        reason: '不得再次确认或重发；只核验平台结果',
      })
      .catch(() => undefined)
    throw error
  }
}
