import type { WebResourceService } from '../../../web-resources/web-resource-service'
import type { BrowserManager } from '../../../browser/browser-manager'
import type { BrowserTaskRuntime } from '../../../browser/browser-task-runtime'
import type { AgentWebResourceLaunchCoordinator } from '../../../web-resources/agent-web-resource-launch-coordinator'
import type { WebAffairService } from '../../../web-affairs/web-affair-service'
import type { ArticlePublishingBrowserPolicy } from '../../../article-publishing/article-publishing-browser-policy'
import type { ToolDefinition, ToolExecutionContext, ToolModule } from '../../types'

const TOOLS: ToolDefinition[] = [
  {
    name: 'web_accounts_list',
    description:
      '只读列出用户已登记到 Studio 的网站、账号名称、业务主体、角色、用户确认的登录状态和运营矩阵。不会返回密码、Cookie、Token、登录提示、Browser Profile 或网页内容，也不会打开或操作账号。',
    inputSchema: {
      type: 'object',
      properties: {
        includeArchived: {
          type: 'boolean',
          description: '是否包含已归档账号和运营矩阵，默认 false',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'web_account_open',
    description:
      '在当前项目中打开用户明确指定的已登记网站账号，并把后续浏览器操作绑定到该账号的隔离登录环境。只接收 web_accounts_list 返回的 accountId；不会返回密码、Cookie、Token、登录提示或 Browser Profile。',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'web_accounts_list 返回的账号 ID' },
        affairId: { type: 'string', description: '可选：结构化网页事务 UUID' },
        attemptId: { type: 'string', description: '可选：与 affairId 同时提供的当前 Attempt UUID' },
      },
      required: ['accountId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
]

interface WebResourceToolExecutionDependencies {
  launchCoordinator: AgentWebResourceLaunchCoordinator
  browserManager: BrowserManager
  browserTaskRuntime: BrowserTaskRuntime
  webAffairService?: WebAffairService
  resolveWorkspaceId?: (workspacePath: string) => Promise<string | null>
  articlePublishingBrowserPolicy?: ArticlePublishingBrowserPolicy
}

export class WebResourceToolModule implements ToolModule {
  readonly name = 'web-resources'
  readonly tools = TOOLS

  constructor(
    private readonly service: WebResourceService,
    private readonly execution?: WebResourceToolExecutionDependencies,
  ) {}

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    if (toolName === 'web_account_open') return this.openAccount(params, context)
    if (toolName !== 'web_accounts_list') throw new Error(`未知网站账号工具: ${toolName}`)

    const snapshot = this.service.getSnapshot()
    if (!snapshot.success) return snapshot

    const includeArchived = params['includeArchived'] === true
    const websites = new Map(snapshot.data.websites.map((website) => [website.id, website]))
    const principals = new Map(
      snapshot.data.principals.map((principal) => [principal.id, principal]),
    )
    const visibleAccounts = snapshot.data.accounts.filter(
      (account) => includeArchived || !account.archivedAt,
    )

    const accounts = visibleAccounts
      .map((account) => {
        const website = websites.get(account.websiteId)
        const principal = principals.get(account.principalId)
        return {
          accountId: account.id,
          accountName: account.label,
          websiteName: website?.name ?? '未知网站',
          websiteOrigin: website?.origin ?? null,
          principalName: principal?.name ?? '未知主体',
          principalKind: principal?.kind ?? null,
          role: account.role ?? null,
          loginStatus: account.loginConfirmedAt ? 'user-confirmed' : 'not-confirmed',
          loginConfirmedAt: account.loginConfirmedAt ?? null,
          archived: Boolean(account.archivedAt),
        }
      })
      .sort(
        (left, right) =>
          left.websiteName.localeCompare(right.websiteName, 'zh-CN') ||
          left.accountName.localeCompare(right.accountName, 'zh-CN'),
      )

    const visibleAccountIds = new Set(visibleAccounts.map((account) => account.id))
    const accountNames = new Map(
      accounts.map((account) => [account.accountId, account.accountName]),
    )
    const accountGroups = snapshot.data.accountGroups
      .filter((group) => includeArchived || !group.archivedAt)
      .map((group) => ({
        groupId: group.id,
        name: group.name,
        revision: group.revision,
        members: group.accountIds
          .filter((accountId) => includeArchived || visibleAccountIds.has(accountId))
          .map((accountId) => ({
            accountId,
            accountName: accountNames.get(accountId) ?? '已归档账号',
          })),
        archived: Boolean(group.archivedAt),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))

    return {
      success: true,
      data: {
        revision: snapshot.data.revision,
        accountCount: accounts.length,
        accounts,
        accountGroups,
        notice:
          '这是登记元数据和用户确认记录，不是实时网页身份校验；读取结果不授予打开或操作账号的权限。',
      },
    }
  }

  private async openAccount(
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    if (!this.execution) throw new Error('网站账号执行能力当前不可用')
    if (context?.scheduledTaskPolicy) throw new Error('定时任务当前不能打开网站账号')
    if (!context?.conversationId || context.trustedWorkspace?.kind !== 'local') {
      throw new Error('只有绑定本地项目的交互式 Agent 会话可以打开网站账号')
    }
    const accountId = typeof params['accountId'] === 'string' ? params['accountId'] : ''
    if (!accountId) throw new Error('accountId 不能为空')

    const launch = this.service.resolveLaunch(accountId)
    if (!launch.success) return launch
    const snapshot = this.service.getSnapshot()
    if (!snapshot.success) return snapshot
    const account = snapshot.data.accounts.find(
      (candidate) => candidate.id === accountId && !candidate.archivedAt,
    )
    if (!account) throw new Error('网站账号不存在或已归档')
    const website = snapshot.data.websites.find((candidate) => candidate.id === account.websiteId)
    const principal = snapshot.data.principals.find(
      (candidate) => candidate.id === account.principalId,
    )

    this.execution.browserTaskRuntime.cancelTaskForConversation(context.conversationId)
    const opened = await this.execution.launchCoordinator.requestLaunch(
      { kind: 'local', path: context.trustedWorkspace.rootPath },
      launch.data,
    )
    const bound = await this.execution.browserManager.waitForViewBinding(
      opened.tabId,
      context.trustedWorkspace.workspaceKey,
      launch.data.browserProfileId,
    )
    if (!bound) throw new Error('账号 Tab 未能绑定到预期项目和隔离登录环境')

    const affairId = typeof params['affairId'] === 'string' ? params['affairId'] : ''
    const attemptId = typeof params['attemptId'] === 'string' ? params['attemptId'] : ''
    if (Boolean(affairId) !== Boolean(attemptId)) {
      throw new Error('affairId 和 attemptId 必须同时提供')
    }
    const origin = new URL(launch.data.entryUrl).origin
    const articleOrigins =
      affairId && attemptId
        ? await this.execution.articlePublishingBrowserPolicy?.resolveAllowedOrigins({
            workspacePath: context.trustedWorkspace.rootPath,
            affairId,
            attemptId,
            accountId,
          })
        : null
    if (articleOrigins?.length === 0) {
      throw new Error('文章发布任务状态已过期或与当前 Agent 不一致')
    }
    const task = this.execution.browserTaskRuntime.startTask({
      tabId: opened.tabId,
      goal: context.agentGoal || `办理 ${website?.name ?? account.label} 网页事务`,
      correlation: {
        workspaceKey: context.trustedWorkspace.workspaceKey,
        conversationId: context.conversationId,
        agentRunId: context.agentRunId ?? null,
        agentSessionRef: null,
        profileId: launch.data.browserProfileId,
        accountId,
        allowedOrigins: articleOrigins ?? [origin],
        ...(affairId && attemptId ? { affairId, affairAttemptId: attemptId } : {}),
      },
    })
    if (affairId && attemptId) {
      if (!this.execution.webAffairService || !this.execution.resolveWorkspaceId) {
        this.execution.browserTaskRuntime.cancelTask(task.id)
        throw new Error('网页事务关联服务当前不可用')
      }
      const workspaceId = await this.execution.resolveWorkspaceId(context.trustedWorkspace.rootPath)
      if (!workspaceId || !context.agentRunId) {
        this.execution.browserTaskRuntime.cancelTask(task.id)
        throw new Error('当前 Agent Run 无法绑定网页事务')
      }
      const boundAffair = await this.execution.webAffairService.bindAttempt(
        {
          workspaceRef: { kind: 'local', path: context.trustedWorkspace.rootPath },
          affairId,
          attemptId,
          tabId: opened.tabId,
          conversationId: context.conversationId,
          agentRunId: context.agentRunId,
          browserTaskRunId: task.id,
        },
        workspaceId,
      )
      if (!boundAffair.success) {
        this.execution.browserTaskRuntime.cancelTask(task.id)
        throw new Error(boundAffair.error.message)
      }
      this.execution.browserTaskRuntime.updateCorrelation(task.id, {
        affairId,
        affairNodeId: boundAffair.data.flow.nodes[0]?.id,
        affairAttemptId: attemptId,
      })
    }
    return {
      success: true,
      data: {
        accountId,
        accountName: account.label,
        websiteName: website?.name ?? '未知网站',
        websiteOrigin: origin,
        principalName: principal?.name ?? '未知主体',
        tabId: opened.tabId,
        browserTaskId: task.id,
        loginStatus: account.loginConfirmedAt ? 'user-confirmed' : 'not-confirmed',
        notice: '账号已在当前项目的可见 Tab 中打开；登录状态仍需以网页当前显示为准。',
      },
    }
  }
}
