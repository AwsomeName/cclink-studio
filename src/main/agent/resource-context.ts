import type { BrowserManager } from '../browser/browser-manager'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { AppSettings } from '../settings/types'
import type { AgentScope } from './scope'
import type { AgentSendMessageContext } from './message-context'
import {
  browserDiagnosticToResource,
  type AgentResourceContextSnapshot,
  type AgentTaskIntentSnapshot,
} from '../../shared/agent-resource-context'
import { globalWorkspaceRef, localWorkspaceRef, workspaceRefKey } from '../../shared/workspace-ref'

export interface BuildAgentResourceContextOptions {
  message: string
  scope: AgentScope
  browserTabId: string | null
  context?: AgentSendMessageContext
  browserManager?: BrowserManager
  playwrightBridge: PlaywrightBridge
  settings: AppSettings
}

export async function buildAgentResourceContext(
  options: BuildAgentResourceContextOptions,
): Promise<AgentResourceContextSnapshot> {
  const visibleTabId = options.browserManager?.getActiveViewId() ?? null
  const tabId = options.browserTabId ?? visibleTabId
  const diagnostics = tabId
    ? await options.playwrightBridge.getPageDiagnostics(tabId).catch(() => null)
    : null
  const activeBrowser =
    tabId && diagnostics
      ? browserDiagnosticToResource({
          tabId,
          visibleTabId,
          viewState: options.browserManager?.getState(tabId) ?? null,
          diagnostics,
        })
      : null
  const workspace =
    options.settings.lastWorkspacePath.trim().length > 0
      ? localWorkspaceRef(options.settings.lastWorkspacePath.trim())
      : globalWorkspaceRef()

  return {
    version: 1,
    generatedAt: Date.now(),
    scope: options.scope,
    activeBrowser,
    workspace: {
      ref: workspace,
      key: workspaceRefKey(workspace),
      rootPath: workspace.kind === 'local' ? workspace.path : null,
      writable: workspace.kind === 'local',
    },
    config: {
      permissionMode: options.settings.permissionMode,
      agentEngine: options.settings.agentEngine,
      defaultBrowserViewMode: options.settings.defaultDeviceMode,
      defaultBrowserZoomMode: options.settings.defaultZoomMode,
    },
    task: inferTaskIntent(options.message),
    mountedResourceIds: (options.context?.resources ?? []).map((resource) => resource.id).slice(0, 20),
    notes: buildContextNotes(activeBrowser, inferTaskIntent(options.message)),
  }
}

export function inferTaskIntent(message: string): AgentTaskIntentSnapshot {
  const normalized = message.trim().toLowerCase()
  const site = detectTargetSite(normalized)
  if (/登录|登陆|sign\s*in|log\s*in|login/.test(normalized) && site) {
    return {
      kind: 'browser_login',
      confidence: 'high',
      targetSite: site.name,
      expectedHosts: site.hosts,
      preferredUrl: site.loginUrl ?? site.homeUrl,
      reason: `用户要求登录 ${site.name}`,
    }
  }
  if (/投稿|发布|发表|上传|post|publish/.test(normalized) && site) {
    return {
      kind: 'browser_publish',
      confidence: 'high',
      targetSite: site.name,
      expectedHosts: site.hosts,
      preferredUrl: site.homeUrl,
      reason: `用户要求在 ${site.name} 发布或投稿`,
    }
  }
  if (/https?:\/\/|www\.|打开|访问|进入|网页|网站|url|open|visit/.test(normalized) || site) {
    return {
      kind: 'browser_navigation',
      confidence: site ? 'high' : 'medium',
      targetSite: site?.name,
      expectedHosts: site?.hosts,
      preferredUrl: site?.homeUrl,
      reason: site ? `用户提到站点 ${site.name}` : '用户要求打开或访问网页',
    }
  }
  if (/搜索|查找|百度|google|search/.test(normalized)) {
    return {
      kind: 'browser_search',
      confidence: 'medium',
      reason: '用户要求搜索网页信息',
    }
  }
  if (/文档|报告|写|整理|markdown|doc/.test(normalized)) {
    return {
      kind: 'document_edit',
      confidence: 'medium',
      reason: '用户要求编辑或生成文档',
    }
  }
  if (/手机|安卓|android|app/.test(normalized)) {
    return {
      kind: 'android_operation',
      confidence: 'medium',
      reason: '用户要求操作 Android 或 App',
    }
  }
  return {
    kind: 'general',
    confidence: 'low',
    reason: '未识别到明确资源型任务',
  }
}

function buildContextNotes(
  browser: AgentResourceContextSnapshot['activeBrowser'],
  task: AgentTaskIntentSnapshot,
): string[] {
  const notes: string[] = []
  if (task.expectedHosts?.length && browser?.host && !task.expectedHosts.includes(browser.host)) {
    notes.push('当前浏览器 host 与任务目标 host 不一致；禁止声称已经打开目标站点。')
  }
  if (task.kind.startsWith('browser') && !browser) {
    notes.push('当前没有可验证的浏览器资源；需要先打开或绑定浏览器 Tab。')
  }
  if (browser?.suspectedChallenges.length) {
    notes.push(`页面疑似存在挑战: ${browser.suspectedChallenges.join(', ')}`)
  }
  return notes
}

function detectTargetSite(text: string): { name: string; hosts: string[]; homeUrl: string; loginUrl?: string } | null {
  if (/知乎|zhihu/.test(text)) {
    return {
      name: 'zhihu',
      hosts: ['www.zhihu.com', 'zhihu.com'],
      homeUrl: 'https://www.zhihu.com/',
      loginUrl: 'https://www.zhihu.com/signin',
    }
  }
  if (/小红书|xiaohongshu|xhs|rednote/.test(text)) {
    return {
      name: 'xiaohongshu',
      hosts: ['www.xiaohongshu.com', 'xiaohongshu.com'],
      homeUrl: 'https://www.xiaohongshu.com/',
    }
  }
  if (/公众号|微信公众平台|mp\.weixin|weixin/.test(text)) {
    return {
      name: 'wechat_mp',
      hosts: ['mp.weixin.qq.com'],
      homeUrl: 'https://mp.weixin.qq.com/',
    }
  }
  if (/微博|weibo/.test(text)) {
    return {
      name: 'weibo',
      hosts: ['weibo.com', 'www.weibo.com'],
      homeUrl: 'https://weibo.com/',
    }
  }
  return null
}
