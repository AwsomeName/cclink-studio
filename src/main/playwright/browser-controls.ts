import type { Page } from 'playwright-core'

interface BrowserControl {
  selector?: string
  tag: string
  type?: string
  role?: string
  label: string
  href?: string
  accept?: string
  disabled: boolean
  checked?: boolean | 'mixed'
  /** Actual DOM classes around a visual control, diagnostic only, never checked state. */
  markers?: string[]
}

/** A bounded, read-only alternative to full HTML or free-form page scripts.
 * Never reads field values, cookies, storage or framework state. */
export async function readBrowserControls(page: Page, selector: string) {
  const root = page.locator(selector)
  if ((await root.count()) !== 1)
    throw new Error('控件读取范围必须唯一，请使用当前可见区域的选择器')
  const observed = await root.evaluate((root) => {
    const visible = (e: Element) => {
      const bounds = e.getBoundingClientRect()
      const style = getComputedStyle(e)
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }
    if (!visible(root)) throw new Error('控件读取范围不可见')
    const selectorFor = (e: Element): string | undefined => {
      const tag = e.tagName.toLowerCase()
      const choices = e.id ? [`#${CSS.escape(e.id)}`] : []
      for (const attr of ['placeholder', 'name', 'aria-label', 'title']) {
        const value = e.getAttribute(attr)
        if (value && value.length <= 100) choices.push(`${tag}[${attr}=${JSON.stringify(value)}]`)
      }
      if (e.classList.length)
        choices.push(
          `${tag}.${Array.from(e.classList)
            .map((c) => CSS.escape(c))
            .join('.')}`,
        )
      for (const candidate of choices)
        if (candidate.length <= 500 && document.querySelectorAll(candidate).length === 1)
          return candidate
      const parts: string[] = []
      let current: Element | null = e
      while (current && current !== document.documentElement) {
        const parent: Element | null = current.parentElement
        if (!parent) return undefined
        parts.unshift(
          `${current.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`,
        )
        current = parent
      }
      const candidate = `html > ${parts.join(' > ')}`
      return candidate.length <= 800 && document.querySelectorAll(candidate).length === 1
        ? candidate
        : undefined
    }
    const standard = Array.from(
      root.querySelectorAll(
        'a[href],button,input,textarea,select,[role="button"],[role="checkbox"],[role="switch"],[contenteditable="true"]',
      ),
    )
    // Some visible toolbars use div/span plus CSS cursor instead of semantic
    // buttons. Report their actual labels/selectors; this does not authorize a
    // click or infer what an unlabeled icon does.
    const visual = Array.from(root.querySelectorAll('div,span,label')).filter((e) => {
      if (!visible(e) || getComputedStyle(e).cursor !== 'pointer') return false
      return !Array.from(e.children).some(
        (child) =>
          child.matches('div,span,label,a,button') &&
          visible(child) &&
          getComputedStyle(child).cursor === 'pointer',
      )
    })
    const elements = [...new Set([...standard, ...visual])].filter(
      (e) =>
        !e.matches('input[type="password"],input[type="hidden"]') &&
        (visible(e) ||
          (e.matches('input[type="file"]') && !!e.parentElement && visible(e.parentElement)) ||
          (e instanceof HTMLInputElement &&
            e.type === 'checkbox' &&
            [...(e.labels ?? [])].some(visible))),
    )
    return {
      total: elements.length,
      images: Array.from(root.querySelectorAll<HTMLImageElement>('img'))
        .filter(visible)
        .slice(0, 80)
        .map((img) => ({
          selector: selectorFor(img),
          src: img.currentSrc || img.src,
          alt: img.alt.slice(0, 160),
          loaded: img.complete && img.naturalWidth > 0,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        })),
      controls: elements.slice(0, 80).map((e) => ({
        selector: selectorFor(e),
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute('type') ?? undefined,
        role: e.getAttribute('role') ?? undefined,
        label: (
          e.getAttribute('aria-label') ||
          e.getAttribute('placeholder') ||
          e.getAttribute('title') ||
          (e instanceof HTMLInputElement && e.type === 'checkbox'
            ? [...(e.labels ?? [])].map((l) => l.textContent ?? '').join(' ')
            : '') ||
          (e.matches('a,button,[role="button"],div,span,label') ? e.textContent : '') ||
          ''
        )
          .trim()
          .slice(0, 160),
        href: e instanceof HTMLAnchorElement ? e.href : undefined,
        accept: e.getAttribute('accept')?.slice(0, 160),
        markers: visual.includes(e)
          ? [e, e.parentElement, e.parentElement?.parentElement]
              .filter((node): node is Element => !!node && root.contains(node))
              .map((node) =>
                typeof node.className === 'string' ? node.className.slice(0, 200) : '',
              )
          : undefined,
        checked:
          e instanceof HTMLInputElement && e.type === 'checkbox'
            ? e.indeterminate
              ? ('mixed' as const)
              : e.checked
            : e.matches('[role="checkbox"],[role="switch"]')
              ? e.getAttribute('aria-checked') === 'mixed'
                ? ('mixed' as const)
                : e.getAttribute('aria-checked') === 'true'
                  ? true
                  : e.getAttribute('aria-checked') === 'false'
                    ? false
                    : undefined
              : undefined,
        disabled: e.matches(':disabled') || e.getAttribute('aria-disabled') === 'true',
      })),
    }
  })
  const controls = sanitizeBrowserControls(observed.controls)
  const images = observed.images.map((img) => ({ ...img, src: safeControlUrl(img.src) }))
  // Deep native selectors can exhaust the Agent's tool-result budget even with
  // a count limit. Keep the response inline, so it need not read runtime files.
  let truncated = observed.total > 80
  while (JSON.stringify({ controls, images }, null, 2).length > 16_000) {
    truncated = true
    if (controls.length > images.length) controls.pop()
    else images.pop()
  }
  return {
    url: safeControlUrl(page.url()),
    total: observed.total,
    images,
    controls,
    truncated,
  }
}

export function safeControlUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return undefined
    if (
      Array.from(url.searchParams.keys()).some((key) =>
        /token|secret|key|code|signature|credential|session|auth/iu.test(key),
      )
    )
      return undefined
    return url.href.length <= 1000 ? url.href : undefined
  } catch {
    return undefined
  }
}

export function sanitizeBrowserControls(controls: BrowserControl[]): BrowserControl[] {
  return controls.slice(0, 80).map((control) => ({
    selector: control.selector?.slice(0, 800),
    tag: control.tag,
    type: control.type,
    role: control.role,
    label: control.label.slice(0, 160),
    href: control.href ? safeControlUrl(control.href) : undefined,
    accept: control.accept?.slice(0, 160),
    disabled: control.disabled,
    checked:
      typeof control.checked === 'boolean' || control.checked === 'mixed'
        ? control.checked
        : undefined,
    markers: control.markers?.slice(0, 3).map((value) => value.slice(0, 200)),
  }))
}
