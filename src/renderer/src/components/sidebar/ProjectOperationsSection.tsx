import { useEffect, useMemo, useState } from 'react'
import type { ProjectOpsAccountsResult, ProjectOpsPlatform } from '@shared/ipc/project-ops'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import { IconGlobe, IconPlus } from '../common/Icons'
import { useAgentStore, useBrowserStore, useTabStore } from '../../stores'
import {
  formatProjectOperationsLoginStatus,
  resolveProjectOperationsLoginStatus,
  type ProjectOperationsLoginStatus,
} from './project-operations-status'

function draftTitle(platform: ProjectOpsPlatform): string {
  return `${platform.name}宣发稿`
}

function defaultDraftFile(platform: ProjectOpsPlatform): string {
  return `${draftTitle(platform)}.md`
}

function sameSite(left: string | undefined, right: string): boolean {
  if (!left) return false
  try {
    return new URL(left).hostname === new URL(right).hostname
  } catch {
    return false
  }
}

export function ProjectOperationsSection({
  workspacePath,
  workspaceRef,
}: {
  workspacePath: string
  workspaceRef: WorkspaceRef
}): React.ReactElement {
  const tabs = useTabStore((s) => s.tabs)
  const browserTabs = useBrowserStore((s) => s.tabs)
  const openTab = useTabStore((s) => s.openTab)
  const activateTab = useTabStore((s) => s.activateTab)
  const createConversation = useAgentStore((s) => s.createConversation)
  const renameConversation = useAgentStore((s) => s.renameConversation)
  const setInput = useAgentStore((s) => s.setInput)
  const [accounts, setAccounts] = useState<ProjectOpsAccountsResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loginStatuses, setLoginStatuses] = useState<Record<string, ProjectOperationsLoginStatus>>(
    {},
  )
  const platforms = useMemo(() => accounts?.config?.platforms ?? [], [accounts])

  useEffect(() => {
    let cancelled = false
    setAccounts(null)
    setLoadError(null)

    void window.cclinkStudio.projectOps
      .getAccounts(workspacePath)
      .then((result) => {
        if (!cancelled) setAccounts(result)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [workspacePath])

  useEffect(() => {
    if (platforms.length === 0) {
      setLoginStatuses({})
      return
    }

    let cancelled = false
    const refresh = async (): Promise<void> => {
      const entries = await Promise.all(
        platforms.map(async (platform) => {
          const configuredProfileId = platform.browserProfile || platform.id
          const [configuredSession, defaultSession] = await Promise.all([
            window.cclinkStudio.browser.getSessionDiagnostics({
              url: platform.url,
              profileId: configuredProfileId,
            }),
            window.cclinkStudio.browser.getSessionDiagnostics({
              url: platform.url,
              profileId: null,
            }),
          ])
          return [
            platform.id,
            resolveProjectOperationsLoginStatus(platform, configuredSession, defaultSession),
          ] as const
        }),
      )
      if (!cancelled) setLoginStatuses(Object.fromEntries(entries))
    }

    void refresh().catch(() => undefined)
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 3_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [platforms])

  const createDefaultConfig = async (): Promise<void> => {
    setLoadError(null)
    try {
      setAccounts(await window.cclinkStudio.projectOps.createAccountsTemplate(workspacePath))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const openPlatformSession = (platform: ProjectOpsPlatform): void => {
    const isV2ex = platform.id === 'v2ex'
    const contentFile = isV2ex
      ? `docs/${defaultDraftFile(platform)}`
      : window.prompt('要提交的 Markdown 文件路径', `docs/${defaultDraftFile(platform)}`) ||
        `docs/${defaultDraftFile(platform)}`
    const status = loginStatuses[platform.id]
    const targetProfile = status?.authenticated
      ? status.profileId
      : platform.browserProfile || platform.id
    const initialUrl =
      isV2ex && !status?.authenticated ? 'https://www.v2ex.com/signup' : platform.url
    const existingTab = tabs.find(
      (tab) =>
        tab.type === 'browser' &&
        (tab.browserProfile ?? null) === targetProfile &&
        sameSite(browserTabs[tab.id]?.url ?? tab.initialUrl, initialUrl),
    )

    if (existingTab) {
      activateTab(existingTab.id)
    } else {
      openTab({
        type: 'browser',
        title: platform.name,
        icon: '🌐',
        initialUrl,
        browserProfile: targetProfile,
        forceNew: true,
      })
    }

    const conversationId = createConversation({
      surface: 'assistant-panel',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef,
      },
      activate: true,
    })
    renameConversation(conversationId, `${platform.name}操作会话`)
    setInput(
      [
        `请打开并维护 ${platform.name} 平台页面。`,
        `平台 URL：${platform.url}`,
        `账号备注：${platform.account || '未填写'}`,
        `登录说明：${platform.notes || '无'}`,
        `实际浏览器 Profile：${targetProfile ?? 'default'}`,
        `配置浏览器 Profile：${platform.browserProfile || platform.id}`,
        `要提交的文案文件：${contentFile}`,
        ...(isV2ex
          ? [
              '先检查登录状态；如果尚未注册或登录，打开注册/登录页面并完成可自动执行的步骤，遇到 OAuth、邀请码、2FA 或验证码时停下来让我处理。',
              '可以自主浏览节点、主题和评论，并整理有价值的信息。',
              '需要发帖或回复时，先读取或创建文案，选择正确节点，填写标题和正文并完成预览。',
              '填写完成后停在最终提交前，让我在可见页面校对；创建主题、发布回复、保存修改等最终提交动作必须逐次请求确认。',
              '不得把未经过我校对的 AI 文本直接发布到 V2EX。',
            ]
          : [
              '请先读取文案文件，再在浏览器中可见地填写页面。',
              '发布、提交、删除、修改账号资料、发送评论或私信前必须请求我确认。',
            ]),
      ].join('\n'),
      conversationId,
    )
  }

  if (!accounts && !loadError) {
    return <div className="project-operations-message">正在读取运营配置</div>
  }

  if (loadError || accounts?.error || (accounts?.issues.length ?? 0) > 0) {
    return (
      <div className="project-operations-message project-operations-error">
        <span>{loadError || accounts?.error || '运营配置格式不正确'}</span>
        {accounts?.issues[0] ? (
          <span className="project-operations-detail">
            {accounts.issues[0].path}: {accounts.issues[0].message}
          </span>
        ) : null}
      </div>
    )
  }

  if (!accounts?.exists) {
    return (
      <div className="project-operations-message">
        <span>尚未配置运营平台</span>
        <button className="project-operations-create" onClick={() => void createDefaultConfig()}>
          <IconPlus size={13} />
          创建默认配置
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar-section">
      {platforms.map((platform) => {
        const status = loginStatuses[platform.id]
        return (
          <button
            key={platform.id}
            className="project-panel-row"
            onClick={() => openPlatformSession(platform)}
            title={`${platform.url}\n${formatProjectOperationsLoginStatus(status)}`}
          >
            <IconGlobe size={14} />
            <span className="project-panel-row-main">
              <span className="project-panel-row-title project-operations-title">
                <span>{platform.name}</span>
                <span
                  className={`project-operations-status ${status?.authenticated ? 'authenticated' : ''}`}
                  aria-hidden="true"
                />
              </span>
              <span className="project-panel-row-meta">
                {platform.account ? `${platform.account} · ` : ''}
                {formatProjectOperationsLoginStatus(status)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
