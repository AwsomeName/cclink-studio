import { DEFAULT_AGENT_ROLE_REF, type AgentRoleRef } from './agent-role'
import type { UpdateTrack } from './update/update-track'

export type { UpdateTrack } from './update/update-track'

/**
 * settings-constants — 跨进程共享的设置常量
 *
 * 主进程和渲染进程均可导入此文件，消除重复定义。
 * 新增提供商或修改默认值时只需改这一处。
 */

/** Agent 后端类型 */
export type BackendType = 'claude-code' | 'http-api'

/** Agent 引擎。M9 开源底座优先支持本机 Claude Code 完整工具模式。 */
export type AgentEngine = 'local-claude-code'

/** Claude Code 运行时来源。 */
export type ClaudeRuntimeSource = 'bundled' | 'system' | 'custom'

/** 权限模式 */
export type PermissionMode = 'auto' | 'categorized' | 'strict'

/** 浏览器缩放模式 */
export type ZoomMode = 'fit' | 'manual'

/** 浏览器设备模式 */
export type DeviceMode = 'desktop' | 'mobile'

/** API 提供商 */
export type Provider =
  | 'anthropic'
  | 'deepseek'
  | 'glm'
  | 'qwen'
  | 'moonshot'
  | 'siliconflow'
  | 'openai'
  | 'custom'

/** API 格式 */
export type ApiFormat = 'anthropic' | 'openai'

/** CAD 转换后端 */
export type CadBackend = 'none' | 'local-freecad' | 'managed-freecad' | 'occt-experimental'

/** 提供商预设配置 */
export interface ProviderPreset {
  /** 显示名称 */
  label: string
  /** Anthropic 兼容端点（空字符串表示不支持） */
  anthropicBaseUrl: string
  /** OpenAI 兼容端点（空字符串表示不支持） */
  openaiBaseUrl: string
  /** 默认模型名 */
  defaultModel: string
}

/** 所有持久化的应用设置 */
export interface AppSettings {
  /** 应用内更新订阅轨道。 */
  updateTrack: UpdateTrack
  /** Agent 引擎 */
  agentEngine: AgentEngine
  /** Agent 后端类型（内部使用，由 apiFormat 决定） */
  backendType: BackendType
  /** Agent 权限模式 */
  permissionMode: PermissionMode
  /** 被用户禁用的内置 Agent 工具模块 */
  disabledAgentToolModules: string[]
  /** 新建 Agent 会话默认使用的内置角色。 */
  defaultAgentRoleRef: AgentRoleRef
  /** Claude Code 运行时来源。 */
  claudeRuntimeSource: ClaudeRuntimeSource
  /** 自定义 Claude Code CLI 路径；仅在 claudeRuntimeSource=custom 时生效。 */
  claudeCodePath: string
  /** 新浏览器 Tab 默认缩放模式 */
  defaultZoomMode: ZoomMode
  /** 新浏览器 Tab 默认设备模式 */
  defaultDeviceMode: DeviceMode

  // ─── API 提供商配置 ───

  /** API 提供商 */
  provider: Provider
  /** API 格式（决定用哪个后端：anthropic → CLI, openai → HTTP） */
  apiFormat: ApiFormat
  /** API 基础地址（根据 provider + apiFormat 自动填充） */
  apiBaseUrl: string
  /** API 密钥 */
  apiKey: string
  /** 模型名称 */
  modelName: string

  // ─── Meshy 3D 资产生成 ───

  /** Meshy API 密钥 */
  meshyApiKey: string

  // ─── CAD / 结构件预览 ───

  /** STEP/STP CAD 转换后端 */
  cadBackend: CadBackend
  /** 本机 FreeCAD/FreeCADCmd 可执行文件路径 */
  freecadPath: string
  /** 是否启用 CAD 转换缓存 */
  cadCacheEnabled: boolean
  /** CAD 转换缓存上限（MB） */
  cadCacheLimitMb: number

  // ─── 编辑器设置（前瞻性：当前 MarkdownEditor 暂未消费，Tiptap 集成后启用） ───

  /** 编辑器字体族 */
  editorFontFamily: string
  /** 编辑器字号 (px) */
  editorFontSize: number
  /** Tab 宽度（空格数） */
  editorTabSize: number
  /** 是否自动换行 */
  editorWordWrap: boolean
  /** 是否显示行号 */
  editorLineNumbers: boolean

  // ─── 外观增强 ───

  /** 应用缩放级别（Electron webFrame zoom level, 0 = 100%） */
  appZoomLevel: number
  /** UI 基础字号 (px) */
  uiFontSize: number

