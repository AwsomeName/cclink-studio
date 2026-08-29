import { defineIpcCall } from './contract'
import { isBoundedIpcEventPayload, isBoundedIpcEventString } from './event-payload'

export interface CclinkUserProfile {
  id: string
  nickname: string
  avatarUrl: string
  phone: string | null
  loginMethod: 'phone'
  lastLoginAt: number
}

export interface AuthSession {
  loggedIn: boolean
  user: CclinkUserProfile | null
  offline?: boolean
}

export interface AuthServiceStatus {
  configured: boolean
  message?: string
}

export interface AuthResult {
  success: boolean
  user?: CclinkUserProfile
  error?: string
}

export interface AuthApiContract {
  getServiceStatus(): Promise<AuthServiceStatus>
  phoneSendCode(phone: string): Promise<{ success: boolean; error?: string }>
  phoneLogin(phone: string, code: string): Promise<AuthResult>
  checkSession(): Promise<AuthSession>
  logout(): Promise<void>
  onSessionChanged(callback: (session: AuthSession) => void): () => void
}

export const authIpc = {
  getServiceStatus: defineIpcCall<[], AuthServiceStatus>('auth:getServiceStatus'),
  phoneSendCode: defineIpcCall<[phone: string], { success: boolean; error?: string }>(
    'auth:phoneSendCode',
  ),
  phoneLogin: defineIpcCall<[phone: string, code: string], AuthResult>('auth:phoneLogin'),
  checkSession: defineIpcCall<[], AuthSession>('auth:checkSession'),
  logout: defineIpcCall<[], void>('auth:logout'),
} as const

export const authIpcEvents = {
  sessionChanged: 'auth:sessionChanged',
} as const

export function parseAuthSessionEvent(value: unknown): AuthSession | null {
  if (!isBoundedIpcEventPayload(value) || !value || typeof value !== 'object') return null
  const session = value as Partial<AuthSession>
  if (typeof session.loggedIn !== 'boolean') return null
  if (session.offline !== undefined && typeof session.offline !== 'boolean') return null
  if (session.user === null) return session as AuthSession
  if (!session.user || typeof session.user !== 'object') return null
  const user = session.user as Partial<CclinkUserProfile>
  if (
    !isBoundedIpcEventString(user.id, 256) ||
    !isBoundedIpcEventString(user.nickname, 512, { allowEmpty: true }) ||
    !isBoundedIpcEventString(user.avatarUrl, 32_768, { allowEmpty: true }) ||
    (user.phone !== null && !isBoundedIpcEventString(user.phone, 64, { allowEmpty: true })) ||
    user.loginMethod !== 'phone' ||
    typeof user.lastLoginAt !== 'number' ||
    !Number.isFinite(user.lastLoginAt)
  ) {
    return null
  }
  return session as AuthSession
}
