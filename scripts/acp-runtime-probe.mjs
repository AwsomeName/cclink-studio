#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const DEFAULT_EXPECTED_VERSION = '1.3.0'
const PROTOCOL_VERSION = 1
const LIVE_MARKER = 'CCLINK_ACP_RUNTIME_SMOKE_OK'

function usage() {
  console.log(`Usage: pnpm smoke:acp-runtime -- [options]

Options:
  --executable <path>        codex-acp executable (default: node_modules/.bin/codex-acp)
  --expected-version <ver>  Exact supported adapter version (default: ${DEFAULT_EXPECTED_VERSION})
  --live                    Run authenticated prompt/cancel/permission/resume checks
  --help                    Show this help

Live environment:
  CCLINK_ACP_SMOKE_API_KEY  Dedicated OpenAI API key; ordinary OPENAI/CODEX variables are ignored

Without --live the probe performs version, stdio, initialize, capability, auth-method and
credential-isolation checks without making a model request.
`)
}

function parseArgs(argv) {
  const options = {
    executable: join(projectRoot, 'node_modules', '.bin', 'codex-acp'),
    expectedVersion: DEFAULT_EXPECTED_VERSION,
    live: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help') {
      usage()
      process.exit(0)
    }
    if (arg === '--live') {
      options.live = true
      continue
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`${arg} 缺少参数值`)
    if (arg === '--executable') options.executable = value
    else if (arg === '--expected-version') options.expectedVersion = value.trim()
    else throw new Error(`未知参数: ${arg}`)
    index += 1
  }

  options.executable = resolve(projectRoot, options.executable)
  if (!isAbsolute(options.executable)) throw new Error('--executable 必须解析为绝对路径')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.expectedVersion)) {
    throw new Error('--expected-version 不是合法 semver')
  }
  return options
}

function sanitizedEnvironment(codexHome, apiKey) {
  const environment = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: codexHome,
    CODEX_HOME: codexHome,
    NO_BROWSER: '1',
    INITIAL_AGENT_MODE: 'agent',
    DISABLE_UPDATES: '1',
  }
  for (const key of ['LANG', 'LC_ALL', 'TERM', 'TMPDIR']) {
    if (process.env[key]) environment[key] = process.env[key]
  }
  if (apiKey) environment.CODEX_API_KEY = apiKey
  return environment
}

function withTimeout(promise, timeoutMs, label) {
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timeout))
}

