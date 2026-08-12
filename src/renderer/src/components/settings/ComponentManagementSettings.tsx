import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClaudeRuntimeStatus } from '@shared/claude-runtime'
import type { CadBackendStatus } from '@shared/ipc/cad'
import type {
  ManagedClaudeRuntimeStatus,
  RuntimeResourceComponentId,
  RuntimeResourceStatus,
} from '@shared/ipc/runtime-components'
import { APP_VERSION } from '../../app-metadata'

type CapabilityKind = 'Runtime' | '能力插件' | '内容包'
type InstallationState = 'installed' | 'not-installed' | 'checking' | 'unavailable'
const CLAUDE_RUNTIME_CONSTRAINED_VERSION = '2.1.211'

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
  actionEnabled?: boolean
  actionTitle?: string
  installComponentId?: RuntimeResourceComponentId
}

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
    managed?.phase === 'downloading' ||
    managed?.phase === 'verifying' ||
    managed?.phase === 'installing'
  return {
    id: 'claude-code-runtime',
    name: 'Claude Code Runtime',
    description: '本地 Agent 执行引擎',
    kind: 'Runtime',
    installationState:
      managedVersion || active ? 'installed' : failed ? 'unavailable' : 'not-installed',
    installationLabel: managedVersion
      ? '已安装 · Studio 管理'
      : active
        ? `已安装 · ${active.source}`
        : failed
          ? '不可用'
          : '未安装',
    installedVersion: managedVersion ?? active?.claudeCodeVersion ?? null,
    constrainedVersion: managed?.constrainedVersion
      ? `仅 ${managed.constrainedVersion}`
      : `仅 ${CLAUDE_RUNTIME_CONSTRAINED_VERSION}`,
    availableVersion: managed?.availableVersion ?? null,
    actionEnabled: Boolean(managed?.supported && !managedVersion && !installing),
    actionTitle: managedVersion
      ? '该限定版本已经安装'
      : installing
        ? '正在安装'
        : managed?.supported
          ? '从固定 npm 包下载安装'
          : '当前平台没有允许的安装包',
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
    status?.phase === 'downloading' ||
    status?.phase === 'verifying' ||
    status?.phase === 'installing'
  const installed = status?.installedVersion ?? null
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
    installationState: installed || fallbackAvailable ? 'installed' : 'not-installed',
    installationLabel: installed
      ? awaitingHost
        ? '已下载 · 待宿主支持'
        : '已安装 · Studio 管理'
      : fallbackAvailable
        ? '已安装 · 随应用'
        : '未安装',
    installedVersion: installed ?? (fallbackAvailable ? bundledVersion : null),
    constrainedVersion: `仅 ${status?.constrainedVersion ?? bundledVersion}`,
    availableVersion: status?.availableVersion ?? null,
    actionEnabled: Boolean(status && !installed && !installing),
    actionTitle: installed
      ? awaitingHost
        ? '资源已经校验下载；当前 agent-device 宿主尚不能切换到用户目录资源'
        : '该限定版本已经安装'
      : installing
        ? '正在安装'
        : '从固定可信来源下载安装',
    installComponentId: componentId,
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
  const [installBusyId, setInstallBusyId] = useState<string | null>(null)
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
    if (!installBusyId) return
    const timer = window.setInterval(() => void refresh(), 400)
    return () => window.clearInterval(timer)
  }, [installBusyId, refresh])

  const installClaudeRuntime = useCallback(async (): Promise<void> => {
    setInstallBusyId('claude-code-runtime')
    setInstallMessage(null)
    try {
      const result = await window.cclinkStudio.runtimeComponents.installManagedClaude()
      setManagedClaudeStatus(result.status)
      setInstallMessage(
        result.success
          ? `Claude Runtime ${result.status.installedVersions[0] ?? ''} 已安装，可在 Agent 设置中启用。`
          : (result.error ?? 'Claude Runtime 安装失败'),
      )
    } catch (error) {
      setInstallMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setInstallBusyId(null)
      await refresh()
    }
  }, [refresh])

  const installRuntimeResource = useCallback(
    async (componentId: RuntimeResourceComponentId): Promise<void> => {
      setInstallBusyId(componentId)
      setInstallMessage(null)
      try {
        const result =
          await window.cclinkStudio.runtimeComponents.installRuntimeResource(componentId)
        setInstallMessage(
          result.success
            ? result.status.activation === 'awaiting-host'
              ? `${result.status.displayName} ${result.status.installedVersion ?? ''} 已下载并校验；当前宿主版本尚不能切换使用。`
              : `${result.status.displayName} ${result.status.installedVersion ?? ''} 已安装并启用。`
            : (result.error ?? `${result.status.displayName} 安装失败`),
        )
      } catch (error) {
        setInstallMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setInstallBusyId(null)
        await refresh()
      }
    },
    [refresh],
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
              const canInstall = row.actionEnabled ?? false
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
                  <td>{row.availableVersion ?? '未接入更新源'}</td>
                  <td>
                    <button
                      type="button"
                      className="settings-secondary-btn component-row-action"
                      disabled={!canInstall}
                      title={row.actionTitle ?? '更新源尚未接入'}
                      onClick={
                        row.id === 'claude-code-runtime'
                          ? () => void installClaudeRuntime()
                          : row.installComponentId
                            ? () => void installRuntimeResource(row.installComponentId!)
                            : undefined
                      }
                    >
                      {installBusyId === row.id
                        ? row.id === 'claude-code-runtime'
                          ? managedClaudeStatus?.progress?.percent !== null &&
                            managedClaudeStatus?.progress?.percent !== undefined
                            ? `${managedClaudeStatus.progress.percent}%`
                            : '安装中'
                          : resourceStatus(row.id as RuntimeResourceComponentId)?.progress
                                ?.percent !== null &&
                              resourceStatus(row.id as RuntimeResourceComponentId)?.progress
                                ?.percent !== undefined
                            ? `${resourceStatus(row.id as RuntimeResourceComponentId)?.progress?.percent}%`
                            : '安装中'
                        : '安装'}
                    </button>
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
