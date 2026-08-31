/**
 * McpClientManager — 外部 MCP Server 配置管理
 *
 * 管理用户配置的外部 MCP server 列表。
 * 外部 server 配置继续由 Studio 保存，但在统一授权 broker 完成前，
 * 不得交给 Agent SDK 启动、发现或调用。
 *
 * 配置文件：{userData}/mcp-servers.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ExternalMcpServer } from '../../shared/ipc/agent'

export type { ExternalMcpServer } from '../../shared/ipc/agent'

/** 配置文件格式 */
interface McpServersConfig {
  servers: ExternalMcpServer[]
}

export class McpClientManager {
  private servers: ExternalMcpServer[] = []
  private readonly configPath: string

  constructor(configPath = join(app.getPath('userData'), 'mcp-servers.json')) {
    this.configPath = configPath
    this.loadFromConfig()
  }

  /**
   * 从配置文件加载外部 server 列表
   */
  loadFromConfig(): void {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf-8')
        const config: McpServersConfig = JSON.parse(raw)
        this.servers = Array.isArray(config.servers) ? config.servers : []
        console.log(`[McpClientManager] 已加载 ${this.servers.length} 个外部 MCP server`)
      } else {
        // 首次运行，创建空配置
        this.servers = []
        this.saveConfig()
        console.log('[McpClientManager] 配置文件不存在，已创建空配置')
      }
    } catch (err) {
      console.error('[McpClientManager] 配置文件加载失败:', err)
      this.servers = []
    }
  }

  /**
   * 获取所有已启用的外部 server
   */
  getEnabledServers(): ExternalMcpServer[] {
    return this.servers.filter((s) => s.enabled)
  }

  /**
   * 获取所有 server（含已禁用）
   */
  getAllServers(): ExternalMcpServer[] {
    return [...this.servers]
  }

  /**
   * 合成 Agent SDK 使用的 --mcp-config JSON。
   *
   * 安全边界：统一授权 broker 完成前只返回内部 cclink_studio server。
   * 外部配置仍可读取和编辑，但不能通过这个运行时入口启动。
   */
  composeMcpConfig(internalPort: number, sessionToken?: string): Record<string, unknown> {
    const internalUrl = new URL(`http://127.0.0.1:${internalPort}/mcp`)
    if (sessionToken) {
      internalUrl.searchParams.set('session', sessionToken)
    }

    const mcpServers: Record<string, unknown> = {
      // 内部 cclink_studio server
      // 关键：Claude Code 的 MCP schema 要求 HTTP server 必须显式带 `type: 'http'`，
      // 否则报 "Does not adhere to MCP server configuration schema" 并 exit 1。
      cclink_studio: {
        type: 'http',
        url: internalUrl.toString(),
      },
    }

    return { mcpServers }
  }

  /**
   * 添加外部 server
   */
  addServer(server: ExternalMcpServer): void {
    assertValidServer(server)
    // 不允许覆盖内部 server 名称
    if (server.name === 'cclink_studio') {
      throw new Error('不允许使用保留名称 "cclink_studio"')
    }
    // 检查重名
    if (this.servers.some((s) => s.name === server.name)) {
      throw new Error(`MCP server "${server.name}" 已存在`)
    }
    this.servers.push(server)
    this.saveConfig()
    console.log(`[McpClientManager] 已添加: ${server.name}`)
  }

  /**
   * 移除外部 server
   */
  removeServer(name: string): boolean {
    const idx = this.servers.findIndex((s) => s.name === name)
    if (idx === -1) return false
    this.servers.splice(idx, 1)
    this.saveConfig()
    console.log(`[McpClientManager] 已移除: ${name}`)
    return true
  }

  /**
   * 更新外部 server 配置
   */
  updateServer(name: string, updates: Partial<ExternalMcpServer>): boolean {
    const server = this.servers.find((s) => s.name === name)
    if (!server) return false

    const next = { ...server, ...updates }
    try {
      assertValidServer(next)
    } catch {
      return false
    }

    // 不允许改名到 cclink_studio 或已存在的名称
    if (updates.name && updates.name !== name) {
      if (updates.name === 'cclink_studio') return false
      if (this.servers.some((s) => s.name === updates.name)) return false
    }

    Object.assign(server, updates)
    this.saveConfig()
    console.log(`[McpClientManager] 已更新: ${name}`)
    return true
  }

  /**
   * 保存配置到文件
   */
  private saveConfig(): void {
    try {
      const config: McpServersConfig = { servers: this.servers }
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[McpClientManager] 配置文件保存失败:', err)
    }
  }
}

function assertValidServer(server: ExternalMcpServer): void {
  if (!/^[A-Za-z0-9_-]+$/.test(server.name)) {
    throw new Error('MCP 名称只能包含字母、数字、下划线和连字符')
  }
  if (!['stdio', 'http', 'sse'].includes(server.transport)) {
    throw new Error('不支持的 MCP 传输类型')
  }
  if (server.transport === 'stdio' && !server.command?.trim()) {
    throw new Error('stdio MCP 必须配置启动命令')
  }
  if (server.transport !== 'stdio') {
    if (!server.url?.trim()) throw new Error('远程 MCP 必须配置 URL')
    const url = new URL(server.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('MCP URL 仅支持 http 或 https')
    }
  }
}
