import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserHttpAuthCredentialId } from './browser-http-auth-credentials'
import type { BrowserHttpAuthRequest } from '../../shared/ipc/browser-http-auth'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('electron', () => ({ app: { isPackaged: true } }))
import { BrowserAuthProcessService } from './browser-auth-process-service'

const origin = 'http://example.test:7500'
const request: BrowserHttpAuthRequest = {
  requestId: 'r1',
  tabId: 'tab1',
  runtimeGeneration: 1,
  url: `${origin}/`,
  origin,
  realm: 'Restricted',
  transport: 'insecure-http',
  credentialId: browserHttpAuthCredentialId('profile-a', origin, 'Restricted'),
}
const submitted = {
  type: 'browser-http-auth-submitted',
  requestId: 'r1',
  tabId: 'tab1',
  runtimeGeneration: 1,
  username: 'user',
  password: ' password with spaces ',
  remember: true,
  allowInsecure: true,
  allowInsecureAutoLogin: true,
}
const cleanups: (() => void)[] = []
beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

function setup(saved?: Record<string, string>) {
  const children: ReturnType<typeof makeChild>[] = []
  const makeChild = () =>
    Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      send: vi.fn(),
    })
  mocks.spawn.mockImplementation(() => {
    const child = makeChild()
    children.push(child)
    return child
  })
  const manager = {
    isBrowserHttpAuthCurrent: vi.fn(() => true),
    recordHttpAuthOutcome: vi.fn(),
    focusTabOwner: vi.fn(() => true),
  }
  const credentials = {
    getStatus: vi.fn(() => ({ status: 'ready' })),
    resolveCredential: vi.fn(() => saved ?? null),
    setCredential: vi.fn().mockResolvedValue({ status: 'ready' }),
  }
  const service = new BrowserAuthProcessService(
    { isDestroyed: () => true } as never,
    manager as never,
    credentials as never,
  )
  cleanups.push(() => {
    service.destroy()
    children.forEach((child) => child.emit('exit'))
  })
  return { service, manager, credentials, children }
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('remembered HTTP Basic credentials', () => {
  it('isolates profiles, schemes, ports and exact realms including display collisions', () => {
    const id = browserHttpAuthCredentialId('profile-a', origin, 'Restricted')
    for (const [profile, host, realm] of [
      ['profile-b', origin, 'Restricted'],
      ['profile-a', 'https://example.test:7500', 'Restricted'],
      ['profile-a', 'http://example.test:7501', 'Restricted'],
      ['profile-a', origin, ' Restricted '],
      ['profile-a', origin, 'Restricted\n'],
    ])
      expect(browserHttpAuthCredentialId(profile, host, realm)).not.toBe(id)
  })

  it('restores in main without spawning a window or putting credentials in diagnostics', () => {
    const { service, manager } = setup({
      origin,
      username: 'user',
      password: 'secret',
      allowInsecureAutoLogin: 'true',
    })
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    expect(callback).toHaveBeenCalledWith('user', 'secret')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(JSON.stringify(manager.recordHttpAuthOutcome.mock.calls)).not.toContain('secret')
  })

  it('requires explicit persistent HTTP consent, even if a password exists', () => {
    const { service, children } = setup({
      origin,
      username: 'user',
      password: 'secret',
      allowInsecureAutoLogin: 'false',
    })
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    expect(callback).not.toHaveBeenCalled()
    expect(children).toHaveLength(1)
    expect(JSON.stringify(mocks.spawn.mock.calls)).not.toContain('secret')
  })

  it('saves exact credentials before acknowledging and only for the main-owned identity', async () => {
    const { service, credentials, children } = setup()
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    children[0].emit('message', { ...submitted, credentialId: 'attacker-selected' })
    await settle()
    expect(credentials.setCredential).toHaveBeenCalledWith({
      id: request.credentialId,
      kind: 'basic',
      fields: {
        username: submitted.username,
        password: submitted.password,
        origin,
        allowInsecureAutoLogin: 'true',
      },
    })
    expect(callback).toHaveBeenCalledWith(submitted.username, submitted.password)
    expect(children[0].send).toHaveBeenCalledWith({
      type: 'browser-http-auth-ack',
      requestId: 'r1',
    })
  })

  it('does not save or forward stale, wrong-child, or unconfirmed submissions', async () => {
    const { service, credentials, children, manager } = setup()
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    for (const message of [
      { ...submitted, requestId: 'other' },
      { ...submitted, runtimeGeneration: 2 },
      { ...submitted, allowInsecureAutoLogin: false },
      { ...submitted, allowInsecure: false },
    ])
      children[0].emit('message', message)
    await settle()
    expect(credentials.setCredential).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    manager.isBrowserHttpAuthCurrent.mockReturnValue(false)
    children[0].emit('message', submitted)
    await settle()
    expect(credentials.setCredential).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(undefined, undefined)
  })

  it('leaves the dialog usable after save failure and permits one-time login', async () => {
    const { service, credentials, children } = setup()
    credentials.setCredential.mockRejectedValue(new Error('private storage detail'))
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    children[0].emit('message', submitted)
    await settle()
    expect(callback).not.toHaveBeenCalled()
    expect(children[0].send).toHaveBeenCalledWith({
      type: 'browser-http-auth-ack',
      requestId: 'r1',
      error: 'credential-save-failed',
    })
    children[0].emit('message', { ...submitted, remember: false })
    await settle()
    expect(callback).toHaveBeenCalledWith(submitted.username, submitted.password)
  })

  it('only attempts a saved credential once before returning to manual input', async () => {
    const { service, children, credentials } = setup({
      origin,
      username: 'user',
      password: 'old',
      allowInsecureAutoLogin: 'true',
    })
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    service.openHttpBasic({ ...request, requestId: 'r2' }, callback)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(credentials.resolveCredential).toHaveBeenCalledTimes(1)
    expect(children).toHaveLength(1)
    const options = JSON.parse(
      Buffer.from(mocks.spawn.mock.calls[0][1][0].split('=')[1], 'base64url').toString(),
    )
    expect(options.attempt).toBe(2)
    children[0].emit('message', {
      type: 'browser-http-auth-cancelled',
      requestId: 'r2',
      tabId: 'tab1',
      runtimeGeneration: 1,
    })
    await settle()
    expect(callback).toHaveBeenLastCalledWith(undefined, undefined)
  })

  it('ignores late completion after the tab closes during a disk write', async () => {
    const { service, children, credentials } = setup()
    let finish!: () => void
    credentials.setCredential.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    children[0].emit('message', submitted)
    service.cancelForTab('tab1')
    finish()
    await settle()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(undefined, undefined)
  })

  it('does not cancel a newer dialog when an old disk write completes late', async () => {
    const { service, children, credentials } = setup()
    let finish!: () => void
    credentials.setCredential.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const first = vi.fn()
    const second = vi.fn()
    service.openHttpBasic(request, first)
    children[0].emit('message', submitted)
    service.openHttpBasic({ ...request, requestId: 'r2' }, second)
    finish()
    await settle()
    expect(first).toHaveBeenCalledExactlyOnceWith(undefined, undefined)
    expect(second).not.toHaveBeenCalled()
    expect(children[1].kill).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer dialog diagnostic when an old save fails', async () => {
    const { service, children, credentials, manager } = setup()
    let fail!: (error: Error) => void
    credentials.setCredential.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    service.openHttpBasic(request, vi.fn())
    children[0].emit('message', submitted)
    service.openHttpBasic({ ...request, requestId: 'r2' }, vi.fn())
    manager.recordHttpAuthOutcome.mockClear()
    fail(new Error('old write failed'))
    await settle()
    expect(manager.recordHttpAuthOutcome).not.toHaveBeenCalled()
  })

  it('honors cancellation while saving and never forwards credentials afterwards', async () => {
    const { service, children, credentials } = setup()
    let finish!: () => void
    credentials.setCredential.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const callback = vi.fn()
    service.openHttpBasic(request, callback)
    children[0].emit('message', submitted)
    children[0].emit('message', {
      type: 'browser-http-auth-cancelled',
      requestId: 'r1',
      tabId: 'tab1',
      runtimeGeneration: 1,
    })
    await settle()
    expect(callback).toHaveBeenCalledExactlyOnceWith(undefined, undefined)
    finish()
    await settle()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('counts attempts by exact protection space instead of the display realm', async () => {
    const { service, children } = setup()
    service.openHttpBasic(request, vi.fn())
    children[0].emit('message', { ...submitted, remember: false })
    await settle()
    service.openHttpBasic(
      {
        ...request,
        requestId: 'r2',
        credentialId: browserHttpAuthCredentialId('profile-a', origin, ' Restricted '),
      },
      vi.fn(),
    )
    const options = JSON.parse(
      Buffer.from(mocks.spawn.mock.calls[1][1][0].split('=')[1], 'base64url').toString(),
    )
    expect(options.attempt).toBe(1)
  })
})
