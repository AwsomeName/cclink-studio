/**
 * SettingsIPC — 设置 IPC 处理器
 *
 * 提供 3 个 IPC channel：
 * - settings:getAll  — 获取所有设置
 * - settings:set     — 更新部分设置（立即持久化 + 实时生效）
 * - settings:reset   — 恢复默认设置
 */

import type { SettingsService } from './settings-service'
import type { PermissionManager } from '../mcp/permission'
import type { AgentBridge } from '../agent/agent-bridge'
import {
  buildClaudeSessionCompatibilityFingerprint,
  type ClaudeRuntimeManager,
} from '../agent/claude-runtime-manager'
import type { ClaudeRuntimeSelection } from '../../shared/claude-runtime'
import {
  DEFAULT_SETTINGS,
  normalizeClaudeRuntimeSettingsUpdate,
  type PermissionMode,
} from './types'
import { detectClaudeCode } from '../agent/claude-code-detector'
import type { McpToolHost } from '../mcp/tool-host'
import type { TrustedRendererGuard } from '../ipc/trusted-renderer-guard'
import { registerTrustedIpcContract } from '../ipc/trusted-renderer-guard'
import { settingsIpcContracts as settingsIpc } from '../../shared/ipc/settings-contract'
import type { ClaudeModelConnectionTestOperationResult } from '../../shared/ipc/settings'
import {
  testClaudeModelConnection,
  type ClaudeModelConnectionTestInput,
} from '../agent/claude-model-connection-test'

/** 合法的 permissionMode 值 */
const VALID_PERMISSION_MODES = new Set<string>(['auto', 'categorized', 'strict'])

