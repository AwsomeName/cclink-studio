export const DEFAULT_CCLINK_API_URL =
  'https://chatcc-d9g0e2ty627b950ad.service.tcloudbase.com/index'

export const CCLINK_UNCONFIGURED_MESSAGE =
  '当前 Studio 未配置 CCLink 托管远程服务；本地功能不受影响。'

export function normalizeCclinkServiceUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === 'off' || trimmed === 'disabled') return null
  const normalized = trimmed.replace(/\/+$/u, '')
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null
    if (
      url.hostname.endsWith('.service.tcloudbase.com') &&
      (url.pathname === '' || url.pathname === '/')
    ) {
      url.pathname = '/index'
    }
    return url.toString().replace(/\/+$/u, '')
  } catch {
    return null
  }
}

export function getCclinkServiceUrl(): string | null {
  if (process.env['CCLINK_API_URL'] !== undefined) {
    return normalizeCclinkServiceUrl(process.env['CCLINK_API_URL'])
  }
  return DEFAULT_CCLINK_API_URL
}
