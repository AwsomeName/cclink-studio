import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClaudeRuntimeStatus } from '@shared/claude-runtime'
import type { CadBackendStatus } from '@shared/ipc/cad'
import { MANAGED_CLAUDE_RUNTIME_VERSION } from '@shared/settings-constants'
import type {
  ManagedClaudeRuntimeStatus,
  RuntimeResourceComponentId,
  RuntimeResourceStatus,
} from '@shared/ipc/runtime-components'
import { APP_VERSION } from '../../app-metadata'

type CapabilityKind = 'Runtime' | '能力插件' | '内容包'
type InstallationState = 'installed' | 'not-installed' | 'checking' | 'unavailable'

interface ManagedCapabilityRow {
  id: string
  name: string
  description: string
  kind: CapabilityKind
  installationState: InstallationState
  installationLabel: string
  installedVersion: string | null
  constrainedVersion: string
  availableVersion: string | null
  managerKind?: 'claude' | 'runtime-resource'
  managedInstalled?: boolean
  updateAvailable?: boolean
  busy?: boolean
  operationComponentId?: RuntimeResourceComponentId
}

type ComponentOperation = 'check' | 'install' | 'repair' | 'uninstall'

const BUILTIN_ROWS: ManagedCapabilityRow[] = [
  {
    id: 'mcp-tools',
    name: 'MCP 工具',
    description: '当前内置工具；后续支持独立插件包',
    kind: '能力插件',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'providers',
    name: '模型 / 图片 Provider',
    description: '模型与图片服务接入能力',
    kind: '能力插件',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'data-source-adapters',
    name: '数据源 Adapter',
    description: '数据库和检索服务适配能力',
    kind: '能力插件',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'platform-adapters',
    name: '平台 Adapter',
    description: '受限平台能力适配器',
    kind: '能力插件',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'command-contributions',
    name: '命令 contribution',
    description: '统一上下文操作中的声明式命令',
    kind: '能力插件',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'templates-prompts-help',
    name: '模板、提示词、帮助文案',
    description: '不含可执行代码的内容资源',
    kind: '内容包',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'catalog-compatibility',
    name: '模型目录、兼容规则',
    description: '模型元数据与兼容性声明',
    kind: '内容包',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
  {
    id: 'static-assets',
    name: '静态资产',
    description: '图标、示例和非执行资源',
    kind: '内容包',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: APP_VERSION,
    constrainedVersion: '随 Studio',
    availableVersion: null,
  },
]

function claudeRow(
  status: ClaudeRuntimeStatus | null,
  managed: ManagedClaudeRuntimeStatus | null,
  failed: boolean,
): ManagedCapabilityRow {
  const active = status?.active
  const managedVersion = managed?.installedVersions[0] ?? null
  const installing =
    managed?.phase === 'checking' ||
    managed?.phase === 'downloading' ||
    managed?.phase === 'verifying' ||
    managed?.phase === 'installing' ||
    managed?.phase === 'uninstalling'
  const damaged = managed?.health === 'damaged'
  return {
    id: 'claude-code-runtime',
    name: 'Claude Code Runtime',
    description: '本地 Agent 执行引擎',
    kind: 'Runtime',
    installationState: damaged
      ? 'unavailable'
      : managedVersion || active
        ? 'installed'
        : failed
          ? 'unavailable'
          : 'not-installed',
    installationLabel: damaged
      ? '已损坏 · 可修复'
      : managedVersion
        ? '已安装 · Studio 管理'
        : active
          ? `已安装 · ${active.source}`
          : failed
            ? '不可用'
            : '未安装',
    installedVersion: managedVersion ?? active?.claudeCodeVersion ?? null,
    constrainedVersion: managed?.constrainedVersion
      ? `仅 ${managed.constrainedVersion}`
      : `仅 ${MANAGED_CLAUDE_RUNTIME_VERSION}`,
    availableVersion: managed?.availableVersion ?? null,
    managerKind: managed?.supported ? 'claude' : undefined,
    managedInstalled: Boolean(managedVersion || damaged),
    updateAvailable: managed?.updateAvailable ?? false,
    busy: installing,
  }
}

function runtimeResourceRow(
  componentId: RuntimeResourceComponentId,
  status: RuntimeResourceStatus | null,
  bundledVersion: string,
  description: string,
  fallbackAvailable = true,
): ManagedCapabilityRow {
  const installing =
    status?.phase === 'checking' ||
    status?.phase === 'downloading' ||
    status?.phase === 'verifying' ||
    status?.phase === 'installing' ||
    status?.phase === 'uninstalling'
  const installed = status?.installedVersion ?? null
  const damaged = status?.health === 'damaged'
  const awaitingHost = status?.activation === 'awaiting-host'
  const names: Record<RuntimeResourceComponentId, string> = {
    'occt-runtime': 'OCCT Runtime',
    'scrcpy-server': 'Android scrcpy server',
    'agent-device-android-helpers': 'agent-device Android Helper',
  }
  return {
    id: componentId,
    name: names[componentId],
    description,
    kind: 'Runtime',
    installationState: damaged
      ? 'unavailable'
      : installed || fallbackAvailable
        ? 'installed'
        : 'not-installed',
    installationLabel: damaged
      ? '管理版本损坏 · 可修复'
      : installed
        ? awaitingHost
          ? '已下载 · 待宿主支持'
          : '已安装 · Studio 管理'
        : fallbackAvailable
          ? '已安装 · 随应用'
          : '未安装',
    installedVersion: installed ?? (fallbackAvailable ? bundledVersion : null),
    constrainedVersion: `仅 ${status?.constrainedVersion ?? bundledVersion}`,
    availableVersion: status?.availableVersion ?? null,
    managerKind: status ? 'runtime-resource' : undefined,
    managedInstalled: Boolean(installed || damaged),
    updateAvailable: status?.updateAvailable ?? false,
    busy: installing,
    operationComponentId: componentId,
  }
}

export function ComponentManagementSettings(): React.ReactElement {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeRuntimeStatus | null>(null)
  const [managedClaudeStatus, setManagedClaudeStatus] = useState<ManagedClaudeRuntimeStatus | null>(
    null,
  )
  const [cadStatus, setCadStatus] = useState<CadBackendStatus | null>(null)
  const [runtimeResources, setRuntimeResources] = useState<RuntimeResourceStatus[]>([])
  const [claudeFailed, setClaudeFailed] = useState(false)
  const [busyOperation, setBusyOperation] = useState<{
    id: string
    operation: ComponentOperation
  } | null>(null)
  const [installMessage, setInstallMessage] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [runtimeResult, managedResult, cadResult, resourcesResult] = await Promise.allSettled([
      window.cclinkStudio.settings.getClaudeRuntimeStatus(),
      window.cclinkStudio.runtimeComponents.getManagedClaudeStatus(),
      window.cclinkStudio.cad.getBackendStatus(),
      window.cclinkStudio.runtimeComponents.listRuntimeResources(),
    ])

    if (runtimeResult.status === 'fulfilled' && runtimeResult.value.success) {
      setClaudeStatus(runtimeResult.value.status ?? null)
      setClaudeFailed(!runtimeResult.value.status)
    } else {
      setClaudeFailed(true)
    }

    if (managedResult.status === 'fulfilled') {
      setManagedClaudeStatus(managedResult.value)
      if (managedResult.value.failure) {
        setInstallMessage(
          `${managedResult.value.failure.code}: ${managedResult.value.failure.message}`,
        )
      }
    } else {
      setClaudeFailed(true)
    }

    if (cadResult.status === 'fulfilled') {
      setCadStatus(cadResult.value)
    }
    if (resourcesResult.status === 'fulfilled') {
      setRuntimeResources(resourcesResult.value)
      const failure = resourcesResult.value.find((item) => item.failure)?.failure
      if (failure) setInstallMessage(`${failure.code}: ${failure.message}`)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!busyOperation) return
    const timer = window.setInterval(() => void refresh(), 400)
    return () => window.clearInterval(timer)
  }, [busyOperation, refresh])

  const runClaudeOperation = useCallback(
    async (operation: ComponentOperation): Promise<void> => {
      if (
        operation === 'uninstall' &&
        !window.confirm('卸载 Studio 管理的 Claude Runtime？Agent 配置和 API Key 会保留。')
      ) {
        return
      }
      setBusyOperation({ id: 'claude-code-runtime', operation })
      setInstallMessage(null)
      try {
        const api = window.cclinkStudio.runtimeComponents
        const result =
          operation === 'check'
            ? await api.checkManagedClaude()
            : operation === 'install'
              ? await api.installManagedClaude()
              : operation === 'repair'
                ? await api.repairManagedClaude()
                : await api.uninstallManagedClaude()
        setManagedClaudeStatus(result.status)
        setInstallMessage(
          result.success
            ? operation === 'check'
              ? result.status.updateAvailable
                ? `发现可更新版本 ${result.status.availableVersion ?? ''}。`
                : `Claude Runtime 检查完成：当前可信目录没有更新。`
              : operation === 'uninstall'
                ? 'Claude Runtime 已卸载；Agent 配置和 API Key 已保留。'
                : operation === 'repair'
                  ? `Claude Runtime ${result.status.installedVersions[0] ?? ''} 已重新下载并校验。`
                  : `Claude Runtime ${result.status.installedVersions[0] ?? ''} 已安装，可在 Agent 设置中启用。`
            : (result.error ?? `Claude Runtime ${operationLabel(operation)}失败`),
        )
      } catch (error) {
        setInstallMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setBusyOperation(null)
        await refresh()
      }
    },
    [refresh],
  )

  const runRuntimeResourceOperation = useCallback(
    async (
      componentId: RuntimeResourceComponentId,
      operation: ComponentOperation,
    ): Promise<void> => {
      const current = runtimeResources.find((item) => item.componentId === componentId)
      if (
        operation === 'uninstall' &&
        !window.confirm(
          `卸载 Studio 管理的 ${current?.displayName ?? componentId}？随 App 提供的回退资源不会删除。`,
        )
      ) {
        return
      }
      setBusyOperation({ id: componentId, operation })
      setInstallMessage(null)
      try {
        const api = window.cclinkStudio.runtimeComponents
        const result =
          operation === 'check'
            ? await api.checkRuntimeResource(componentId)
            : operation === 'install'
              ? await api.installRuntimeResource(componentId)
              : operation === 'repair'
                ? await api.repairRuntimeResource(componentId)
                : await api.uninstallRuntimeResource(componentId)
        setInstallMessage(
          result.success
            ? operation === 'check'
              ? result.status.updateAvailable
                ? `${result.status.displayName} 可更新到 ${result.status.availableVersion}。`
                : `${result.status.displayName} 检查完成：当前可信目录没有更新。`
              : operation === 'uninstall'
                ? `${result.status.displayName} 的管理版本已卸载，随 App 回退资源不受影响。`
                : operation === 'repair'
                  ? `${result.status.displayName} ${result.status.installedVersion ?? ''} 已重新下载并校验。`
                  : result.status.activation === 'awaiting-host'
                    ? `${result.status.displayName} ${result.status.installedVersion ?? ''} 已下载并校验；当前宿主版本尚不能切换使用。`
                    : `${result.status.displayName} ${result.status.installedVersion ?? ''} 已安装并启用。`
            : (result.error ?? `${result.status.displayName} ${operationLabel(operation)}失败`),
        )
      } catch (error) {
        setInstallMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setBusyOperation(null)
        await refresh()
      }
    },
    [refresh, runtimeResources],
  )

  const resourceStatus = useCallback(
    (componentId: RuntimeResourceComponentId) =>
      runtimeResources.find((item) => item.componentId === componentId) ?? null,
    [runtimeResources],
  )

  const rows = useMemo(
    () => [
      claudeRow(claudeStatus, managedClaudeStatus, claudeFailed),
      runtimeResourceRow(
        'occt-runtime',
        resourceStatus('occt-runtime'),
        cadStatus?.version ?? '0.0.23',
        'STEP/STP 结构件转换 WASM',
        Boolean(cadStatus?.available),
      ),
      runtimeResourceRow(
        'scrcpy-server',
        resourceStatus('scrcpy-server'),
        '2.3.1',
        'Android 真机画面与控制服务',
      ),
      runtimeResourceRow(
        'agent-device-android-helpers',
        resourceStatus('agent-device-android-helpers'),
        '0.17.2',
        'Android 语义快照与多点触控辅助 APK',
      ),
      ...BUILTIN_ROWS,
    ],
    [cadStatus, claudeFailed, claudeStatus, managedClaudeStatus, resourceStatus],
  )

  return (
    <section className="settings-section component-management-settings">
      <div className="component-table-shell">
        <table className="component-table">
          <thead>
            <tr>
              <th>能力</th>
              <th>类型</th>
              <th>安装状态</th>
              <th>限定版本</th>
              <th>可用版本</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const currentBusy = busyOperation?.id === row.id || row.busy
              const managedClaudeActive =
                row.managerKind === 'claude' && claudeStatus?.active?.source === 'managed'
              const progress =
                row.managerKind === 'claude'
                  ? managedClaudeStatus?.progress?.percent
                  : row.operationComponentId
                    ? resourceStatus(row.operationComponentId)?.progress?.percent
                    : null
              return (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.description}</small>
                  </td>
                  <td>
                    <span className={`component-kind component-kind-${row.kind}`}>{row.kind}</span>
                  </td>
                  <td>
                    <div className="component-install-summary">
                      <span className={`component-install-state ${row.installationState}`}>
                        <span />
                        {row.installationLabel}
                      </span>
                      {row.installedVersion && (
                        <small className="component-installed-version">
                          版本 {row.installedVersion}
                        </small>
                      )}
                    </div>
                  </td>
                  <td>{row.constrainedVersion}</td>
                  <td>
                    {row.availableVersion
                      ? `${row.availableVersion}${row.updateAvailable ? ' · 可更新' : ''}`
                      : '未接入更新源'}
                  </td>
                  <td>
                    {row.managerKind ? (
                      <div className="component-row-actions">
                        <button
                          type="button"
                          className="settings-secondary-btn component-row-action"
                          disabled={Boolean(currentBusy)}
                          onClick={() =>
                            void (row.managerKind === 'claude'
                              ? runClaudeOperation('check')
                              : runRuntimeResourceOperation(row.operationComponentId!, 'check'))
                          }
                        >
                          {busyOperation?.id === row.id && busyOperation.operation === 'check'
                            ? '检查中'
                            : '检查'}
                        </button>
                        {!row.managedInstalled ? (
                          <button
                            type="button"
                            className="settings-secondary-btn component-row-action"
                            disabled={Boolean(currentBusy)}
                            onClick={() =>
                              void (row.managerKind === 'claude'
                                ? runClaudeOperation('install')
                                : runRuntimeResourceOperation(row.operationComponentId!, 'install'))
                            }
                          >
                            {busyOperation?.id === row.id &&
                            progress !== null &&
                            progress !== undefined
                              ? `${progress}%`
                              : '安装'}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="settings-secondary-btn component-row-action"
                              disabled={Boolean(currentBusy)}
                              onClick={() =>
                                void (row.managerKind === 'claude'
                                  ? runClaudeOperation('repair')
                                  : runRuntimeResourceOperation(
                                      row.operationComponentId!,
                                      'repair',
                                    ))
                              }
                            >
                              {busyOperation?.id === row.id &&
                              progress !== null &&
                              progress !== undefined
                                ? `${progress}%`
                                : row.updateAvailable
                                  ? '更新'
                                  : '修复'}
                            </button>
                            <button
                              type="button"
                              className="settings-secondary-btn component-row-action component-row-action-danger"
                              disabled={Boolean(currentBusy || managedClaudeActive)}
                              title={
                                managedClaudeActive
                                  ? '请先在 Agent 设置中切换到系统或自定义 Runtime'
                                  : '卸载 Studio 管理的版本'
                              }
                              onClick={() =>
                                void (row.managerKind === 'claude'
                                  ? runClaudeOperation('uninstall')
                                  : runRuntimeResourceOperation(
                                      row.operationComponentId!,
                                      'uninstall',
                                    ))
                              }
                            >
                              卸载
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="settings-secondary-btn component-row-action"
                        disabled
                        title="该能力随完整 App 更新"
                      >
                        随 App 更新
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {installMessage && <p className="settings-description">{installMessage}</p>}
    </section>
  )
}

function operationLabel(operation: ComponentOperation): string {
  return operation === 'check'
    ? '检查'
    : operation === 'install'
      ? '安装'
      : operation === 'repair'
        ? '修复'
        : '卸载'
}
