import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  useThemeStore,
  useSyncStore,
  useFsStore,
  useSettingsStore,
  useSubscriptionStore,
  useTabStore,
  useCommandStore,
  useAuthStore,
  useCclinkStore,
  useAndroidStore,
} from '../../stores'
import type { PhysicalDeviceInfo } from '../../stores/android-store'
import {
  IconUser,
  IconPaintbrush,
  IconRobot,
  IconGlobe,
  IconKeyboard,
  IconFile,
  IconSettings,
  IconCloud,
  IconSync,
  IconCloudCheck,
  IconCrown,
  IconSearch,
  IconClose,
  IconLink,
  IconMobile,
} from '../common/Icons'
import { SubscriptionSettings } from '../subscription/SubscriptionSettings'
import { Toggle } from '../common/Toggle'
import { CclinkPanel } from '../cclink/CclinkPanel'
import type { SyncPhase, SyncResult } from '@shared/ipc/sync'
import { SYNC_PHASE_LABEL } from '../../constants/sync-labels'
import { PROVIDER_PRESETS, DEFAULT_SETTINGS } from '@shared/ipc/settings'
import type { AppSettings, Provider } from '@shared/ipc/settings'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import type { TerminalAuditEvent, TerminalAuditEventKind, TerminalPermissionRisk } from '@shared/terminal'

type AppSettingKey = Extract<keyof AppSettings, string>

/** 判断设置值是否被修改（与默认值不同） */
function isModified<K extends AppSettingKey>(key: K, settings: AppSettings): boolean {
  return settings[key] !== DEFAULT_SETTINGS[key]
}

/** 设置行组件 — 带修改标记 + 单项重置 */
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
    <div className={`settings-row ${modified ? 'modified' : ''}`} id={`setting-${settingKey}`}>
      {modified && <span className="settings-modified-dot" />}
      {children}
      {modified && (
        <button
          className="settings-reset-setting"
          onClick={() => onReset(settingKey)}
          title="恢复默认值"
        >
          <IconSettings size={12} />
        </button>
      )}
    </div>
  )
}

/** 设置导航项 */
const SETTINGS_SECTIONS = [
  { id: 'account', label: '账户', icon: IconUser },
  { id: 'appearance', label: '外观', icon: IconPaintbrush },
  { id: 'agent', label: 'Agent', icon: IconRobot },
  { id: 'remote-connections', label: '远程连接', icon: IconLink },
  { id: 'devices', label: '设备', icon: IconMobile },
  { id: 'browser', label: '浏览器', icon: IconGlobe },
  { id: 'editor', label: '编辑器', icon: IconFile },
  { id: 'meshy', label: 'Meshy', icon: IconFile },
  { id: 'sync', label: '同步', icon: IconCloud },
  { id: 'subscription', label: '订阅', icon: IconCrown },
  { id: 'shortcuts', label: '快捷键', icon: IconKeyboard },
  { id: 'about', label: '关于', icon: IconSettings },
]

/** 设置搜索索引 — 每个可搜索单元的元数据 */
const SETTINGS_SEARCH_INDEX = [
  // 账户
  {
    sectionId: 'account',
    label: '当前账号',
    description: '手机号、用户 ID、登录方式和最近登录时间',
    keywords: ['account', 'user', 'phone', 'login', '账号', '手机号'],
  },
  {
    sectionId: 'account',
    label: 'CCLink 身份',
    description: 'DeepInk 账号对应的远程连接 / TIM 身份',
    keywords: ['cclink', 'tim', 'remote', 'agent', '远程', '身份'],
  },
  // 外观
  {
    sectionId: 'appearance',
    label: '主题',
    description: '选择应用主题',
    keywords: ['theme', 'dark', 'light', '深色', '浅色'],
    settingKey: 'theme' as string,
  },
  // Agent
  {
    sectionId: 'agent',
    label: 'AI 提供商',
    description: '选择模型服务提供商',
    keywords: ['provider', 'anthropic', 'deepseek', 'glm', 'qwen', 'openai'],
    settingKey: 'provider',
  },
  {
    sectionId: 'agent',
    label: 'API 格式',
    description: 'Anthropic 或 OpenAI 兼容格式',
    keywords: ['format', 'anthropic', 'openai', 'api'],
    settingKey: 'apiFormat',
  },
  {
    sectionId: 'agent',
    label: 'API 地址',
    description: 'API 基础地址',
    keywords: ['url', 'base', 'endpoint', '端点'],
    settingKey: 'apiBaseUrl',
  },
  {
    sectionId: 'agent',
    label: 'API 密钥',
    description: '在提供商控制台申请的 API Key',
    keywords: ['key', 'secret', 'token', '密码'],
    settingKey: 'apiKey',
  },
  {
    sectionId: 'agent',
    label: '模型名称',
    description: '指定要使用的模型',
    keywords: ['model', 'gpt', 'claude', 'glm', 'qwen'],
    settingKey: 'modelName',
  },
  {
    sectionId: 'agent',
    label: '权限模式',
    description: '控制 Agent 执行操作前的确认方式',
    keywords: ['permission', 'auto', 'strict', '权限', '确认'],
    settingKey: 'permissionMode',
  },
  {
    sectionId: 'agent',
    label: '预算上限 (USD)',
    description: '单次对话的最大 AI 调用费用',
    keywords: ['budget', 'cost', '费用', '预算'],
    settingKey: 'maxBudgetUsd',
  },
  {
    sectionId: 'agent',
    label: 'Terminal 审计',
    description: '查看和清理终端命令确认、审批和错误记录',
    keywords: ['terminal', 'audit', 'shell', 'command', '日志', '审计', '终端'],
  },
  // 远程连接
  {
    sectionId: 'remote-connections',
    label: 'CCLink 远程连接',
    description: '身份同步、旧账号导入、服务器同步和实时链路',
    keywords: ['cclink', 'remote', 'agent', 'tim', '远程', '服务器'],
  },
  // 设备
  {
    sectionId: 'devices',
    label: 'Android 设备',
    description: 'Android 真机连接；模拟器和云手机已封存',
    keywords: ['android', 'device', 'adb', 'phone', 'usb', 'wifi', '设备', '真机'],
  },
  // 浏览器
  {
    sectionId: 'browser',
    label: '默认缩放模式',
    description: '新打开浏览器 Tab 时的默认缩放方式',
    keywords: ['zoom', 'fit', '缩放', '适应'],
    settingKey: 'defaultZoomMode',
  },
  {
    sectionId: 'browser',
    label: '默认设备模式',
    description: '新打开浏览器 Tab 时的默认设备模式',
    keywords: ['device', 'mobile', 'desktop', '设备', '移动'],
    settingKey: 'defaultDeviceMode',
  },
  // 编辑器
  {
    sectionId: 'editor',
    label: '字体族',
    description: '编辑器字体',
    keywords: ['font', 'family', '字体'],
    settingKey: 'editorFontFamily',
  },
  {
    sectionId: 'editor',
    label: '字号',
    description: '编辑器字号',
    keywords: ['font', 'size', '字号'],
    settingKey: 'editorFontSize',
  },
  {
    sectionId: 'editor',
    label: 'Tab 宽度',
    description: 'Tab 键插入的空格数',
    keywords: ['tab', '缩进', '空格'],
    settingKey: 'editorTabSize',
  },
  {
    sectionId: 'editor',
    label: '自动换行',
    description: '长行自动折行',
    keywords: ['word', 'wrap', '换行'],
    settingKey: 'editorWordWrap',
  },
  {
    sectionId: 'editor',
    label: '行号',
    description: '编辑器行号显示',
    keywords: ['line', 'number', '行号'],
    settingKey: 'editorLineNumbers',
  },
  {
    sectionId: 'editor',
    label: '显示隐藏文件',
    description: '文件树中显示以 . 开头的文件和目录',
    keywords: ['hidden', 'dotfile', 'dot', '隐藏'],
    settingKey: 'showHiddenFiles',
  },
  // Meshy
  {
    sectionId: 'meshy',
    label: 'Meshy API 密钥',
    description: '用于 Text to 3D 模型生成和资产保存',
    keywords: ['meshy', '3d', 'model', 'asset', 'key', '模型', '资产'],
    settingKey: 'meshyApiKey',
  },
  // 同步
  {
    sectionId: 'sync',
    label: '云同步',
    description: '连接 WebDAV 服务器，同步工作空间文件',
    keywords: ['webdav', 'cloud', 'jianguoyun', '坚果云', '云端'],
  },
  // 订阅
  {
    sectionId: 'subscription',
    label: '订阅',
    description: '管理订阅套餐和付费功能',
    keywords: ['plan', 'pro', '付费', '会员'],
  },
  // 快捷键
  {
    sectionId: 'shortcuts',
    label: '快捷键',
    description: '键盘快捷键列表',
    keywords: ['keyboard', 'shortcut', 'keybinding', '键盘'],
  },
  // 关于
  {
    sectionId: 'about',
    label: '关于',
    description: 'DeepInk 版本信息',
    keywords: ['version', 'about', '版本'],
  },
]