/** 影响 Agent 后端的设置字段 */
const AGENT_SETTING_KEYS = new Set([
  'agentEngine',
  'claudeRuntimeSource',
  'claudeCodePath',
  'maxBudgetUsd',
  'provider',
  'apiFormat',
  'apiBaseUrl',
  'modelName',
])
export function registerSettingsIpc(
  settingsService: SettingsService,
  trustedRendererGuard: TrustedRendererGuard,
  permissionManager: PermissionManager,
  getAgentBridge: () => AgentBridge | null,
  getToolHost: () => McpToolHost | null = () => null,
  getClaudeRuntimeManager: () => ClaudeRuntimeManager | null = () => null,
  recoverAgentRuntime: () => Promise<void> = async () => undefined,
  runClaudeModelConnectionTest: (
    input: ClaudeModelConnectionTestInput,
  ) => ReturnType<typeof testClaudeModelConnection> = testClaudeModelConnection,
): void {
  let modelConnectionTestPending = false

  /** 获取所有设置 */
  registerTrustedIpcContract(settingsIpc.getAll, trustedRendererGuard, () => {
    return settingsService.getAll()
  })

  registerTrustedIpcContract(settingsIpc.getSecretStatus, trustedRendererGuard, () => {
    return settingsService.getSecretStatus()
  })

  registerTrustedIpcContract(
    settingsIpc.setSecret,
    trustedRendererGuard,
    async (_event, key, value) => {
      let releaseAgentLock: (() => void) | null = null
      try {
        releaseAgentLock = acquireAgentConfigurationLock(getAgentBridge())
        if (!releaseAgentLock) return runtimeSwitchPendingSecretResult()
        const status = await settingsService.setSecret(key, value)
        await applyAgentConfiguration(
          getAgentBridge(),
          settingsService,
          getClaudeRuntimeManager(),
          recoverAgentRuntime,
          true,
        )
        return { success: true, status }
      } catch (err) {
        console.error('[SettingsIPC] 设置凭证更新失败:', err)
        return { success: false, error: settingsIpcError(err) }
      } finally {
        releaseAgentLock?.()
      }
    },
  )

  registerTrustedIpcContract(settingsIpc.clearSecret, trustedRendererGuard, async (_event, key) => {
    let releaseAgentLock: (() => void) | null = null
    try {
      if (key === 'apiKey' && settingsService.getAll().claudeRuntimeSource === 'bundled') {
        return {
          success: false,
          error: 'AUTH_REQUIRED: 使用内置 Claude Code 时必须保留 API 凭证，请先切换运行时',
        }
      }
      releaseAgentLock = acquireAgentConfigurationLock(getAgentBridge())
      if (!releaseAgentLock) return runtimeSwitchPendingSecretResult()
      const status = await settingsService.clearSecret(key)
      await applyAgentConfiguration(
        getAgentBridge(),
        settingsService,
        getClaudeRuntimeManager(),
        recoverAgentRuntime,
        true,
      )
      return { success: true, status }
    } catch (err) {
      console.error('[SettingsIPC] 设置凭证清除失败:', err)
      return { success: false, error: settingsIpcError(err) }
    } finally {
      releaseAgentLock?.()
    }
  })

  /**
   * 更新部分设置
   *
   * 持久化到磁盘，并对需要实时生效的字段立即应用：
   * - permissionMode → PermissionManager.setMode()
   * - API 配置变更 → AgentBridge.reconfigure()
   */
  registerTrustedIpcContract(settingsIpc.set, trustedRendererGuard, async (_event, partial) => {
    let releaseAgentLock: (() => void) | null = null
    try {
      const normalizedPartial = normalizeClaudeRuntimeSettingsUpdate(
        settingsService.getAll(),
        partial,
      )
      const changesAgentSettings = Object.keys(normalizedPartial).some((key) =>
        AGENT_SETTING_KEYS.has(key),
      )
      if (changesAgentSettings) {
        releaseAgentLock = acquireAgentConfigurationLock(getAgentBridge())
        if (!releaseAgentLock) return runtimeSwitchPendingSettingsResult()
      }

      const runtimeManager = getClaudeRuntimeManager()
      const changesRuntime =
        'claudeRuntimeSource' in normalizedPartial || 'claudeCodePath' in normalizedPartial
      const runtimeSelection = changesRuntime
        ? selectionFromSettings({ ...settingsService.getAll(), ...normalizedPartial })
        : null
      if (
        runtimeSelection?.source === 'bundled' &&
        !settingsService.getRuntimeSettings().apiKey.trim()
      ) {
        return {
          success: false,
          error: 'AUTH_REQUIRED: 内置 Claude Code 仅支持显式 API 凭证，不能使用 Claude 订阅登录',
        }
      }
      const runtimeProbe =
        runtimeSelection && runtimeManager ? await runtimeManager.probe(runtimeSelection) : null
      if (runtimeProbe && !runtimeProbe.success) {
        return {
          success: false,
          error: `${runtimeProbe.failure.code}: ${runtimeProbe.failure.message}`,
        }
      }

      const updated = await settingsService.set(normalizedPartial)

      // 权限模式：校验后立即生效
      if (normalizedPartial.permissionMode) {
        const mode = normalizedPartial.permissionMode as string
        if (VALID_PERMISSION_MODES.has(mode)) {
          permissionManager.setMode(mode as PermissionMode)
        } else {
          console.warn('[SettingsIPC] 无效的权限模式:', mode)
        }
      }

      if (normalizedPartial.disabledAgentToolModules) {
        applyToolModuleSettings(getToolHost(), updated.disabledAgentToolModules)
      }

      // API 配置变更：热重载后端
      const agentBridge = getAgentBridge()
      if (runtimeSelection && runtimeProbe?.success && runtimeManager) {
        runtimeManager.commit(runtimeSelection, runtimeProbe.runtime)
      }
      if (agentBridge && changesAgentSettings) {
        reconfigureAgent(agentBridge, settingsService, runtimeManager)
      } else if (changesAgentSettings) {
        await recoverAgentRuntime()
      }

      return { success: true, settings: updated }
    } catch (err) {
      console.error('[SettingsIPC] 设置更新失败:', err)
      return { success: false, error: settingsIpcError(err) }
    } finally {
      releaseAgentLock?.()
    }
  })

  /** 恢复默认设置 */
  registerTrustedIpcContract(settingsIpc.reset, trustedRendererGuard, async () => {
    let releaseAgentLock: (() => void) | null = null
    try {
      releaseAgentLock = acquireAgentConfigurationLock(getAgentBridge())
      if (!releaseAgentLock) return runtimeSwitchPendingSettingsResult()
      const runtimeManager = getClaudeRuntimeManager()
      const selection = selectionFromSettings(settingsService.getAll(), true)
      const probe = runtimeManager ? await runtimeManager.probe(selection) : null
      if (probe && !probe.success) {
        return { success: false, error: `${probe.failure.code}: ${probe.failure.message}` }
      }
      const settings = await settingsService.reset()
      // 重置权限模式为默认值
      permissionManager.setMode(settings.permissionMode)
      applyToolModuleSettings(getToolHost(), settings.disabledAgentToolModules)

      // 热重载后端为默认配置
      const agentBridge = getAgentBridge()
      if (probe?.success && runtimeManager) runtimeManager.commit(selection, probe.runtime)
      if (agentBridge) {
        reconfigureAgent(agentBridge, settingsService, runtimeManager)
      } else {
        await recoverAgentRuntime()
      }

      return { success: true, settings }
    } catch (err) {
      console.error('[SettingsIPC] 设置重置失败:', err)
      return { success: false, error: settingsIpcError(err) }
    } finally {
      releaseAgentLock?.()
    }
  })

  /** 重置单个设置到默认值 */
  registerTrustedIpcContract(settingsIpc.resetKey, trustedRendererGuard, async (_event, key) => {
    let releaseAgentLock: (() => void) | null = null
    try {
      if (AGENT_SETTING_KEYS.has(key)) {
        releaseAgentLock = acquireAgentConfigurationLock(getAgentBridge())
        if (!releaseAgentLock) return runtimeSwitchPendingSettingsResult()
      }
      const runtimeManager = getClaudeRuntimeManager()
      const changesRuntime = key === 'claudeRuntimeSource' || key === 'claudeCodePath'
      const resetUpdate = normalizeClaudeRuntimeSettingsUpdate(settingsService.getAll(), {
        [key]: DEFAULT_SETTINGS[key],
      })
      const selection = changesRuntime
        ? selectionFromSettings({ ...settingsService.getAll(), ...resetUpdate })
        : null
      const probe = selection && runtimeManager ? await runtimeManager.probe(selection) : null
      if (probe && !probe.success) {
        return { success: false, error: `${probe.failure.code}: ${probe.failure.message}` }
      }
      const updated = await settingsService.resetKey(key)

      // 权限模式重置 → 即时生效
      if (key === 'permissionMode') {
        permissionManager.setMode(updated.permissionMode)
      }
      if (key === 'disabledAgentToolModules') {
        applyToolModuleSettings(getToolHost(), updated.disabledAgentToolModules)
      }

      // API 配置重置 → 热重载后端
      const agentBridge = getAgentBridge()
      if (selection && probe?.success && runtimeManager) {
        runtimeManager.commit(selection, probe.runtime)
      }
      if (AGENT_SETTING_KEYS.has(key) && agentBridge) {
        reconfigureAgent(agentBridge, settingsService, runtimeManager)
      } else if (AGENT_SETTING_KEYS.has(key)) {
        await recoverAgentRuntime()
      }

      return { success: true, settings: updated }
    } catch (err) {
      console.error('[SettingsIPC] 单项重置失败:', err)
      return { success: false, error: settingsIpcError(err) }
    } finally {
      releaseAgentLock?.()
    }
  })

  /** 检测本机 Claude Code CLI 路径 */
  registerTrustedIpcContract(settingsIpc.detectClaudeCode, trustedRendererGuard, async () => {
    try {
      const runtimeManager = getClaudeRuntimeManager()
      if (runtimeManager) {
        const status = runtimeManager.getStatus()
        const runtime = status.active
        if (runtime) {
          return {
            success: true,
            status: {
              installed: true,
              path: runtime.executablePath,
              source:
                runtime.source === 'custom'
                  ? ('configured' as const)
                  : runtime.source === 'system'
                    ? ('known-path' as const)
                    : ('bundled' as const),
            },
          }
        }
      }
      const settings = settingsService.getAll()
      return { success: true, status: await detectClaudeCode(settings.claudeCodePath) }
    } catch (err) {
      return { success: false, error: settingsIpcError(err) }
    }
  })

  registerTrustedIpcContract(settingsIpc.getClaudeRuntimeStatus, trustedRendererGuard, () => {
    const runtimeManager = getClaudeRuntimeManager()
    if (!runtimeManager) return { success: false, error: 'Claude Code 运行时管理器未初始化' }
    return { success: true, status: runtimeManager.getStatus() }
  })

  registerTrustedIpcContract(
    settingsIpc.probeClaudeRuntime,
    trustedRendererGuard,
    async (_event, selection) => {
      try {
        const runtimeManager = getClaudeRuntimeManager()
        if (!runtimeManager) {
          return { success: false, error: 'Claude Code 运行时管理器未初始化' }
        }
        return { success: true, result: await runtimeManager.probe(selection) }
      } catch (err) {
        return { success: false, error: settingsIpcError(err) }
      }
    },
  )

  registerTrustedIpcContract(
    settingsIpc.testClaudeModelConnection,
    trustedRendererGuard,
    async (_event, selection): Promise<ClaudeModelConnectionTestOperationResult> => {
      if (modelConnectionTestPending) {
        return { success: false, error: '模型连接测试正在进行，请等待当前测试完成' }
      }
      modelConnectionTestPending = true
      try {
        const runtimeManager = getClaudeRuntimeManager()
        if (!runtimeManager) {
          return { success: false, error: 'Claude Code 运行时管理器未初始化' }
        }

        const settings = settingsService.getRuntimeSettings()
        if (!settings.apiKey.trim()) {
          return {
            success: true,
            result: {
              success: false,
              code: 'AUTH_REQUIRED' as const,
              message: '请先保存 API Key，再测试连接。',
              durationMs: 0,
            },
          }
        }
        if (settings.apiFormat !== 'anthropic') {
          return {
            success: true,
            result: {
              success: false,
              code: 'API_FORMAT_UNSUPPORTED' as const,
              message:
                '内置 Claude Code 当前只支持 Anthropic 兼容 API，不能直接测试 OpenAI Compatible 接口。',
              durationMs: 0,
            },
          }
        }
        if (!settings.modelName.trim()) {
          return {
            success: true,
            result: {
              success: false,
              code: 'MODEL_REQUIRED' as const,
              message: '请先填写要测试的模型名称。',
              durationMs: 0,
            },
          }
        }

        const runtimeProbe = await runtimeManager.probe(selection)
        if (!runtimeProbe.success) {
          return {
            success: true,
            result: {
              success: false,
              code: 'RUNTIME_UNAVAILABLE' as const,
              message: `${runtimeProbe.failure.code}: ${runtimeProbe.failure.message}`,
              durationMs: 0,
            },
          }
        }

        return {
          success: true,
          result: await runClaudeModelConnectionTest({
            runtime: runtimeProbe.runtime,
            apiFormat: settings.apiFormat,
            apiBaseUrl: settings.apiBaseUrl,
            apiKey: settings.apiKey,
            modelName: settings.modelName,
          }),
        }
      } catch (err) {
        return { success: false, error: settingsIpcError(err) }
      } finally {
        modelConnectionTestPending = false
      }
    },
  )

  console.log('[SettingsIPC] 设置 IPC 已注册')
}

