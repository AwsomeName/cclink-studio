import { describe, expect, it, vi } from 'vitest'
import { AgentWebResourceLaunchCoordinator } from './agent-web-resource-launch-coordinator'

describe('AgentWebResourceLaunchCoordinator', () => {
  it('accepts only the trusted renderer acknowledgement for the requested visible tab', async () => {
    let listener: ((_event: unknown, value: unknown) => void) | undefined
    const send = vi.fn()
    const coordinator = new AgentWebResourceLaunchCoordinator(
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send },
      } as never,
      {
        isTrusted: () => true,
        assert: () => undefined,
        ipcRegistrations: {
          on: (_channel: string, registered: typeof listener) => {
            listener = registered
          },
        },
      } as never,
      500,
    )

    const pending = coordinator.requestLaunch(
      { kind: 'local', path: '/workspace/a' },
      {
        webResourceRef: { accountId: '4fa85f64-5717-4562-b3fc-2c963f66afa6' },
        title: 'Apple Developer',
        entryUrl: 'https://developer.apple.com/account',
        browserProfileId: 'web-account-a',
      },
    )
    const request = send.mock.calls[0]?.[1]
    expect(request).toMatchObject({ workspaceKey: '/workspace/a' })
    listener?.({}, { requestId: request.requestId, success: true, tabId: 'account-tab' })

    await expect(pending).resolves.toEqual({ tabId: 'account-tab' })
  })
})
