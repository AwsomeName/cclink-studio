/**
 * 标签身份：让同类型的多个标签（几台远程电脑、几个网站）一眼分得开。
 *
 * 全部是纯函数，只读标签已有的名称、地址和账号名；不发网络请求，不读凭证。
 * 远程桌面的手动简称和颜色作为 Tab 字段由 tab-store 唯一持有并随工作空间恢复。
 */

export const TAB_IDENTITY_COLORS = [
  'teal',
  'orange',
  'purple',
  'blue',
  'pink',
  'green',
  'red',
  'slate',
] as const

export type TabIdentityColor = (typeof TAB_IDENTITY_COLORS)[number]

/** 白字在每个底色上 ≥ 4.5:1；亮度错开，色弱也能分。 */
export const TAB_IDENTITY_COLOR_VALUES: Record<TabIdentityColor, string> = {
  teal: '#23787a',
  orange: '#a85a22',
  purple: '#6f52b8',
  blue: '#2b68ad',
  pink: '#a3466f',
  green: '#357a41',
  red: '#a84141',
  slate: '#52606e',
}

export function isTabIdentityColor(value: unknown): value is TabIdentityColor {
  return typeof value === 'string' && (TAB_IDENTITY_COLORS as readonly string[]).includes(value)
}

/** FNV-1a：同一个键每次落在同一个颜色上。 */
export function identityColorFor(key: string): TabIdentityColor {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return TAB_IDENTITY_COLORS[(hash >>> 0) % TAB_IDENTITY_COLORS.length] ?? 'slate'
}

export function nextIdentityColor(color: TabIdentityColor): TabIdentityColor {
  const index = TAB_IDENTITY_COLORS.indexOf(color)
  return TAB_IDENTITY_COLORS[(index + 1) % TAB_IDENTITY_COLORS.length] ?? 'teal'
}

const CJK = /[㐀-鿿豈-﫿]/u
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const LATIN_WORD = /[A-Za-z0-9]+/g

/** 用户手动简称最多两个字符。 */
export const MAX_TAB_SHORT_NAME_LENGTH = 2

export function normalizeTabShortName(value: string): string {
  return Array.from(value.trim().replace(/\s+/g, '')).slice(0, MAX_TAB_SHORT_NAME_LENGTH).join('')
}

/**
 * 名称简称：中文取第一个汉字；英文取前两个词的首字母（单词含数字时保留型号，如 M1）。
 * 没有可用字符时返回空串。
 */
export function shortNameFromLabel(label: string): string {
  const text = label.trim()
  if (!text) return ''
  const first = Array.from(text).find((char) => LETTER_OR_DIGIT.test(char))
  if (!first) return ''
  if (CJK.test(first)) return first
  const words = text.match(LATIN_WORD) ?? []
  const head = words[0]
  if (!head) return first.toUpperCase()
  const second = words[1]
  if (/\d/.test(head) && head.length <= 3) return head.toUpperCase().slice(0, 2)
  if (second) return `${head.charAt(0)}${second.charAt(0)}`.toUpperCase()
  return `${head.charAt(0).toUpperCase()}${head.charAt(1).toLowerCase()}`
}

/** 网页字母块：一个字符。 */
function monogramFromText(text: string | null | undefined): string {
  const char = Array.from(text?.trim() ?? '').find(
    (item) => LETTER_OR_DIGIT.test(item) && !/\d/.test(item),
  )
  return char ? char.toUpperCase() : ''
}

function isAddressHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(':')
  )
}

export interface BrowserTabIdentityInput {
  url: string | null | undefined
  /** 网页标题。 */
  pageTitle?: string | null
  /** 已保存网站账号对应的网站名（Tab 标题）。 */
  siteName?: string | null
}

export interface TabMonogram {
  text: string
  color: TabIdentityColor
}

/** 网站没有自带图标时的字母块；空白页或非网页地址返回 null。 */
export function browserMonogram(input: BrowserTabIdentityInput): TabMonogram | null {
  let parsed: URL
  try {
    parsed = new URL(input.url ?? '')
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
    return null
  }
  const hostname = parsed.hostname.replace(/^www\./, '')
  const colorKey = parsed.protocol === 'file:' ? 'file:' : `${hostname}:${parsed.port}`
  let text = monogramFromText(input.siteName)
  if (!text && hostname && !isAddressHost(hostname)) {
    const labels = hostname.split('.')
    text = monogramFromText(labels.length >= 2 ? labels[labels.length - 2] : labels[0])
  }
  if (!text) text = monogramFromText(input.pageTitle)
  if (!text) return null
  return { text, color: identityColorFor(colorKey) }
}

export interface DesktopTabIdentityInput {
  tabId: string
  title: string
  target?: { deviceId?: string; host?: string; port?: number }
  override?: { shortName?: string; color?: TabIdentityColor }
}

/** 新建远程桌面标签的默认标题，不代表任何设备。 */
export const DEFAULT_DESKTOP_TAB_TITLE = '远程桌面'

/** 远程桌面简称和颜色；还没选设备、也没有地址时返回 null（显示空白显示器）。 */
export function desktopIdentity(input: DesktopTabIdentityInput): TabMonogram | null {
  const colorKey = input.target?.deviceId ?? input.target?.host ?? input.tabId
  const color = input.override?.color ?? identityColorFor(colorKey)
  const override = input.override?.shortName ? normalizeTabShortName(input.override.shortName) : ''
  if (override) return { text: override, color }
  const name = input.title.trim() === DEFAULT_DESKTOP_TAB_TITLE ? '' : input.title
  const fromName = shortNameFromLabel(name)
  if (fromName) return { text: fromName, color }
  const host = input.target?.host?.trim()
  if (host) {
    const lastSegment = host.split(/[.:]/).filter(Boolean).at(-1)
    if (lastSegment)
      return {
        text: /^\d+$/.test(lastSegment)
          ? `.${lastSegment}`.slice(0, 3)
          : shortNameFromLabel(lastSegment),
        color,
      }
  }
  return input.override?.color ? { text: '', color } : null
}
