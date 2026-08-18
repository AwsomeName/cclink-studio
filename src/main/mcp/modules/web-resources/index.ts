import type { WebResourceService } from '../../../web-resources/web-resource-service'
import type { ToolDefinition, ToolModule } from '../../types'

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
]

export class WebResourceToolModule implements ToolModule {
  readonly name = 'web-resources'
  readonly tools = TOOLS

  constructor(private readonly service: WebResourceService) {}

  async execute(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    if (toolName !== 'web_accounts_list') {
      throw new Error(`未知网站账号工具: ${toolName}`)
    }

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
}
