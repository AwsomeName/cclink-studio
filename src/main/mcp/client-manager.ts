/**
 * McpClientManager — 外部 MCP Server 配置管理
 *
 * 管理用户配置的外部 MCP server 列表。
 * CCLink Studio 不做 MCP 代理——CLI 直连外部 server，
 * 这里只负责读取配置并合成 --mcp-config。
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

  constructor() {
    this.configPath = join(app.getPath('userData'), 'mcp-servers.json')
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
   * 合成 --mcp-config JSON
   *
   * 合并内部 deepink server + 所有已启用的外部 server
   */
  composeMcpConfig(internalPort: number, sessionToken?: string): Record<string, unknown> {
    const internalUrl = new URL(`http://127.0.0.1:${internalPort}/mcp`)
    if (sessionToken) {
      internalUrl.searchParams.set('session', sessionToken)
    }

    const mcpServers: Record<string, unknown> = {
      // 内部 deepink server
      // 关键：Claude Code 的 MCP schema 要求 HTTP server 必须显式带 `type: 'http'`，
      // 否则报 "Does not adhere to MCP server configuration schema" 并 exit 1。
      deepink: {
        type: 'http',
        url: internalUrl.toString(),
      },
    }

    // 外部 servers
    for (const server of this.getEnabledServers()) {
      if (server.transport === 'stdio') {
        mcpServers[server.name] = {
          type: 'stdio',
          command: server.command,
          ...(server.args?.length ? { args: server.args } : {}),
          ...(Object.keys(server.env ?? {}).length ? { env: server.env } : {}),
        }
      } else {
        // http / sse —— 同样必须带 type
        mcpServers[server.name] = {
          type: server.transport,
          url: server.url,
          ...(Object.keys(server.headers ?? {}).length ? { headers: server.headers } : {}),
        }
      }
    }

    return { mcpServers }
  }

  /**
   * 添加外部 server
   */
  addServer(server: ExternalMcpServer): void {
    // 不允许覆盖内部 server 名称
    if (server.name === 'deepink') {
      throw new Error('不允许使用保留名称 "deepink"')
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

    // 不允许改名到 deepink 或已存在的名称
    if (updates.name && updates.name !== name) {
      if (updates.name === 'deepink') return false
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
