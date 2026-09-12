import type { Page } from 'playwright-core'

export function parseToutiaoPublicationUrl(raw: string) {
  try {
    const u = new URL(raw)
    const id = /^\/w\/(\d{1,24})\/?$/u.exec(u.pathname)?.[1]
    return ['https://www.toutiao.com', 'https://toutiao.com'].includes(u.origin) &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.search &&
      !u.hash &&
      id
      ? { id, url: u.origin + u.pathname }
      : null
  } catch {
    return null
  }
}

/** Public body/gallery only. Numeric author identity is verified separately by
 * the original account's management card; opaque profile tokens are never read. */
export async function readToutiaoPublication(page: Page, title: string) {
  const anchor = parseToutiaoPublicationUrl(page.url())
  if (!anchor || !title) throw new Error('不是可核验的头条单篇公开地址')
  await page
    .getByText(title, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
  return page.evaluate(
    ({ anchor, title }) => {
      const norm = (s: string) => s.replace(/[\s\u200b]/gu, '')
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      }
      const leaves = [...document.querySelectorAll<HTMLElement>('div,p,article')].filter(
        (el) =>
          visible(el) &&
          norm(el.innerText ?? '').startsWith(norm(title)) &&
          ![...el.children].some((c) =>
            norm((c as HTMLElement).innerText ?? '').startsWith(norm(title)),
          ),
      )
      const candidates = leaves.flatMap((leaf) => {
        let root: HTMLElement | null = leaf
        for (
          let depth = 0;
          root && root !== document.body && depth < 5;
          depth++, root = root.parentElement
        ) {
          const images = [...root.querySelectorAll<HTMLImageElement>('img')].flatMap((img) => {
            try {
              const u = new URL(img.currentSrc || img.src)
              const id = /^\/(tos-cn-i-ezhpy3drpa\/[a-f0-9]{32})(?:~[^/]*)?$/u.exec(u.pathname)?.[1]
              return u.protocol === 'https:' &&
                ['p3-sign.toutiaoimg.com', 'p11-sign.toutiaoimg.com'].includes(u.hostname) &&
                id
                ? [
                    {
                      src: `https://p3-sign.toutiaoimg.com/${id}`,
                      alt: '',
                      loaded: img.complete && img.naturalWidth > 0,
                    },
                  ]
                : []
            } catch {
              return []
            }
          })
          if (images.length) return [{ text: root.innerText, images, region: root.className }]
        }
        return []
      })
      const current = location.href === anchor.url
      const candidate = candidates.length === 1 ? candidates[0] : undefined
      return {
        observedAt: new Date().toISOString(),
        url: location.href,
        id: anchor.id,
        recognized: current && !!candidate,
        text: candidate?.text ?? '',
        title,
        images: candidate?.images ?? [],
        imageEnumerationComplete: current && !!candidate,
        diagnostic: `公开正文区域 ${candidates.length} 个；${candidate?.region ?? '未识别'}；图片 ${candidate?.images.length ?? 0} 张`,
      }
    },
    { anchor, title },
  )
}
