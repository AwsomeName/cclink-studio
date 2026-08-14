import { hostname, platform, release } from 'node:os'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CclinkIdentity } from '../../shared/cclink'
import type { CclinkUserProfile } from '../../shared/ipc/auth'
import { callCclinkCloud, decodeUserSigUserId, isTerminalAuthError } from './cloud-function-client'
import { CclinkSessionStore } from './session-store'

interface DesktopAuthData {
  session?: {
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    expiresAt?: string | null
  }
  user?: Record<string, unknown>
  im?: { sdkAppId?: number; userId?: string; userSig?: string }
}

interface DeviceIdentity {
  id: string
  name: string
}

export interface SessionRestoreResult {
  loggedIn: boolean
  user: CclinkUserProfile | null
  offline?: boolean
}

export class CclinkAuthService {
  private readonly sessionStore: CclinkSessionStore
  private readonly userFilePath: string
  private readonly deviceFilePath: string
  private refreshToken: string | null = null
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0
  private user: CclinkUserProfile | null = null
  private identity: CclinkIdentity | null = null
  private inFlightRefresh: Promise<DesktopAuthData> | null = null

  constructor(
    private readonly baseUrl: string | null,
    private readonly userDataPath: string,
  ) {
    this.sessionStore = new CclinkSessionStore(userDataPath)
    this.userFilePath = join(userDataPath, 'cclink-user.json')
    this.deviceFilePath = join(userDataPath, 'cclink-device.json')
  }