function applyToolModuleSettings(toolHost: McpToolHost | null, disabledModules: string[]): void {
  if (!toolHost) return
  const disabled = new Set(disabledModules)
  for (const module of toolHost.getRegisteredModules()) {
    toolHost.setModuleEnabled(module.name, !disabled.has(module.name))
  }
}

function reconfigureAgent(
  agentBridge: AgentBridge | null,
  settingsService: SettingsService,
  runtimeManager: ClaudeRuntimeManager | null,
  forceResetSessions = false,
): void {
  if (!agentBridge) return
  try {
    const runtimeSettings = settingsService.getRuntimeSettings()
    const activeRuntime = runtimeManager?.getStatus().active ?? null
    agentBridge.reconfigure(
      {
        ...runtimeSettings,
        claudeCodePath: activeRuntime?.executablePath ?? runtimeSettings.claudeCodePath,
        sessionCompatibilityFingerprint: activeRuntime
          ? buildClaudeSessionCompatibilityFingerprint(activeRuntime.fingerprint, runtimeSettings)
          : undefined,
        runtimeProvenance: activeRuntime
          ? {
              source: activeRuntime.source,
              sdkVersion: activeRuntime.sdkVersion ?? null,
              claudeCodeVersion: activeRuntime.claudeCodeVersion,
            }
          : undefined,
      },
      { forceResetSessions },
    )
  } catch (err) {
    console.warn('[SettingsIPC] 后端热重载失败（下次启动生效）:', err)
  }
}

