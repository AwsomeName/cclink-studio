import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BIGMODEL_AUTH_COOKIE, type BrowserAuthRequest } from './browser-auth-contract'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/studio-auth-test', isPackaged: true },
}))
import { BrowserAuthProcessService } from './browser-auth-process-service'

function childProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    send: vi.fn(),
    connected: true,
  })
}

const request: BrowserAuthRequest = {
  requestId: 'auth-request-1',
  tabId: 'tab-a',
  profileId: 'profile-a',
  runtimeGeneration: 2,
  provider: 'bigmodel',
  url: 'https://bigmodel.cn/login',
}
const message = {
  ...request,
  type: 'browser-auth-complete',
  returnUrl: 'https://bigmodel.cn/console',
  cookies: [
    {
      name: BIGMODEL_AUTH_COOKIE,
      value: 'fixture-token',
      domain: '.bigmodel.cn',
      path: '/',
      secure: true,
      httpOnly: false,
      session: false,
      sameSite: 'no_restriction',
    },
  ],
}

function setup() {
  const child = childProcess()
  mocks.spawn.mockReturnValue(child)
  const manager = {
    isBrowserAuthCurrent: vi.fn(() => true),
    cancelBrowserAuth: vi.fn(),
    completeBrowserAuth: vi.fn().mockResolvedValue(undefined),
    focusTabOwner: vi.fn(() => true),
  }
  const service = new BrowserAuthProcessService(
    { isDestroyed: () => false } as never,
    manager as never,
  )
  return { child, manager, service }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('isolated browser auth process lifecycle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('launches without CDP arguments and acknowledges only the matching operation', async () => {
    const { child, manager, service } = setup()
    service.open(request)
    service.open(request)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(child.send).toHaveBeenCalledWith({
      type: 'browser-auth-focus',
      requestId: request.requestId,
    })
    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).toHaveLength(1)
    expect(args[0]).toMatch(/^--cclink-browser-auth=/)
    const options = JSON.parse(Buffer.from(args[0].split('=')[1], 'base64url').toString())
    expect(options).toMatchObject({
      ...request,
      userDataPath: '/tmp/studio-auth-test/Browser Auth/profile-a',
    })
    child.emit('message', message)
    await settle()
    expect(manager.completeBrowserAuth).toHaveBeenCalledWith(message)
    expect(child.send).toHaveBeenCalledWith({
      type: 'browser-auth-ack',
      requestId: request.requestId,
    })
    service.destroy()
  })

  it('rejects malformed, cross-profile and stale-runtime results before writing state', async () => {
    const { child, manager, service } = setup()
    service.open(request)
    for (const value of [
      null,
      { ...message, profileId: 'other' },
      { ...message, runtimeGeneration: 1 },
      { ...message, cookies: [{ ...message.cookies[0], domain: '.evil.example' }] },
    ])
      child.emit('message', value)
    await settle()
    expect(manager.completeBrowserAuth).not.toHaveBeenCalled()
    expect(child.send).not.toHaveBeenCalled()
    service.destroy()
  })

  it('closes a tab-owned child and ignores its late completion after another login starts', async () => {
    const { child, manager, service } = setup()
    service.open(request)
    service.cancelForTab(request.tabId)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(manager.cancelBrowserAuth).toHaveBeenCalledWith(request)
    const nextChild = childProcess()
    mocks.spawn.mockReturnValue(nextChild)
    service.open({
      ...request,
      requestId: 'auth-request-2',
      tabId: 'tab-b',
      profileId: 'profile-b',
    })
    child.emit('message', message)
    await settle()
    expect(manager.completeBrowserAuth).not.toHaveBeenCalled()
    expect(nextChild.kill).not.toHaveBeenCalled()
    service.destroy()
  })

  it('releases a cancelled or crashed request so the original tab can retry', async () => {
    const { child, manager, service } = setup()
    service.open(request)
    child.emit('message', { ...request, type: 'browser-auth-cancelled' })
    await settle()
    expect(manager.cancelBrowserAuth).toHaveBeenCalledWith(request)
    child.emit('exit', 0)
    service.open({ ...request, requestId: 'auth-retry' })
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    service.destroy()
  })
})
