import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, PROVIDER_PRESETS, getPresetBaseUrl } from '@shared/ipc/settings'
import type { ApiFormat, AppSettings, PermissionMode, Provider } from '@shared/ipc/settings'
import { useSettingsStore } from '../../stores'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import {
  IconFile,
  IconGlobe,
  IconKeyboard,
  IconPaintbrush,
  IconRobot,
  IconSearch,
  IconSettings,
} from '../common/Icons'
import { Toggle } from '../common/Toggle'

type SettingsSectionId = 'appearance' | 'agent' | 'browser' | 'editor' | 'shortcuts' | 'about'
type AppSettingKey = Extract<keyof AppSettings, string>

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  label: string
  icon: (props: { size?: number }) => React.ReactElement
}> = [
  { id: 'appearance', label: '外观', icon: IconPaintbrush },
  { id: 'agent', label: 'Agent', icon: IconRobot },
  { id: 'browser', label: '浏览器', icon: IconGlobe },
  { id: 'editor', label: '编辑器', icon: IconFile },
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
  const settings = useSettingsStore((state) => state.settings)
  const loading = useSettingsStore((state) => state.loading)
  const error = useSettingsStore((state) => state.error)
  const loadSettings = useSettingsStore((state) => state.loadSettings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const resetSettings = useSettingsStore((state) => state.resetSettings)
  const resetSetting = useSettingsStore((state) => state.resetSetting)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (initialSection) setActiveSection(normalizeSection(initialSection))
  }, [initialSection])

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

  const handleProviderChange = (provider: Provider): void => {
    const preset = PROVIDER_PRESETS[provider]
    const apiBaseUrl = getPresetBaseUrl(provider, settings.apiFormat)
    update({
      provider,
      apiBaseUrl,
      modelName: provider === 'custom' ? settings.modelName : preset.defaultModel,
    })
  }

  const handleApiFormatChange = (apiFormat: ApiFormat): void => {
    const apiBaseUrl = getPresetBaseUrl(settings.provider, apiFormat)
    update({
      apiFormat,
      backendType: apiFormat === 'anthropic' ? 'claude-code' : 'http-api',
      apiBaseUrl,
    })
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
          <button type="button" className="settings-reset-all" onClick={() => void resetSettings()}>
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
              <SettingsRow settingKey="permissionMode" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>权限模式</span>
                  <span className="settings-description">控制 Agent 操作确认策略。</span>
                </div>
                <div className="settings-control">
                  <select
                    className="settings-select"
                    value={settings.permissionMode}
                    onChange={(event) =>
                      update({ permissionMode: event.target.value as PermissionMode })
                    }
                  >
                    <option value="auto">自动</option>
                    <option value="categorized">按类别确认</option>
                    <option value="strict">严格确认</option>
                  </select>
                </div>
              </SettingsRow>

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
                    onChange={(event) => update({ apiBaseUrl: event.target.value })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="apiKey" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>API Key</span>
                  <span className="settings-description">仅保存在本机设置中。</span>
                </div>
                <div className="settings-control settings-control-inline">
                  <input
                    className="settings-input"
                    type={showApiKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    onChange={(event) => update({ apiKey: event.target.value })}
                  />
                  <button type="button" onClick={() => setShowApiKey((value) => !value)}>
                    {showApiKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </SettingsRow>

              <SettingsRow settingKey="modelName" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>模型名称</span>
                  <span className="settings-description">发送给后端的模型标识。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={settings.modelName}
                    onChange={(event) => update({ modelName: event.target.value })}
                  />
                </div>
              </SettingsRow>

              <SettingsRow settingKey="claudeCodePath" settings={settings} onReset={resetOne}>
                <div className="settings-label">
                  <span>Claude Code 路径</span>
                  <span className="settings-description">为空时从 PATH 自动解析。</span>
                </div>
                <div className="settings-control">
                  <input
                    className="settings-input"
                    value={settings.claudeCodePath}
                    onChange={(event) => update({ claudeCodePath: event.target.value })}
                  />
                </div>
              </SettingsRow>
            </div>
          </section>
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
                      update({ defaultZoomMode: event.target.value as AppSettings['defaultZoomMode'] })
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
                    开源桌面工作台壳，不内置官方生产 API、账号、订阅、云同步或远程工作区服务。
                  </span>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-label">
                  <span>当前阶段</span>
                  <span className="settings-description">
                    商业能力已迁入 cclink-dev/commercial，本仓库保留本地 Agent、浏览器、编辑器、文件和终端能力。
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
