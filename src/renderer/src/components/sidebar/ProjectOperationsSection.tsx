import { useEffect, useState } from 'react'
import type { ProjectOpsAccountsResult, ProjectOpsPlatform } from '@shared/ipc/project-ops'
import type { WorkspaceRef } from '../../../../shared/workspace-ref'
import {
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconGlobe,
  IconPlus,
  IconRobot,
} from '../common/Icons'
import { useAgentStore, useFsStore, useTabStore } from '../../stores'

function draftTitle(platform: ProjectOpsPlatform): string {
  return `${platform.name}宣发稿`
}

function defaultDraftFile(platform: ProjectOpsPlatform): string {
  return `${draftTitle(platform)}.md`
}

function formatAccount(platform: ProjectOpsPlatform): string {
  return platform.account
    ? `${platform.account} · ${platform.browserProfile || platform.id}`
    : platform.browserProfile || platform.id
}

export function ProjectOperationsSection({
  workspacePath,
  workspaceRef,
}: {
  workspacePath: string
  workspaceRef: WorkspaceRef
}): React.ReactElement {
  const openTab = useTabStore((s) => s.openTab)
  const createConversation = useAgentStore((s) => s.createConversation)
  const renameConversation = useAgentStore((s) => s.renameConversation)
  const setInput = useAgentStore((s) => s.setInput)
  const refreshDir = useFsStore((s) => s.refreshDir)
  const [accounts, setAccounts] = useState<ProjectOpsAccountsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    setMessage(null)
    try {
      const result = await window.deepink.projectOps.getAccounts(workspacePath)
      setAccounts(result)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取项目运营配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [workspacePath])

  const createTemplate = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.deepink.projectOps.createAccountsTemplate(workspacePath)
      setAccounts(result)
      await refreshDir(workspacePath).catch(() => undefined)
      openTab({
        type: 'editor',
        title: 'deepink-accounts.json',
        icon: '⚙️',
        filePath: result.filePath,
      })
      setMessage('已创建 deepink-accounts.json')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建配置模板失败')
    } finally {
      setLoading(false)
    }
  }

  const createCopyConversation = async (platform: ProjectOpsPlatform): Promise<void> => {
    setLoading(true)
    try {
      const draft = await window.deepink.projectOps.createCopyDraft(workspacePath, {
        platformId: platform.id,
        title: draftTitle(platform),
        fileName: defaultDraftFile(platform),
      })
      await refreshDir(workspacePath).catch(() => undefined)
      openTab({
        type: 'editor',
        title: defaultDraftFile(platform),
        icon: '📄',
        filePath: draft.filePath,
      })
      const conversationId = createConversation({
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'deepink-agent',
          workspaceRef,
        },
        activate: true,
      })
      renameConversation(conversationId, `${platform.name}文案会话`)
      setInput(
        [
          `请基于当前项目资料，为 ${platform.name} 写一版宣发文案。`,
          `目标文件：${draft.filePath}`,
          '要求：先阅读项目 README 和 docs，再改写/补全这个 Markdown 文件；不要发布，只写文案。',
        ].join('\n'),
        conversationId,
      )
      openTab({
        type: 'conversation',
        title: `${platform.name}文案会话`,
        icon: '🤖',
        conversation: {
          surface: 'workbench-tab',
          runtime: {
            location: 'local',
            transport: 'local',
            backend: 'deepink-agent',
            workspaceRef,
          },
          sessionId: conversationId,
        },
      })
      setMessage(draft.created ? '已创建文案草稿和工作会话' : '已打开文案草稿和工作会话')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建文案会话失败')
    } finally {
      setLoading(false)
    }
  }

  const openPlatformSession = (platform: ProjectOpsPlatform): void => {
    const contentFile =
      window.prompt('要提交的 Markdown 文件路径', `docs/${defaultDraftFile(platform)}`) ||
      `docs/${defaultDraftFile(platform)}`
    openTab({
      type: 'browser',
      title: platform.name,
      icon: '🌐',
      initialUrl: platform.url,
      browserProfile: platform.browserProfile || platform.id,
      forceNew: true,
    })
    const conversationId = createConversation({
      surface: 'workbench-tab',
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'deepink-agent',
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
        `浏览器 Profile：${platform.browserProfile || platform.id}`,
        `要提交的文案文件：${contentFile}`,
        '请先读取文案文件，再在浏览器中可见地填写页面。',
        '发布、提交、删除、修改账号资料、发送评论或私信前必须请求我确认。',
      ].join('\n'),
      conversationId,
    )
    openTab({
      type: 'conversation',
      title: `${platform.name}操作会话`,
      icon: '🤖',
      conversation: {
        surface: 'workbench-tab',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'deepink-agent',
          workspaceRef,
        },
        sessionId: conversationId,
      },
    })
  }

  const appendRecord = async (platform: ProjectOpsPlatform): Promise<void> => {
    const url = window.prompt('发布 URL 或页面地址', '') || ''
    const statusInput = window.prompt(
      '状态：published / pending-review / failed / cancelled / draft',
      'published',
    )
    const status =
      statusInput === 'pending-review' ||
      statusInput === 'failed' ||
      statusInput === 'cancelled' ||
      statusInput === 'draft' ||
      statusInput === 'published'
        ? statusInput
        : 'published'
    const contentFile =
      window.prompt('文案文件', `docs/${defaultDraftFile(platform)}`) ||
      `docs/${defaultDraftFile(platform)}`
    const notes = window.prompt('备注', '') || ''
    setLoading(true)
    try {
      const result = await window.deepink.projectOps.appendPublicationRecord(workspacePath, {
        platformId: platform.id,
        platformName: platform.name,
        account: platform.account,
        contentFile,
        url,
        status,
        notes,
      })
      await refreshDir(workspacePath).catch(() => undefined)
      openTab({
        type: 'editor',
        title: '发布记录.md',
        icon: '📄',
        filePath: result.filePath,
      })
      setMessage('已追加发布记录')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '追加发布记录失败')
    } finally {
      setLoading(false)
    }
  }

  const platforms = accounts?.config?.platforms ?? []
  const hasIssues = Boolean(accounts?.issues.length)

  return (
    <div className="sidebar-section project-ops-entry-section">
      <button
        className={`sidebar-section-header sidebar-section-header-button ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        项目运营
      </button>

      {!expanded && !accounts?.exists && (
        <button
          className="project-panel-row project-panel-row-compact"
          onClick={() => void createTemplate()}
          disabled={loading}
        >
          <IconPlus size={14} />
          <span className="project-panel-row-main">
            <span className="project-panel-row-title">启用项目运营</span>
          </span>
        </button>
      )}

      {!expanded && accounts?.exists && !hasIssues && platforms.length > 0 && (
        <div className="project-panel-empty compact">{platforms.length} 个平台配置</div>
      )}

      {expanded && (
        <>
          {!accounts?.exists && (
            <>
              <button
                className="project-panel-row"
                onClick={() => void createTemplate()}
                disabled={loading}
              >
                <IconPlus size={14} />
                <span className="project-panel-row-main">
                  <span className="project-panel-row-title">创建项目运营配置</span>
                  <span className="project-panel-row-meta">
                    保存平台入口、账号备注和浏览器 Profile
                  </span>
                </span>
              </button>
            </>
          )}

          {accounts?.exists && hasIssues && (
            <div className="project-panel-empty">
              配置格式错误：
              {accounts.issues.map((issue) => `${issue.path} ${issue.message}`).join('；')}
            </div>
          )}

          {platforms.map((platform) => (
            <div key={platform.id} className="project-ops-platform">
              <button
                className="project-panel-row"
                onClick={() => openPlatformSession(platform)}
                title={platform.url}
              >
                <IconGlobe size={14} />
                <span className="project-panel-row-main">
                  <span className="project-panel-row-title">{platform.name}</span>
                  <span className="project-panel-row-meta">{formatAccount(platform)}</span>
                </span>
              </button>
              <div className="project-panel-quick-actions">
                <button
                  className="project-panel-quick-action"
                  onClick={() => void createCopyConversation(platform)}
                  disabled={loading}
                  title="创建文案草稿和文案会话"
                >
                  <IconFile size={14} />
                  文案
                </button>
                <button
                  className="project-panel-quick-action"
                  onClick={() => openPlatformSession(platform)}
                  title="打开平台并创建操作会话"
                >
                  <IconRobot size={14} />
                  操作
                </button>
                <button
                  className="project-panel-quick-action"
                  onClick={() => void appendRecord(platform)}
                  disabled={loading}
                  title="追加发布记录"
                >
                  <IconPlus size={14} />
                  记录
                </button>
              </div>
            </div>
          ))}

          {accounts?.exists && platforms.length === 0 && !hasIssues && (
            <div className="project-panel-empty">配置里还没有平台</div>
          )}

          {accounts?.exists && (
            <button className="project-panel-row" onClick={() => void reload()} disabled={loading}>
              <IconFile size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">刷新平台配置</span>
                <span className="project-panel-row-meta">{accounts.filePath}</span>
              </span>
            </button>
          )}

          {message && <div className="project-panel-empty">{message}</div>}
        </>
      )}
    </div>
  )
}
