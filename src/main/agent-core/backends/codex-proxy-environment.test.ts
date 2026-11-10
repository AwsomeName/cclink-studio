import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexAppServer, codexEnvironment } from './codex-app-server'
import { McpToolHost } from '../tools/tool-host'

afterEach(() => vi.unstubAllEnvs())

it.each([
  [undefined, undefined],
  ['', ''],
  ['internal.example,localhost', 'other.example, internal.example'],
  ['*', undefined],
])('keeps loopback direct with NO_PROXY=%s and no_proxy=%s', (upper, lower) => {
  vi.stubEnv('NO_PROXY', upper)
  vi.stubEnv('no_proxy', lower)
  const proxyKeys = [
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]
  for (const key of proxyKeys) vi.stubEnv(key, 'http://proxy.example:7900')

  const env = codexEnvironment()
  const exclusions = env.NO_PROXY?.split(',')
  expect(exclusions).toEqual(expect.arrayContaining(['127.0.0.1', 'localhost', '::1']))
  for (const inherited of [upper, lower]) {
    for (const entry of inherited
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? [])
      expect(exclusions).toContain(entry)
  }
  expect(env.no_proxy).toBe(env.NO_PROXY)
  expect(new Set(exclusions).size).toBe(exclusions?.length)
  for (const key of proxyKeys) expect(env[key]).toBe('http://proxy.example:7900')
  expect(process.env.NO_PROXY).toBe(upper)
  expect(process.env.no_proxy).toBe(lower)
})

// Real app-server + ToolHost handshake, without a model turn or model quota use.
describe.skipIf(process.env.CCLINK_CODEX_REAL_SMOKE !== '1')('real Codex MCP routing', () => {
  it.each(['system', 'environment'] as const)(
    'initializes Studio tools with %s proxies without sending loopback through a proxy',
    async (mode) => {
      const cwd = await mkdtemp(join(tmpdir(), 'studio-codex-proxy-'))
      let proxyRequests = 0
      const proxy = createServer((_req, res) => {
        proxyRequests += 1
        res.writeHead(502)
        res.end()
      })
      const host = new McpToolHost({
        getMode: () => 'auto',
        needsConfirmation: () => false,
        requestConfirmation: async () => false,
      })
      host.registerModule({
        name: 'probe',
        tools: [
          {
            name: 'studio_proxy_probe',
            description: 'Local handshake regression fixture.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
        ],
        execute: async () => ({ ok: true }),
      })
      const server = new CodexAppServer(
        () => {},
        () => {},
      )
      let token: string | undefined
      try {
        await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
        const address = proxy.address()
        if (!address || typeof address === 'string') throw new Error('Missing proxy port')
        for (const key of [
          'HTTP_PROXY',
          'http_proxy',
          'HTTPS_PROXY',
          'https_proxy',
          'ALL_PROXY',
          'all_proxy',
        ])
          vi.stubEnv(key, mode === 'environment' ? `http://127.0.0.1:${address.port}` : undefined)
        vi.stubEnv('NO_PROXY', 'existing.example')
        vi.stubEnv('no_proxy', 'other.example')
        await host.start()
        await server.start(cwd)
        const loaded = await server.request<{
          config: { mcp_servers?: Record<string, Record<string, unknown>> }
        }>('config/read', { cwd, includeLayers: false })
        const disabled = Object.fromEntries(
          Object.entries(loaded.config.mcp_servers ?? {}).map(([name, value]) => [
            name,
            {
              ...(typeof value.url === 'string' ? { url: value.url } : { command: value.command }),
              enabled: false,
            },
          ]),
        )
        token = host.createToolSession({ conversationId: 'proxy-regression' })
        const response = await server.request<{ thread: { id: string } }>('thread/start', {
          cwd,
          ephemeral: true,
          approvalPolicy: 'untrusted',
          sandbox: 'read-only',
          config: {
            mcp_servers: {
              ...disabled,
              cclink_studio: {
                url: `http://127.0.0.1:${host.getPort()}/mcp?session=${token}`,
                enabled: true,
                required: true,
              },
            },
          },
        })
        const status = await server.request<{
          data: Array<{ name: string; tools: Record<string, unknown> }>
        }>('mcpServerStatus/list', {
          threadId: response.thread.id,
          limit: 100,
          detail: 'toolsAndAuthOnly',
        })
        expect(
          Object.keys(status.data.find((entry) => entry.name === 'cclink_studio')?.tools ?? {}),
        ).toContain('studio_proxy_probe')
        expect(proxyRequests).toBe(0)
      } finally {
        await server.stop()
        if (token) await host.cancelToolSession(token)
        await host.stop()
        proxy.closeAllConnections()
        await new Promise<void>((resolve) => proxy.close(() => resolve()))
        await rm(cwd, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
