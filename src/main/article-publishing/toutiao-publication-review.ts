import type { Page } from 'playwright-core'
import { readToutiaoPage } from './toutiao-publishing-adapter'

export const TOUTIAO_PUBLICATION_MANAGEMENT_URL = 'https://mp.toutiao.com/profile_v4/weitoutiao'

/** Match the actual management card by account, title and all previously
 * verified platform image identities. A title/count match alone is insufficient. */
export async function readToutiaoPublicationReview(
  page: Page,
  expected: {
    uid: string
    title: string
    images: string[]
  },
) {
  if (page.url() !== TOUTIAO_PUBLICATION_MANAGEMENT_URL) throw new Error('不是头条微头条管理页')
  await page
    .getByText(expected.title, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
  const account = await readToutiaoPage(page)
  if (account.uid !== expected.uid) throw new Error('头条管理页账号不是本次原账号')
  return page.evaluate(
    ({ expected, url }) => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      }
      const norm = (s: string) => s.replace(/[\s\u200b]/gu, '')
      const title = norm(expected.title)
      const leaves = [...document.querySelectorAll<HTMLElement>('a,p,span,div')].filter(
        (el) =>
          visible(el) &&
          norm(el.innerText ?? '').startsWith(title) &&
          ![...el.children].some((child) =>
            norm((child as HTMLElement).innerText ?? '').startsWith(title),
          ),
      )
      const imageId = (raw: string) => {
        try {
          const u = new URL(raw)
          return u.protocol === 'https:' &&
            ['p3-sign.toutiaoimg.com', 'p11-sign.toutiaoimg.com'].includes(u.hostname)
            ? /^\/(tos-cn-i-ezhpy3drpa\/[a-f0-9]{32})(?:~[^/]*)?$/u.exec(u.pathname)?.[1]
            : undefined
        } catch {
          return undefined
        }
      }
      const wanted = expected.images.map(imageId)
      const seen = new Set<Element>()
      const candidates: Array<{
        status: string
        images: Array<{ src: string; loaded: boolean }>
        urls: string[]
        region: string
        titleSelector: string
      }> = []
      const diagnostics: string[] = []
      for (const leaf of leaves.slice(0, 12)) {
        let row: HTMLElement | null = leaf
        for (
          let depth = 0;
          row && row !== document.body && depth < 7;
          depth++, row = row.parentElement
        ) {
          if (seen.has(row)) continue
          seen.add(row)
          const statuses = [...row.querySelectorAll<HTMLElement>('span,div,p')].filter(
            (el) =>
              visible(el) &&
              ['审核中', '已发布', '未通过', '审核未通过', '仅我可见'].includes(
                el.innerText?.trim(),
              ) &&
              ![...el.children].some(
                (child) => (child as HTMLElement).innerText?.trim() === el.innerText.trim(),
              ),
          )
          if (statuses.length !== 1) continue
          const images = [...row.querySelectorAll<HTMLImageElement>('img')]
            .filter(visible)
            .map((img) => ({
              raw: img.currentSrc || img.src,
              id: imageId(img.currentSrc || img.src),
              loaded: img.complete && img.naturalWidth > 0,
            }))
            .filter((img) => img.id)
          const allSources = [...row.querySelectorAll<HTMLImageElement>('img')]
            .slice(0, 6)
            .map((img) => {
              try {
                const u = new URL(img.currentSrc || img.src)
                return u.origin + u.pathname
              } catch {
                return '不可读'
              }
            })
          diagnostics.push(
            `${row.tagName}.${row.className}：${statuses[0].innerText.trim()}；图片 ${allSources.join('、')}`,
          )
          if (
            !wanted.length ||
            wanted.some((id) => !id) ||
            images.length !== wanted.length ||
            images.some((img, i) => img.id !== wanted[i] || !img.loaded)
          )
            continue
          const urls = [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap((a) => {
            try {
              const u = new URL(a.href)
              return ['https://www.toutiao.com', 'https://toutiao.com'].includes(u.origin) &&
                /^\/(?:w\/\d+|article\/\d+|a\d+)\/?$/u.test(u.pathname)
                ? [u.origin + u.pathname]
                : []
            } catch {
              return []
            }
          })
          candidates.push({
            status: statuses[0].innerText.trim(),
            images: images.map((img) => ({
              src: `https://p3-sign.toutiaoimg.com/${img.id}`,
              loaded: img.loaded,
            })),
            urls: [...new Set(urls)],
            region: row.className,
            titleSelector: (() => {
              const parts: string[] = []
              let node: Element | null = leaf
              while (node && node !== document.body) {
                const parent: Element | null = node.parentElement
                if (!parent) return ''
                parts.unshift(
                  `${node.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(node) + 1})`,
                )
                node = parent
              }
              return `body > ${parts.join(' > ')}`
            })(),
          })
          break
        }
      }
      return { current: location.href === url, candidates, diagnostics: diagnostics.slice(0, 3) }
    },
    { expected, url: page.url() },
  )
}

/** Activate only the title of the freshly matched published card. This opens a
 * result for reading; it never enters the editor or dispatches a publication. */
export async function openToutiaoPublicationResult(
  page: Page,
  expected: Parameters<typeof readToutiaoPublicationReview>[1],
  isCurrent: () => boolean,
) {
  const review = await readToutiaoPublicationReview(page, expected)
  const card = review.candidates[0]
  if (
    !isCurrent() ||
    !review.current ||
    review.candidates.length !== 1 ||
    card.status !== '已发布' ||
    !card.titleSelector
  )
    throw new Error('头条公开结果入口未唯一核验，保留只读等待')
  const target = page.locator(card.titleSelector)
  if (
    (await target.count()) !== 1 ||
    !(await target.innerText())
      .replace(/[\s\u200b]/gu, '')
      .startsWith(expected.title.replace(/[\s\u200b]/gu, '')) ||
    !isCurrent()
  )
    throw new Error('头条作品标题入口已变化，不能打开')
  const popup = page
    .waitForEvent('popup', { timeout: 10_000 })
    .then(async (p) => {
      await p.waitForURL((url) => url.protocol === 'https:', { timeout: 10_000 })
      return p.url()
    })
    .catch(() => null)
  const navigation = page
    .waitForURL((url) => url.href !== TOUTIAO_PUBLICATION_MANAGEMENT_URL, { timeout: 10_000 })
    .then(() => page.url())
    .catch(() => null)
  await target.click({ timeout: 5000 })
  const urls = (await Promise.all([popup, navigation])).filter((s): s is string => !!s)
  const valid = [...new Set(urls)].filter((raw) => {
    const u = new URL(raw)
    return (
      ['https://www.toutiao.com', 'https://toutiao.com'].includes(u.origin) &&
      /^\/(?:w\/\d+|article\/\d+|a\d+)\/?$/u.test(u.pathname)
    )
  })
  if (!isCurrent() || valid.length !== 1)
    throw new Error('头条作品入口未返回唯一公开地址；禁止重复提交')
  const url = new URL(valid[0])
  return url.origin + url.pathname
}
