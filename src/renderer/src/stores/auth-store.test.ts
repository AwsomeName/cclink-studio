import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from './auth-store'

beforeEach(() => {
  useAuthStore.setState({
    loggedIn: false,
    user: null,
    localIdentity: null,
    identityReady: false,
    checking: true,
    phoneInput: '',
    codeInput: '',
    codeCountdown: 0,
    loading: false,
    error: null,
  })
})

describe('useAuthStore', () => {
  describe('setLocalIdentity', () => {
    it('设置本机身份并标记初始化完成', () => {
      const identity = {
        localId: 'local_1',
        deviceId: 'device_1',
        deviceName: 'Mac',
        createdAt: 1,
        updatedAt: 1,
        boundCloudUserId: null,
      }

      useAuthStore.getState().setLocalIdentity(identity)

      expect(useAuthStore.getState().localIdentity).toEqual(identity)
      expect(useAuthStore.getState().identityReady).toBe(true)
    })
  })

  describe('setLoggedIn', () => {
    it('登录成功：设置用户并清理 checking/loading/error', () => {
      const user = {
        id: 'u1',
        nickname: 'Test',
        avatarUrl: '',
        phone: null,
        loginMethod: 'phone' as const,
        lastLoginAt: Date.now(),
      }
      useAuthStore.setState({ checking: true, loading: true, error: '旧错误' })
      useAuthStore.getState().setLoggedIn(true, user)

      const state = useAuthStore.getState()
      expect(state.loggedIn).toBe(true)
      expect(state.user).toEqual(user)
      expect(state.checking).toBe(false)
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('登出：清除用户', () => {
      useAuthStore.setState({
        loggedIn: true,
        user: { id: 'u1', nickname: 'T', avatarUrl: '', phone: null, loginMethod: 'phone', lastLoginAt: 0 },
      })
      useAuthStore.getState().setLoggedIn(false, null)

      const state = useAuthStore.getState()
      expect(state.loggedIn).toBe(false)
      expect(state.user).toBeNull()
      expect(state.checking).toBe(false)
    })
  })

  describe('setError', () => {
    it('设置错误并清除 loading', () => {
      useAuthStore.setState({ loading: true })
      useAuthStore.getState().setError('网络错误')

      const state = useAuthStore.getState()
      expect(state.error).toBe('网络错误')
      expect(state.loading).toBe(false)
    })
  })

  describe('resetForm', () => {
    it('清除所有表单字段', () => {
      useAuthStore.setState({
        phoneInput: '13800138000',
        codeInput: '123456',
        codeCountdown: 30,
        error: '验证码错误',
        loading: true,
      })
      useAuthStore.getState().resetForm()

      const state = useAuthStore.getState()
      expect(state.phoneInput).toBe('')
      expect(state.codeInput).toBe('')
      expect(state.codeCountdown).toBe(0)
      expect(state.error).toBeNull()
      expect(state.loading).toBe(false)
    })
  })
})
