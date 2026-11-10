import { spawnClaudeProcess } from './claude-process-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  buildClaudeProcessEnvironment,
  prepareClaudeConfigDirectory,
  withClaudeProbeEnvironment,
} from './claude-process-environment'

const directories: string[] = []
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'studio-auth-isolation-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Claude subprocess credential isolation', () => {
  it('removes all inherited auth and routing channels without modifying the parent', () => {
    const inheritedEnv = {
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://localhost:1234',
      ANTHROPIC_API_KEY: 'outside-key',
      ANTHROPIC_AUTH_TOKEN: 'outside-token',
      ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer outside-token',
      CLAUDE_CONFIG_DIR: '/outside',
      CLAUDE_CODE_OAUTH_TOKEN: 'subscription',
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '9',
      CLAUDE_CODE_HOST_CREDS_FILE: '/secret',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'outside-session',
    }
    const original = { ...inheritedEnv }
    const env = buildClaudeProcessEnvironment({
      configDir: '/studio',
      apiKey: 'studio-key',
      inheritedEnv,
    })
    expect(env.ANTHROPIC_API_KEY).toBe('studio-key')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/studio')
    expect(env.HTTPS_PROXY).toBe(inheritedEnv.HTTPS_PROXY)
    for (const key of Object.keys(inheritedEnv).filter((key) =>
      /TOKEN|HEADERS|DESCRIPTOR|CREDS|BEDROCK/.test(key),
    ))
      expect(env[key]).toBeUndefined()
    expect(inheritedEnv).toEqual(original)
  })

  it('refuses a linked config directory instead of writing into an external login', async () => {
    const root = await directory()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, '.credentials.json'), 'external sentinel')
    const linked = join(root, 'linked')
    await symlink(outside, linked)
    await expect(prepareClaudeConfigDirectory(linked)).rejects.toThrow('拒绝回退')
    expect(await readFile(join(outside, '.credentials.json'), 'utf8')).toBe('external sentinel')
  })

  it('uses and removes a private directory for version probes', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/outside')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'subscription')
    const path = await withClaudeProbeEnvironment(async (env) => {
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBe('')
      return env.CLAUDE_CONFIG_DIR!
    })
    await expect(readFile(join(path, 'settings.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(process.env.CLAUDE_CONFIG_DIR).toBe('/outside')
  })

  it.skipIf(process.platform !== 'darwin')(
    'OS protection denies external login reads and writes while normal files work',
    async () => {
      const root = await directory()
      const external = join(root, '.claude')
      await mkdir(external)
      const credential = join(external, '.credentials.json')
      await writeFile(credential, 'external sentinel')
      const configDir = join(root, 'studio')
      await prepareClaudeConfigDirectory(configDir)
      const child = spawnClaudeProcess({
        command: process.execPath,
        args: [
          '-e',
          `const fs = require('node:fs');
        let blocked = 0;
        try { fs.readFileSync(process.argv[1]) } catch { blocked++ }
        try { fs.writeFileSync(process.argv[1], 'overwritten') } catch { blocked++ }
        fs.writeFileSync(process.argv[2], 'normal file');
        process.stdout.write(String(blocked));`,
          credential,
          join(root, 'normal.txt'),
        ],
        env: buildClaudeProcessEnvironment({ configDir, inheritedEnv: { HOME: root } }),
        signal: new AbortController().signal,
      })
      let stdout = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      const exit = await new Promise((resolve, reject) => {
        child.on('exit', resolve)
        child.on('error', reject)
      })
      expect(exit).toBe(0)
      expect(stdout).toBe('2')
      expect(await readFile(credential, 'utf8')).toBe('external sentinel')
      expect(await readFile(join(root, 'normal.txt'), 'utf8')).toBe('normal file')
    },
  )

  it.skipIf(process.env.CCLINK_CLAUDE_AUTH_REAL_SMOKE !== '1')(
    'real Claude sends only the Studio key and never falls back after 401',
    async () => {
      const root = await directory()
      const foreignHome = join(root, 'foreign-home')
      const foreignConfig = join(foreignHome, '.claude')
      const configDir = join(root, 'studio')
      const workspace = join(root, 'workspace')
      const bin = join(root, 'bin')
      await Promise.all(
        [foreignConfig, configDir, workspace, bin].map((path) => mkdir(path, { recursive: true })),
      )
      const foreignCredentials = JSON.stringify({
        claudeAiOauth: {
          accessToken: 'foreign-oauth',
          refreshToken: 'foreign-refresh',
          expiresAt: Date.now() + 3600000,
          scopes: ['user:inference'],
        },
      })
      await writeFile(join(foreignConfig, '.credentials.json'), foreignCredentials)
      await writeFile(
        join(foreignConfig, 'settings.json'),
        JSON.stringify({ env: { ANTHROPIC_API_KEY: 'foreign-settings-key' } }),
      )
      await mkdir(join(workspace, '.claude'))
      await writeFile(
        join(workspace, '.claude/settings.json'),
        JSON.stringify({
          env: { ANTHROPIC_API_KEY: 'project-key', CLAUDE_CODE_OAUTH_TOKEN: 'project-oauth' },
        }),
      )
      // A tripwire, never the system credential utility. Only this fake home is used.
      const keychainTripwire = join(root, 'keychain-attempt')
      await writeFile(
        join(bin, 'security'),
        `#!/bin/sh\necho attempted >> '${keychainTripwire}'\nexit 1\n`,
        { mode: 0o755 },
      )
      await prepareClaudeConfigDirectory(configDir)
      const requests: Array<{ key: unknown; authorization: unknown }> = []
      const server = createServer((req, res) => {
        req.resume()
        if (!req.url?.startsWith('/v1/messages')) {
          res.writeHead(404).end()
          return
        }
        requests.push({ key: req.headers['x-api-key'], authorization: req.headers.authorization })
        if (req.headers['x-api-key'] === 'invalid-studio-key') {
          res.writeHead(401, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              type: 'error',
              error: { type: 'authentication_error', message: 'Invalid API key' },
            }),
          )
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const event = (type: string, data: object) =>
          res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
        event('message_start', {
          message: {
            id: 'msg_smoke',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        })
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        event('content_block_delta', {
          index: 0,
          delta: { type: 'text_delta', text: 'STUDIO_AUTH_OK' },
        })
        event('content_block_stop', { index: 0 })
        event('message_delta', {
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        })
        event('message_stop', {})
        res.end()
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address() as { port: number }
      try {
        for (const apiKey of ['studio-smoke-key', 'invalid-studio-key']) {
          const env = buildClaudeProcessEnvironment({
            configDir,
            apiKey,
            apiBaseUrl: `http://127.0.0.1:${address.port}`,
            inheritedEnv: {
              PATH: `${bin}:${process.env.PATH}`,
              HOME: foreignHome,
              TMPDIR: root,
              CLAUDE_CONFIG_DIR: foreignConfig,
              CLAUDE_CODE_OAUTH_TOKEN: 'foreign-oauth',
            },
          })
          const abortController = new AbortController()
          const timer = setTimeout(() => abortController.abort(), 20000)
          const stream = query({
            prompt: 'Reply STUDIO_AUTH_OK',
            options: {
              pathToClaudeCodeExecutable: join(
                process.cwd(),
                '.agent-runtime-staging',
                `darwin-${process.arch}`,
                'claude',
              ),
              cwd: workspace,
              env,
              settingSources: [],
              spawnClaudeCodeProcess: spawnClaudeProcess,
              tools: [],
              maxTurns: 1,
              model: 'claude-sonnet-4-6',
              abortController,
            },
          })
          let result: { is_error: boolean } | undefined
          try {
            try {
              for await (const event of stream) if (event.type === 'result') result = event
              expect(result?.is_error).toBe(apiKey === 'invalid-studio-key')
            } catch (error) {
              if (apiKey !== 'invalid-studio-key') throw error
              expect(String(error)).toContain('401')
            }
          } finally {
            clearTimeout(timer)
            stream.close()
          }
        }
        expect(requests.length).toBeGreaterThanOrEqual(2)
        expect(requests.some((request) => request.key === 'studio-smoke-key')).toBe(true)
        expect(requests.some((request) => request.key === 'invalid-studio-key')).toBe(true)
        for (const request of requests) {
          expect(['studio-smoke-key', 'invalid-studio-key']).toContain(request.key)
          expect(request.authorization).toBeUndefined()
        }
        expect(await readFile(join(foreignConfig, '.credentials.json'), 'utf8')).toBe(
          foreignCredentials,
        )
        await expect(readFile(keychainTripwire)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
    50000,
  )
})
