import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentCapabilityStatus,
  AgentToolModuleStatus,
  ExternalMcpServer,
  ExternalMcpServerInput,
} from '@shared/ipc/agent'
import type { AppSettings, PermissionMode } from '@shared/ipc/settings'
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconPlus,
  IconRefresh,
} from '../common/Icons'
import { Toggle } from '../common/Toggle'

interface AgentCapabilitiesSettingsProps {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
}

interface McpFormState {
  originalName: string | null
  name: string
  transport: ExternalMcpServer['transport']
  command: string
  args: string
  url: string
  env: string
  headers: string
  clearCredentials: boolean
  hasStoredCredentials: boolean
  enabled: boolean
}

const EMPTY_FORM: McpFormState = {
  originalName: null,
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  headers: '',
  clearCredentials: false,
  hasStoredCredentials: false,
  enabled: true,
}

const CAPABILITY_ORDER = [
  'agent-backend',
  'mcp',
  'editor',
  'terminal',
  'browser',
  'android',
  'agent-device',
  'meshy',
  'data-source',
  'hardware',
  'cad',
]

const CAPABILITY_STATE_LABEL: Record<AgentCapabilityStatus['state'], string> = {
  ready: '就绪',
  degraded: '降级',
  unavailable: '不可用',
  failed: '失败',
}

