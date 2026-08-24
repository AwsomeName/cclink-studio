import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { request } from 'node:http'

const DEFAULT_CCLINK_AGENT_PORT = 17_374
const STARTUP_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 3_000

export interface CclinkAgentEndpoint {
  baseUrl: string
  token: string
  runtimeId: string
}

export interface CclinkAgentServiceOptions {
  executablePath?: string
  workspaceRoot: string
  port?: number
  runtimeId?: string
}

/**
 * Studio-owned lifecycle wrapper for the experimental chatcc HTTP/SSE process.
 *
 * The child owns no Studio Thread/run persistence. It is started only when the
 * explicit experimental backend flag is present and is stopped with AgentBridge.
 */
export class CclinkAgentService {
  private readonly options: Required<CclinkAgentServiceOptions>
  private child: ChildProcessWithoutNullStreams | null = null
  private endpoint: CclinkAgentEndpoint | null = null
  private stderrTail = ''

  constructor(options: CclinkAgentServiceOptions) {
    const port = options.port ?? DEFAULT_CCLINK_AGENT_PORT
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      throw new Error(`cclink-agent 端口无效: ${port}`)
    }
    const workspaceRoot = options.workspaceRoot.trim()
    if (!workspaceRoot) throw new Error('cclink-agent 工作区不能为空')
    this.options = {
      executablePath: options.executablePath?.trim() || 'chatcc',
      workspaceRoot,
      port,
      runtimeId: options.runtimeId?.trim() || 'claude_code',
    }
  }

  async start(): Promise<CclinkAgentEndpoint> {
    if (this.endpoint && this.child && this.child.exitCode === null) return this.endpoint
    if (this.child) throw new Error('cclink-agent 服务处于未完成的退出状态')

    const token = `mock:studio-${randomUUID()}:runtime:run runtime:probe:${this.options.workspaceRoot}`
    const baseUrl = `http://127.0.0.1:${this.options.port}`
    const child = spawn(
      this.options.executablePath,
      [
        'cclink-studio',
        '--host',
        '127.0.0.1',
        '--port',
        String(this.options.port),
        '--workspace',
        this.options.workspaceRoot,
        '--allow-mock-token',
      ],
      {
        cwd: this.options.workspaceRoot,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    child.stdin.end()
    this.child = child
    this.stderrTail = ''
    child.stdout.resume()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_000)
    })

    try {
      await this.waitUntilReady(child, baseUrl, token)
      this.endpoint = { baseUrl, token, runtimeId: this.options.runtimeId }
      return this.endpoint
    } catch (error) {
      await this.stop()
      const detail = this.safeFailureDetail()
      throw new Error(`cclink-agent 服务启动失败${detail ? `: ${detail}` : ''}`, { cause: error })
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.endpoint = null
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS)),
    ])
    if (!exited && child.exitCode === null) child.kill('SIGKILL')
  }

  private async waitUntilReady(
    child: ChildProcessWithoutNullStreams,
    baseUrl: string,
    token: string,
  ): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`chatcc 已退出 (code=${child.exitCode})`)
      }
      if (
        (await healthCheck(baseUrl)) &&
        (await runtimeReady(baseUrl, token, this.options.runtimeId))
      ) {
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('等待 /healthz 超时')
  }

  private safeFailureDetail(): string {
    return this.stderrTail
      .split('\n')
      .filter((line) => !line.toLowerCase().includes('token'))
      .join('\n')
      .trim()
      .slice(-1_000)
  }
}

async function healthCheck(baseUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = request(`${baseUrl}/healthz`, { method: 'GET', timeout: 500 }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode === 200))
    })
    req.once('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.once('error', () => resolve(false))
    req.end()
  })
}

async function runtimeReady(baseUrl: string, token: string, runtimeId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const url = new URL('/cclink-studio/v1/runtime/probe', baseUrl)
    url.searchParams.set('runtime', runtimeId)
    const req = request(
      url,
      {
        method: 'GET',
        timeout: 750,
        headers: { authorization: `Bearer ${token}` },
      },
      (response) => {
        response.setEncoding('utf8')
        let body = ''
        response.on('data', (chunk) => (body = `${body}${chunk}`.slice(-64_000)))
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body) as {
              ok?: boolean
              protocol?: string
              protocol_version?: number
              runtime_probe?: {
                runtimes?: Array<{ id?: string; base_runtime?: string; status?: string }>
              }
            }
            resolve(
              response.statusCode === 200 &&
                parsed.ok === true &&
                parsed.protocol === 'cclink.studio.remote' &&
                parsed.protocol_version === 1 &&
                parsed.runtime_probe?.runtimes?.some(
                  (runtime) =>
                    (runtime.id === runtimeId || runtime.base_runtime === runtimeId) &&
                    runtime.status === 'ok',
                ) === true,
            )
          } catch {
            resolve(false)
          }
        })
      },
    )
    req.once('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.once('error', () => resolve(false))
    req.end()
  })
}
