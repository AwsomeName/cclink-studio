import type { BrowserSessionDiagnosticSummary } from '@shared/ipc/browser'
import type { WebPrincipalKind } from '@shared/web-resources/web-resource-types'

export type WebResourceLoginStatus =
  | 'checking'
  | 'authenticated'
  | 'session-data'
  | 'not-authenticated'
  | 'error'

export interface WebResourceLoginObservation {
  status: WebResourceLoginStatus
  checkedAt: number
  summary?: BrowserSessionDiagnosticSummary
}

export const WEB_PRINCIPAL_KIND_LABELS: Record<WebPrincipalKind, string> = {
  personal: '个人',
  'sole-proprietor': '个体工商户',
  company: '公司',
  organization: '其他组织',
}

export function observeWebResourceLogin(
  summary: BrowserSessionDiagnosticSummary,
): WebResourceLoginObservation {
  const hasActiveAuthCookie = summary.likelyAuthCookies.some(
    (cookie) => typeof cookie.expiresAt !== 'number' || cookie.expiresAt > Date.now(),
  )
  return {
    status: hasActiveAuthCookie
      ? 'authenticated'
      : summary.cookieCount > 0
        ? 'session-data'
        : 'not-authenticated',
    checkedAt: Date.now(),
    summary,
  }
}

export function formatWebResourceLoginStatus(
  observation: WebResourceLoginObservation | undefined,
): string {
  switch (observation?.status) {
    case 'authenticated':
      return '检测到登录凭据'
    case 'session-data':
      return '有会话数据，需确认'
    case 'not-authenticated':
      return '待登录'
    case 'error':
      return '状态检查失败'
    default:
      return '检查中'
  }
}
