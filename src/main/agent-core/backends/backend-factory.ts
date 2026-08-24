/**
 * 后端工厂 — 根据配置创建对应的 IAgentBackend 实例
 */

import type { McpToolHost } from '../tools/tool-host.js'
import type { IAgentBackend, BackendConfig } from './types.js'
import {
  LocalClaudeCodeBackend,
  type AndroidAdbHost,
  type BrowserAutomationHost,
  type McpConfigComposer,
} from './local-claude-code-backend.js'
import { LocalAcpBackend } from './local-acp-backend.js'
import { CclinkAgentBackend } from './cclink-agent-backend.js'

export interface BackendFactoryDeps {
  playwrightBridge: BrowserAutomationHost
  toolHost: McpToolHost
  mcpClientMgr: McpConfigComposer
  adbBridge: AndroidAdbHost
  agentDeviceAvailable?: () => boolean
}

/**
 * 创建 AI 后端实例
 *
 * @param config 后端配置
 * @param deps 共享依赖（MCP 工具、Playwright 等）
 */
export function createBackend(config: BackendConfig, deps: BackendFactoryDeps): IAgentBackend {
  switch (config.type) {
    case 'local-claude-code':
      return new LocalClaudeCodeBackend(
        deps.playwrightBridge,
        deps.toolHost,
        deps.mcpClientMgr,
        deps.adbBridge,
        {
          claudeCodePath: config.claudeCode?.claudeCodePath,
          env: config.claudeCode?.env,
          apiBaseUrl: config.claudeCode?.apiBaseUrl,
          apiKey: config.claudeCode?.apiKey,
          modelName: config.claudeCode?.modelName,
          getWorkspacePath: config.claudeCode?.getWorkspacePath,
          hostContext: config.claudeCode?.hostContext,
          agentDeviceAvailable: deps.agentDeviceAvailable,
        },
      )

    case 'local-acp':
      return new LocalAcpBackend({
        executablePath: config.acp.executablePath,
        apiKey: config.acp.apiKey,
        codexHome: config.acp.codexHome,
        expectedVersion: config.acp.expectedVersion,
        getWorkspacePath: config.acp.getWorkspacePath,
        requestPermission: config.acp.requestPermission,
      })

    case 'cclink-agent':
      return new CclinkAgentBackend(config.cclinkAgent)

    default:
      throw new Error(`未知的后端类型: ${(config as { type?: unknown }).type}`)
  }
}
