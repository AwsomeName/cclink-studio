import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS } from '@shared/ipc/settings'
import type { AppSettings, CadBackend } from '@shared/ipc/settings'
import type { SettingsSecretStatus } from '@shared/ipc/settings'
import {
  APP_ZOOM_LEVEL_MAX,
  APP_ZOOM_LEVEL_MIN,
  MANAGED_CLAUDE_RUNTIME_VERSION,
} from '@shared/settings-constants'
import type {
  ClaudeRuntimeSelection,
  ClaudeRuntimeSource,
  ClaudeRuntimeStatus,
} from '@shared/claude-runtime'
import type { CadBackendStatus, CadCacheStatus } from '@shared/ipc/cad'
import type { CredentialMetadata, CredentialServiceStatus } from '@shared/ipc/credentials'
import { useSettingsStore } from '../../stores'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import {
  IconCloud,
  IconFile,
  IconDatabase,
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
import { ComponentManagementSettings } from './ComponentManagementSettings'
import { KeybindingsSettings } from './KeybindingsSettings'
import { ModelUsageSettings } from './model-usage/ModelUsageSettings'
import { ApiConnectionsSettings, connectionServiceFromSection } from './api-connections-settings'
import type { ConnectionServiceId } from './api-connections-settings'
import './api-connections-settings.css'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
type SettingsSectionId =
  | 'appearance'
  | 'updates'
  | 'components'
  | 'connections'
  | 'agent-capabilities'
  | 'model-usage'
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
  group: string
  icon: (props: { size?: number }) => React.ReactElement
}> = [
  { id: 'appearance', label: '外观', group: '通用', icon: IconPaintbrush },
  { id: 'editor', label: '编辑器', group: '通用', icon: IconFile },
  { id: 'shortcuts', label: '快捷键', group: '通用', icon: IconKeyboard },
  { id: 'connections', label: 'API Key 与连接', group: 'AI 与服务', icon: IconLink },
  { id: 'agent-capabilities', label: 'Agent 行为与工具', group: 'AI 与服务', icon: IconRobot },
  { id: 'model-usage', label: '模型用量', group: 'AI 与服务', icon: IconDatabase },
  { id: 'components', label: '组件管理', group: 'AI 与服务', icon: IconTool },
  { id: 'browser', label: '浏览器', group: '工作台', icon: IconGlobe },
  { id: 'git-backup', label: 'Git 备份', group: '工作台', icon: IconLink },
  { id: 'cad', label: '硬件与 CAD', group: '工作台', icon: IconMonitor },
  { id: 'updates', label: '更新', group: '应用', icon: IconCloud },
  { id: 'about', label: '关于', group: '应用', icon: IconSettings },
]