const SETTINGS_PAGE_STORAGE_KEY = 'deepink-settings-page-state'
const DEFAULT_SETTINGS_SECTION = 'account'
const LEGACY_SETTINGS_SECTION_ALIASES: Record<string, string> = {
  'remote-agent': 'remote-connections',
}

function normalizeSettingsSection(section: unknown): string {
  const normalized =
    typeof section === 'string' ? (LEGACY_SETTINGS_SECTION_ALIASES[section] ?? section) : section
  return SETTINGS_SECTIONS.some((item) => item.id === normalized)
    ? String(normalized)
    : DEFAULT_SETTINGS_SECTION
}

function loadSettingsPageState(): {
  activeSection: string
  searchQuery: string
  jsonMode: boolean
  scrollTop: number
} {
  try {
    if (typeof localStorage === 'undefined') {
      return {
        activeSection: DEFAULT_SETTINGS_SECTION,
        searchQuery: '',
        jsonMode: false,
        scrollTop: 0,
      }
    }
    const raw = localStorage.getItem(SETTINGS_PAGE_STORAGE_KEY)
    if (!raw)
      return {
        activeSection: DEFAULT_SETTINGS_SECTION,
        searchQuery: '',
        jsonMode: false,
        scrollTop: 0,
      }
    const parsed = JSON.parse(raw) as Partial<ReturnType<typeof loadSettingsPageState>>
    return {
      activeSection: normalizeSettingsSection(parsed.activeSection),
      searchQuery: parsed.searchQuery ?? '',
      jsonMode: Boolean(parsed.jsonMode),
      scrollTop: typeof parsed.scrollTop === 'number' ? parsed.scrollTop : 0,
    }
  } catch {
    return {
      activeSection: DEFAULT_SETTINGS_SECTION,
      searchQuery: '',
      jsonMode: false,
      scrollTop: 0,
    }
  }
}

function saveSettingsPageState(state: {
  activeSection: string
  searchQuery: string
  jsonMode: boolean
  scrollTop: number
}): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SETTINGS_PAGE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage 可能不可用，忽略持久化失败。
  }
}

interface SettingsPageProps {
  initialSection?: string
}

