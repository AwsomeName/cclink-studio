import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClaudeRuntimeStatus } from '@shared/claude-runtime'
import type { CadBackendStatus } from '@shared/ipc/cad'
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
}

const BUILTIN_ROWS: ManagedCapabilityRow[] = [
  {
    id: 'scrcpy-server',
    name: 'Android scrcpy server',
    description: 'Android 真机画面与控制服务',
    kind: 'Runtime',
    installationState: 'installed',
    installationLabel: '已安装 · 随应用',
    installedVersion: '2.3.1',
    constrainedVersion: '仅 2.3.1',
    availableVersion: null,
  },
  {
    id: 'runtime-helper',
    name: 'WASM / 辅助程序',
    description: '后续受控 Runtime 扩展位置',
    kind: 'Runtime',
    installationState: 'not-installed',
    installationLabel: '未安装',
    installedVersion: null,
    constrainedVersion: '待定义',
    availableVersion: null,
  },
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

function claudeRow(status: ClaudeRuntimeStatus | null, failed: boolean): ManagedCapabilityRow {
  const active = status?.active
  return {
    id: 'claude-code-runtime',
    name: 'Claude Code Runtime',
    description: '本地 Agent 执行引擎',
    kind: 'Runtime',
    installationState: active ? 'installed' : failed ? 'unavailable' : 'checking',
    installationLabel: active ? `已安装 · ${active.source}` : failed ? '不可用' : '检测中',
    installedVersion: active?.claudeCodeVersion ?? null,
    constrainedVersion: `仅 ${CLAUDE_RUNTIME_CONSTRAINED_VERSION}`,
    availableVersion: null,
  }
}

function cadRow(status: CadBackendStatus | null, failed: boolean): ManagedCapabilityRow {
  return {
    id: 'cad-runtime',
    name: 'CAD / OCCT / FreeCAD Runtime',
    description: 'STEP/STP 等结构件转换后端',
    kind: 'Runtime',
    installationState: status?.available
      ? 'installed'
      : failed || status
        ? 'not-installed'
        : 'checking',
    installationLabel: status?.available
      ? `已安装 · ${status.kind}`
      : failed || status
        ? '未安装或未启用'
        : '检测中',
    installedVersion: status?.available ? (status.version ?? '版本未知') : null,
    constrainedVersion: '待定义',
    availableVersion: null,
  }
}

export function ComponentManagementSettings(): React.ReactElement {
  const [claudeStatus, setClaudeStatus] = useState<ClaudeRuntimeStatus | null>(null)
  const [cadStatus, setCadStatus] = useState<CadBackendStatus | null>(null)
  const [claudeFailed, setClaudeFailed] = useState(false)
  const [cadFailed, setCadFailed] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const [runtimeResult, cadResult] = await Promise.allSettled([
      window.cclinkStudio.settings.getClaudeRuntimeStatus(),
      window.cclinkStudio.cad.getBackendStatus(),
    ])

    if (runtimeResult.status === 'fulfilled' && runtimeResult.value.success) {
      setClaudeStatus(runtimeResult.value.status ?? null)
      setClaudeFailed(!runtimeResult.value.status)
    } else {
      setClaudeFailed(true)
    }

    if (cadResult.status === 'fulfilled') {
      setCadStatus(cadResult.value)
      setCadFailed(false)
    } else {
      setCadFailed(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const rows = useMemo(
    () => [claudeRow(claudeStatus, claudeFailed), cadRow(cadStatus, cadFailed), ...BUILTIN_ROWS],
    [cadFailed, cadStatus, claudeFailed, claudeStatus],
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
              const canUpdate = row.availableVersion !== null
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
                      disabled={!canUpdate}
                      title={canUpdate ? undefined : '更新源尚未接入'}
                    >
                      安装
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
