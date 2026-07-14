import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { z } from 'zod'
import type {
  ProjectOpsAccountsConfig,
  ProjectOpsAccountsResult,
  ProjectOpsCreateDraftInput,
  ProjectOpsCreateDraftResult,
  ProjectOpsPlatform,
  ProjectOpsPublicationRecordInput,
  ProjectOpsPublicationRecordResult,
  ProjectOpsValidationIssue,
} from '../../shared/ipc/project-ops'

const PLATFORM_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  account: z.string().optional(),
  notes: z.string().optional(),
  browserProfile: z.string().optional(),
})

const ACCOUNTS_SCHEMA = z.object({
  version: z.literal(1),
  platforms: z.array(PLATFORM_SCHEMA),
})

const ACCOUNTS_FILE_NAME = 'deepink-accounts.json'

const DEFAULT_ACCOUNTS_TEMPLATE: ProjectOpsAccountsConfig = {
  version: 1,
  platforms: [
    {
      id: 'wechat-mp',
      name: '微信公众号',
      url: 'https://mp.weixin.qq.com',
      account: '',
      notes: '扫码登录；发布前必须人工确认。',
      browserProfile: 'wechat-mp',
    },
    {
      id: 'zhihu',
      name: '知乎',
      url: 'https://www.zhihu.com',
      account: '',
      notes: '用于专栏文章和问答；发布前必须人工确认。',
      browserProfile: 'zhihu',
    },
  ],
}

function formatZodIssues(error: z.ZodError): ProjectOpsValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '$',
    message: issue.message,
  }))
}

function normalizeFileName(fileName: string): string {
  return fileName
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeProfile(platform: ProjectOpsPlatform | undefined): string {
  return platform?.browserProfile || platform?.id || 'default'
}

export class ProjectOpsService {
  private readonly allowedRoots: string[]

  constructor() {
    const home = app.getPath('home')
    this.allowedRoots = [
      home,
      app.getPath('desktop'),
      app.getPath('documents'),
      app.getPath('downloads'),
    ]
  }

  async getAccounts(workspacePath: string): Promise<ProjectOpsAccountsResult> {
    const workspace = this.validateWorkspacePath(workspacePath)
    const filePath = this.accountsPath(workspace)
    const visibleResult = await this.readAccountsFile(filePath)
    if (visibleResult) return visibleResult

    const legacyFilePath = this.legacyAccountsPath(workspace)
    const legacyResult = await this.readAccountsFile(legacyFilePath)
    if (legacyResult) return legacyResult

    return { exists: false, filePath, issues: [] }
  }

  async createAccountsTemplate(workspacePath: string): Promise<ProjectOpsAccountsResult> {
    const workspace = this.validateWorkspacePath(workspacePath)
    const filePath = this.accountsPath(workspace)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(DEFAULT_ACCOUNTS_TEMPLATE, null, 2), 'utf-8')
    return { exists: true, filePath, config: DEFAULT_ACCOUNTS_TEMPLATE, issues: [] }
  }

  private async readAccountsFile(filePath: string): Promise<ProjectOpsAccountsResult | null> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      const result = ACCOUNTS_SCHEMA.safeParse(parsed)
      if (!result.success) {
        return {
          exists: true,
          filePath,
          issues: formatZodIssues(result.error),
          error: '项目账号配置格式不正确',
        }
      }
      return { exists: true, filePath, config: result.data, issues: [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      if (error instanceof SyntaxError) {
        return {
          exists: true,
          filePath,
          issues: [{ path: '$', message: error.message }],
          error: '项目账号配置不是合法 JSON',
        }
      }
      throw error
    }
  }

  async createCopyDraft(
    workspacePath: string,
    input: ProjectOpsCreateDraftInput = {},
  ): Promise<ProjectOpsCreateDraftResult> {
    const workspace = this.validateWorkspacePath(workspacePath)
    const accounts = await this.getAccounts(workspace)
    const platform = accounts.config?.platforms.find((item) => item.id === input.platformId)
    const title = input.title?.trim() || `${platform?.name ?? '项目'}宣发稿`
    const fileName = normalizeFileName(input.fileName || `${title}.md`)
    const filePath = this.resolveWithinWorkspace(workspace, 'docs', fileName)
    const content = [
      `# ${title}`,
      '',
      `> 平台：${platform?.name ?? '未指定'}`,
      `> 账号：${platform?.account || '未填写'}`,
      `> Profile：${safeProfile(platform)}`,
      '',
      '## 目标',
      '',
      '- ',
      '',
      '## 正文',
      '',
      '',
      '## 发布前检查',
      '',
      '- [ ] 标题确认',
      '- [ ] 正文确认',
      '- [ ] 图片/附件确认',
      '- [ ] 发布前人工确认',
      '',
    ].join('\n')
    await mkdir(dirname(filePath), { recursive: true })
    let created = true
    try {
      await readFile(filePath, 'utf-8')
      created = false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await writeFile(filePath, content, 'utf-8')
    }
    return { filePath, created }
  }

  async appendPublicationRecord(
    workspacePath: string,
    input: ProjectOpsPublicationRecordInput,
  ): Promise<ProjectOpsPublicationRecordResult> {
    const workspace = this.validateWorkspacePath(workspacePath)
    const filePath = this.resolveWithinWorkspace(workspace, 'docs', '发布记录.md')
    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    const block = [
      '',
      `## ${now} · ${input.platformName || input.platformId}`,
      '',
      `- 状态：${input.status}`,
      `- 平台：${input.platformName || input.platformId}`,
      `- 账号：${input.account || '未填写'}`,
      `- 文案：${input.contentFile || '未指定'}`,
      `- URL：${input.url || '未填写'}`,
      `- 备注：${input.notes || '—'}`,
      '',
    ].join('\n')
    await mkdir(dirname(filePath), { recursive: true })
    let existing = '# 发布记录\n'
    try {
      existing = await readFile(filePath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeFile(filePath, `${existing.trimEnd()}\n${block}`, 'utf-8')
    return { filePath }
  }

  private accountsPath(workspacePath: string): string {
    return this.resolveWithinWorkspace(workspacePath, ACCOUNTS_FILE_NAME)
  }

  private legacyAccountsPath(workspacePath: string): string {
    return this.resolveWithinWorkspace(workspacePath, '.deepink', 'accounts.json')
  }

  private validateWorkspacePath(workspacePath: string): string {
    const resolved = resolve(workspacePath)
    const allowed = this.allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + sep),
    )
    if (!allowed) throw new Error(`工作空间不在允许范围内: ${resolved}`)
    return resolved
  }

  private resolveWithinWorkspace(workspacePath: string, ...segments: string[]): string {
    const workspace = this.validateWorkspacePath(workspacePath)
    const target = resolve(workspace, ...segments)
    if (target !== workspace && !target.startsWith(workspace + sep)) {
      throw new Error(`路径不在当前工作空间内: ${target}`)
    }
    return target
  }
}