export function SettingsPage({ initialSection }: SettingsPageProps = {}): React.ReactElement {
  const initialPageState = useState(loadSettingsPageState)[0]
  const [activeSection, setActiveSection] = useState(
    initialSection ? normalizeSettingsSection(initialSection) : initialPageState.activeSection,
  )
  const [searchQuery, setSearchQuery] = useState(initialPageState.searchQuery)
  const [scrollToSettingKey, setScrollToSettingKey] = useState<string | null>(null)
  const [jsonMode, setJsonMode] = useState(initialPageState.jsonMode)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const resetSettings = useSettingsStore((s) => s.resetSettings)
  const resetSetting = useSettingsStore((s) => s.resetSetting)
  const settings = useSettingsStore((s) => s.settings)
  const loadSubscriptionStatus = useSubscriptionStore((s) => s.loadStatus)
  const user = useAuthStore((s) => s.user)
  const loggedIn = useAuthStore((s) => s.loggedIn)
  const localIdentity = useAuthStore((s) => s.localIdentity)
  const loadCclink = useCclinkStore((s) => s.load)

  // 首次挂载时加载设置 + 远程身份状态；订阅状态需要云账号。
  useEffect(() => {
    loadSettings()
    if (loggedIn) loadSubscriptionStatus()
    void loadCclink()
  }, [loggedIn, loadSettings, loadSubscriptionStatus, loadCclink])

  useEffect(() => {
    if (!initialSection) return
    setActiveSection(normalizeSettingsSection(initialSection))
    setSearchQuery('')
    setScrollToSettingKey(null)
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [initialSection])

  useEffect(() => {
    if (jsonMode) setJsonText(JSON.stringify(settings, null, 2))
  }, [jsonMode, settings])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.scrollTop = initialPageState.scrollTop
  }, [])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const save = (): void => {
      saveSettingsPageState({
        activeSection,
        searchQuery,
        jsonMode,
        scrollTop: el.scrollTop,
      })
    }
    save()
    el.addEventListener('scroll', save, { passive: true })
    return () => el.removeEventListener('scroll', save)
  }, [activeSection, searchQuery, jsonMode])

  // 搜索定位：滚动到具体设置行并高亮
  useEffect(() => {
    if (!scrollToSettingKey) return
    const el = document.getElementById(`setting-${scrollToSettingKey}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('settings-row-highlight')
      setTimeout(() => {
        el.classList.remove('settings-row-highlight')
        setScrollToSettingKey(null)
      }, 1500)
    }
  }, [scrollToSettingKey])

  // 搜索过滤
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return SETTINGS_SEARCH_INDEX.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q)),
    )
  }, [searchQuery])

  const isSearching = searchQuery.trim().length > 0

  /** 点击搜索结果跳转到对应 section 并滚动到具体设置 */
  const handleSearchResultClick = (sectionId: string, settingKey?: string) => {
    setSearchQuery('')
    setActiveSection(sectionId)
    if (settingKey) {
      // 延迟一帧让 section 渲染后再滚动
      setTimeout(() => setScrollToSettingKey(settingKey), 50)
    }
  }

  /** 恢复默认设置 */
  const handleReset = () => {
    if (confirm('确定要恢复所有默认设置吗？此操作不可撤销。')) {
      resetSettings()
    }
  }

  /** 退出登录 */
  const handleLogout = async () => {
    await window.deepink.cclink.disconnectRealtime().catch(() => undefined)
    await window.deepink.cclink.clearIdentity().catch(() => undefined)
    await window.deepink.auth.logout()
    useCclinkStore.setState({
      identity: null,
      servers: [],
      sessions: [],
      messages: {},
      realtimeStatus: { state: 'idle' },
      error: null,
    })
    useAuthStore.getState().setLoggedIn(false, null)
  }

  /** 进入 JSON 模式时序列化当前设置 */
  const enterJsonMode = () => {
    setJsonText(JSON.stringify(settings, null, 2))
    setJsonError(null)
    setJsonMode(true)
  }

  /** JSON 模式保存 */
  const handleJsonSave = async () => {
    try {
      const parsed = JSON.parse(jsonText)
      // 校验 key 合法性
      const validKeys = Object.keys(DEFAULT_SETTINGS)
      const unknownKeys = Object.keys(parsed).filter((k) => !validKeys.includes(k))
      if (unknownKeys.length > 0) {
        setJsonError(`未知设置项: ${unknownKeys.join(', ')}`)
        return
      }
      const result = await window.deepink.settings.set(parsed)
      if (result.success && result.settings) {
        useSettingsStore.getState().loadSettings()
        setJsonMode(false)
        setJsonError(null)
      } else {
        setJsonError(result.error ?? '保存失败')
      }
    } catch (err) {
      setJsonError(`JSON 格式错误: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 单项重置处理 */
  const handleResetSetting = useCallback(
    (key: AppSettingKey) => {
      resetSetting(key)
    },
    [resetSetting],
  )

  return (
    <div className="settings-page">
      {/* 左侧导航 */}
      <div className="settings-nav">
        {/* 搜索框 */}
        <div className="settings-search">
          <IconSearch size={14} className="settings-search-icon" />
          <input
            type="text"
            className="settings-search-input"
            placeholder="搜索设置..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="settings-search-clear" onClick={() => setSearchQuery('')}>
              <IconClose size={12} />
            </button>
          )}
        </div>

        {!isSearching &&
          SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <div
                key={section.id}
                className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={16} />
                <span>{section.label}</span>
              </div>
            )
          })}

        {/* 搜索结果 */}
        {isSearching && (
          <div className="settings-search-results">
            {searchResults.length === 0 ? (
              <div className="settings-search-empty">没有匹配的设置</div>
            ) : (
              searchResults.map((item, idx) => {
                const section = SETTINGS_SECTIONS.find((s) => s.id === item.sectionId)
                const SectionIcon = section?.icon ?? IconSettings
                return (
                  <div
                    key={`${item.sectionId}-${idx}`}
                    className="settings-search-item"
                    onClick={() => handleSearchResultClick(item.sectionId, item.settingKey)}
                  >
                    <SectionIcon size={14} />
                    <div className="settings-search-item-text">
                      <span className="settings-search-item-label">{item.label}</span>
                      <span className="settings-search-item-desc">{item.description}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* 底部操作 */}
        <div className="settings-nav-footer">
          <div className="settings-account-mini">
            <span>{loggedIn ? user?.nickname || user?.phone || '云账号' : '本机工作台'}</span>
            <small>
              {loggedIn
                ? user?.phone || '已登录'
                : localIdentity?.localId.slice(0, 14) || '本地身份'}
            </small>
          </div>
          {loggedIn && (
            <button className="settings-logout-btn" onClick={() => void handleLogout()}>
              退出登录
            </button>
          )}
          <button className="settings-reset-btn" onClick={handleReset}>
            恢复默认设置
          </button>
        </div>
      </div>

      {/* 右侧内容 */}
      <div className="settings-content" ref={contentRef}>
        {/* GUI / JSON 模式切换 */}
        <div className="settings-toolbar">
          <div className="settings-mode-toggle">
            <button
              className={`settings-format-btn ${!jsonMode ? 'active' : ''}`}
              onClick={() => jsonMode && setJsonMode(false)}
            >
              GUI
            </button>
            <button
              className={`settings-format-btn ${jsonMode ? 'active' : ''}`}
              onClick={() => !jsonMode && enterJsonMode()}
            >
              JSON
            </button>
          </div>
        </div>

        {jsonMode ? (
          /* JSON 编辑器 */
          <div className="settings-json-container">
            <textarea
              className="settings-json-editor"
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value)
                setJsonError(null)
              }}
              spellCheck={false}
            />
            {jsonError && <div className="settings-json-error">{jsonError}</div>}
            <div className="settings-json-actions">
              <button className="sync-btn-primary" onClick={handleJsonSave}>
                保存
              </button>
              <button
                className="sync-btn-secondary"
                onClick={() => {
                  setJsonMode(false)
                  setJsonError(null)
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          /* GUI 模式 */
          <>
            {activeSection === 'account' && <AccountSettings onLogout={handleLogout} />}
            {activeSection === 'appearance' && <AppearanceSettings onReset={handleResetSetting} />}
            {activeSection === 'agent' && <AgentSettings onReset={handleResetSetting} />}
            {activeSection === 'remote-connections' && <RemoteConnectionSettings />}
            {activeSection === 'devices' && <DeviceSettings />}
            {activeSection === 'browser' && <BrowserSettings onReset={handleResetSetting} />}
            {activeSection === 'editor' && <EditorSettings onReset={handleResetSetting} />}
            {activeSection === 'meshy' && <MeshySettings onReset={handleResetSetting} />}
            {activeSection === 'sync' && <SyncSettings />}
            {activeSection === 'subscription' && <SubscriptionSettings />}
            {activeSection === 'shortcuts' && <ShortcutsSettings />}
            {activeSection === 'about' && <AboutSettings />}
          </>
        )}
      </div>
    </div>
  )
}

function formatDateTime(value?: number | string | null): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function maskPhone(phone?: string | null): string {
  if (!phone) return '手机号资料未同步'
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
}

function maskSecret(value?: string | null): string {
  if (!value) return '未生成'
  if (value.length <= 10) return '已生成'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

function shortId(value?: string | null): string {
  if (!value) return '—'
  return value.length > 18 ? `${value.slice(0, 14)}…` : value
}

function AccountInfoRow({
  label,
  value,
  muted,
}: {
  label: string
  value: React.ReactNode
  muted?: boolean
}): React.ReactElement {
  return (
    <div className="settings-account-row">
      <span className="settings-account-row-label">{label}</span>
      <span className={`settings-account-row-value ${muted ? 'muted' : ''}`}>{value}</span>
    </div>
  )
}

function CloudLoginInline(): React.ReactElement {
  const phoneInput = useAuthStore((s) => s.phoneInput)
  const codeInput = useAuthStore((s) => s.codeInput)
  const codeCountdown = useAuthStore((s) => s.codeCountdown)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const setPhoneInput = useAuthStore((s) => s.setPhoneInput)
  const setCodeInput = useAuthStore((s) => s.setCodeInput)
  const setCodeCountdown = useAuthStore((s) => s.setCodeCountdown)
  const setLoading = useAuthStore((s) => s.setLoading)
  const setError = useAuthStore((s) => s.setError)
  const [serviceConfigured, setServiceConfigured] = useState(true)

  useEffect(() => {
    window.deepink.auth
      .getServiceStatus()
      .then((status) => {
        setServiceConfigured(status.configured)
        if (!status.configured) setError(status.message || '登录服务未配置')
      })
      .catch(() => {
        setServiceConfigured(false)
        setError('登录服务状态不可用')
      })
  }, [setError])

  useEffect(() => {
    if (codeCountdown <= 0) return
    const timer = window.setInterval(() => {
      const current = useAuthStore.getState().codeCountdown
      setCodeCountdown(Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [codeCountdown, setCodeCountdown])

  const handleSendCode = async (): Promise<void> => {
    if (!/^1[3-9]\d{9}$/.test(phoneInput)) {
      setError('请输入正确的 11 位手机号')
      return
    }
    if (!serviceConfigured) {
      setError('登录服务未配置，请检查后端地址')
      return
    }
    if (codeCountdown > 0) return

    setLoading(true)
    setError(null)
    try {
      const result = await window.deepink.auth.phoneSendCode(phoneInput)
      if (result.success) {
        setCodeCountdown(60)
      } else {
        setError(result.error || '发送验证码失败')
      }
    } catch {
      setError('网络错误，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }

  const handlePhoneLogin = async (): Promise<void> => {
    if (!/^1[3-9]\d{9}$/.test(phoneInput)) {
      setError('请输入正确的 11 位手机号')
      return
    }
    if (!codeInput || codeInput.length < 4) {
      setError('请输入验证码')
      return
    }
    if (!serviceConfigured) {
      setError('登录服务未配置，请检查后端地址')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await window.deepink.auth.phoneLogin(phoneInput, codeInput)
      if (!result.success) {
        setError(result.error || '登录失败')
        setLoading(false)
      }
    } catch {
      setError('网络错误，请检查网络连接')
      setLoading(false)
    }
  }

  return (
    <div className="settings-account-login">
      <div className="settings-description">
        当前使用本机身份保存工作现场。登录后可启用订阅、CCLink 远程连接和跨设备账号能力。
      </div>
      <div className="settings-account-row">
        <span className="settings-account-row-label">手机号</span>
        <input
          className="settings-input"
          type="tel"
          maxLength={11}
          value={phoneInput}
          onChange={(event) => setPhoneInput(event.target.value.replace(/\D/g, ''))}
          disabled={loading || !serviceConfigured}
          placeholder="请输入手机号"
        />
      </div>
      <div className="settings-account-row">
        <span className="settings-account-row-label">验证码</span>
        <input
          className="settings-input"
          type="text"
          maxLength={6}
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value.replace(/\D/g, ''))}
          disabled={loading || !serviceConfigured}
          placeholder="请输入验证码"
        />
      </div>
      {error && <div className="settings-account-error">{error}</div>}
      <div className="settings-account-actions">
        <button
          className="sync-btn-secondary"
          onClick={() => void handleSendCode()}
          disabled={!serviceConfigured || loading || codeCountdown > 0 || phoneInput.length !== 11}
        >
          {codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
        </button>
        <button
          className="sync-btn-primary"
          onClick={() => void handlePhoneLogin()}
          disabled={!serviceConfigured || loading || !phoneInput || !codeInput}
        >
          {loading ? '登录中...' : '登录云账号'}
        </button>
      </div>
    </div>
  )
}

function SettingsInfoCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <section className="settings-account-card">
      <div className="settings-account-card-title">{title}</div>
      <div className="settings-description">{description}</div>
      {children}
    </section>
  )
}

/** 远程连接设置 */
function RemoteConnectionSettings(): React.ReactElement {
  return (
    <div className="settings-section">
      <h2>远程连接</h2>
      <div className="settings-account-grid">
        <SettingsInfoCard
          title="CCLink 连接通道"
          description="这里承接 CCLink 身份、旧账号导入、服务器同步、实时链路和诊断。远程会话和文件只在对应工作空间里展示，设置页不再充当日常工作区。"
        />
      </div>
      <CclinkPanel />
    </div>
  )
}

/** 设备设置 */
function DeviceSettings(): React.ReactElement {
  const openTab = useTabStore((s) => s.openTab)
  const deviceMode = useAndroidStore((s) => s.deviceMode)
  const setDeviceMode = useAndroidStore((s) => s.setDeviceMode)
  const setDeviceInfo = useAndroidStore((s) => s.setDeviceInfo)
  const physicalDevices = useAndroidStore((s) => s.physicalDevices)
  const setPhysicalDevices = useAndroidStore((s) => s.setPhysicalDevices)
  const [deviceLoading, setDeviceLoading] = useState(false)
  const [connectingSerial, setConnectingSerial] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const offConnected = window.deepink.android.onPhysicalConnected((data) => {
      setDeviceMode('physical')
      setDeviceInfo(data.deviceInfo)
    })
    const offDisconnected = window.deepink.android.onPhysicalDisconnected(() => {
      setDeviceMode(null)
      setDeviceInfo(null)
    })
    return () => {
      offConnected()
      offDisconnected()
    }
  }, [setDeviceInfo, setDeviceMode])

  const scanPhysicalDevices = async (): Promise<void> => {
    setDeviceLoading(true)
    setError(null)
    try {
      const devices = await window.deepink.android.listPhysicalDevices()
      setPhysicalDevices(devices)
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描物理真机失败')
    } finally {
      setDeviceLoading(false)
    }
  }

  const connectPhysicalDevice = async (device: PhysicalDeviceInfo): Promise<void> => {
    setConnectingSerial(device.serial)
    setError(null)
    try {
      const result = await window.deepink.android.connectPhysical(device.serial)
      setDeviceMode('physical')
      setDeviceInfo(result.deviceInfo)
      openTab({ type: 'android', title: 'Android', icon: '📱' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接物理真机失败')
    } finally {
      setConnectingSerial(null)
    }
  }

  const disconnectPhysicalDevice = async (): Promise<void> => {
    setDeviceLoading(true)
    setError(null)
    try {
      await window.deepink.android.disconnectPhysical()
      setDeviceMode(null)
      setDeviceInfo(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '断开物理真机失败')
    } finally {
      setDeviceLoading(false)
    }
  }

  return (
    <div className="settings-section">
      <h2>设备</h2>
      <div className="settings-account-grid">
        <SettingsInfoCard
          title="Android"
          description="Android 模拟器、SDK 一键安装和云手机路线已封存。后续只支持用户自有 Android 真机，通过 USB 或 Wi-Fi ADB 主动连接后才启用 Android Tab 和 Agent 工具。"
        />
        <section className="settings-account-card">
          <div className="settings-account-card-title">模拟器 / SDK</div>
          <AccountInfoRow label="状态" value="已封存" />
          <AccountInfoRow label="当前设备" value="—" />
          <div className="settings-device-hint">
            DeepInk 不再下载 Android SDK、系统镜像或创建 AVD，也不会启动 emulator。你可以清理本机
            Android SDK / AVD 占用空间；保留一个可用的 adb 即可继续连接真机。
          </div>
        </section>

        <section className="settings-account-card">
          <div className="settings-account-card-title">物理真机</div>
          <div className="settings-device-hint">
            用 USB 连接 Android 手机，并开启开发者选项里的 USB 调试。
          </div>
          <div className="settings-account-actions">
            <button
              className="sync-btn-secondary"
              onClick={() => void scanPhysicalDevices()}
              disabled={deviceLoading}
            >
              {deviceLoading ? '扫描中...' : '扫描真机'}
            </button>
            {deviceMode === 'physical' && (
              <button
                className="sync-btn-secondary"
                onClick={() => void disconnectPhysicalDevice()}
                disabled={deviceLoading}
              >
                断开真机
              </button>
            )}
          </div>
          <div className="settings-device-list">
            {physicalDevices.length > 0 ? (
              physicalDevices.map((device) => (
                <PhysicalDeviceRow
                  key={device.serial}
                  device={device}
                  active={deviceMode === 'physical'}
                  connecting={connectingSerial === device.serial}
                  onConnect={() => void connectPhysicalDevice(device)}
                />
              ))
            ) : (
              <div className="settings-device-empty">暂无已扫描真机</div>
            )}
          </div>
        </section>
      </div>
      {error && <div className="settings-account-error">{error}</div>}
    </div>
  )
}

function PhysicalDeviceRow({
  device,
  active,
  connecting,
  onConnect,
}: {
  device: PhysicalDeviceInfo
  active: boolean
  connecting: boolean
  onConnect: () => void
}): React.ReactElement {
  const authorized = device.state === 'device'
  return (
    <div className={`settings-device-row ${active ? 'active' : ''}`}>
      <div className="settings-device-row-main">
        <div className="settings-device-row-title">{device.model ?? device.serial}</div>
        <div className="settings-device-row-meta">
          {device.serial} ·{' '}
          {authorized
            ? '已授权'
            : device.state === 'unauthorized'
              ? '待手机确认授权'
              : device.state}
        </div>
      </div>
      <button
        className="sync-btn-secondary"
        onClick={onConnect}
        disabled={!authorized || active || connecting}
      >
        {active ? '已连接' : connecting ? '连接中...' : '连接'}
      </button>
    </div>
  )
}

/** 账户设置 */
function AccountSettings({ onLogout }: { onLogout: () => Promise<void> }): React.ReactElement {
  const [logoutConfirming, setLogoutConfirming] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const loggedIn = useAuthStore((s) => s.loggedIn)
  const user = useAuthStore((s) => s.user)
  const localIdentity = useAuthStore((s) => s.localIdentity)
  const identity = useCclinkStore((s) => s.identity)
  const identityLoading = useCclinkStore((s) => s.identityLoading)
  const cclinkError = useCclinkStore((s) => s.error)
  const ensureIdentity = useCclinkStore((s) => s.ensureIdentity)
  const clearIdentity = useCclinkStore((s) => s.clearIdentity)
  const subscriptionTier = useSubscriptionStore((s) => s.tier)
  const subscriptionStatus = useSubscriptionStore((s) => s.status)
  const subscriptionPeriodEnd = useSubscriptionStore((s) => s.periodEnd)

  const displayName = loggedIn ? user?.nickname || user?.phone || 'DeepInk 用户' : '本机工作台'
  const tierLabel = subscriptionTier === 'pro' ? 'Pro' : 'Free'
  const statusLabel = subscriptionStatus === 'active' ? '有效' : '未激活'
  const cclinkReady = Boolean(
    identity?.clientImUserId && identity?.imUserSig && identity?.authToken,
  )
  const handleLogoutClick = async (): Promise<void> => {
    if (!logoutConfirming) {
      setLogoutConfirming(true)
      setLogoutError(null)
      return
    }
    setLogoutLoading(true)
    setLogoutError(null)
    try {
      await onLogout()
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : '退出登录失败，请重试')
      setLogoutLoading(false)
    }
  }

  return (
    <div className="settings-section">
      <h2>账户</h2>

      <div className="settings-account-hero">
        <div className="settings-account-avatar">
          {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <IconUser size={30} />}
        </div>
        <div className="settings-account-hero-main">
          <div className="settings-account-name">{displayName}</div>
          <div className="settings-account-subtitle">
            {loggedIn
              ? `${maskPhone(user?.phone)} · 手机号登录`
              : `本地身份 · ${shortId(localIdentity?.localId)}`}
          </div>
        </div>
        <span className={`settings-account-badge ${subscriptionTier === 'pro' ? 'pro' : ''}`}>
          {tierLabel}
        </span>
      </div>

      <div className="settings-account-grid">
        <section className="settings-account-card">
          <div className="settings-account-card-title">本机身份</div>
          <div className="settings-description">
            未登录也会使用本机身份保存工作现场、草稿、Tab 和布局；之后绑定云账号时再做迁移。
          </div>
          <AccountInfoRow label="本地 ID" value={localIdentity?.localId ?? '初始化中'} muted />
          <AccountInfoRow label="设备 ID" value={localIdentity?.deviceId ?? '初始化中'} muted />
          <AccountInfoRow label="设备名" value={localIdentity?.deviceName ?? '—'} />
          <AccountInfoRow label="创建时间" value={formatDateTime(localIdentity?.createdAt)} />
          <AccountInfoRow label="更新时间" value={formatDateTime(localIdentity?.updatedAt)} />
          <AccountInfoRow label="绑定云账号" value={localIdentity?.boundCloudUserId ?? '未绑定'} />
        </section>

        <section className="settings-account-card">
          <div className="settings-account-card-title">DeepInk 账号</div>
          {loggedIn ? (
            <>
              <AccountInfoRow label="手机号" value={maskPhone(user?.phone)} />
              <AccountInfoRow label="用户 ID" value={user?.id ?? '—'} muted />
              <AccountInfoRow
                label="登录方式"
                value={
                  user?.loginMethod === 'phone'
                    ? '手机号验证码'
                    : user?.loginMethod === 'wechat'
                      ? '微信登录'
                      : '—'
                }
              />
              <AccountInfoRow label="最近登录" value={formatDateTime(user?.lastLoginAt)} />
              <AccountInfoRow label="订阅状态" value={`${tierLabel} · ${statusLabel}`} />
              <AccountInfoRow
                label="订阅到期"
                value={formatDateTime(user?.subscriptionExpiresAt ?? subscriptionPeriodEnd)}
              />
              {logoutError && <div className="settings-account-error">{logoutError}</div>}
              <div className="settings-account-actions">
                <button
                  className="settings-logout-btn inline"
                  onClick={() => void handleLogoutClick()}
                  disabled={logoutLoading}
                >
                  {logoutLoading ? '退出中...' : logoutConfirming ? '确认退出' : '退出登录'}
                </button>
                {logoutConfirming && !logoutLoading && (
                  <button className="sync-btn-secondary" onClick={() => setLogoutConfirming(false)}>
                    取消
                  </button>
                )}
              </div>
            </>
          ) : (
            <CloudLoginInline />
          )}
        </section>

        <section className="settings-account-card">
          <div className="settings-account-card-title">远程连接 / CCLink 身份</div>
          <div className={`settings-account-status ${cclinkReady ? 'ok' : 'warn'}`}>
            {!loggedIn
              ? '登录 DeepInk 云账号后可创建或导入 CCLink/TIM 身份'
              : cclinkReady
                ? '已就绪，可用于远程连接链路'
                : '尚未创建 DeepInk CCLink/TIM 身份；旧账号请到“远程连接”设置导入'}
          </div>
          <AccountInfoRow label="账号用户 ID" value={identity?.accountUserId ?? '—'} muted />
          <AccountInfoRow label="TIM 用户 ID" value={identity?.clientImUserId ?? '—'} muted />
          <AccountInfoRow
            label="SDK AppID"
            value={identity?.sdkAppId ? String(identity.sdkAppId) : '—'}
          />
          <AccountInfoRow label="设备名" value={identity?.deviceName ?? '—'} />
          <AccountInfoRow label="设备 ID" value={identity?.deviceId ?? '—'} muted />
          <AccountInfoRow label="Auth Token" value={maskSecret(identity?.authToken)} muted />
          <AccountInfoRow label="UserSig" value={maskSecret(identity?.imUserSig)} muted />
          <AccountInfoRow label="更新时间" value={formatDateTime(identity?.updatedAt)} />
          <AccountInfoRow label="过期时间" value={formatDateTime(identity?.expiresAt)} />
          {cclinkError && <div className="settings-account-error">{cclinkError}</div>}
          <div className="settings-account-actions">
            <button
              className="sync-btn-primary"
              disabled={identityLoading || !loggedIn}
              onClick={() => void ensureIdentity()}
              title={loggedIn ? undefined : '登录 DeepInk 云账号后可用'}
            >
              {identityLoading
                ? '处理中...'
                : cclinkReady
                  ? '刷新 DeepInk 身份'
                  : '创建 DeepInk 身份'}
            </button>
            <button
              className="sync-btn-secondary"
              disabled={!identity}
              onClick={() => void clearIdentity()}
            >
              清除本地身份
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
/** 外观设置 */
function AppearanceSettings({
  onReset,
}: {
  onReset: (key: AppSettingKey) => void
}): React.ReactElement {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  return (
    <div className="settings-section">
      <h2>外观</h2>
      <div className="settings-group">
        {/* 主题由 theme-store 管理（不在 AppSettings 中），不显示修改标记 */}
        <div className="settings-row">
          <div className="settings-label">
            <span>主题</span>
            <span className="settings-description">选择应用主题</span>
          </div>
          <select
            className="settings-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'system')}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>

        <SettingsRow settingKey="appZoomLevel" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>界面缩放</span>
            <span className="settings-description">
              应用整体缩放级别（-3 缩到 50%，+3 放到 200%）
            </span>
          </div>
          <div className="settings-input-group">
            <input
              type="number"
              className="settings-input"
              min={-3}
              max={3}
              step={0.5}
              value={settings.appZoomLevel}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v >= -3 && v <= 3) {
                  updateSettings({ appZoomLevel: v })
                  document.body.style.zoom = String(Math.pow(1.2, v))
                }
              }}
            />
          </div>
        </SettingsRow>

        <SettingsRow settingKey="uiFontSize" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>UI 字号 (px)</span>
            <span className="settings-description">界面基础字号（影响菜单、按钮、标签等）</span>
          </div>
          <select
            className="settings-select"
            value={settings.uiFontSize}
            onChange={(e) => {
              const v = Number(e.target.value)
              updateSettings({ uiFontSize: v })
              document.documentElement.style.fontSize = `${v}px`
            }}
          >
            <option value={12}>12 px</option>
            <option value={13}>13 px</option>
            <option value={14}>14 px</option>
            <option value={15}>15 px</option>
            <option value={16}>16 px</option>
          </select>
        </SettingsRow>
      </div>
    </div>
  )
}

/** Agent 设置 */
function AgentSettings({ onReset }: { onReset: (key: AppSettingKey) => void }): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const error = useSettingsStore((s) => s.error)
  const clearError = useSettingsStore((s) => s.clearError)
  // 预算输入用本地 state，避免中间状态（如 "0."）被受控 value 吞掉
  const [budgetInput, setBudgetInput] = useState(String(settings.maxBudgetUsd))
  // API 密码显示/隐藏
  const [showApiKey, setShowApiKey] = useState(false)

  // store 中的值变化时同步到本地 state
  useEffect(() => {
    setBudgetInput(String(settings.maxBudgetUsd))
  }, [settings.maxBudgetUsd])

  /** 选择提供商时联动更新 apiBaseUrl、apiFormat、modelName */
  const handleProviderChange = (provider: string) => {
    const preset = PROVIDER_PRESETS[provider as Provider]
    if (!preset) return

    // 根据当前 apiFormat 确定新 baseUrl
    const currentFormat = settings.apiFormat
    const newBaseUrl =
      currentFormat === 'anthropic' ? preset.anthropicBaseUrl : preset.openaiBaseUrl

    // 如果当前格式不支持（空 URL），自动切换到另一种
    let apiFormat = currentFormat
    let apiBaseUrl = newBaseUrl
    if (!newBaseUrl) {
      apiFormat = currentFormat === 'anthropic' ? 'openai' : 'anthropic'
      apiBaseUrl = apiFormat === 'anthropic' ? preset.anthropicBaseUrl : preset.openaiBaseUrl
    }

    // 计算新的 backendType
    const backendType = apiFormat === 'openai' ? 'http-api' : 'claude-code'

    updateSettings({
      provider: provider as AppSettings['provider'],
      apiFormat,
      apiBaseUrl,
      modelName: preset.defaultModel || settings.modelName,
      backendType: backendType as AppSettings['backendType'],
    })
  }

  /** 切换 API 格式时联动更新 apiBaseUrl */
  const handleFormatChange = (format: 'anthropic' | 'openai') => {
    const preset = PROVIDER_PRESETS[settings.provider]
    const baseUrl = format === 'anthropic' ? preset.anthropicBaseUrl : preset.openaiBaseUrl
    const backendType = format === 'openai' ? 'http-api' : 'claude-code'

    updateSettings({
      apiFormat: format,
      apiBaseUrl: baseUrl || settings.apiBaseUrl,
      backendType: backendType as AppSettings['backendType'],
    })
  }

  const preset = PROVIDER_PRESETS[settings.provider] ?? PROVIDER_PRESETS.custom
  const isCustom = settings.provider === 'custom'
  const anthropicAvailable = !!preset.anthropicBaseUrl || isCustom
  const openaiAvailable = !!preset.openaiBaseUrl || isCustom

  return (
    <div className="settings-section">
      <h2>Agent</h2>
      <div className="settings-group">
        {/* ── 提供商选择 ── */}
        <SettingsRow settingKey="provider" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>AI 提供商</span>
            <span className="settings-description">选择模型服务提供商</span>
          </div>
          <select
            className="settings-select"
            value={settings.provider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </SettingsRow>

        {/* ── API 格式 ── */}
        <SettingsRow settingKey="apiFormat" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>API 格式</span>
            <span className="settings-description">
              {settings.apiFormat === 'anthropic'
                ? '使用 Claude Code CLI + 环境变量注入（支持完整工具链）'
                : '直接 HTTP API 调用（纯对话模式）'}
            </span>
          </div>
          <div className="settings-format-group">
            <button
              className={`settings-format-btn ${settings.apiFormat === 'anthropic' ? 'active' : ''}`}
              disabled={!anthropicAvailable}
              onClick={() => handleFormatChange('anthropic')}
              title={!anthropicAvailable ? '该提供商不支持 Anthropic 格式' : ''}
            >
              Anthropic
            </button>
            <button
              className={`settings-format-btn ${settings.apiFormat === 'openai' ? 'active' : ''}`}
              disabled={!openaiAvailable}
              onClick={() => handleFormatChange('openai')}
              title={!openaiAvailable ? '该提供商不支持 OpenAI 格式' : ''}
            >
              OpenAI
            </button>
          </div>
        </SettingsRow>

        {/* ── API 地址 ── */}
        <SettingsRow settingKey="apiBaseUrl" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>API 地址</span>
            <span className="settings-description">
              {settings.apiFormat === 'anthropic' ? 'Anthropic 兼容端点' : 'OpenAI 兼容端点'}
            </span>
          </div>
          <input
            type="text"
            className="settings-input settings-input-wide"
            value={settings.apiBaseUrl}
            readOnly={!isCustom}
            onChange={(e) => isCustom && updateSettings({ apiBaseUrl: e.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </SettingsRow>

        {/* ── API 密钥 ── */}
        <SettingsRow settingKey="apiKey" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>API 密钥</span>
            <span className="settings-description">在提供商控制台申请的 API Key</span>
          </div>
          <div className="settings-input-group">
            <input
              type={showApiKey ? 'text' : 'password'}
              className="settings-input settings-input-apikey"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
            <button
              className="settings-icon-btn"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? '隐藏密钥' : '显示密钥'}
            >
              {showApiKey ? '🙈' : '👁'}
            </button>
          </div>
        </SettingsRow>

        {/* ── 模型名称 ── */}
        <SettingsRow settingKey="modelName" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>模型名称</span>
            <span className="settings-description">
              {settings.apiFormat === 'anthropic' && settings.provider !== 'custom'
                ? '部分提供商在服务端做模型映射，无需填写'
                : '指定要使用的模型'}
            </span>
          </div>
          <input
            type="text"
            className="settings-input"
            value={settings.modelName}
            onChange={(e) => updateSettings({ modelName: e.target.value })}
            placeholder={preset.defaultModel || 'model-name'}
          />
        </SettingsRow>

        {/* ── 权限模式 ── */}
        <SettingsRow settingKey="permissionMode" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>权限模式</span>
            <span className="settings-description">
              控制 Agent 执行操作前的确认方式（立即生效）
            </span>
          </div>
          <select
            className="settings-select"
            value={settings.permissionMode}
            onChange={(e) =>
              updateSettings({
                permissionMode: e.target.value as 'auto' | 'categorized' | 'strict',
              })
            }
          >
            <option value="auto">自动 — 全部允许</option>
            <option value="categorized">分类 — 写操作需确认</option>
            <option value="strict">严格 — 全部需确认</option>
          </select>
        </SettingsRow>

        {/* ── 预算上限 ── */}
        <SettingsRow settingKey="maxBudgetUsd" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>预算上限 (USD)</span>
            <span className="settings-description">单次对话的最大 AI 调用费用（重启后生效）</span>
          </div>
          <input
            type="number"
            className="settings-input"
            value={budgetInput}
            min="0.1"
            step="0.1"
            onChange={(e) => setBudgetInput(e.target.value)}
            onBlur={() => {
              const val = parseFloat(budgetInput)
              if (!isNaN(val) && val >= 0.1) {
                updateSettings({ maxBudgetUsd: val })
              } else {
                setBudgetInput(String(settings.maxBudgetUsd))
              }
            }}
          />
        </SettingsRow>

        {error && (
          <div className="settings-error">
            {error}
            <button className="settings-error-dismiss" onClick={clearError}>
              关闭
            </button>
          </div>
        )}
      </div>
      <TerminalAuditSettings />
    </div>
  )
}

const TERMINAL_AUDIT_KIND_LABEL: Record<TerminalAuditEventKind, string> = {
  created: '创建',
  closed: '关闭视图',
  terminated: '终止',
  'command-confirmation-requested': '请求确认',
  'command-confirmation-timeout': '确认超时',
  'command-submitted': '提交命令',
  'command-approved': '已允许',
  'command-denied': '已拒绝',
  output: '输出',
  exit: '退出',
  error: '错误',
}

const TERMINAL_AUDIT_RISK_LABEL: Record<TerminalPermissionRisk, string> = {
  read: '只读',
  write: '写入',
  network: '网络',
  destructive: '破坏性',
  privileged: '高权限',
  unknown: '未知',
}

const TERMINAL_SESSION_STATUS_LABEL: Record<TerminalSessionSnapshot['status'], string> = {
  idle: '空闲',
  starting: '启动中',
  running: '运行中',
  blocked: '等待确认',
  exited: '已退出',
  error: '错误',
}

function formatTerminalAuditTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatTerminalSessionRuntime(session: TerminalSessionSnapshot): string {
  const workspaceRef = session.runtime.workspaceRef
  const source =
    workspaceRef.kind === 'remote'
      ? `远程 · ${session.runtime.transport}`
      : workspaceRef.kind === 'local'
        ? '本地'
        : '系统'
  const cwd = session.runtime.cwd || (workspaceRef.kind === 'global' ? '未归档' : workspaceRef.path)
  return `${source} · ${session.runtime.backend}${cwd ? ` · ${cwd}` : ''}`
}

function formatTerminalSessionUpdatedAt(session: TerminalSessionSnapshot): string {
  return `更新：${formatTerminalAuditTime(session.updatedAt)}`
}

function getTerminalAuditSummary(event: TerminalAuditEvent): string {
  if (event.command) return event.command
  if (event.message) return event.message
  if (event.exitCode !== undefined) return `退出码 ${event.exitCode}`
  return '无命令详情'
}

function getTerminalAuditMeta(event: TerminalAuditEvent): string {
  const parts = [
    event.actor ? `来源：${event.actor}` : null,
    event.risk ? `风险：${TERMINAL_AUDIT_RISK_LABEL[event.risk]}` : null,
    event.workspaceKey ? `工作空间：${event.workspaceKey}` : null,
    event.terminalSessionId ? `会话：${event.terminalSessionId}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** Terminal 审计设置 */
function TerminalAuditSettings(): React.ReactElement {
  const [sessions, setSessions] = useState<TerminalSessionSnapshot[]>([])
  const [events, setEvents] = useState<TerminalAuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDiagnostics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSessions, nextEvents] = await Promise.all([
        window.deepink.terminal.listSessions(),
        window.deepink.terminal.listAuditEvents({ limit: 30 }),
      ])
      setSessions(nextSessions)
      setEvents(nextEvents.slice().reverse())
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Terminal 诊断失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDiagnostics()
  }, [loadDiagnostics])

  const handleClearAll = useCallback(async () => {
    if (!window.confirm('确定要清空全部 Terminal 审计记录吗？')) return

    setLoading(true)
    setError(null)
    try {
      const result = await window.deepink.terminal.clearAuditEvents()
      if (!result.success) {
        throw new Error(result.error ?? '清空 Terminal 审计失败')
      }
      setEvents([])
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空 Terminal 审计失败')
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <section className="settings-account-card terminal-audit-card">
      <div className="settings-account-card-title">Terminal 审计</div>
      <div className="settings-description">
        这里只展示 Terminal Tab 的命令确认、审批、超时、错误和退出记录；当前仍未接入真实 shell 执行。
      </div>

      <div className="terminal-audit-actions">
        <button className="settings-secondary-btn" onClick={loadDiagnostics} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </button>
        <button
          className="settings-danger-btn"
          onClick={handleClearAll}
          disabled={loading || events.length === 0}
        >
          清空审计
        </button>
      </div>

      {error && <div className="settings-error terminal-audit-error">{error}</div>}

      <div className="terminal-session-section">
        <div className="terminal-section-title">当前 Terminal Sessions</div>
        {loading && sessions.length === 0 && (
          <div className="terminal-audit-empty">正在加载当前 session…</div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="terminal-audit-empty">
            暂无活跃 Terminal session；当前仍未接入真实 shell。
          </div>
        )}
        {sessions.map((session) => (
          <div key={session.sessionId} className={`terminal-session-item status-${session.status}`}>
            <div className="terminal-audit-item-head">
              <span className="terminal-audit-kind">
                {TERMINAL_SESSION_STATUS_LABEL[session.status]}
              </span>
              <span className="terminal-audit-time">
                {formatTerminalSessionUpdatedAt(session)}
              </span>
            </div>
            <div className="terminal-audit-command">{session.sessionId}</div>
            <div className="terminal-audit-meta">{formatTerminalSessionRuntime(session)}</div>
            {session.lastCommand && (
              <div className="terminal-audit-message">最后命令：{session.lastCommand}</div>
            )}
            {session.errorMessage && (
              <div className="terminal-audit-message">错误：{session.errorMessage}</div>
            )}
          </div>
        ))}
      </div>

      <div className="terminal-audit-list">
        {loading && events.length === 0 && <div className="terminal-audit-empty">正在加载审计记录…</div>}
        {!loading && events.length === 0 && <div className="terminal-audit-empty">暂无 Terminal 审计记录</div>}
        {events.map((event) => {
          const meta = getTerminalAuditMeta(event)
          return (
            <div key={event.id} className={`terminal-audit-item kind-${event.kind}`}>
              <div className="terminal-audit-item-head">
                <span className="terminal-audit-kind">
                  {TERMINAL_AUDIT_KIND_LABEL[event.kind]}
                </span>
                <span className="terminal-audit-time">{formatTerminalAuditTime(event.timestamp)}</span>
              </div>
              <div className="terminal-audit-command">{getTerminalAuditSummary(event)}</div>
              {meta && <div className="terminal-audit-meta">{meta}</div>}
              {event.message && event.command && (
                <div className="terminal-audit-message">{event.message}</div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 浏览器设置 */
function BrowserSettings({
  onReset,
}: {
  onReset: (key: AppSettingKey) => void
}): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const error = useSettingsStore((s) => s.error)
  const clearError = useSettingsStore((s) => s.clearError)

  return (
    <div className="settings-section">
      <h2>浏览器</h2>
      <div className="settings-group">
        <SettingsRow settingKey="defaultZoomMode" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>默认缩放模式</span>
            <span className="settings-description">
              新打开浏览器 Tab 时的默认缩放方式（重启后生效）
            </span>
          </div>
          <select
            className="settings-select"
            value={settings.defaultZoomMode}
            onChange={(e) =>
              updateSettings({ defaultZoomMode: e.target.value as 'fit' | 'manual' })
            }
          >
            <option value="fit">适应宽度</option>
            <option value="manual">100%（手动）</option>
          </select>
        </SettingsRow>
        <SettingsRow settingKey="defaultDeviceMode" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>默认设备模式</span>
            <span className="settings-description">
              新打开浏览器 Tab 时的默认设备模式（重启后生效）
            </span>
          </div>
          <select
            className="settings-select"
            value={settings.defaultDeviceMode}
            onChange={(e) =>
              updateSettings({ defaultDeviceMode: e.target.value as 'desktop' | 'mobile' })
            }
          >
            <option value="desktop">桌面版</option>
            <option value="mobile">移动版</option>
          </select>
        </SettingsRow>
        {error && (
          <div className="settings-error">
            {error}
            <button className="settings-error-dismiss" onClick={clearError}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 编辑器设置 */
function EditorSettings({
  onReset,
}: {
  onReset: (key: AppSettingKey) => void
}): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  return (
    <div className="settings-section">
      <h2>编辑器</h2>
      <div className="settings-group">
        <SettingsRow settingKey="editorFontFamily" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>字体族</span>
            <span className="settings-description">编辑器使用的字体（Tiptap 集成后生效）</span>
          </div>
          <select
            className="settings-select"
            value={settings.editorFontFamily}
            onChange={(e) => updateSettings({ editorFontFamily: e.target.value })}
          >
            <option value='-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'>
              系统默认
            </option>
            <option value='"SF Mono", "Menlo", monospace'>SF Mono</option>
            <option value='"Menlo", monospace'>Menlo</option>
            <option value='"Courier New", monospace'>Courier New</option>
            <option value='"JetBrains Mono", monospace'>JetBrains Mono</option>
          </select>
        </SettingsRow>

        <SettingsRow settingKey="editorFontSize" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>字号 (px)</span>
            <span className="settings-description">编辑器正文字号</span>
          </div>
          <input
            type="number"
            className="settings-input"
            min={10}
            max={32}
            step={1}
            value={settings.editorFontSize}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v) && v >= 10 && v <= 32) updateSettings({ editorFontSize: v })
            }}
          />
        </SettingsRow>

        <SettingsRow settingKey="editorTabSize" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>Tab 宽度</span>
            <span className="settings-description">按 Tab 键插入的空格数</span>
          </div>
          <select
            className="settings-select"
            value={settings.editorTabSize}
            onChange={(e) => updateSettings({ editorTabSize: Number(e.target.value) })}
          >
            <option value={2}>2 空格</option>
            <option value={4}>4 空格</option>
            <option value={8}>8 空格</option>
          </select>
        </SettingsRow>

        <SettingsRow settingKey="editorWordWrap" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>自动换行</span>
            <span className="settings-description">长行自动折行显示</span>
          </div>
          <Toggle
            checked={settings.editorWordWrap}
            onChange={(v) => updateSettings({ editorWordWrap: v })}
          />
        </SettingsRow>

        <SettingsRow settingKey="editorLineNumbers" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>显示行号</span>
            <span className="settings-description">代码块/编辑器左侧显示行号</span>
          </div>
          <Toggle
            checked={settings.editorLineNumbers}
            onChange={(v) => updateSettings({ editorLineNumbers: v })}
          />
        </SettingsRow>

        <SettingsRow settingKey="showHiddenFiles" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>显示隐藏文件</span>
            <span className="settings-description">
              文件树中显示以 . 开头的文件和目录（如 .git、.vscode）
            </span>
          </div>
          <Toggle
            checked={settings.showHiddenFiles}
            onChange={(v) => updateSettings({ showHiddenFiles: v })}
          />
        </SettingsRow>
      </div>
    </div>
  )
}

/** Meshy 设置 */
function MeshySettings({ onReset }: { onReset: (key: AppSettingKey) => void }): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [showMeshyApiKey, setShowMeshyApiKey] = useState(false)

  return (
    <div className="settings-section">
      <h2>Meshy</h2>
      <div className="settings-group">
        <SettingsRow settingKey="meshyApiKey" settings={settings} onReset={onReset}>
          <div className="settings-label">
            <span>Meshy API 密钥</span>
            <span className="settings-description">
              用于 Text to 3D 生成、查询任务和保存 3D 资产
            </span>
          </div>
          <div className="settings-input-group">
            <input
              type={showMeshyApiKey ? 'text' : 'password'}
              className="settings-input settings-input-apikey"
              value={settings.meshyApiKey}
              onChange={(e) => updateSettings({ meshyApiKey: e.target.value })}
              placeholder="msy-..."
            />
            <button
              className="settings-icon-btn"
              onClick={() => setShowMeshyApiKey(!showMeshyApiKey)}
              title={showMeshyApiKey ? '隐藏密钥' : '显示密钥'}
            >
              {showMeshyApiKey ? '🙈' : '👁'}
            </button>
          </div>
        </SettingsRow>
      </div>
    </div>
  )
}

/** 云同步设置（SYNC_PHASE_LABEL 从共享常量导入） */
function SyncSettings(): React.ReactElement {
  const config = useSyncStore((s) => s.config)
  const status = useSyncStore((s) => s.status)
  const formData = useSyncStore((s) => s.formData)
  const testResult = useSyncStore((s) => s.testResult)
  const testing = useSyncStore((s) => s.testing)
  const loadConfig = useSyncStore((s) => s.loadConfig)
  const setFormData = useSyncStore((s) => s.setFormData)
  const saveConfig = useSyncStore((s) => s.saveConfig)
  const deleteConfig = useSyncStore((s) => s.deleteConfig)
  const testConnection = useSyncStore((s) => s.testConnection)
  const triggerSync = useSyncStore((s) => s.triggerSync)
  const workspacePath = useFsStore((s) => s.workspacePath)
  const tree = useFsStore((s) => s.tree)
  const openTab = useTabStore((s) => s.openTab)

  // Pro 门控：非 Pro 用户显示升级提示
  const tier = useSubscriptionStore((s) => s.tier)
  const isPro = tier === 'pro'

  // Pro 门控：非 Pro 用户显示升级提示
  // 开发版放行 Pro 功能
  if (!isPro && !import.meta.env.DEV) {
    return (
      <div className="settings-section">
        <h2>
          云同步 <span className="sync-panel-pro-badge">PRO</span>
        </h2>
        <div className="settings-group">
          <div className="sync-pro-gate">
            <div className="sync-pro-gate-icon">☁️</div>
            <p className="sync-pro-gate-title">云同步为 Pro 功能</p>
            <p className="sync-pro-gate-desc">
              升级 Pro 解锁 WebDAV 云同步，支持坚果云等 WebDAV 服务。
            </p>
            <button
              className="sync-btn-primary"
              onClick={() => openTab({ type: 'settings', title: '订阅', icon: '💎' })}
            >
              💎 升级 Pro
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 加载配置（IPC 监听在 store 的 loadConfig 中注册，不依赖组件生命周期）
  useEffect(() => {
    loadConfig()
  }, [])

  const isSyncing = [
    'connecting',
    'scanning-local',
    'scanning-remote',
    'comparing',
    'syncing',
  ].includes(status.phase)

  if (config) {
    // ── 已连接视图 ──
    return (
      <div className="settings-section">
        <h2>云同步</h2>
        <div className="settings-group">
          {/* 服务器信息 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>服务器</span>
              <span className="settings-description">
                {config.provider === 'jianguoyun' ? '坚果云' : 'WebDAV'}
              </span>
            </div>
            <div className="settings-control">
              <input
                className="settings-input"
                type="text"
                value={formData.serverUrl}
                onChange={(e) => setFormData({ serverUrl: e.target.value })}
                onBlur={() => saveConfig()}
                placeholder="WebDAV 服务器地址"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span>用户名</span>
              <span className="settings-description">{config.username}</span>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span>远程路径</span>
              <span className="settings-description">远端同步根目录</span>
            </div>
            <div className="settings-control">
              <input
                className="settings-input"
                type="text"
                value={formData.remotePath}
                onChange={(e) => setFormData({ remotePath: e.target.value })}
                onBlur={() => saveConfig()}
                placeholder="/DeepInk/"
              />
            </div>
          </div>

          {/* 同步范围 — 选择性同步 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>同步范围</span>
              <span className="settings-description">
                选择要同步的工作空间子目录（不选 = 同步整个工作空间）
              </span>
            </div>
          </div>
          {workspacePath && tree.length > 0 ? (
            <div className="sync-scope-list">
              {tree
                .filter((node) => node.type === 'directory')
                .map((dir) => {
                  const checked = formData.includePaths.includes(dir.name)
                  return (
                    <label key={dir.path} className="sync-scope-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? formData.includePaths.filter((p) => p !== dir.name)
                            : [...formData.includePaths, dir.name]
                          setFormData({ includePaths: next })
                          // 自动持久化同步范围
                          saveConfig()
                        }}
                      />
                      <span>{dir.name}/</span>
                    </label>
                  )
                })}
              {tree.filter((n) => n.type === 'directory').length === 0 && (
                <span className="sync-scope-empty">工作空间无子目录</span>
              )}
            </div>
          ) : (
            <div className="sync-scope-hint">
              {!workspacePath ? '请先打开工作空间' : '加载目录列表中...'}
            </div>
          )}
          {formData.includePaths.length > 0 && (
            <div className="sync-scope-summary">
              已选 {formData.includePaths.length} 个目录 ·
              <button
                className="sync-scope-clear"
                onClick={() => {
                  setFormData({ includePaths: [] })
                  saveConfig()
                }}
              >
                全部取消
              </button>
            </div>
          )}

          {/* 自动同步设置 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>自动同步</span>
              <span className="settings-description">定期自动同步工作空间文件</span>
            </div>
            <select
              className="settings-select"
              value={formData.autoSyncInterval}
              onChange={(e) => {
                const val = Number(e.target.value)
                setFormData({ autoSyncInterval: val })
              }}
            >
              <option value={0}>关闭</option>
              <option value={5}>每 5 分钟</option>
              <option value={10}>每 10 分钟</option>
              <option value={15}>每 15 分钟</option>
              <option value={30}>每 30 分钟</option>
              <option value={60}>每 60 分钟</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span>文件保存自动上传</span>
              <span className="settings-description">本地文件变更后自动上传到云端</span>
            </div>
            <Toggle
              checked={formData.autoUploadOnSave}
              onChange={(v) => setFormData({ autoUploadOnSave: v })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-label">
              <span>启动时自动拉取</span>
              <span className="settings-description">应用启动时自动拉取远端变更</span>
            </div>
            <Toggle
              checked={formData.syncOnStartup}
              onChange={(v) => setFormData({ syncOnStartup: v })}
            />
          </div>

          {/* 同步按钮 */}
          <div className="sync-actions">
            <button
              className="sync-btn-primary"
              disabled={isSyncing || !workspacePath}
              onClick={() => workspacePath && triggerSync(workspacePath)}
            >
              {isSyncing ? (
                <>
                  <IconSync size={14} className="animate-spin" />
                  {SYNC_PHASE_LABEL[status.phase]}
                </>
              ) : (
                <>
                  <IconSync size={14} />
                  立即同步
                </>
              )}
            </button>

            <button
              className="sync-btn-danger"
              onClick={() => {
                if (confirm('确定要断开云同步吗？')) deleteConfig()
              }}
              disabled={isSyncing}
            >
              断开连接
            </button>
          </div>

          {/* 同步进度 */}
          {isSyncing && (
            <div className="sync-progress">
              {status.message}
              {status.totalFiles > 0 && ` (${status.processedFiles}/${status.totalFiles})`}
            </div>
          )}

          {/* 上次同步结果 */}
          {status.lastResult && status.phase === 'done' && (
            <SyncResultView result={status.lastResult} />
          )}

          {/* 错误信息 */}
          {status.error && <div className="sync-error">{status.error}</div>}
        </div>
      </div>
    )
  }

  // ── 配置表单视图 ──
  return (
    <div className="settings-section">
      <h2>云同步</h2>
      <div className="settings-group">
        <p className="sync-description-text">连接 WebDAV 服务器，将工作空间文件同步到云端。</p>

        <div className="sync-form">
          {/* 服务商选择 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>服务商</span>
            </div>
            <select
              className="settings-select"
              value={formData.provider}
              onChange={(e) =>
                setFormData({ provider: e.target.value as 'jianguoyun' | 'generic' })
              }
            >
              <option value="jianguoyun">坚果云（推荐）</option>
              <option value="generic">通用 WebDAV</option>
            </select>
          </div>

          {/* 服务器地址（通用模式可编辑） */}
          {formData.provider === 'generic' && (
            <div className="settings-row">
              <div className="settings-label">
                <span>服务器地址</span>
              </div>
              <input
                type="text"
                className="settings-input"
                placeholder="https://your-server.com/dav/"
                value={formData.serverUrl}
                onChange={(e) => setFormData({ serverUrl: e.target.value })}
              />
            </div>
          )}

          {/* 用户名 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>{formData.provider === 'jianguoyun' ? '邮箱' : '用户名'}</span>
            </div>
            <input
              type="text"
              className="settings-input"
              placeholder={formData.provider === 'jianguoyun' ? 'your@email.com' : 'username'}
              value={formData.username}
              onChange={(e) => setFormData({ username: e.target.value })}
            />
          </div>

          {/* 密码 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>{formData.provider === 'jianguoyun' ? '应用密码' : '密码'}</span>
              {formData.provider === 'jianguoyun' && (
                <span className="settings-description">
                  坚果云 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用密码
                </span>
              )}
            </div>
            <input
              type="password"
              className="settings-input"
              placeholder={formData.provider === 'jianguoyun' ? '应用专用密码' : '密码'}
              value={formData.password}
              onChange={(e) => setFormData({ password: e.target.value })}
            />
          </div>

          {/* 远程路径 */}
          <div className="settings-row">
            <div className="settings-label">
              <span>远程路径</span>
            </div>
            <input
              type="text"
              className="settings-input"
              placeholder="/DeepInk/"
              value={formData.remotePath}
              onChange={(e) => setFormData({ remotePath: e.target.value })}
            />
          </div>

          {/* 操作按钮 */}
          <div className="sync-actions">
            <button
              className="sync-btn-secondary"
              disabled={testing || !formData.username || !formData.password}
              onClick={() => testConnection()}
            >
              {testing ? '测试中...' : '测试连接'}
            </button>

            <button
              className="sync-btn-primary"
              disabled={!formData.username || !formData.password}
              onClick={() => saveConfig()}
            >
              <IconCloudCheck size={14} />
              保存并连接
            </button>
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div className={testResult.success ? 'sync-test-success' : 'sync-test-error'}>
              {testResult.success ? '✓ 连接成功' : `✗ ${testResult.error}`}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 同步结果摘要 */
function SyncResultView({ result }: { result: SyncResult }): React.ReactElement {
  const hasIssues = result.conflicts.length > 0 || result.errors.length > 0
  return (
    <div className={`sync-result ${hasIssues ? 'has-issues' : 'success'}`}>
      <div className="sync-result-header">{hasIssues ? '⚠️ 同步完成（有问题）' : '✓ 同步完成'}</div>
      <div className="sync-result-detail">
        {result.uploaded.length > 0 && <span>↑ {result.uploaded.length} 上传</span>}
        {result.downloaded.length > 0 && <span>↓ {result.downloaded.length} 下载</span>}
        {result.skipped.length > 0 && <span>· {result.skipped.length} 跳过</span>}
        {result.conflicts.length > 0 && (
          <span className="sync-conflict">⚡ {result.conflicts.length} 冲突</span>
        )}
        {result.deleted.length > 0 && <span>🗑 {result.deleted.length} 删除</span>}
      </div>
      {result.conflicts.length > 0 && (
        <div className="sync-result-files">
          冲突文件（已保留两份，远程版本保存为 .remote.xxx）：
          {result.conflicts.map((f: string) => (
            <div key={f} className="sync-file-item">
              {f}
            </div>
          ))}
        </div>
      )}
      {result.errors.length > 0 && (
        <div className="sync-result-files">
          错误：
          {result.errors.map((e: { path: string; error: string }) => (
            <div key={e.path} className="sync-file-item">
              {e.path}: {e.error}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 快捷键设置 — 从 command store 动态读取，按分类分组 */
function ShortcutsSettings(): React.ReactElement {
  const commands = useCommandStore((s) => s.commands)

  // 按 category 分组
  const grouped = useMemo(() => {
    const groups: { category: string; commands: typeof commands }[] = []
    const seen = new Map<string, number>()
    for (const cmd of commands) {
      const cat = cmd.category || '其他'
      if (seen.has(cat)) {
        groups[seen.get(cat)!].commands.push(cmd)
      } else {
        seen.set(cat, groups.length)
        groups.push({ category: cat, commands: [cmd] })
      }
    }
    return groups
  }, [commands])

  return (
    <div className="settings-section">
      <h2>快捷键</h2>
      <div className="settings-group">
        <p className="settings-description" style={{ marginBottom: 16 }}>
          所有命令都可通过 <kbd className="settings-kbd">⌘ Shift P</kbd> 命令面板调用。
          命令实时同步自命令注册表。
        </p>
        {grouped.map((group) => (
          <div key={group.category}>
            <div className="settings-shortcuts-category">{group.category}</div>
            <table className="settings-shortcuts-table">
              <tbody>
                {group.commands.map((cmd) => (
                  <tr key={cmd.id}>
                    <td>
                      {cmd.shortcut ? (
                        <kbd className="settings-kbd">{cmd.shortcut}</kbd>
                      ) : (
                        <span className="settings-shortcut-none">—</span>
                      )}
                    </td>
                    <td>{cmd.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 关于 */
function AboutSettings(): React.ReactElement {
  return (
    <div className="settings-section">
      <h2>关于 DeepInk</h2>
      <div className="settings-group">
        <div className="settings-about">
          <h3>DeepInk</h3>
          <p>下一代一站式 AI 桌面服务</p>
          <p className="settings-version">版本 0.1.0</p>
        </div>
      </div>
    </div>
  )
}