async function applyAgentConfiguration(
  agentBridge: AgentBridge | null,
  settingsService: SettingsService,
  runtimeManager: ClaudeRuntimeManager | null,
  recoverAgentRuntime: () => Promise<void>,
  forceResetSessions = false,
): Promise<void> {
  if (agentBridge) {
    reconfigureAgent(agentBridge, settingsService, runtimeManager, forceResetSessions)
    return
  }
  await recoverAgentRuntime()
}

function selectionFromSettings(
  settings: { claudeRuntimeSource?: string; claudeCodePath?: string },
  useDefaults = false,
): ClaudeRuntimeSelection {
  const source = useDefaults ? 'system' : settings.claudeRuntimeSource
  if (source === 'bundled') return { source: 'bundled' }
  if (source === 'custom') return { source: 'custom', customPath: settings.claudeCodePath ?? '' }
  return { source: 'system' }
}

function acquireAgentConfigurationLock(agentBridge: AgentBridge | null): (() => void) | null {
  if (!agentBridge) return () => undefined
  if (!agentBridge.beginConfigurationChange()) return null
  return () => agentBridge.endConfigurationChange()
}

function runtimeSwitchPendingSettingsResult() {
  return {
    success: false,
    error: 'RUNTIME_SWITCH_PENDING: Agent 正在响应，运行时和模型配置将在任务结束后才能切换',
  }
}

function runtimeSwitchPendingSecretResult() {
  return {
    success: false,
    error: 'RUNTIME_SWITCH_PENDING: Agent 正在响应，凭证将在任务结束后才能切换',
  }
}

function settingsIpcError(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ZodError') {
    return '设置参数无效'
  }
  return error instanceof Error ? error.message : String(error)
}