const SETTINGS_SEARCH_INDEX: Array<{
  sectionId: SettingsSectionId
  label: string
  description: string
  keywords: string[]
  service?: ConnectionServiceId
}> = [
  {
    sectionId: 'model-usage',
    label: '模型用量',
    description: '查看输入、输出、缓存、活跃度与调用明细，回填和导出本地统计。',
    keywords: ['usage', 'token', '用量', '统计', '消耗', '活跃', '费用'],
  },
  {
    sectionId: 'appearance',
    label: '主题与字号',
    description: '调整桌面壳主题、界面字号和缩放。',
    keywords: ['theme', 'font', 'zoom', '主题', '字号', '缩放'],
  },
  {
    sectionId: 'updates',
    label: '更新通道',
    description: '选择只接收正式版，或同时接收公开测试版。',
    keywords: ['update', 'release', 'beta', '更新', '测试版', '预发布'],
  },
  {
    sectionId: 'components',
    label: '组件管理',
    description: '查看 Runtime、能力插件和内容包的安装与更新状态。',
    keywords: ['component', 'runtime', 'plugin', 'npm', '组件', '插件', '版本', '更新'],
  },
  {
    sectionId: 'connections',
    label: 'Agent 后端',
    description: '使用本机 Codex，配置 Claude Code 备选。',
    keywords: ['agent', 'claude', 'codex', 'acp', 'openai', 'model', 'api', '模型'],
  },
  {
    sectionId: 'agent-capabilities',
    label: 'Agent 工具与 MCP',
    description: '管理内置工具、外部 MCP、运行状态和权限策略。',
    keywords: ['agent', 'tool', 'mcp', 'permission', '工具', '能力', '权限'],
  },
  {
    sectionId: 'connections',
    service: 'meshy',
    label: 'Meshy 3D 生成',
    description: '配置 Meshy API Key。',
    keywords: ['meshy', '3d', 'key', '模型生成'],
  },
  {
    sectionId: 'connections',
    service: 'jimeng',
    label: '即梦图像生成',
    description: '配置火山引擎 AK/SK。',
    keywords: ['jimeng', '即梦', 'image', '图片', '图像生成', '配图'],
  },
  {
    sectionId: 'connections',
    service: 'pexels',
    label: 'Pexels 素材搜索',
    description: '配置图片与视频素材搜索 Key。',
    keywords: ['pexels', '素材', '图片', '视频', 'key'],
  },
  {
    sectionId: 'connections',
    service: 'github',
    label: 'GitHub 账号与 Token',
    description: '保存并验证 GitHub 认证。',
    keywords: ['github', 'token', 'git', '账号'],
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
    sectionId: 'shortcuts',
    label: '快捷键',
    description: '查找命令、修改组合键或恢复默认键位。',
    keywords: ['shortcut', 'keybinding', 'command', '快捷键', '按键', '查找'],
  },
  {
    sectionId: 'cad',
    label: '硬件与 CAD',
    description: '启用 STEP/STP 结构件预览，配置本机 FreeCAD 和 CAD 转换缓存。',
    keywords: ['cad', 'freecad', 'step', 'stp', 'hardware', '结构件', '硬件', '预览'],
  },
  {
    sectionId: 'connections',
    label: 'API Key 与连接',
    description: '管理 Agent、Git、数据源和扩展使用的本机凭证文件。',
    keywords: ['credential', 'secret', 'token', 'key', '凭证', '密钥'],
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
  if (
    !section ||
    ['agent', 'credentials', 'image-generation'].includes(section) ||
    section.startsWith('connections')
  )
    return 'connections'
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
  const showContextMenu = useContextMenuStore((state) => state.show)
  const target = {
    kind: 'setting' as const,
    settingKey,
    label: settingKey,
    modified,
  }
  return (
    <div
      className={`settings-row ${modified ? 'modified' : ''}`}
      data-context-target="setting"
      tabIndex={-1}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        showContextMenu({
          target,
          x: event.clientX,
          y: event.clientY,
          focusReturn: event.currentTarget,
        })
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
        event.preventDefault()
        event.stopPropagation()
        showContextMenu(buildKeyboardContextMenuInput(target, event.currentTarget))
      }}
    >
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
  const [connectionService, setConnectionService] = useState<ConnectionServiceId>(
    connectionServiceFromSection(initialSection),
  )
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [connectionDirty, setConnectionDirty] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCodexApiKey, setShowCodexApiKey] = useState(false)
  const [codexApiKeyInput, setCodexApiKeyInput] = useState('')
  const [codexProbeBusy, setCodexProbeBusy] = useState(false)
  const [codexMessage, setCodexMessage] = useState<string | null>(null)
  const [secretStatus, setSecretStatus] = useState<SettingsSecretStatus | null>(null)
  const [secretBusy, setSecretBusy] = useState(false)
  const [claudeRuntimeStatus, setClaudeRuntimeStatus] = useState<ClaudeRuntimeStatus | null>(null)
  const [claudeRuntimeSource, setClaudeRuntimeSource] = useState<ClaudeRuntimeSource>('system')
  const [claudeRuntimePath, setClaudeRuntimePath] = useState('')
  const [claudeManagedVersion, setClaudeManagedVersion] = useState('')
  const [claudeRuntimeBusy, setClaudeRuntimeBusy] = useState(false)
  const [claudeRuntimeMessage, setClaudeRuntimeMessage] = useState<string | null>(null)
  const [cadStatus, setCadStatus] = useState<CadBackendStatus | null>(null)
  const [cadCacheStatus, setCadCacheStatus] = useState<CadCacheStatus | null>(null)
  const [cadChecking, setCadChecking] = useState(false)
  const [cadActionError, setCadActionError] = useState<string | null>(null)
  const [credentialStatus, setCredentialStatus] = useState<CredentialServiceStatus | null>(null)
  const [credentialMetadata, setCredentialMetadata] = useState<CredentialMetadata[]>([])
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null)
  const [revealedCredentialFields, setRevealedCredentialFields] = useState<Record<string, string>>(
    {},
  )
  const revealGeneration = useRef(0)
  const revealTimers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const settings = useSettingsStore((state) => state.settings)
  const loading = useSettingsStore((state) => state.loading)
  const error = useSettingsStore((state) => state.error)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.resetSettings)
  const resetSetting = useSettingsStore((state) => state.resetSetting)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const refreshSecretStatus = useCallback(async (): Promise<void> => {
    try {
      setSecretStatus(await window.cclinkStudio.settings.getSecretStatus())
    } catch (nextError: unknown) {
      setCodexMessage(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }, [])

  const refreshCredentialStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await window.cclinkStudio.credentials.listMetadata()
      setCredentialStatus(result.status ?? (await window.cclinkStudio.credentials.getStatus()))
      setCredentialMetadata(result.metadata ?? [])
      if (!result.success) setCredentialMessage(result.error ?? '无法读取本地凭证状态')
    } catch (nextError: unknown) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      setCredentialMessage(message)
      setCredentialMetadata([])
      setCredentialStatus({
        status: 'failed',
        filePath: '',
        configuredCount: 0,
        legacyEncryptedFiles: [],
        message,
      })
    }
  }, [])

  const refreshConnections = useCallback(async (): Promise<void> => {
    await Promise.all([refreshCredentialStatus(), refreshSecretStatus(), loadSettings()])
  }, [refreshCredentialStatus, refreshSecretStatus, loadSettings])

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
    if (initialSection) {
      navigateRef.current(
        normalizeSection(initialSection),
        connectionServiceFromSection(initialSection),
      )
    }
  }, [initialSection])

  useEffect(() => {
    if (activeSection === 'connections') {
      void refreshSecretStatus()
    }
  }, [activeSection, refreshSecretStatus])

  useEffect(() => {
    if (activeSection === 'connections') {
      void refreshCredentialStatus()
    } else {
      setRevealedCredentialFields({})
    }
    return () => {
      revealGeneration.current += 1
      for (const timer of revealTimers.current) clearTimeout(timer)
      revealTimers.current.clear()
    }
  }, [activeSection, refreshCredentialStatus])

  useEffect(() => {
    setClaudeRuntimeSource(settings.claudeRuntimeSource)
    setClaudeRuntimePath(settings.claudeCodePath)
    setClaudeManagedVersion(settings.claudeManagedVersion)
  }, [settings.claudeCodePath, settings.claudeManagedVersion, settings.claudeRuntimeSource])

  useEffect(() => {
    if (activeSection === 'connections') void refreshClaudeRuntimeStatus()
    else {
      setCodexApiKeyInput('')
      setShowCodexApiKey(false)
    }
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
    void resetSetting(key)
  }

  const runtimeSelectionDraft = (): ClaudeRuntimeSelection =>
    claudeRuntimeSource === 'custom'
      ? { source: 'custom', customPath: claudeRuntimePath }
      : claudeRuntimeSource === 'managed'
        ? { source: 'managed', version: claudeManagedVersion }
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

  const applyClaudeRuntime = async (): Promise<void> => {
    setClaudeRuntimeBusy(true)
    setClaudeRuntimeMessage(null)
    try {
      const success = await updateSettings({
        claudeRuntimeSource,
        claudeCodePath: claudeRuntimeSource === 'custom' ? claudeRuntimePath : '',
        claudeManagedVersion: claudeRuntimeSource === 'managed' ? claudeManagedVersion : '',
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

  const saveCodexApiKey = async (): Promise<void> => {
    if (!codexApiKeyInput.trim()) return
    setSecretBusy(true)
    setCodexMessage(null)
    try {
      const result = await window.cclinkStudio.settings.setSecret('codexApiKey', codexApiKeyInput)
      if (!result.success || !result.status) {
        setCodexMessage(result.error ?? 'Codex API Key 保存失败')
        return
      }
      setCodexApiKeyInput('')
      setShowCodexApiKey(false)
      setSecretStatus(result.status)
      setCodexMessage('Codex API Key 已保存到本地凭证文件')
    } catch (nextError: unknown) {
      setCodexMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSecretBusy(false)
    }
  }

  const clearCodexApiKey = async (): Promise<void> => {
    setSecretBusy(true)
    setCodexMessage(null)
    try {
      const result = await window.cclinkStudio.settings.clearSecret('codexApiKey')
      if (!result.success || !result.status) {
        setCodexMessage(result.error ?? 'Codex API Key 清除失败')
        return
      }
      setCodexApiKeyInput('')
      setSecretStatus(result.status)
      setCodexMessage('Codex API Key 已清除')
    } catch (nextError: unknown) {
      setCodexMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSecretBusy(false)
    }
  }

  const probeCodexAcp = async (): Promise<void> => {
    setCodexProbeBusy(true)
    setCodexMessage(null)
    try {
      const response = await window.cclinkStudio.settings.probeCodexAcp(settings.codexAcpPath)
      if (!response.success || !response.result) {
        setCodexMessage(response.error ?? 'Codex ACP 检测失败')
        return
      }
      setCodexMessage(`可用 · Codex ACP ${response.result.version} · ${response.result.executable}`)
    } catch (nextError: unknown) {
      setCodexMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setCodexProbeBusy(false)
    }
  }

  const runCredentialAction = async (
    action: () => Promise<{ success: boolean; error?: string }>,
    successMessage: string,
  ): Promise<void> => {
    revealGeneration.current += 1
    setCredentialBusy(true)
    setCredentialMessage(null)
    try {
      const result = await action()
      setCredentialMessage(result.success ? successMessage : (result.error ?? '凭证操作失败'))
      setRevealedCredentialFields({})
      await refreshConnections()
    } catch (nextError: unknown) {
      setCredentialMessage(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setCredentialBusy(false)
    }
  }

  const revealCredentialField = async (id: string, field: string): Promise<void> => {
    const key = `${id}:${field}`
    const generation = revealGeneration.current
    if (revealedCredentialFields[key] !== undefined) {
      setRevealedCredentialFields((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      return
    }
    setCredentialBusy(true)
    setCredentialMessage(null)
    try {
      const result = await window.cclinkStudio.credentials.revealField(id, field)
      if (generation !== revealGeneration.current) return
      if (!result.success || result.value === undefined) {
        setCredentialMessage(result.error ?? '无法显示凭证字段')
        return
      }
      setRevealedCredentialFields((current) => ({ ...current, [key]: result.value! }))
      const timer = setTimeout(() => {
        revealTimers.current.delete(timer)
        setRevealedCredentialFields((current) => {
          if (current[key] === undefined) return current
          const next = { ...current }
          delete next[key]
          return next
        })
      }, 30_000)
      revealTimers.current.add(timer)
    } catch {
      if (generation === revealGeneration.current)
        setCredentialMessage('无法显示凭证字段，请重试。')
    } finally {
      setCredentialBusy(false)
    }
  }

  const resetAll = async (): Promise<void> => {
    await resetSettings()

    await refreshSecretStatus()
    await refreshCredentialStatus()
  }

  const connectionsBusy =
    connectionBusy || credentialBusy || secretBusy || claudeRuntimeBusy || codexProbeBusy
  const navigateSettings = (section: SettingsSectionId, service = connectionService): boolean => {
    if (section === activeSection && (section !== 'connections' || service === connectionService))
      return true
    if (activeSection === 'connections') {
      if (connectionsBusy) return false
      if (
        connectionDirty &&
        !window.confirm('放弃尚未保存的输入并切换页面？已保存的配置保持不变。')
      )
        return false
    }
    setConnectionDirty(false)
    setConnectionService(service)
    setActiveSection(section)
    return true
  }
  const navigateRef = useRef(navigateSettings)
  navigateRef.current = navigateSettings

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
                disabled={activeSection === 'connections' && connectionsBusy}
                onClick={() => {
                  if (navigateSettings(result.sectionId, result.service ?? 'claude'))
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
            {SETTINGS_SECTIONS.map((section, index) => {
              const Icon = section.icon
              return (
                <Fragment key={section.id}>
                  {(index === 0 || SETTINGS_SECTIONS[index - 1].group !== section.group) && (
                    <div className="settings-nav-group">{section.group}</div>
                  )}
                  <button
                    type="button"
                    className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                    disabled={activeSection === 'connections' && connectionsBusy}
                    onClick={() => navigateSettings(section.id)}
                  >
                    <Icon size={16} />
                    <span>{section.label}</span>
                  </button>
                </Fragment>
              )
            })}
          </nav>
        )}
      </aside>

      <main className="settings-content">
        {!['components', 'model-usage', 'connections'].includes(activeSection) && (
          <div className="settings-header">
            <div>
              <h1>设置</h1>
              <p>管理本机工作台的外观、工具和使用偏好。</p>
            </div>
            <button type="button" className="settings-reset-all" onClick={() => void resetAll()}>
              恢复默认
            </button>
          </div>
        )}

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

              <SettingsRow settingKey="appZoomLevel" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>应用缩放</span>
                  <span className="settings-description">Electron zoom level。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    type="number"
                    min={APP_ZOOM_LEVEL_MIN}
                    max={APP_ZOOM_LEVEL_MAX}
                    step={0.25}
                    value={settings.appZoomLevel}
                    onChange={(event) => update({ appZoomLevel: Number(event.target.value) })}
                  />
                </div>
              </SettingsRow>
            </div>
          </section>
        )}

        {activeSection === 'updates' && (
          <section className="settings-section">
            <h2>更新</h2>
            <div className="settings-group">
              <SettingsRow settingKey="updateTrack" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>更新通道</span>
                  <span className="settings-description">
                    测试通道会接收公开的 GitHub Pre-release 和正式版；Draft 永远不会下发。
                    切换后需重新检查更新。
                  </span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.updateTrack}
                    onChange={(event) =>
                      update({ updateTrack: event.target.value as AppSettings['updateTrack'] })
                    }
                  >
                    <option value="stable">稳定版</option>
                    <option value="beta">测试版（包含预发布）</option>
                  </select>
                </div>
              </SettingsRow>
              {settings.updateTrack === 'beta' && (
                <div className="settings-row">
                  <div className="settings-label">
                    <span>测试风险</span>
                    <span className="settings-description">
                      测试版可能存在未完成能力或兼容问题；可随时切回稳定版。
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeSection === 'components' && <ComponentManagementSettings />}
        {activeSection === 'model-usage' && <ModelUsageSettings />}

        {activeSection === 'connections' && (
          <ApiConnectionsSettings
            service={connectionService}
            busy={connectionsBusy}
            onSelectService={(service) => navigateSettings('connections', service)}
            onBusyChange={setConnectionBusy}
            onDirtyChange={setConnectionDirty}
            settings={settings}
            metadata={credentialMetadata}
            storageStatus={credentialStatus}
            onRefresh={refreshConnections}
            onComponents={() => navigateSettings('components')}
            runtimeSettings={
              <div className="settings-group">
                {' '}
                <SettingsRow
                  settingKey="claudeRuntimeSource"
                  settings={settings}
                  onReset={resetOne}
                >
                  <div className="settings-label">
                    <span>Claude Code 运行时</span>
                    <span className="settings-description">
                      所有运行时均使用 Studio 独立配置和 API Key，不读取或修改本机 Claude 登录。
                    </span>
                  </div>
                  <div className="settings-control">
                    <select
                      className="settings-select"
                      value={claudeRuntimeSource}
                      onChange={(event) => {
                        const source = event.target.value as ClaudeRuntimeSource
                        setClaudeRuntimeSource(source)
                        if (source === 'managed' && !claudeManagedVersion) {
                          setClaudeManagedVersion(MANAGED_CLAUDE_RUNTIME_VERSION)
                        }
                      }}
                    >
                      <option value="managed">Studio 管理版本</option>
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
                          setClaudeRuntimePath(event.target.value)
                        }}
                      />
                    </div>
                  </SettingsRow>
                )}
                {claudeRuntimeSource === 'managed' && (
                  <SettingsRow
                    settingKey="claudeManagedVersion"
                    settings={settings}
                    onReset={resetOne}
                  >
                    <div className="settings-label">
                      <span>Managed Runtime 版本</span>
                      <span className="settings-description">
                        先在“组件管理”安装允许的版本，再在这里启用。
                      </span>
                    </div>
                    <div className="settings-control">
                      <input
                        className="settings-input"
                        value={claudeManagedVersion}
                        onChange={(event) => setClaudeManagedVersion(event.target.value)}
                        placeholder={MANAGED_CLAUDE_RUNTIME_VERSION}
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
                <details>
                  <summary>旧版 Codex ACP（兼容设置）</summary>{' '}
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Codex ACP（可选）</span>
                      <span className="settings-description">
                        仅用于旧版 ACP 会话；默认 Codex 直接使用本机 CLI
                        和已有文件登录，不需要此处的 ACP 配置。
                      </span>
                    </div>
                  </div>
                  <SettingsRow settingKey="codexAcpPath" settings={settings} onReset={resetOne}>
                    <div className="settings-label">
                      <span>Codex ACP 可执行文件</span>
                      <span className="settings-description">
                        留空时从系统 PATH 查找；请自行安装
                        @agentclientprotocol/codex-acp@1.3.0，当前只接受该版本。
                      </span>
                    </div>
                    <div className="settings-control settings-control-inline">
                      <input
                        className="settings-input"
                        value={settings.codexAcpPath}
                        placeholder="codex-acp"
                        onChange={(event) => {
                          setCodexMessage(null)
                          update({ codexAcpPath: event.target.value })
                        }}
                      />
                      <button
                        className="settings-secondary-btn"
                        type="button"
                        disabled={codexProbeBusy}
                        onClick={() => void probeCodexAcp()}
                      >
                        {codexProbeBusy ? '检测中...' : '检测'}
                      </button>
                    </div>
                  </SettingsRow>
                  <div className="settings-row settings-secret-row">
                    <div className="settings-label">
                      <span>Codex API Key</span>
                      <span className="settings-description">
                        {secretStatus?.codexApiKeyConfigured
                          ? '已独立保存到本地凭证文件。'
                          : '尚未配置；不会读取 Claude 的 Key 或 Codex 登录状态。'}
                      </span>
                    </div>
                    <div className="settings-secret-control">
                      <div className="settings-control settings-control-inline">
                        <input
                          className="settings-input settings-input-apikey"
                          type={showCodexApiKey ? 'text' : 'password'}
                          value={codexApiKeyInput}
                          placeholder={
                            secretStatus?.codexApiKeyConfigured
                              ? '输入新 Key 以替换'
                              : '输入 OpenAI API Key'
                          }
                          autoComplete="off"
                          disabled={secretBusy || secretStatus?.storageAvailable === false}
                          onChange={(event) => setCodexApiKeyInput(event.target.value)}
                        />
                        <button
                          className="settings-secondary-btn"
                          type="button"
                          disabled={secretBusy}
                          onClick={() => setShowCodexApiKey((value) => !value)}
                        >
                          {showCodexApiKey ? '隐藏' : '显示'}
                        </button>
                        <button
                          className="settings-secondary-btn"
                          type="button"
                          disabled={secretBusy || !codexApiKeyInput.trim()}
                          onClick={() => void saveCodexApiKey()}
                        >
                          保存
                        </button>
                        {secretStatus?.codexApiKeyConfigured && (
                          <button
                            className="settings-danger-btn"
                            type="button"
                            disabled={secretBusy}
                            onClick={() => void clearCodexApiKey()}
                          >
                            清除
                          </button>
                        )}
                      </div>
                      {codexMessage && <span className="settings-description">{codexMessage}</span>}
                    </div>
                  </div>
                </details>
              </div>
            }
            storageSettings={
              <section className="settings-section">
                <h2>本地凭证</h2>
                <div className="settings-group">
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>凭证文件</span>
                      <span className="settings-description">
                        {credentialStatus?.filePath ?? '正在读取…'}
                      </span>
                      <span className="settings-description">
                        状态：{credentialStatus?.status ?? 'unknown'} · 已配置{' '}
                        {credentialStatus?.configuredCount ?? 0} 项
                      </span>
                      <span className="settings-description">
                        凭证以明文保存在本机，拥有当前系统用户权限的程序可以读取。
                      </span>
                    </div>
                    <div className="settings-control settings-control-inline">
                      <button
                        type="button"
                        disabled={credentialBusy}
                        onClick={() =>
                          void runCredentialAction(
                            () => window.cclinkStudio.credentials.openDirectory(),
                            '已打开凭证目录',
                          )
                        }
                      >
                        打开目录
                      </button>
                      <button
                        type="button"
                        disabled={credentialBusy}
                        onClick={() =>
                          void runCredentialAction(
                            () => window.cclinkStudio.credentials.reload(),
                            '已重新加载磁盘版本',
                          )
                        }
                      >
                        重新加载
                      </button>
                    </div>
                  </div>

                  {credentialStatus?.message && (
                    <div className="settings-row">
                      <div className="settings-label">
                        <span>状态提示</span>
                        <span className="settings-description">{credentialStatus.message}</span>
                      </div>
                    </div>
                  )}

                  {credentialStatus && credentialStatus.legacyEncryptedFiles.length > 0 && (
                    <div className="settings-row">
                      <div className="settings-label">
                        <span>旧版加密文件</span>
                        <span className="settings-description">
                          无法在不访问系统钥匙串的情况下迁移，请重新输入对应凭证。
                        </span>
                        {credentialStatus.legacyEncryptedFiles.map((filePath) => (
                          <span key={filePath} className="settings-description">
                            {filePath}
                          </span>
                        ))}
                      </div>
                      <div className="settings-control">
                        <button
                          type="button"
                          disabled={credentialBusy}
                          onClick={() => {
                            if (!window.confirm('确认删除检测到的全部旧版加密凭证文件？')) return
                            void runCredentialAction(
                              () => window.cclinkStudio.credentials.removeLegacyFiles(),
                              '旧版加密凭证文件已删除',
                            )
                          }}
                        >
                          删除旧文件
                        </button>
                      </div>
                    </div>
                  )}

                  {credentialMetadata.map((credential) => (
                    <div key={credential.id} className="settings-row">
                      <div className="settings-label">
                        <span>{credential.id}</span>
                        <span className="settings-description">
                          {credential.kind} · {credential.consumers.join('、') || '暂无消费者'} ·
                          更新于 {credential.updatedAt ?? '未知'}
                        </span>
                        {credential.fieldNames.map((field) => {
                          const key = `${credential.id}:${field}`
                          const revealed = revealedCredentialFields[key]
                          return (
                            <span key={field} className="settings-description">
                              {field}: {revealed ?? '••••••••'}
                            </span>
                          )
                        })}
                      </div>
                      <div className="settings-control settings-control-inline">
                        {credential.fieldNames.map((field) => {
                          const key = `${credential.id}:${field}`
                          return (
                            <span key={field} className="settings-control settings-control-inline">
                              <button
                                type="button"
                                disabled={credentialBusy}
                                onClick={() => void revealCredentialField(credential.id, field)}
                              >
                                {revealedCredentialFields[key] === undefined ? '显示' : '隐藏'}{' '}
                                {field}
                              </button>
                              <button
                                type="button"
                                disabled={credentialBusy}
                                onClick={() =>
                                  void runCredentialAction(
                                    () =>
                                      window.cclinkStudio.credentials.copyField(
                                        credential.id,
                                        field,
                                      ),
                                    `已复制 ${credential.id}.${field}`,
                                  )
                                }
                              >
                                复制
                              </button>
                            </span>
                          )
                        })}
                        <button
                          type="button"
                          disabled={credentialBusy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `确认清除 ${credential.consumers.join('、') || credential.id} 的凭证？相关功能将需要重新配置。`,
                              )
                            )
                              return
                            void runCredentialAction(
                              () => window.cclinkStudio.credentials.remove(credential.id),
                              `已清除 ${credential.id}`,
                            )
                          }}
                        >
                          清除
                        </button>
                      </div>
                    </div>
                  ))}

                  {credentialMetadata.length === 0 && (
                    <div className="settings-row">
                      <div className="settings-label">
                        <span>尚未保存凭证</span>
                        <span className="settings-description">
                          从上方选择服务并填写密钥；数据源按连接管理。
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="settings-row">
                    <div className="settings-label">
                      <span>清除全部</span>
                      <span className="settings-description">
                        只清除 CCLink Studio 管理的第三方凭证，不删除项目配置。
                      </span>
                    </div>
                    <div className="settings-control">
                      <button
                        type="button"
                        disabled={credentialBusy || credentialMetadata.length === 0}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `确认清除 ${credentialMetadata.length} 项凭证？受影响功能：${credentialMetadata.flatMap((item) => item.consumers).join('、')}。此操作不可撤销。`,
                            )
                          )
                            return
                          void runCredentialAction(
                            () => window.cclinkStudio.credentials.clearAll(),
                            '全部本地凭证已清除',
                          )
                        }}
                      >
                        清除全部
                      </button>
                    </div>
                  </div>

                  {credentialMessage && (
                    <div className="settings-description">{credentialMessage}</div>
                  )}
                </div>
              </section>
            }
          />
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
              <SettingsRow settingKey="markdownAutoSave" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>Markdown 自动保存</span>
                  <span className="settings-description">
                    已命名的本地 Markdown 停止输入 1.5
                    秒后保存。冲突或失败时暂停；未命名文档仅保留草稿。
                  </span>
                </div>
                <div className="settings-control">
                  <Toggle
                    checked={settings.markdownAutoSave}
                    onChange={(checked) => update({ markdownAutoSave: checked })}
                  />
                </div>
              </SettingsRow>
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
            <p className="settings-description">
              GitHub 账号与 Token 统一在“API Key 与连接”管理。现有仓库绑定和备份配置保留。
            </p>
            <button
              type="button"
              className="settings-secondary-btn"
              onClick={() => {
                navigateSettings('connections', 'github')
              }}
            >
              配置 GitHub 连接
            </button>
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
            <KeybindingsSettings />
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
