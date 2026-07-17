import type {
  BrowserCookieDiagnosticEntry,
  BrowserSessionDiagnosticSummary,
} from '@shared/ipc/browser'
import type { ProjectOpsPlatform } from '@shared/ipc/project-ops'

const PLATFORM_AUTH_COOKIES: Record<string, string[]> = {
  zhihu: ['z_c0'],
  'wechat-mp': ['slave_sid', 'data_ticket', 'bizuin'],
  v2ex: ['A2'],
}

export interface ProjectOperationsLoginStatus {
  authenticated: boolean
  persistent: boolean
  profileId: string | null
  configuredProfileId: string
  profileMismatch: boolean
  session: BrowserSessionDiagnosticSummary
}

function authenticationCookies(
  platform: ProjectOpsPlatform,
  session: BrowserSessionDiagnosticSummary,
): BrowserCookieDiagnosticEntry[] {
  const exactNames = PLATFORM_AUTH_COOKIES[platform.id]
  if (exactNames) {
    const expected = new Set(exactNames.map((name) => name.toLowerCase()))
    return session.likelyAuthCookies.filter((cookie) => expected.has(cookie.name.toLowerCase()))
  }
  return session.likelyAuthCookies
}

export function isPlatformAuthenticated(
  platform: ProjectOpsPlatform,
  session: BrowserSessionDiagnosticSummary,
): boolean {
  return authenticationCookies(platform, session).some(
    (cookie) => typeof cookie.expiresAt !== 'number' || cookie.expiresAt > Date.now(),
  )
}

export function resolveProjectOperationsLoginStatus(
  platform: ProjectOpsPlatform,
  configuredSession: BrowserSessionDiagnosticSummary,
  defaultSession: BrowserSessionDiagnosticSummary,
): ProjectOperationsLoginStatus {
  const configuredProfileId = platform.browserProfile || platform.id
  const configuredAuthenticated = isPlatformAuthenticated(platform, configuredSession)
  const defaultAuthenticated = isPlatformAuthenticated(platform, defaultSession)
  const profileId = configuredAuthenticated
    ? configuredProfileId
    : defaultAuthenticated
      ? null
      : configuredProfileId
  const session = configuredAuthenticated
    ? configuredSession
    : defaultAuthenticated
      ? defaultSession
      : configuredSession
  const authCookies = authenticationCookies(platform, session)

  return {
    authenticated: configuredAuthenticated || defaultAuthenticated,
    persistent:
      (configuredAuthenticated || defaultAuthenticated) &&
      authCookies.some(
        (cookie) =>
          !cookie.session &&
          (typeof cookie.expiresAt !== 'number' || cookie.expiresAt > Date.now()),
      ),
    profileId,
    configuredProfileId,
    profileMismatch: defaultAuthenticated && !configuredAuthenticated,
    session,
  }
}

export function formatProjectOperationsLoginStatus(
  status: ProjectOperationsLoginStatus | undefined,
): string {
  if (!status) return '正在检查登录状态'
  const profileLabel = status.profileId ?? 'default'
  if (!status.authenticated) return `未登录 · ${profileLabel}`
  const authenticationLabel = status.persistent ? '已登录并已保存' : '已登录（仅当前会话）'
  if (status.profileMismatch) {
    return `${authenticationLabel} · ${profileLabel}（配置为 ${status.configuredProfileId}）`
  }
  return `${authenticationLabel} · ${profileLabel}`
}
