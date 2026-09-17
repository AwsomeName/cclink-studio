import type { Page, Request, Response, Route } from 'playwright-core'
import type { BilibiliSubmissionObservation } from '../../shared/article-publishing/article-publishing-types'

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

/** Normalize B站's interchangeable native CDN shards and rendition suffix. */
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
    // Upload receipts and the public page can use different i0/i1/i2 shards for
    // the same immutable BFS path. Canonicalize that bounded native host set so
    // public verification compares image identity instead of CDN routing.
    return path ? `https://i0.hdslb.com${path}` : null
  } catch {
    return null
  }
}

export async function readBilibiliPublication(page: Page) {
  const anchor = parseBilibiliPublicationUrl(page.url())
  if (!anchor) throw new Error('不是本次 B站动态详情地址')
  const identity = await page
    .evaluate(async (id) => {
      try {
        const response = await fetch(
          `https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${encodeURIComponent(id)}`,
          { credentials: 'include' },
        )
        const payload = await response.json()
        const item = payload?.data?.item
        const mid = item?.modules?.module_author?.mid
        const imageUrls = item?.modules?.module_dynamic?.major?.draw?.items
        const images = Array.isArray(imageUrls)
          ? imageUrls.flatMap((image: { src?: unknown }) =>
              typeof image?.src === 'string' ? [image.src] : [],
            )
          : []
        return response.ok &&
          payload?.code === 0 &&
          item?.id_str === id &&
          (typeof mid === 'number' || typeof mid === 'string') &&
          /^\d{5,20}$/u.test(String(mid))
          ? { uid: String(mid), images }
          : null
      } catch {
        return null
      }
    }, anchor.id)
    .catch(() => null)
  const live = await page.evaluate(() => {
    const roots = document.querySelectorAll('.bili-dyn-item')
    const root = roots.length === 1 ? roots[0] : null
    const cards = root?.querySelectorAll('.dyn-card-opus')
    const card = cards?.length === 1 && !root?.querySelector('.dyn-orig-author') ? cards[0] : null
    const paragraphs = card?.querySelectorAll('.opus-paragraph-children')
    const recognized = Boolean(card && paragraphs?.length && !card.querySelector('.folded'))
    const headings = card?.querySelectorAll('h1,h2,h3,[class*="__title"]')
    const title = headings?.length === 1 ? (headings[0].textContent?.trim() ?? '') : ''
    const text = [...(paragraphs ?? [])]
      .map((paragraph) => {
        const copy = paragraph.cloneNode(true) as HTMLElement
        // Expanded/collapsed controls are nested in the paragraph container but are not part of
        // the submitted dynamic. Keep topic-link text intact: Bilibili places the next topic's
        // opening `#` at the end of the preceding link.
        for (const element of [...copy.querySelectorAll<HTMLElement>('*')].reverse()) {
          if (/^(?:\.{3}|…|展开|收起)$/u.test((element.innerText ?? '').trim())) element.remove()
        }
        return copy.innerText
      })
      .join('\n')
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
  const renderedImages = live.images.flatMap((image) => {
    const src = bilibiliImageUrl(image.src)
    return src ? [{ ...image, src }] : []
  })
  const loaded = new Set(renderedImages.filter((image) => image.loaded).map((image) => image.src))
  // The native detail API is the exact ordered public gallery. The DOM also
  // mounts hidden duplicate previews and can collapse positions after nine,
  // so counting every <img> either doubles a valid post or misses extras.
  const apiImages = identity?.images.flatMap((raw) => {
    const src = bilibiliImageUrl(raw)
    return src ? [{ src, alt: '', loaded: loaded.has(src) }] : []
  })
  const images = apiImages?.length ? apiImages : renderedImages
  return {
    ...live,
    ...(identity ? identity : {}),
    id: anchor.id,
    images,
    imageEnumerationComplete: live.recognized && images.length > 0,
  }
}

/** Passive observer of this single guarded native click; no network write or credentials. */
export async function observeBilibiliSubmission(
  page: Page,
  expected: { uid: string; text: string; images: string[] },
  recordObservation?: (facts: Omit<BilibiliSubmissionObservation, 'observedAt'>) => Promise<void>,
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
  let requestMatch: BilibiliSubmissionObservation['requestMatch']
  let responseStatus: number | undefined
  let platformCode: number | undefined
  let postId: string | undefined
  let transportFailed: boolean | undefined
  let submissionSeen = false
  let confirmationAttempted = false
  let observationFailed = false
  let observationWrites = Promise.resolve()
  const recordFacts = () => {
    const facts = {
      confirmationAttempted,
      requestObserved: submissionSeen,
      observationEnded: disposed,
      ...(requestMatch ? { requestMatch } : {}),
      ...(responseStatus !== undefined ? { responseStatus } : {}),
      ...(platformCode !== undefined ? { platformCode } : {}),
      ...(postId ? { postId } : {}),
      ...(transportFailed !== undefined ? { transportFailed } : {}),
    }
    observationWrites = observationWrites.then(() => recordObservation?.(facts))
    void observationWrites.catch(() => {
      observationFailed = true
    })
    return observationWrites
  }
  let settled = false
  let resolve!: (v: { uid: string; id: string; url: string }) => void
  let reject!: (e: Error) => void
  const result = new Promise<{ uid: string; id: string; url: string }>((yes, no) => {
    resolve = (value) => {
      if (settled) return
      settled = true
      yes(value)
    }
    reject = (error) => {
      if (settled) return
      settled = true
      no(error)
    }
  })
  void result.catch(() => undefined)
  const norm = (s: string) => s.replace(/[\s\u200b]/gu, '')
  const classify = (r: Request): NonNullable<BilibiliSubmissionObservation['requestMatch']> => {
    try {
      const data = r.postDataJSON()?.dyn_req
      if (!data || !Array.isArray(data.content?.contents) || !Array.isArray(data.pics))
        return 'invalid-body'
      if (data.content.contents.some((c: { raw_text?: unknown }) => typeof c.raw_text !== 'string'))
        return 'invalid-body'
      const text = data.content.contents.map((c: { raw_text: string }) => c.raw_text).join('')
      if (norm(text) !== norm(expected.text)) return 'text-mismatch'
      if (
        data.pics.length !== expected.images.length ||
        data.pics.some(
          (p: { img_src?: string }, i: number) =>
            bilibiliImageUrl(p.img_src ?? '') !== bilibiliImageUrl(expected.images[i]),
        )
      )
        return 'image-mismatch'
      return 'matched'
    } catch {
      return 'invalid-body'
    }
  }
  const isSubmissionRequest = (r: Request) =>
    r.method() === 'POST' &&
    new URL(r.url()).origin === 'https://api.bilibili.com' &&
    new URL(r.url()).pathname === '/x/dynamic/feed/create/dyn'
  const onRequest = (r: Request) => {
    if (!armed || disposed || !isSubmissionRequest(r)) return
    // Even a mismatched native submission forbids a second send.
    submissionSeen = true
    if (request) {
      requestMatch = 'multiple-requests'
      void recordFacts().catch(() => undefined)
      reject(new Error('B站出现多个提交请求，结果未知，禁止重发'))
      return
    }
    request = r
    requestMatch = classify(r)
    void recordFacts().catch(() => undefined)
  }
  const routeHandler = async (route: Route, routedRequest: Request) => {
    if (!armed || disposed || !isSubmissionRequest(routedRequest)) {
      await route.continue()
      return
    }
    const match = classify(routedRequest)
    if (match === 'matched') {
      await route.continue()
      return
    }
    submissionSeen = true
    request = routedRequest
    requestMatch = match
    await recordFacts().catch(() => undefined)
    await route.abort('blockedbyclient')
    reject(new Error(`B站创建请求与冻结稿不匹配（${match}）；已在网络派发前阻止`))
  }
  if (typeof page.route === 'function')
    await page.route('**/x/dynamic/feed/create/dyn', routeHandler)
  const onResponse = (r: Response) => {
    if (!armed || disposed || !request || r.request() !== request) return
    void (async () => {
      responseStatus = r.status()
      await recordFacts()
      const data = await r.json()
      if (disposed || settled) return
      if (Number.isSafeInteger(data?.code)) platformCode = data.code
      const anchor =
        typeof data?.data?.dyn_id_str === 'string'
          ? parseBilibiliPublicationUrl(`https://t.bilibili.com/${data.data.dyn_id_str}`)
          : null
      if (anchor) postId = anchor.id
      await recordFacts()
      if (data?.code !== 0)
        throw new Error(
          `B站提交返回平台错误码 ${platformCode ?? '不可读'}（HTTP ${responseStatus}）；结果未知，禁止重发`,
        )
      if (requestMatch !== 'matched')
        throw new Error(`B站创建请求与冻结稿不匹配（${requestMatch}）；不能认领回执，禁止重发`)
      if (data?.code !== 0 || !anchor) throw new Error('B站提交回执未能证明动态 ID；只核验，不重发')
      if (!disposed) resolve({ ...anchor, uid: expected.uid })
    })().catch((e) => reject(e instanceof Error ? e : new Error('B站回执不可核验')))
  }
  const onRequestFailed = (r: Request) => {
    if (!armed || disposed || r !== request) return
    transportFailed = true
    void recordFacts().catch(() => undefined)
    reject(
      new Error(
        `B站创建请求网络失败（正文与图片匹配：${requestMatch ?? '未完成'}）；结果未知，禁止重发`,
      ),
    )
  }
  const onPageLost = () => reject(new Error('B站提交观察页面已关闭或崩溃；只核验，不再发送'))
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onRequestFailed)
  page.on('close', onPageLost)
  page.on('crash', onPageLost)
  const timer = setTimeout(
    () =>
      reject(
        new Error(
          `B站提交结果未取得可核验回执（请求匹配：${requestMatch ?? '未观察到请求'}；HTTP：${responseStatus ?? '未取得'}）；禁止重复发送`,
        ),
      ),
    30_000,
  )
  timer.unref?.()
  return {
    arm: () => {
      if (armed || disposed || settled)
        throw new Error('B站提交观察不可重新启用或已超时；禁止派发发布入口')
      armed = true
      void recordFacts().catch(() => undefined)
    },
    finish: () => result,
    hasSubmissionRequest: () => submissionSeen,
    canConfirm: () => armed && !disposed && !settled && !submissionSeen && !observationFailed,
    markConfirmationAttempted: async () => {
      if (
        !armed ||
        disposed ||
        settled ||
        submissionSeen ||
        confirmationAttempted ||
        observationFailed
      )
        throw new Error('B站确认派发条件已失效；不得再次发送')
      // Conservative write before click: a crash between this write and click
      // can never be mistaken for proof that sending is still permitted.
      confirmationAttempted = true
      await recordFacts()
    },
    dispose: async () => {
      if (disposed) return observationWrites
      disposed = true
      if (!settled) reject(new Error('B站提交观察已释放；只核验，不再发送'))
      clearTimeout(timer)
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('requestfailed', onRequestFailed)
      page.off('close', onPageLost)
      page.off('crash', onPageLost)
      if (typeof page.unroute === 'function')
        await page.unroute('**/x/dynamic/feed/create/dyn', routeHandler).catch(() => undefined)
      return armed ? recordFacts() : observationWrites
    },
  }
}

export interface BilibiliConfirmationProgress {
  id: 'bilibili.agreement.inspect' | 'bilibili.agreement.confirm' | 'bilibili.submission.receipt'
  status: 'running' | 'completed' | 'skipped' | 'unknown' | 'waiting'
  evidence: string
  reason?: string
}

/** The first native 发布 can open terms instead of submitting. This continuation
 * belongs to that same guarded operation, never to a retry or unknown-result run. */
export async function finishBilibiliSubmission(
  page: Page,
  observer: Awaited<ReturnType<typeof observeBilibiliSubmission>>,
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
    // The native button becomes visible before its specification iframe has
    // loaded. Wait for that exact document's heading, within the live observer;
    // button visibility alone is not evidence that the document is ready.
    const heading = page
      .frameLocator('.bili-dyn-specification-popup__content iframe')
      .getByRole('heading', { level: 1, name: /哔哩哔哩动态使用规范/u })
    try {
      await heading.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
      assertAllowed()
      await guard.record({
        id: 'bilibili.agreement.inspect',
        status: 'waiting',
        evidence: '首次规范文档尚未就绪；确认尚未执行，原提交观察器仍在监听',
        reason: '仅在同一次操作内有界重读规范文档；不重复点击发布入口',
      })
      // Read-only continuation, not another publish/confirmation attempt. The
      // original 30-second receipt deadline is never reset or extended.
      await heading.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
        throw new Error('B站规范文档标题在有界等待内未就绪；保留现场，不发送')
      })
    }
    assertAllowed()
    const recognition = await page
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
        if (frames.length !== 1) return `规范 iframe 数量 ${frames.length}，预期 1`
        if (buttons.length !== 1) return `可用确认按钮数量 ${buttons.length}，预期 1`
        // Require the real specification document and its bounded modal, not an
        // arbitrary page button carrying the same label.
        const specification = frames[0].contentDocument
        if (!specification) return '规范文档不可读'
        const heading = specification.querySelector('h1')?.textContent ?? ''
        if (!heading.includes('哔哩哔哩动态使用规范')) return '规范一级标题不匹配'
        let container = frames[0].parentElement
        while (container && container !== document.body) {
          if (container.contains(buttons[0])) {
            if (container.querySelector('main')) return '弹窗容器包含主页面'
            if (container.querySelectorAll('iframe').length !== 1) return '弹窗容器包含多个 iframe'
            if (
              ![...container.querySelectorAll('button')].some(
                (b) => visible(b) && b.textContent?.trim() === '取消',
              )
            )
              return '弹窗缺少可见取消按钮'
            return 'recognized'
          }
          container = container.parentElement
        }
        return '规范与确认按钮没有独立共同容器'
      })
      .catch(() => '规范 DOM 读取失败')
    if (recognition !== 'recognized')
      throw new Error(`B站首次规范确认弹窗身份不完整：${recognition}；保留现场，不发送`)
    await guard.record({
      id: 'bilibili.agreement.inspect',
      status: 'completed',
      evidence: '实际读到原生动态使用规范 iframe、标题、确认并发送和取消；尚未观察到提交请求',
    })
  }
  assertAllowed()
  await checkDialog()
  await guard.revalidate()
  await guard.record({
    id: 'bilibili.agreement.confirm',
    status: 'running',
    evidence: '同账号、冻结正文、标题和逐图复核通过；准备确认本次已授权发送',
  })
  await checkDialog()
  assertAllowed()
  try {
    await observer.markConfirmationAttempted()
    assertAllowed()
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