class JsonRpcPeer {
  constructor(child) {
    this.child = child
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.sessionUpdates = []
    this.permissionRequests = []
    this.stderr = ''
    this.closed = false

    child.stdout.on('data', (chunk) => this.onData(chunk.toString()))
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4096)
    })
    child.once('exit', (code, signal) => {
      this.closed = true
      const error = new Error(`codex-acp 提前退出（code=${code}, signal=${signal ?? 'none'}）`)
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
    child.once('error', (error) => {
      this.closed = true
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
  }

  onData(chunk) {
    this.buffer += chunk
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.failAll(new Error('codex-acp stdout 包含非法 JSON'))
        continue
      }
      this.onMessage(message)
    }
  }

  onMessage(message) {
    if (!message || typeof message !== 'object') return
    if ('method' in message) {
      if (message.method === 'session/update') {
        this.sessionUpdates.push(message.params)
        return
      }
      if ('id' in message) {
        void this.respondToAgentRequest(message)
      }
      return
    }
    if (!('id' in message)) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) {
      const detail = message.error.message ?? JSON.stringify(message.error)
      pending.reject(new Error(detail))
    } else {
      pending.resolve(message.result)
    }
  }

  async respondToAgentRequest(message) {
    if (message.method !== 'session/request_permission') {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Probe 不支持客户端方法 ${message.method}` },
      })
      return
    }

    const options = Array.isArray(message.params?.options) ? message.params.options : []
    const reject = options.find(
      (option) => option?.kind === 'reject_once' || option?.optionId === 'reject_once',
    )
    this.permissionRequests.push({
      sessionId: message.params?.sessionId ?? null,
      optionIds: options.map((option) => option?.optionId).filter(Boolean),
    })
    this.write({
      jsonrpc: '2.0',
      id: message.id,
      result: reject
        ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
        : { outcome: { outcome: 'cancelled' } },
    })
  }

  request(method, params, timeoutMs = 15_000) {
    if (this.closed) return Promise.reject(new Error('codex-acp 连接已关闭'))
    const id = this.nextId++
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.write({ jsonrpc: '2.0', id, method, params })
    return withTimeout(response, timeoutMs, method)
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, params })
  }

  write(message) {
    if (this.closed || !this.child.stdin.writable) return
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  async close() {
    if (this.closed) return
    this.child.stdin.end()
    await new Promise((resolveClose) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolveClose()
      }
      this.child.once('exit', finish)
      const timeout = setTimeout(() => {
        if (!this.child.killed) this.child.kill()
        finish()
      }, 2_500)
    })
    this.closed = true
  }
}

async function verifyExecutable(executable, expectedVersion, environment) {
  await access(executable)
  const result = await execFileAsync(executable, ['--version'], {
    env: environment,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  })
  const output = result.stdout.trim()
  const match = output.match(/^@agentclientprotocol\/codex-acp\s+(\S+)$/)
  if (!match) throw new Error(`无法解析 codex-acp 版本输出: ${output || '(empty)'}`)
  if (match[1] !== expectedVersion) {
    throw new Error(`codex-acp 版本不兼容：期望 ${expectedVersion}，实际 ${match[1]}`)
  }
  return match[1]
}

function startPeer(executable, environment) {
  const child = spawn(executable, [], {
    env: environment,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return new JsonRpcPeer(child)
}

async function initialize(peer) {
  const result = await peer.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      auth: { terminal: false },
    },
    clientInfo: {
      name: 'cclink-studio-acp-probe',
      title: 'CCLink Studio ACP Probe',
      version: '1',
    },
  })
  if (result?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`ACP 协议不兼容：期望 ${PROTOCOL_VERSION}，实际 ${result?.protocolVersion}`)
  }
  if (result?.agentInfo?.name !== '@agentclientprotocol/codex-acp') {
    throw new Error(`Agent 身份不匹配：${result?.agentInfo?.name ?? '(missing)'}`)
  }
  const authMethodIds = Array.isArray(result.authMethods)
    ? result.authMethods.map((method) => method?.id).filter(Boolean)
    : []
  if (!authMethodIds.includes('api-key')) throw new Error('codex-acp 未声明 api-key 认证')
  if (result?.agentCapabilities?.loadSession !== true) {
    throw new Error('codex-acp 未声明 session 恢复能力')
  }
  return result
}

function streamedAgentText(peer, sessionId) {
  return peer.sessionUpdates
    .filter(
      (params) =>
        params?.sessionId === sessionId && params?.update?.sessionUpdate === 'agent_message_chunk',
    )
    .map((params) => (params.update?.content?.type === 'text' ? params.update.content.text : ''))
    .join('')
}

async function authenticateAndCreateSession(peer, workspace) {
  await peer.request('authenticate', { methodId: 'api-key' }, 30_000)
  return peer.request('session/new', { cwd: workspace, mcpServers: [] }, 30_000)
}

async function runLiveProbe({ executable, environment, probeRoot }) {
  const workspace = join(probeRoot, 'workspace')
  const outsideRoot = join(probeRoot, 'outside')
  const outsideTarget = join(outsideRoot, 'should-not-exist.txt')
  await mkdir(workspace, { recursive: true })
  await mkdir(outsideRoot, { recursive: true })

  let peer = startPeer(executable, environment)
  try {
    await initialize(peer)
    const session = await authenticateAndCreateSession(peer, workspace)
    const sessionId = session?.sessionId
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('session/new 未返回 sessionId')

    const textResult = await peer.request(
      'session/prompt',
      {
        sessionId,
        prompt: [{ type: 'text', text: `Reply with exactly ${LIVE_MARKER}. Do not use tools.` }],
      },
      120_000,
    )
    const responseText = streamedAgentText(peer, sessionId)
    if (textResult?.stopReason !== 'end_turn' || !responseText.includes(LIVE_MARKER)) {
      throw new Error('真实文本 prompt 未得到预期终态或标记')
    }

    await peer.close()
    peer = startPeer(executable, environment)
    await initialize(peer)
    await peer.request('authenticate', { methodId: 'api-key' }, 30_000)
    await peer.request('session/resume', { sessionId, cwd: workspace, mcpServers: [] }, 30_000)

    const permissionCountBefore = peer.permissionRequests.length
    await peer.request(
      'session/prompt',
      {
        sessionId,
        prompt: [
          {
            type: 'text',
            text: `Attempt to write the word blocked to ${outsideTarget}. Do not write anywhere else.`,
          },
        ],
      },
      120_000,
    )
    const permissionRequestObserved = peer.permissionRequests.length > permissionCountBefore
    let outsideWriteBlocked = false
    try {
      await access(outsideTarget)
    } catch {
      outsideWriteBlocked = true
    }
    if (!permissionRequestObserved || !outsideWriteBlocked) {
      throw new Error('workspace 外写入没有形成可拒绝的权限请求，或拒绝后仍产生了文件')
    }

    const cancelPromise = peer.request(
      'session/prompt',
      {
        sessionId,
        prompt: [
          {
            type: 'text',
            text: 'Inspect this workspace repeatedly and do not finish until explicitly cancelled.',
          },
        ],
      },
      120_000,
    )
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    peer.notify('session/cancel', { sessionId })
    const cancelResult = await cancelPromise
    if (cancelResult?.stopReason !== 'cancelled') {
      throw new Error(`取消终态不正确：${cancelResult?.stopReason ?? '(missing)'}`)
    }

    await peer.request('session/close', { sessionId }, 15_000)
    return {
      sessionResume: true,
      textPrompt: true,
      permissionReject: permissionRequestObserved,
      outsideWriteBlocked,
      cancel: true,
    }
  } finally {
    await peer.close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const apiKey = options.live ? process.env.CCLINK_ACP_SMOKE_API_KEY?.trim() : ''
  if (options.live && !apiKey) {
    throw new Error('缺少 CCLINK_ACP_SMOKE_API_KEY；拒绝借用普通环境变量或用户 Codex 登录')
  }

  const isolatedRoot = await mkdtemp(join(tmpdir(), 'cclink-acp-runtime-probe-'))
  const codexHome = join(isolatedRoot, 'codex-home')
  let probeRoot = null
  await mkdir(codexHome, { recursive: true })
  const environment = sanitizedEnvironment(codexHome, apiKey)

  try {
    if (options.live) probeRoot = await mkdtemp(join(dirname(projectRoot), '.cclink-acp-live-'))
    const version = await verifyExecutable(options.executable, options.expectedVersion, environment)
    const peer = startPeer(options.executable, environment)
    const initialized = await initialize(peer)
    await peer.close()

    const baseResult = {
      success: true,
      mode: options.live ? 'live' : 'initialize-only',
      executableVersion: version,
      protocolVersion: initialized.protocolVersion,
      agentName: initialized.agentInfo.name,
      authMethods: initialized.authMethods.map((method) => method.id),
      loadSession: initialized.agentCapabilities.loadSession,
      browserAuthDisabled: !initialized.authMethods.some((method) => method.id === 'chatgpt'),
      inheritedOpenAiCredentials:
        'OPENAI_API_KEY' in environment ||
        ('CODEX_API_KEY' in environment && environment.CODEX_API_KEY !== apiKey),
      codeXPathInjected: 'CODEX_PATH' in environment,
    }
    const liveResult = options.live
      ? await runLiveProbe({
          executable: options.executable,
          environment,
          probeRoot: probeRoot,
        })
      : {}
    console.log(JSON.stringify({ ...baseResult, ...liveResult }, null, 2))
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true })
    if (probeRoot) await rm(probeRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[acp-runtime-probe] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