export function AgentCapabilitiesSettings({
  settings,
  updateSettings,
}: AgentCapabilitiesSettingsProps): React.ReactElement {
  const [capabilities, setCapabilities] = useState<AgentCapabilityStatus[]>([])
  const [modules, setModules] = useState<AgentToolModuleStatus[]>([])
  const [servers, setServers] = useState<ExternalMcpServer[]>([])
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const [pendingModules, setPendingModules] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<McpFormState | null>(null)
  const [savingServer, setSavingServer] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [nextCapabilities, nextModules, nextServers] = await Promise.all([
        window.cclinkStudio.agent.getCapabilities(),
        window.cclinkStudio.agent.listToolModules(),
        window.cclinkStudio.agent.listMcpServers(),
      ])
      setCapabilities(nextCapabilities)
      setModules(nextModules)
      setServers(nextServers)
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const orderedCapabilities = useMemo(
    () =>
      [...capabilities].sort(
        (left, right) => CAPABILITY_ORDER.indexOf(left.name) - CAPABILITY_ORDER.indexOf(right.name),
      ),
    [capabilities],
  )

  const toggleModule = async (moduleId: string, enabled: boolean): Promise<void> => {
    setPendingModules((current) => new Set(current).add(moduleId))
    setError(null)
    try {
      const result = await window.cclinkStudio.agent.setToolModuleEnabled(moduleId, enabled)
      if (!result.success) throw new Error(result.error ?? '工具模块更新失败')
      setModules((current) =>
        current.map((module) => (module.id === moduleId ? { ...module, enabled } : module)),
      )
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setPendingModules((current) => {
        const next = new Set(current)
        next.delete(moduleId)
        return next
      })
    }
  }

  const toggleExternalServer = async (server: ExternalMcpServer): Promise<void> => {
    setError(null)
    const updated = await window.cclinkStudio.agent.updateMcpServer(server.name, {
      enabled: !server.enabled,
    })
    if (!updated) {
      setError(`无法更新 MCP Server: ${server.name}`)
      return
    }
    setServers((current) =>
      current.map((item) =>
        item.name === server.name ? { ...item, enabled: !item.enabled } : item,
      ),
    )
  }

  const editServer = (server: ExternalMcpServer): void => {
    setForm({
      originalName: server.name,
      name: server.name,
      transport: server.transport,
      command: server.command ?? '',
      args: (server.args ?? []).join('\n'),
      url: server.url ?? '',
      env: '',
      headers: '',
      clearCredentials: false,
      hasStoredCredentials: server.credentialConfigured || server.credentialMissing,
      enabled: server.enabled,
    })
  }

  const saveServer = async (): Promise<void> => {
    if (!form) return
    setSavingServer(true)
    setError(null)
    try {
      const server = buildServer(form)
      if (form.originalName) {
        const updated = await window.cclinkStudio.agent.updateMcpServer(form.originalName, server)
        if (!updated) throw new Error('更新失败，请检查名称是否重复或配置是否合法')
      } else {
        const result = await window.cclinkStudio.agent.addMcpServer(server)
        if (!result.success) throw new Error(result.error ?? '添加 MCP Server 失败')
      }
      setForm(null)
      setServers(await window.cclinkStudio.agent.listMcpServers())
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setSavingServer(false)
    }
  }

  const removeServer = async (server: ExternalMcpServer): Promise<void> => {
    if (!window.confirm(`删除外部 MCP Server“${server.name}”？`)) return
    const removed = await window.cclinkStudio.agent.removeMcpServer(server.name)
    if (!removed) {
      setError(`无法删除 MCP Server: ${server.name}`)
      return
    }
    setServers((current) => current.filter((item) => item.name !== server.name))
    if (form?.originalName === server.name) setForm(null)
  }

  const copyServer = async (server: ExternalMcpServer): Promise<void> => {
    const newName = window.prompt('复制后的 MCP Server 名称', `${server.name}_copy`)?.trim()
    if (!newName) return
    setError(null)
    try {
      const copied = await window.cclinkStudio.agent.copyMcpServer(server.name, newName)
      if (!copied) throw new Error(`无法复制 MCP Server: ${server.name}`)
      setServers(await window.cclinkStudio.agent.listMcpServers())
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    }
  }

  const reloadExternalConfig = async (): Promise<void> => {
    setError(null)
    try {
      await window.cclinkStudio.agent.reloadMcpConfig()
      setServers(await window.cclinkStudio.agent.listMcpServers())
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    }
  }

  return (
    <section className="settings-section agent-capabilities-settings">
      <div className="agent-capabilities-heading">
        <div>
          <h2>Agent 能力</h2>
          <p>统一管理 SDK 可见的内置工具、外部 MCP 和操作确认策略。</p>
        </div>
        <button
          type="button"
          className="agent-capabilities-icon-button"
          title="刷新运行状态"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <IconRefresh size={14} />
        </button>
      </div>

      {error && <div className="agent-capabilities-error">{error}</div>}

      <div className="agent-capabilities-block">
        <div className="agent-capabilities-block-title">
          <div>
            <h3>运行状态</h3>
            <p>这是当前进程的真实可用性，不是配置开关。</p>
          </div>
        </div>
        <div className="agent-runtime-grid">
          {orderedCapabilities.map((capability) => (
            <div className="agent-runtime-item" key={capability.name}>
              <span className={`agent-capability-dot ${capability.state}`} />
              <span>{capability.label}</span>
              <small>
                {CAPABILITY_STATE_LABEL[capability.state]}
                {capability.reason ? ` · ${capability.reason}` : ''}
              </small>
            </div>
          ))}
          {!loading && orderedCapabilities.length === 0 && (
            <span className="agent-capabilities-empty">Agent runtime 尚未就绪。</span>
          )}
        </div>
      </div>

      <div className="agent-capabilities-block">
        <div className="agent-capabilities-block-title">
          <div>
            <h3>权限策略</h3>
            <p>决定写入、发布、删除等操作何时需要你确认。</p>
          </div>
          <select
            className="settings-select"
            value={settings.permissionMode}
            onChange={(event) =>
              updateSettings({ permissionMode: event.target.value as PermissionMode })
            }
          >
            <option value="auto">自动</option>
            <option value="categorized">按风险确认</option>
            <option value="strict">每次确认</option>
          </select>
        </div>
        <p className="agent-capabilities-note">
          自动模式仍会尊重工具声明的强制确认策略；严格模式不会改变工具本身的可用范围。
        </p>
      </div>

      <div className="agent-capabilities-block">
        <div className="agent-capabilities-block-title">
          <div>
            <h3>内置工具</h3>
            <p>关闭后会从 SDK 工具列表移除，并拒绝已经缓存的旧调用。</p>
          </div>
          <span>
            {modules.reduce((sum, module) => sum + (module.enabled ? module.toolCount : 0), 0)}{' '}
            个已暴露
          </span>
        </div>

        <div className="agent-module-list">
          {modules.map((module) => {
            const expanded = expandedModules.has(module.id)
            return (
              <div className="agent-module" key={module.id}>
                <div className="agent-module-row">
                  <button
                    type="button"
                    className="agent-module-expand"
                    title={expanded ? '收起工具列表' : '展开工具列表'}
                    onClick={() =>
                      setExpandedModules((current) => toggleSetValue(current, module.id))
                    }
                  >
                    {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                  </button>
                  <span
                    className={`agent-capability-dot ${module.available ? 'available' : 'unavailable'}`}
                  />
                  <div className="agent-module-copy">
                    <strong>{module.label}</strong>
                    <span>{module.description}</span>
                    {!module.available && <small>{module.reason}</small>}
                  </div>
                  <span className="agent-module-count">{module.toolCount} 个工具</span>
                  <Toggle
                    checked={module.enabled}
                    disabled={pendingModules.has(module.id)}
                    onChange={(enabled) => void toggleModule(module.id, enabled)}
                  />
                </div>
                {expanded && (
                  <div className="agent-tool-list">
                    {module.tools.map((tool) => (
                      <div className="agent-tool-row" key={tool.name}>
                        <code>{tool.name}</code>
                        <span>{tool.description}</span>
                        <em className={`agent-tool-risk ${tool.risk}`}>{riskLabel(tool.risk)}</em>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="agent-capabilities-block">
        <div className="agent-capabilities-block-title">
          <div>
            <h3>外部 MCP</h3>
            <p>全局配置；受控授权支持完成前不会交给 Agent Runtime 启动或发现工具。</p>
          </div>
          <div className="agent-capabilities-actions">
            <button
              type="button"
              className="agent-capabilities-icon-button"
              title="从配置文件重新加载"
              onClick={() => void reloadExternalConfig()}
            >
              <IconRefresh size={13} />
            </button>
            <button
              type="button"
              className="agent-capabilities-add-button"
              onClick={() => setForm({ ...EMPTY_FORM })}
            >
              <IconPlus size={13} />
              添加
            </button>
          </div>
        </div>

        <div className="agent-mcp-list">
          {servers.map((server) => (
            <div className="agent-mcp-row" key={server.name}>
              <span
                className={`agent-capability-dot ${server.enabled ? 'available' : 'disabled'}`}
              />
              <div className="agent-mcp-copy">
                <strong>{server.name}</strong>
                <span>
                  {server.transport.toUpperCase()} · {serverEndpoint(server)} ·{' '}
                  {server.enabled ? '已配置，等待受控授权支持' : '已停用'}
                  {server.credentialMissing
                    ? ' · 凭证引用缺失'
                    : server.credentialConfigured
                      ? ` · 凭证已保存（${[...server.envKeys, ...server.headerNames].length} 项）`
                      : ' · 无凭证'}
                </span>
              </div>
              <button type="button" onClick={() => void copyServer(server)}>
                复制
              </button>
              <button type="button" onClick={() => editServer(server)}>
                编辑
              </button>
              <button type="button" className="danger" onClick={() => void removeServer(server)}>
                删除
              </button>
              <Toggle checked={server.enabled} onChange={() => void toggleExternalServer(server)} />
            </div>
          ))}
          {servers.length === 0 && (
            <span className="agent-capabilities-empty">尚未配置外部 MCP Server。</span>
          )}
        </div>

        {form && (
          <McpServerForm
            form={form}
            saving={savingServer}
            onChange={setForm}
            onCancel={() => setForm(null)}
            onSave={() => void saveServer()}
          />
        )}

        <p className="agent-capabilities-note">
          环境变量和请求头由本地 CredentialService 保存；配置文件只含不可变 revision
          引用，页面不会读取 或回显凭证值。
        </p>
      </div>
    </section>
  )
}

function McpServerForm({
  form,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  form: McpFormState
  saving: boolean
  onChange: (form: McpFormState) => void
  onCancel: () => void
  onSave: () => void
}): React.ReactElement {
  const set = <K extends keyof McpFormState>(key: K, value: McpFormState[K]): void => {
    onChange({ ...form, [key]: value })
  }

  return (
    <div className="agent-mcp-form">
      <div className="agent-mcp-form-header">
        <strong>{form.originalName ? '编辑 MCP Server' : '添加 MCP Server'}</strong>
        <button type="button" title="关闭" onClick={onCancel}>
          <IconClose size={13} />
        </button>
      </div>
      <label>
        <span>名称</span>
        <input
          value={form.name}
          placeholder="例如 knowledge"
          onChange={(event) => set('name', event.target.value)}
        />
      </label>
      <label>
        <span>传输</span>
        <select
          value={form.transport}
          onChange={(event) =>
            set('transport', event.target.value as ExternalMcpServer['transport'])
          }
        >
          <option value="stdio">stdio</option>
          <option value="http">HTTP</option>
          <option value="sse">SSE</option>
        </select>
      </label>
      {form.transport === 'stdio' ? (
        <>
          <label className="wide">
            <span>命令</span>
            <input
              value={form.command}
              placeholder="npx"
              onChange={(event) => set('command', event.target.value)}
            />
          </label>
          <label className="wide">
            <span>参数</span>
            <textarea
              value={form.args}
              placeholder={'每行一个参数，例如\n-y\n@example/mcp-server'}
              onChange={(event) => set('args', event.target.value)}
            />
          </label>
          <label className="wide">
            <span>环境变量</span>
            <textarea
              value={form.env}
              placeholder={
                form.hasStoredCredentials
                  ? '留空则保留已保存凭证；输入 JSON 将创建新 revision'
                  : 'JSON 对象，例如 {"TOKEN":"..."}'
              }
              onChange={(event) => set('env', event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label className="wide">
            <span>URL</span>
            <input
              value={form.url}
              placeholder="https://example.com/mcp"
              onChange={(event) => set('url', event.target.value)}
            />
          </label>
          <label className="wide">
            <span>请求头</span>
            <textarea
              value={form.headers}
              placeholder={
                form.hasStoredCredentials
                  ? '留空则保留已保存凭证；输入 JSON 将创建新 revision'
                  : 'JSON 对象，例如 {"Authorization":"Bearer ..."}'
              }
              onChange={(event) => set('headers', event.target.value)}
            />
          </label>
        </>
      )}
      {form.hasStoredCredentials && (
        <label className="wide agent-mcp-enabled">
          <input
            type="checkbox"
            checked={form.clearCredentials}
            onChange={(event) => set('clearCredentials', event.target.checked)}
          />
          <span>保存时清除当前凭证 revision</span>
        </label>
      )}
      <div className="agent-mcp-form-footer">
        <label className="agent-mcp-enabled">
          <Toggle checked={form.enabled} onChange={(enabled) => set('enabled', enabled)} />
          <span>启用</span>
        </label>
        <div>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" disabled={saving} onClick={onSave}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildServer(form: McpFormState): ExternalMcpServerInput {
  const name = form.name.trim()
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('MCP 名称只能包含字母、数字、下划线和连字符')
  }
  if (form.transport === 'stdio') {
    const command = form.command.trim()
    if (!command) throw new Error('stdio MCP 必须填写命令')
    const credentials = buildCredentialMutation(form, 'env')
    return {
      name,
      transport: 'stdio',
      command,
      args: form.args
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      ...(credentials !== undefined ? { credentials } : {}),
      enabled: form.enabled,
    }
  }

  const url = form.url.trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('请填写 http 或 https MCP URL')
  const credentials = buildCredentialMutation(form, 'headers')
  return {
    name,
    transport: form.transport,
    url,
    ...(credentials !== undefined ? { credentials } : {}),
    enabled: form.enabled,
  }
}

function buildCredentialMutation(
  form: McpFormState,
  kind: 'env' | 'headers',
): ExternalMcpServerInput['credentials'] | undefined {
  if (form.clearCredentials) return null
  const raw = kind === 'env' ? form.env : form.headers
  if (!raw.trim()) return undefined
  const parsed = parseRecord(raw, kind === 'env' ? '环境变量' : '请求头')
  return parsed ? { [kind]: parsed } : undefined
}

function parseRecord(value: string, label: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${label}必须是合法 JSON 对象`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`)
  }
  const entries = Object.entries(parsed)
  if (entries.some(([, item]) => typeof item !== 'string')) {
    throw new Error(`${label}的值必须都是字符串`)
  }
  return Object.fromEntries(entries) as Record<string, string>
}

function serverEndpoint(server: ExternalMcpServer): string {
  if (server.transport === 'stdio') return server.command || '未配置命令'
  return server.url || '未配置 URL'
}

function riskLabel(risk: 'read' | 'write' | 'destructive'): string {
  if (risk === 'read') return '只读'
  if (risk === 'destructive') return '高风险'
  return '写入'
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
