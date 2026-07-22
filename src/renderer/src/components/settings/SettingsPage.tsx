import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, PROVIDER_PRESETS, getPresetBaseUrl } from '@shared/ipc/settings'
import type { ApiFormat, AppSettings, CadBackend, Provider } from '@shared/ipc/settings'
import type { SettingsSecretStatus } from '@shared/ipc/settings'
import type {
  ClaudeRuntimeSelection,
  ClaudeRuntimeSource,
  ClaudeRuntimeStatus,
} from '@shared/claude-runtime'
import type { CadBackendStatus, CadCacheStatus } from '@shared/ipc/cad'
import type { GitBackupAccountStatus } from '@shared/ipc/git-backup'
import { useSettingsStore } from '../../stores'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import {
  IconFile,
  IconGlobe,
  IconKeyboard,
  IconLink,
  IconMonitor,
  IconPaintbrush,
  IconRobot,
  IconSearch,
  IconSettings,
  IconTool,
} from '../common/Icons'
import { Toggle } from '../common/Toggle'
import { AgentCapabilitiesSettings } from './AgentCapabilitiesSettings'

type SettingsSectionId =
  | 'appearance'
  | 'agent'
  | 'agent-capabilities'
  | 'browser'
  | 'editor'
  | 'git-backup'
  | 'cad'
  | 'shortcuts'
  | 'about'
type AppSettingKey = Extract<keyof AppSettings, string>

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  label: string
  icon: (props: { size?: number }) => React.ReactElement
}> = [
  { id: 'appearance', label: '外观', icon: IconPaintbrush },
  { id: 'agent', label: 'Agent', icon: IconRobot },
  { id: 'agent-capabilities', label: 'Agent 能力', icon: IconTool },
  { id: 'browser', label: '浏览器', icon: IconGlobe },
  { id: 'editor', label: '编辑器', icon: IconFile },
  { id: 'git-backup', label: 'Git 备份', icon: IconLink },
  { id: 'cad', label: '硬件与 CAD', icon: IconMonitor },
  { id: 'shortcuts', label: '快捷键', icon: IconKeyboard },
  { id: 'about', label: '关于', icon: IconSettings },
]

const SETTINGS_SEARCH_INDEX: Array<{
  sectionId: SettingsSectionId
  label: string
  description: string
  keywords: string[]
}> = [
  {
    sectionId: 'appearance',
    label: '主题与字号',
    description: '调整桌面壳主题、界面字号和缩放。',
    keywords: ['theme', 'font', 'zoom', '主题', '字号', '缩放'],
  },
  {
    sectionId: 'agent',
    label: 'Agent 后端',
    description: '配置本地 Claude Code 或 OpenAI 兼容 API。',
    keywords: ['agent', 'claude', 'openai', 'model', 'api', '模型'],
  },
  {
    sectionId: 'agent-capabilities',
    label: 'Agent 工具与 MCP',
    description: '管理内置工具、外部 MCP、运行状态和权限策略。',
    keywords: ['agent', 'tool', 'mcp', 'permission', '工具', '能力', '权限'],
  },
  {
    sectionId: 'browser',
    label: '浏览器默认值',
    description: '配置新浏览器 Tab 的缩放和设备模式。',
    keywords: ['browser', 'zoom', 'device', '浏览器'],
  },
  {
    sectionId: 'editor',
    label: '编辑器',
    description: '配置编辑器字体、字号、换行和隐藏文件显示。',
    keywords: ['editor', 'markdown', 'file', '编辑器', '文件'],
  },
  {
    sectionId: 'cad',
    label: '硬件与 CAD',
    description: '启用 STEP/STP 结构件预览，配置本机 FreeCAD 和 CAD 转换缓存。',
    keywords: ['cad', 'freecad', 'step', 'stp', 'hardware', '结构件', '硬件', '预览'],
  },
  {
    sectionId: 'git-backup',
    label: 'Git 备份',
    description: '配置 GitHub 账号并手动备份当前项目。',
    keywords: ['git', 'github', 'backup', '备份', '仓库', 'token'],
  },
  {
    sectionId: 'about',
    label: '开源壳边界',
    description: '查看 CCLink Studio 开源壳说明。',
    keywords: ['cclink', 'studio', 'oss', '开源'],
  },
]

function normalizeSection(section?: string): SettingsSectionId {
  return SETTINGS_SECTIONS.some((item) => item.id === section)
    ? (section as SettingsSectionId)
    : 'appearance'
}

