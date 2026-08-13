import { defineIpcCall } from './contract'

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