  // ─── 工作区 ───

  /** 上次打开的工作区路径（空串 = 未选过，启动时自动恢复） */
  lastWorkspacePath: string
  /** 最近打开的工作区路径列表（产品侧显示为最近项目） */
  recentWorkspacePaths: string[]

  // ─── 手动 Git 备份 ───

  /** GitHub 用户名；访问 Token 保存到统一凭证文件，不进入普通设置。 */
  gitBackupUsername: string

  // ─── 文件浏览 ───

  /** 文件树是否显示隐藏文件（. 开头） */
  showHiddenFiles: boolean
}

export const APP_ZOOM_LEVEL_MIN = -5
export const APP_ZOOM_LEVEL_MAX = 5
/** 约等于每次放大或缩小 10%。 */
export const APP_ZOOM_LEVEL_STEP = 0.5

/** 所有提供商的预设（唯一权威来源） */
export const PROVIDER_PRESETS: Record<Provider, ProviderPreset> = {
  anthropic: {
    label: 'Anthropic',
    anthropicBaseUrl: 'https://api.anthropic.com',
    openaiBaseUrl: '',
    defaultModel: 'claude-sonnet-4-6',
  },
  deepseek: {
    label: 'DeepSeek',
    anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
    openaiBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  glm: {
    label: '智谱 GLM',
    anthropicBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
  },
  qwen: {
    label: '通义千问',
    anthropicBaseUrl: 'https://coding.dashscope.aliyuncs.com',
    openaiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  moonshot: {
    label: 'Moonshot/Kimi',
    anthropicBaseUrl: 'https://api.moonshot.cn/anthropic',
    openaiBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  siliconflow: {
    label: '硅基流动',
    anthropicBaseUrl: 'https://api.siliconflow.cn/',
    openaiBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
  },
  openai: {
    label: 'OpenAI',
    anthropicBaseUrl: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  custom: { label: '自定义', anthropicBaseUrl: '', openaiBaseUrl: '', defaultModel: '' },
}

/** 默认设置值（唯一权威来源） */
export const DEFAULT_SETTINGS: AppSettings = {
  updateTrack: 'stable',
  agentEngine: 'local-claude-code',
  backendType: 'claude-code',
  permissionMode: 'auto',
  disabledAgentToolModules: [],
  defaultAgentRoleRef: DEFAULT_AGENT_ROLE_REF,
  // 法务/再分发门禁完成前，新旧安装都保持系统运行时默认值。
  claudeRuntimeSource: 'system',
  claudeCodePath: '',
  defaultZoomMode: 'fit',
  defaultDeviceMode: 'desktop',

  provider: 'anthropic',
  apiFormat: 'anthropic',
  apiBaseUrl: 'https://api.anthropic.com',
  apiKey: '',
  modelName: 'claude-sonnet-4-6',

  // Meshy
  meshyApiKey: '',

  // CAD / 结构件预览
  cadBackend: 'none',
  freecadPath: '',
  cadCacheEnabled: true,
  cadCacheLimitMb: 1024,

  // 编辑器
  editorFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
  editorFontSize: 14,
  editorTabSize: 2,
  editorWordWrap: true,
  editorLineNumbers: true,

  // 外观
  appZoomLevel: 0,
  uiFontSize: 13,

  // 工作区
  lastWorkspacePath: '',
  recentWorkspacePaths: [],

  // 手动 Git 备份
  gitBackupUsername: '',

  // 文件浏览
  showHiddenFiles: false,
}

export function normalizeClaudeRuntimeSettingsUpdate(
  current: Pick<AppSettings, 'claudeRuntimeSource' | 'claudeCodePath'>,
  update: Partial<AppSettings>,
): Partial<AppSettings> {
  const normalized = { ...update }
  if (update.claudeRuntimeSource) {
    normalized.claudeCodePath =
      update.claudeRuntimeSource === 'custom'
        ? (update.claudeCodePath ?? current.claudeCodePath)
        : ''
  } else if (typeof update.claudeCodePath === 'string') {
    normalized.claudeRuntimeSource = update.claudeCodePath.trim() ? 'custom' : 'system'
  }
  return normalized
}

/**
 * 根据 provider + apiFormat 获取对应的 base URL
 */
export function getPresetBaseUrl(provider: Provider, apiFormat: ApiFormat): string {
  const preset = PROVIDER_PRESETS[provider]
  return apiFormat === 'anthropic' ? preset.anthropicBaseUrl : preset.openaiBaseUrl
}