function isModified<K extends AppSettingKey>(key: K, settings: AppSettings): boolean {
  return settings[key] !== DEFAULT_SETTINGS[key]
}

function cadBackendLabel(value: CadBackend): string {
  switch (value) {
    case 'none':
      return '未启用'
    case 'local-freecad':
      return '本机 FreeCAD'
    case 'managed-freecad':
      return '托管 FreeCAD（未实现）'
    case 'occt-experimental':
      return 'OpenCascade 实验后端'
  }
}

function cadStatusLabel(status: CadBackendStatus | null): string {
  if (!status) return '尚未检测'
  if (status.available) {
    const version = status.version ? ` · ${status.version}` : ''
    const path = status.path ? ` · ${status.path}` : ''
    return `${cadBackendLabel(status.kind)} 可用${version}${path}`
  }
  return status.error?.message ?? `${cadBackendLabel(status.kind)} 不可用`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function SettingsRow({
  settingKey,
  settings,
  onReset,
  children,
}: {
  settingKey: AppSettingKey
  settings: AppSettings
  onReset: (key: AppSettingKey) => void
  children: React.ReactNode
}): React.ReactElement {
  const modified = isModified(settingKey, settings)
  return (
    <div className={`settings-row ${modified ? 'modified' : ''}`}>
      {modified && <span className="settings-modified-dot" />}
      {children}
      {modified && (
        <button
          className="settings-reset-setting"
          type="button"
          onClick={() => onReset(settingKey)}
          title="恢复默认值"
        >
          <IconSettings size={12} />
        </button>
      )}
    </div>
  )
}

interface SettingsPageProps {
  initialSection?: string
}

export function SettingsPage({ initialSection }: SettingsPageProps = {}): React.ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    normalizeSection(initialSection),
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [secretStatus, setSecretStatus] = useState<SettingsSecretStatus | null>(null)
  const [secretBusy, setSecretBusy] = useState(false)
  const [secretMessage, setSecretMessage] = useState<string | null>(null)
  const [claudeRuntimeStatus, setClaudeRuntimeStatus] = useState<ClaudeRuntimeStatus | null>(null)
  const [claudeRuntimeSource, setClaudeRuntimeSource] = useState<ClaudeRuntimeSource>('system')
  const [claudeRuntimePath, setClaudeRuntimePath] = useState('')
  const [claudeRuntimeBusy, setClaudeRuntimeBusy] = useState(false)
  const [claudeRuntimeMessage, setClaudeRuntimeMessage] = useState<string | null>(null)
  const [claudeConnectionBusy, setClaudeConnectionBusy] = useState(false)
  const [claudeConnectionResult, setClaudeConnectionResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [cadStatus, setCadStatus] = useState<CadBackendStatus | null>(null)
  const [cadCacheStatus, setCadCacheStatus] = useState<CadCacheStatus | null>(null)
  const [cadChecking, setCadChecking] = useState(false)
  const [cadActionError, setCadActionError] = useState<string | null>(null)
  const [gitUsername, setGitUsername] = useState('')
  const [gitToken, setGitToken] = useState('')
  const [gitStatus, setGitStatus] = useState<GitBackupAccountStatus | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitMessage, setGitMessage] = useState<string | null>(null)
  const settings = useSettingsStore((state) => state.settings)
  const loading = useSettingsStore((state) => state.loading)
  const error = useSettingsStore((state) => state.error)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.resetSettings)
  const resetSetting = useSettingsStore((state) => state.resetSetting)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await window.cclinkStudio.gitBackup.getAccountStatus()
      setGitStatus(status)
    } catch (nextError: unknown) {
      setGitMessage(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [])

  const refreshSecretStatus = useCallback(async (): Promise<void> => {
    try {
      setSecretStatus(await window.cclinkStudio.settings.getSecretStatus())
    } catch (nextError: unknown) {
      setSecretMessage(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [])

  const refreshClaudeRuntimeStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await window.cclinkStudio.settings.getClaudeRuntimeStatus()
      if (!result.success || !result.status) {
        setClaudeRuntimeMessage(result.error ?? '无法读取 Claude Code 运行时状态')
        return
      }
      setClaudeRuntimeStatus(result.status)
    } catch (nextError: unknown) {
      setClaudeRuntimeMessage(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (initialSection) setActiveSection(normalizeSection(initialSection))
  }, [initialSection])

  useEffect(() => {
    setGitUsername(settings.gitBackupUsername)
  }, [settings.gitBackupUsername])

  useEffect(() => {
    if (activeSection === 'git-backup') void refreshGitStatus()
  }, [activeSection, refreshGitStatus])

  useEffect(() => {
    if (activeSection === 'agent') void refreshSecretStatus()
  }, [activeSection, refreshSecretStatus])

  useEffect(() => {
    setClaudeRuntimeSource(settings.claudeRuntimeSource)
    setClaudeRuntimePath(settings.claudeCodePath)
  }, [settings.claudeCodePath, settings.claudeRuntimeSource])

  useEffect(() => {
    if (activeSection === 'agent') void refreshClaudeRuntimeStatus()
  }, [activeSection, refreshClaudeRuntimeStatus])

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return SETTINGS_SEARCH_INDEX.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.keywords.some((keyword) => keyword.toLowerCase().includes(query)),
    )
  }, [searchQuery])

  const update = (partial: Partial<AppSettings>): void => {
    void updateSettings(partial)
  }

  const resetOne = (key: AppSettingKey): void => {
    setClaudeConnectionResult(null)
    void resetSetting(key)
  }

  const handleProviderChange = (provider: Provider): void => {
    setClaudeConnectionResult(null)
    const preset = PROVIDER_PRESETS[provider]
    const apiBaseUrl = getPresetBaseUrl(provider, settings.apiFormat)
    update({
      provider,
      apiBaseUrl,
      modelName: provider === 'custom' ? settings.modelName : preset.defaultModel,
    })
  }

  const handleApiFormatChange = (apiFormat: ApiFormat): void => {
    setClaudeConnectionResult(null)
    const apiBaseUrl = getPresetBaseUrl(settings.provider, apiFormat)
    update({
      apiFormat,
      backendType: apiFormat === 'anthropic' ? 'claude-code' : 'http-api',
      apiBaseUrl,
    })
  }

  const runtimeSelectionDraft = (): ClaudeRuntimeSelection =>
    claudeRuntimeSource === 'custom'
      ? { source: 'custom', customPath: claudeRuntimePath }
      : { source: claudeRuntimeSource }

  const probeClaudeRuntime = async (): Promise<void> => {
    setClaudeRuntimeBusy(true)
    setClaudeRuntimeMessage(null)
    try {
      const response =
        await window.cclinkStudio.settings.probeClaudeRuntime(runtimeSelectionDraft())
      if (!response.success || !response.result) {
        setClaudeRuntimeMessage(response.error ?? 'Claude Code 运行时探测失败')
      } else if (!response.result.success) {
        setClaudeRuntimeMessage(
          `${response.result.failure.code}: ${response.result.failure.message}`,
        )
      } else {
        setClaudeRuntimeMessage(
          `可用 · Claude Code ${response.result.runtime.claudeCodeVersion} · ${response.result.runtime.executablePath}`,
        )
      }
    } catch (nextError: unknown) {
      setClaudeRuntimeMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setClaudeRuntimeBusy(false)
    }
  }

  const testClaudeConnection = async (): Promise<void> => {
    setClaudeConnectionBusy(true)
    setClaudeConnectionResult(null)
    try {
      const response =
        await window.cclinkStudio.settings.testClaudeModelConnection(runtimeSelectionDraft())
      if (!response.success || !response.result) {
        setClaudeConnectionResult({
          success: false,
          message: response.error ?? '模型连接测试失败',
        })
        return
      }

      if (!response.result.success) {
        setClaudeConnectionResult({
          success: false,
          message: `${response.result.code}: ${response.result.message}`,
        })
        return
      }

      const cost =
        typeof response.result.totalCostUsd === 'number'
          ? ` · $${response.result.totalCostUsd.toFixed(4)}`
          : ''
      setClaudeConnectionResult({
        success: true,
        message: `${response.result.message} · ${response.result.model} · ${response.result.durationMs}ms${cost}`,
      })
    } catch (nextError: unknown) {
      setClaudeConnectionResult({
        success: false,
        message: nextError instanceof Error ? nextError.message : String(nextError),
      })
    } finally {
      setClaudeConnectionBusy(false)
    }
  }

  const applyClaudeRuntime = async (): Promise<void> => {
    setClaudeRuntimeBusy(true)
    setClaudeRuntimeMessage(null)
    try {
      const success = await updateSettings({
        claudeRuntimeSource,
        claudeCodePath: claudeRuntimeSource === 'custom' ? claudeRuntimePath : '',
      })
      if (!success) return
      setClaudeRuntimeMessage('Claude Code 运行时已切换')
      await refreshClaudeRuntimeStatus()
    } finally {
      setClaudeRuntimeBusy(false)
    }
  }

  const refreshCadStatus = (): void => {
    const cadApi = window.cclinkStudio?.cad
    if (!cadApi) {
      setCadActionError('CAD 转换 API 未加载，请重启 CCLink Studio。')
      return
    }
    setCadChecking(true)
    setCadActionError(null)
    Promise.all([cadApi.getBackendStatus(), cadApi.getCacheStatus()])
      .then(([nextStatus, nextCacheStatus]) => {
        setCadStatus(nextStatus)
        setCadCacheStatus(nextCacheStatus)
      })
      .catch((nextError: unknown) => {
        setCadActionError(nextError instanceof Error ? nextError.message : String(nextError))
      })
      .finally(() => setCadChecking(false))
  }

  const clearCadCache = (): void => {
    const cadApi = window.cclinkStudio?.cad
    if (!cadApi) {
      setCadActionError('CAD 转换 API 未加载，请重启 CCLink Studio。')
      return
    }
    setCadChecking(true)
    setCadActionError(null)
    cadApi
      .clearCache()
      .then((nextCacheStatus) => setCadCacheStatus(nextCacheStatus))
      .catch((nextError: unknown) => {
        setCadActionError(nextError instanceof Error ? nextError.message : String(nextError))
      })
      .finally(() => setCadChecking(false))
  }

  const saveGitAccount = async (): Promise<void> => {
    setGitBusy(true)
    setGitMessage(null)
    try {
      const result = await window.cclinkStudio.gitBackup.saveAccount({
        username: gitUsername,
        token: gitToken || undefined,
      })
      if (!result.success) {
        setGitMessage(result.error ?? 'Git 备份账号保存失败')
        return
      }
      setGitToken('')
      setGitStatus(result.account ?? null)
      setGitMessage(result.message ?? 'Git 备份账号已保存')
      await loadSettings()
    } catch (nextError: unknown) {
      setGitMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setGitBusy(false)
    }
  }

  const testGitAccount = async (): Promise<void> => {
    setGitBusy(true)
    setGitMessage(null)
    try {
      const result = await window.cclinkStudio.gitBackup.testAccount({
        username: gitUsername,
        token: gitToken || undefined,
      })
      setGitMessage(result.message ?? result.error ?? 'GitHub 连接测试失败')
      if (result.account) setGitStatus(result.account)
    } catch (nextError: unknown) {
      setGitMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setGitBusy(false)
    }
  }

  const clearGitAccount = async (): Promise<void> => {
    setGitBusy(true)
    setGitMessage(null)
    try {
      const result = await window.cclinkStudio.gitBackup.clearAccount()
      setGitToken('')
      setGitUsername('')
      setGitStatus(result.account ?? null)
      setGitMessage(result.message ?? result.error ?? 'Git 备份账号已清除')
      await loadSettings()
    } catch (nextError: unknown) {
      setGitMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setGitBusy(false)
    }
  }

  const saveApiKey = async (): Promise<void> => {
    if (!apiKeyInput.trim()) return
    setSecretBusy(true)
    setSecretMessage(null)
    try {
      const result = await window.cclinkStudio.settings.setSecret('apiKey', apiKeyInput)
      if (!result.success || !result.status) {
        setSecretMessage(result.error ?? 'API Key 保存失败')
        return
      }
      setApiKeyInput('')
      setShowApiKey(false)
      setSecretStatus(result.status)
      setSecretMessage('API Key 已保存到系统加密存储')
      setClaudeConnectionResult(null)
    } catch (nextError: unknown) {
      setSecretMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSecretBusy(false)
    }
  }

  const clearApiKey = async (): Promise<void> => {
    setSecretBusy(true)
    setSecretMessage(null)
    try {
      const result = await window.cclinkStudio.settings.clearSecret('apiKey')
      if (!result.success || !result.status) {
        setSecretMessage(result.error ?? 'API Key 清除失败')
        return
      }
      setApiKeyInput('')
      setSecretStatus(result.status)
      setSecretMessage('API Key 已清除')
      setClaudeConnectionResult(null)
    } catch (nextError: unknown) {
      setSecretMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSecretBusy(false)
    }
  }

  const resetAll = async (): Promise<void> => {
    await resetSettings()
    setApiKeyInput('')
    setClaudeConnectionResult(null)
    await refreshSecretStatus()
  }

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-search">
          <IconSearch size={14} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索设置"
          />
        </div>

        {searchResults.length > 0 ? (
          <div className="settings-search-results">
            {searchResults.map((result) => (
              <button
                key={`${result.sectionId}:${result.label}`}
                type="button"
                className="settings-search-result"
                onClick={() => {
                  setActiveSection(result.sectionId)
                  setSearchQuery('')
                }}
              >
                <span>{result.label}</span>
                <small>{result.description}</small>
              </button>
            ))}
          </div>
        ) : (
          <nav className="settings-nav">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon size={16} />
                  <span>{section.label}</span>
                </button>
              )
            })}
          </nav>
        )}
      </aside>

      <main className="settings-content">
        <div className="settings-header">
          <div>
            <h1>设置</h1>
            <p>CCLink Studio 开源桌面壳仅保留本地工作台配置。</p>
          </div>
          <button type="button" className="settings-reset-all" onClick={() => void resetAll()}>
            恢复默认
          </button>
        </div>

        {loading && <div className="settings-description">正在加载设置...</div>}
        {error && <div className="settings-error">{error}</div>}

        {activeSection === 'appearance' && (
          <section className="settings-section">
            <h2>外观</h2>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-label">
                  <span>主题</span>
                  <span className="settings-description">选择界面主题。</span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={theme}
                    onChange={(event) => setTheme(event.target.value as Theme)}
                  >
                    <option value="dark">深色</option>
                    <option value="light">浅色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </div>
              </div>

              <SettingsRow settingKey="uiFontSize" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>界面字号</span>
                  <span className="settings-description">{settings.uiFontSize}px</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    type="number"
                    min={11}
                    max={18}
                    value={settings.uiFontSize}
                    onChange={(event) => update({ uiFontSize: Number(event.target.value) })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="appZoomLevel" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>应用缩放</span>
                  <span className="settings-description">Electron zoom level。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    type="number"
                    min={-2}
                    max={3}
                    step={0.25}
                    value={settings.appZoomLevel}
                    onChange={(event) => update({ appZoomLevel: Number(event.target.value) })}
                  />
                </div>
              </SettingsRow>
            </div>
          </section>
        )}

        {activeSection === 'agent' && (
          <section className="settings-section">
            <h2>Agent</h2>
            <div className="settings-group">
              <SettingsRow settingKey="provider" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>模型提供商</span>
                  <span className="settings-description">用于本地 Agent 后端。</span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.provider}
                    onChange={(event) => handleProviderChange(event.target.value as Provider)}
                  >
                    {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </SettingsRow>

              <SettingsRow settingKey="apiFormat" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>API 格式</span>
                  <span className="settings-description">Anthropic 或 OpenAI 兼容格式。</span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.apiFormat}
                    onChange={(event) => handleApiFormatChange(event.target.value as ApiFormat)}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI Compatible</option>
                  </select>
                </div>
              </SettingsRow>

              <SettingsRow settingKey="apiBaseUrl" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>API 地址</span>
                  <span className="settings-description">留空时由提供商预设决定。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={settings.apiBaseUrl}
                    onChange={(event) => {
                      setClaudeConnectionResult(null)
                      update({ apiBaseUrl: event.target.value })
                    }}
                  />
                </div>
              </SettingsRow>

              <div className="settings-row settings-secret-row">
                <div className="settings-label">
                  <span>API Key</span>
                  <span className="settings-description">
                    {secretStatus?.migrationBlocked
                      ? '旧版凭证待迁移，当前设置文件不会被覆盖。'
                      : secretStatus?.apiKeyConfigured
                        ? '已配置并由系统加密存储保护。'
                        : '尚未配置。'}
                  </span>
                </div>
                <div className="settings-secret-control">
                  <div className="settings-control settings-control-inline">
                    <input
                      className="settings-input settings-input-apikey"
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      placeholder={
                        secretStatus?.apiKeyConfigured ? '输入新 Key 以替换' : '输入 API Key'
                      }
                      autoComplete="off"
                      disabled={secretBusy || secretStatus?.encryptionAvailable === false}
                      onChange={(event) => setApiKeyInput(event.target.value)}
                    />
                    <button
                      className="settings-secondary-btn"
                      type="button"
                      disabled={secretBusy}
                      onClick={() => setShowApiKey((value) => !value)}
                    >
                      {showApiKey ? '隐藏' : '显示'}
                    </button>
                    <button
                      className="settings-secondary-btn"
                      type="button"
                      disabled={secretBusy || !apiKeyInput.trim()}
                      onClick={() => void saveApiKey()}
                    >
                      保存
                    </button>
                    {secretStatus?.apiKeyConfigured && (
                      <button
                        className="settings-danger-btn"
                        type="button"
                        disabled={secretBusy}
                        onClick={() => void clearApiKey()}
                      >
                        清除
                      </button>
                    )}
                  </div>
                  {secretStatus?.encryptionAvailable === false && (
                    <span className="settings-inline-error">
                      系统加密存储不可用，已禁止写入凭证。
                    </span>
                  )}
                  {secretMessage && <span className="settings-description">{secretMessage}</span>}
                </div>
              </div>

              <SettingsRow settingKey="modelName" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>模型名称</span>
                  <span className="settings-description">发送给后端的模型标识。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={settings.modelName}
                    onChange={(event) => {
                      setClaudeConnectionResult(null)
                      update({ modelName: event.target.value })
                    }}
                  />
                </div>
              </SettingsRow>

              <div className="settings-row settings-connection-test-row">
                <div className="settings-label">
                  <span>连接测试</span>
                  <span className="settings-description">
                    使用当前运行时、已保存的 Key 和模型发送一次无工具最小请求，可能产生少量费用。
                  </span>
                </div>
                <div className="settings-connection-test-control">
                  <button
                    className="settings-secondary-btn"
                    type="button"
                    disabled={claudeConnectionBusy || claudeRuntimeBusy}
                    onClick={() => void testClaudeConnection()}
                  >
                    {claudeConnectionBusy ? '测试中...' : '测试连接'}
                  </button>
                  {claudeConnectionResult && (
                    <span
                      className={`settings-connection-result ${
                        claudeConnectionResult.success ? 'success' : 'error'
                      }`}
                    >
                      {claudeConnectionResult.message}
                    </span>
                  )}
                </div>
              </div>

              <SettingsRow settingKey="claudeRuntimeSource" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>Claude Code 运行时</span>
                  <span className="settings-description">
                    内置固定版本、系统安装或自定义可执行文件。切换前会先探测，不会静默回退。
                  </span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={claudeRuntimeSource}
                    onChange={(event) => {
                      setClaudeConnectionResult(null)
                      setClaudeRuntimeSource(event.target.value as ClaudeRuntimeSource)
                    }}
                  >
                    <option value="bundled">内置固定版本</option>
                    <option value="system">系统安装</option>
                    <option value="custom">自定义路径</option>
                  </select>
                  <button
                    className="settings-secondary-btn"
                    type="button"
                    disabled={claudeRuntimeBusy}
                    onClick={() => void probeClaudeRuntime()}
                  >
                    检测
                  </button>
                  <button
                    className="settings-secondary-btn"
                    type="button"
                    disabled={claudeRuntimeBusy}
                    onClick={() => void applyClaudeRuntime()}
                  >
                    应用
                  </button>
                </div>
              </SettingsRow>

              {claudeRuntimeSource === 'custom' && (
                <SettingsRow settingKey="claudeCodePath" settings={settings} onReset={resetOne}>
                  <div className="settings-label">
                    <span>自定义可执行文件</span>
                    <span className="settings-description">必须是可执行文件的绝对路径。</span>
                  </div>
                  <div className="settings-control">
                    <input
                      className="settings-input"
                      value={claudeRuntimePath}
                      onChange={(event) => {
                        setClaudeConnectionResult(null)
                        setClaudeRuntimePath(event.target.value)
                      }}
                    />
                  </div>
                </SettingsRow>
              )}

              <div className="settings-row">
                <div className="settings-label">
                  <span>当前状态</span>
                  <span className="settings-description">
                    {claudeRuntimeStatus?.failure
                      ? `${claudeRuntimeStatus.state} · ${claudeRuntimeStatus.failure.code}: ${claudeRuntimeStatus.failure.message}`
                      : claudeRuntimeStatus?.active
                        ? `${claudeRuntimeStatus.state} · ${claudeRuntimeStatus.active.source} · Claude Code ${claudeRuntimeStatus.active.claudeCodeVersion}`
                        : '尚未激活 Claude Code 运行时'}
                  </span>
                </div>
                {claudeRuntimeMessage && (
                  <div className="settings-control">
                    <span className="settings-description">{claudeRuntimeMessage}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeSection === 'agent-capabilities' && (
          <AgentCapabilitiesSettings settings={settings} updateSettings={update} />
        )}

        {activeSection === 'browser' && (
          <section className="settings-section">
            <h2>浏览器</h2>
            <div className="settings-group">
              <SettingsRow settingKey="defaultZoomMode" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>默认缩放</span>
                  <span className="settings-description">新浏览器 Tab 的默认缩放模式。</span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.defaultZoomMode}
                    onChange={(event) =>
                      update({
                        defaultZoomMode: event.target.value as AppSettings['defaultZoomMode'],
                      })
                    }
                  >
                    <option value="fit">适应宽度</option>
                    <option value="manual">手动缩放</option>
                  </select>
                </div>
              </SettingsRow>

              <SettingsRow settingKey="defaultDeviceMode" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>默认设备模式</span>
                  <span className="settings-description">桌面或移动视口。</span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.defaultDeviceMode}
                    onChange={(event) =>
                      update({
                        defaultDeviceMode: event.target.value as AppSettings['defaultDeviceMode'],
                      })
                    }
                  >
                    <option value="desktop">桌面</option>
                    <option value="mobile">移动</option>
                  </select>
                </div>
              </SettingsRow>
            </div>
          </section>
        )}

        {activeSection === 'editor' && (
          <section className="settings-section">
            <h2>编辑器与文件</h2>
            <div className="settings-group">
              <SettingsRow settingKey="editorFontFamily" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>编辑器字体</span>
                  <span className="settings-description">Markdown 编辑器字体族。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={settings.editorFontFamily}
                    onChange={(event) => update({ editorFontFamily: event.target.value })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="editorFontSize" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>编辑器字号</span>
                  <span className="settings-description">{settings.editorFontSize}px</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    type="number"
                    min={11}
                    max={24}
                    value={settings.editorFontSize}
                    onChange={(event) => update({ editorFontSize: Number(event.target.value) })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="editorWordWrap" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>自动换行</span>
                  <span className="settings-description">长文本在编辑器内自动折行。</span>
                </div>
                <div className="settings-control">
                  <Toggle
                    checked={settings.editorWordWrap}
                    onChange={(checked) => update({ editorWordWrap: checked })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="showHiddenFiles" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>显示隐藏文件</span>
                  <span className="settings-description">文件树显示点号开头的文件。</span>
                </div>
                <div className="settings-control">
                  <Toggle
                    checked={settings.showHiddenFiles}
                    onChange={(checked) => update({ showHiddenFiles: checked })}
                  />
                </div>
              </SettingsRow>
            </div>
          </section>
        )}

        {activeSection === 'git-backup' && (
          <section className="settings-section">
            <h2>Git 备份</h2>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-label">
                  <span>本机 Git</span>
                  <span className="settings-description">
                    {gitStatus?.gitAvailable
                      ? gitStatus.gitVersion || 'Git 已安装'
                      : gitStatus
                        ? '未检测到 Git，请先安装 Git。'
                        : '正在检测…'}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <span>GitHub 账号</span>
                  <span className="settings-description">
                    只用于按项目名创建私人仓库和 HTTPS Push。
                  </span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={gitUsername}
                    maxLength={39}
                    placeholder="GitHub 用户名"
                    onChange={(event) => setGitUsername(event.target.value)}
                  />
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <span>访问 Token</span>
                  <span className="settings-description">
                    {gitStatus?.tokenConfigured
                      ? '已加密保存；留空表示继续使用现有 Token。'
                      : 'Token 通过系统安全存储加密保存，无法读回明文。'}
                  </span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    type="password"
                    value={gitToken}
                    maxLength={2048}
                    placeholder={gitStatus?.tokenConfigured ? '已配置' : 'GitHub Token'}
                    autoComplete="off"
                    onChange={(event) => setGitToken(event.target.value)}
                  />
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <span>连接状态</span>
                  <span className="settings-description">
                    {gitMessage ??
                      (gitStatus?.connected
                        ? `已连接 ${gitStatus.connectedLogin}`
                        : gitStatus?.tokenConfigured
                          ? '账号已配置，可测试连接。'
                          : '尚未配置账号。')}
                  </span>
                </div>
                <div className="settings-control settings-control-inline">
                  <button type="button" disabled={gitBusy} onClick={() => void testGitAccount()}>
                    {gitBusy ? '处理中…' : '测试连接'}
                  </button>
                  <button type="button" disabled={gitBusy} onClick={() => void saveGitAccount()}>
                    保存
                  </button>
                  {gitStatus?.tokenConfigured && (
                    <button type="button" disabled={gitBusy} onClick={() => void clearGitAccount()}>
                      清除
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'cad' && (
          <section className="settings-section">
            <h2>硬件与 CAD</h2>
            <div className="settings-group">
              <SettingsRow settingKey="cadBackend" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>STEP/STP 预览后端</span>
                  <span className="settings-description">
                    开源壳只配置用户本机已有 FreeCAD，不下载 CAD 运行时。
                  </span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.cadBackend}
                    onChange={(event) =>
                      update({ cadBackend: event.target.value as AppSettings['cadBackend'] })
                    }
                  >
                    <option value="none">未启用</option>
                    <option value="local-freecad">本机 FreeCAD</option>
                    <option value="managed-freecad" disabled>
                      托管 FreeCAD（未实现）
                    </option>
                    <option value="occt-experimental">OpenCascade 实验后端</option>
                  </select>
                </div>
              </SettingsRow>

              <SettingsRow settingKey="freecadPath" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>FreeCAD 路径</span>
                  <span className="settings-description">
                    可填写 FreeCADCmd / FreeCAD 可执行文件路径；留空时自动查找常见安装位置和 PATH。
                  </span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={settings.freecadPath}
                    placeholder="/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd"
                    onChange={(event) => update({ freecadPath: event.target.value })}
                  />
                </div>
              </SettingsRow>

              <div className="settings-row">
                <div className="settings-label">
                  <span>后端检测</span>
                  <span className="settings-description">{cadStatusLabel(cadStatus)}</span>
                  {cadStatus?.error?.detail && (
                    <span className="settings-description">{cadStatus.error.detail}</span>
                  )}
                  {cadActionError && <span className="settings-description">{cadActionError}</span>}
                </div>
                <div className="settings-control settings-control-inline">
                  <button type="button" onClick={refreshCadStatus} disabled={cadChecking}>
                    {cadChecking ? '检测中' : '检测'}
                  </button>
                </div>
              </div>

              <SettingsRow settingKey="cadCacheEnabled" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>启用 CAD 转换缓存</span>
                  <span className="settings-description">
                    缓存 STEP/STP 转换后的预览 mesh 和尺寸 metadata。
                  </span>
                </div>
                <div className="settings-control">
                  <Toggle
                    checked={settings.cadCacheEnabled}
                    onChange={(checked) => update({ cadCacheEnabled: checked })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="cadCacheLimitMb" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>CAD 缓存上限</span>
                  <span className="settings-description">{settings.cadCacheLimitMb} MB</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    type="number"
                    min={128}
                    step={128}
                    value={settings.cadCacheLimitMb}
                    onChange={(event) => update({ cadCacheLimitMb: Number(event.target.value) })}
                  />
                </div>
              </SettingsRow>

              <div className="settings-row">
                <div className="settings-label">
                  <span>转换缓存</span>
                  <span className="settings-description">
                    {cadCacheStatus
                      ? `${cadCacheStatus.entryCount} 项 · ${formatBytes(cadCacheStatus.bytes)} · ${cadCacheStatus.cachePath}`
                      : '尚未读取缓存状态'}
                  </span>
                </div>
                <div className="settings-control settings-control-inline">
                  <button type="button" onClick={refreshCadStatus} disabled={cadChecking}>
                    刷新
                  </button>
                  <button type="button" onClick={clearCadCache} disabled={cadChecking}>
                    清理缓存
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'shortcuts' && (
          <section className="settings-section">
            <h2>快捷键</h2>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-label">
                  <span>命令面板</span>
                  <span className="settings-description">Cmd+Shift+P</span>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>新建 Tab</span>
                  <span className="settings-description">Cmd+T</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeSection === 'about' && (
          <section className="settings-section">
            <h2>关于</h2>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-label">
                  <span>CCLink Studio</span>
                  <span className="settings-description">
                    开源桌面工作台壳，不内置官方生产 API、账号、订阅、云同步或网络工作区服务。
                  </span>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>当前阶段</span>
                  <span className="settings-description">
                    官方账号、同步、发布和网络运行时由 cclink-dev 与 chat-cc 承接，本仓库保留本地
                    Agent、浏览器、编辑器、文件和终端能力。
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