  initialize(): void {
    this.refreshToken = this.sessionStore.load()?.refreshToken ?? null
    this.removePersistedUserProfile()
    this.user = null
    this.accessToken = null
    this.accessTokenExpiresAt = 0
    this.identity = null
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl)
  }
  getUser(): CclinkUserProfile | null {
    return this.user
  }
  getIdentity(): CclinkIdentity | null {
    return this.identity
  }

  async sendSmsCode(phone: string): Promise<{ success: boolean; error?: string }> {
    try {
      await callCclinkCloud(this.baseUrl, 'desktopSendSmsCode', { phone })
      return { success: true }
    } catch (error) {
      return { success: false, error: describeError(error) }
    }
  }

  async login(phone: string, code: string): Promise<CclinkUserProfile> {
    const device = this.getOrCreateDevice()
    const data = await callCclinkCloud<DesktopAuthData>(this.baseUrl, 'desktopLoginByPhone', {
      phone,
      code,
      device_id: device.id,
      device_name: device.name,
      platform: 'desktop',
    })
    this.acceptDesktopAuth(data, device, phone)
    return this.user!
  }

  async restoreSession(): Promise<SessionRestoreResult> {
    if (!this.refreshToken) return { loggedIn: false, user: null }
    try {
      await this.refreshDesktopAuth()
      return { loggedIn: true, user: this.user }
    } catch (error) {
      if (isTerminalAuthError(error)) {
        this.logout()
        return { loggedIn: false, user: null }
      }
      return { loggedIn: false, user: null, offline: true }
    }
  }

  async ensureIdentity(): Promise<CclinkIdentity> {
    if (this.identity && this.accessToken && Date.now() < this.accessTokenExpiresAt)
      return this.identity
    await this.refreshDesktopAuth()
    if (!this.identity) throw new Error('CCLink 云服务未返回远程身份')
    return this.identity
  }

  logout(): void {
    this.sessionStore.clear()
    this.refreshToken = null
    this.accessToken = null
    this.accessTokenExpiresAt = 0
    this.identity = null
    this.user = null
    try {
      if (existsSync(this.userFilePath)) unlinkSync(this.userFilePath)
    } catch {
      // 本地 token 已清除；资料文件清理失败不恢复登录态。
    }
  }

  private async refreshDesktopAuth(): Promise<DesktopAuthData> {
    if (this.inFlightRefresh) return this.inFlightRefresh
    const refreshToken = this.refreshToken
    if (!refreshToken) throw new Error('请先登录 CCLink')
    const device = this.getOrCreateDevice()
    const request = callCclinkCloud<DesktopAuthData>(this.baseUrl, 'desktopRefresh', {
      refreshToken,
      device_id: device.id,
      device_name: device.name,
      platform: 'desktop',
      os: `${platform()} ${release()}`,
    }).then((data) => {
      if (this.refreshToken !== refreshToken) throw new Error('登录状态已变化')
      this.acceptDesktopAuth(data, device)
      return data
    })
    this.inFlightRefresh = request
    try {
      return await request
    } finally {
      if (this.inFlightRefresh === request) this.inFlightRefresh = null
    }
  }

  private acceptDesktopAuth(
    data: DesktopAuthData,
    device: DeviceIdentity,
    fallbackPhone?: string,
  ): void {
    const accessToken = text(data.session?.accessToken)
    const refreshToken = text(data.session?.refreshToken)
    const expiresIn = Number(data.session?.expiresIn ?? expiresInFrom(data.session?.expiresAt))
    if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('CCLink 云服务未返回完整 Session')
    }
    const user = normalizeUser(data.user, fallbackPhone, this.user)
    const imUserId = text(data.user?.imUserId ?? data.user?.im_user_id)
    const clientImUserId = text(
      data.im?.userId ?? data.user?.clientImUserId ?? data.user?.client_im_user_id,
    )
    const imUserSig = text(data.im?.userSig)
    const sdkAppId = Number(data.im?.sdkAppId ?? data.user?.sdkAppId ?? data.user?.sdk_app_id ?? 0)
    if (
      !user.id ||
      !imUserId ||
      !clientImUserId ||
      !imUserSig ||
      !sdkAppId ||
      user.id !== imUserId
    ) {
      throw new Error('CCLink 云服务未返回一致的设备 IM 身份')
    }
    const signedUserId = decodeUserSigUserId(imUserSig)
    if (signedUserId && signedUserId !== clientImUserId)
      throw new Error('CCLink UserSig 身份不匹配')
    const expiresAt = Date.now() + expiresIn * 1000
    this.sessionStore.save(refreshToken, expiresAt)
    this.user = user
    this.refreshToken = refreshToken
    this.accessToken = accessToken
    this.accessTokenExpiresAt = expiresAt
    this.identity = {
      accountUserId: user.id,
      imUserId,
      clientImUserId,
      imUserSig,
      authToken: accessToken,
      sdkAppId,
      deviceId: device.id,
      deviceName: device.name,
      expiresAt: data.session?.expiresAt,
      updatedAt: Date.now(),
    }
  }

  private removePersistedUserProfile(): void {
    if (!existsSync(this.userFilePath)) return
    try {
      unlinkSync(this.userFilePath)
    } catch {
      // 删除失败也不读取、不迁移，更不能据此恢复登录结论。
    }
  }

  private getOrCreateDevice(): DeviceIdentity {
    const existing = readJsonFile<DeviceIdentity>(this.deviceFilePath)
    if (existing?.id && existing.name) return existing
    const device = { id: `studio-${randomUUID()}`, name: hostname() || 'CCLink Studio' }
    mkdirSync(this.userDataPath, { recursive: true })
    writeFileSync(this.deviceFilePath, `${JSON.stringify(device, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    ensurePrivate(this.deviceFilePath)
    return device
  }
}

function normalizeUser(
  source: Record<string, unknown> | undefined,
  fallbackPhone: string | undefined,
  cached: CclinkUserProfile | null,
): CclinkUserProfile {
  const src = source ?? {}
  const phone = text(src.phone ?? src.mobile ?? fallbackPhone) || cached?.phone || null
  return {
    id: text(src.id ?? src.userId ?? src.user_id) || cached?.id || (phone ? `phone:${phone}` : ''),
    nickname: text(src.nickname ?? src.name) || cached?.nickname || '',
    avatarUrl: text(src.avatarUrl ?? src.avatar_url) || cached?.avatarUrl || '',
    phone,
    loginMethod: 'phone',
    lastLoginAt: Date.now(),
  }
}

function readJsonFile<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    const value = JSON.parse(readFileSync(path, 'utf8')) as T
    ensurePrivate(path)
    return value
  } catch {
    return null
  }
}

function ensurePrivate(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}
function expiresInFrom(value?: string | null): number {
  const time = value ? new Date(value).getTime() : NaN
  return Number.isFinite(time) ? Math.max(1, Math.floor((time - Date.now()) / 1000)) : 86400 * 90
}
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'CCLink 服务请求失败'
}
