import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { AgentBridge, type AgentBridgeOptions } from '../agent/agent-bridge'
import { CclinkAgentService } from '../agent/cclink-agent-service'
import {
  buildClaudeSessionCompatibilityFingerprint,
  ClaudeRuntimeManager,
  ClaudeRuntimeResolutionError,
} from '../agent/claude-runtime-manager'
import type { CclinkStudioRuntimeState } from './app-runtime'
import { AgentRuntimeStateStore } from '../agent/agent-runtime-state-store'

export async function bootstrapAgentRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.agentRuntimeStateStore ??= new AgentRuntimeStateStore(
    join(app.getPath('userData'), 'agent-runtime', 'state.json'),
  )
  await runtime.agentRuntimeStateStore.load()

  if (
    runtime.mainWindow &&
    runtime.toolHost &&
    runtime.capabilities.get('mcp').state === 'ready' &&
    runtime.permissionManager &&
    runtime.mcpClientMgr &&
    runtime.settingsService
  ) {
    let startingCclinkAgentService: CclinkAgentService | null = null
    try {
      const settings = runtime.settingsService.getRuntimeSettings()
      const experimentalCclinkAgent = isExperimentalCclinkAgentEnabled()
      let runtimeLabel = ''
      let backendOptions: AgentBridgeOptions = {
        agentEngine: settings.agentEngine,
        backendType: settings.backendType,
      }
      if (experimentalCclinkAgent) {
        const workspaceRoot = settings.lastWorkspacePath?.trim() || process.cwd()
        const service = new CclinkAgentService({
          executablePath: process.env.CCLINK_AGENT_CLI_PATH,
          workspaceRoot,
          port: parseExperimentalPort(process.env.CCLINK_AGENT_PORT),
          runtimeId: process.env.CCLINK_AGENT_RUNTIME_ID,
        })
        startingCclinkAgentService = service
        const endpoint = await service.start()
        backendOptions = {
          ...backendOptions,
          experimentalCclinkAgent: { ...endpoint, service },
          sessionCompatibilityFingerprint: createHash('sha256')
            .update(`cclink-agent|http-sse|protocol-1|${endpoint.runtimeId}`)
            .digest('hex'),
        }
        runtimeLabel = `cclink-agent ${endpoint.runtimeId} @ ${endpoint.baseUrl}`
      } else {
        runtime.claudeRuntimeManager ??= new ClaudeRuntimeManager({
          bundledRoot: runtime.isDev
            ? join(process.cwd(), '.agent-runtime-staging')
            : join(process.resourcesPath, 'agent-runtime'),
          ...(runtime.isDev
            ? {}
            : { materializedRoot: join(app.getPath('userData'), 'agent-runtime-cache') }),
          resolveManaged: (version) => {
            if (!runtime.runtimeComponentManager) {
              throw new Error('Runtime 组件管理器未初始化')
            }
            return runtime.runtimeComponentManager.resolveManagedClaude(version)
          },
        })
        const claudeCodePath = settings.claudeCodePath?.trim() ?? ''
        const claudeRuntime = await runtime.claudeRuntimeManager.initialize(
          settings.claudeRuntimeSource === 'bundled'
            ? { source: 'bundled' }
            : settings.claudeRuntimeSource === 'managed'
              ? { source: 'managed', version: settings.claudeManagedVersion }
              : settings.claudeRuntimeSource === 'custom' || claudeCodePath
                ? { source: 'custom', customPath: claudeCodePath }
                : { source: 'system' },
        )
        if (
          (claudeRuntime.source === 'bundled' || claudeRuntime.source === 'managed') &&
          !settings.apiKey.trim()
        ) {
          const failure = {
            code: 'AUTH_REQUIRED' as const,
            message: 'Studio 管理的 Claude Code 仅支持显式 API 凭证，不能使用 Claude 订阅登录',
          }
          runtime.claudeRuntimeManager.reportFailure(failure)
          throw new ClaudeRuntimeResolutionError(failure)
        }
        backendOptions = {
          ...backendOptions,
          claudeCodePath: claudeRuntime.executablePath,
          sessionCompatibilityFingerprint: buildClaudeSessionCompatibilityFingerprint(
            claudeRuntime.fingerprint,
            settings,
          ),
          runtimeProvenance: {
            source: claudeRuntime.source,
            sdkVersion: claudeRuntime.sdkVersion ?? null,
            claudeCodeVersion: claudeRuntime.claudeCodeVersion,
          },
        }
        runtimeLabel = `${claudeRuntime.source}, Claude Code ${claudeRuntime.claudeCodeVersion}`
      }
      runtime.agentBridge = new AgentBridge(
        runtime.mainWindow,
        runtime.playwrightBridge,
        runtime.toolHost,
        runtime.permissionManager,
        runtime.mcpClientMgr,
        runtime.adbBridge,
        {
          ...backendOptions,
          apiFormat: settings.apiFormat,
          apiBaseUrl: settings.apiBaseUrl,
          apiKey: settings.apiKey,
          modelName: settings.modelName,
          codexAcpPath: settings.codexAcpPath,
          codexApiKey: settings.codexApiKey,
          codexHome: join(app.getPath('userData'), 'codex-acp'),
          getWorkspacePath: () => runtime.settingsService!.getAll().lastWorkspacePath,
          getSettingsSnapshot: () => runtime.settingsService!.getAll(),
          agentDeviceAvailable: () => runtime.agentDeviceManager?.isAvailable() ?? false,
          browserManager: runtime.browserManager ?? undefined,
          browserTaskRuntime: runtime.browserTaskRuntime ?? undefined,
          usageLedgerService: runtime.usageLedgerService ?? undefined,
          roleRegistry: runtime.agentRoleRegistry ?? undefined,
          runtimeStateStore: runtime.agentRuntimeStateStore,
        },
      )
      startingCclinkAgentService = null

      if (runtime.browserManager) {
        runtime.browserManager.onViewDestroyed((tabId) =>
          runtime.agentBridge?.invalidateBrowserScope(tabId),
        )
      }
      runtime.capabilities.ready('agent-backend')
      await runtime.scheduledTaskService?.startRuntime(runtime.agentBridge)
      console.log(`[CCLink Studio] Agent 后端就绪 (${settings.agentEngine}, ${runtimeLabel})`)
    } catch (error) {
      await runtime.agentBridge?.destroy({ waitForActiveRuns: false }).catch(() => undefined)
      await startingCclinkAgentService?.stop().catch(() => undefined)
      await runtime.scheduledTaskService?.markRuntimeUnavailable(
        error instanceof Error ? error.message : String(error),
      )
      runtime.agentBridge = null
      const runtimeState = runtime.claudeRuntimeManager?.getStatus().state
      const reason =
        error instanceof ClaudeRuntimeResolutionError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error)
      if (
        runtimeState === 'unavailable' ||
        (error instanceof ClaudeRuntimeResolutionError && error.code === 'AUTH_REQUIRED')
      ) {
        runtime.capabilities.unavailable('agent-backend', reason)
      } else if (runtimeState === 'degraded') {
        runtime.capabilities.degraded('agent-backend', reason)
      } else {
        runtime.capabilities.failed('agent-backend', error)
      }
      console.error('[CCLink Studio] Agent 后端初始化失败:', error)
    }
    return
  }

  runtime.capabilities.unavailable('agent-backend', 'Agent 核心依赖未就绪')
  await runtime.scheduledTaskService?.markRuntimeUnavailable('Agent 核心依赖未就绪')
  console.warn(
    '[CCLink Studio] Agent 后端未就绪：MCP、权限或设置 runtime 初始化失败，Agent IPC 将保持降级状态',
  )
}

export function isExperimentalCclinkAgentEnabled(
  value = process.env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND,
): boolean {
  return value?.trim().toLowerCase() === 'cclink-agent'
}

function parseExperimentalPort(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`CCLINK_AGENT_PORT 无效: ${value}`)
  }
  return port
}

export async function shutdownAgentRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  try {
    await runtime.scheduledTaskService?.stopRuntime()
    await runtime.agentBridge?.destroy({ waitForActiveRuns: false })
  } finally {
    runtime.agentBridge = null
    runtime.claudeRuntimeManager?.dispose()
  }
}
