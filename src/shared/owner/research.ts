import { z } from 'zod'
import { publicRepoPattern } from '../ipc/owner-research'
const phrase = z.string().trim().min(1).max(1200)
/**
 * A research source is either a public GitHub repository (`owner/repo`) or a read-only local
 * folder granted to this affair, addressed as `folder:<grant UUID>`. The key never carries a
 * local path: reads resolve the grant in the main process and fail once it is revoked.
 */
export const folderKeyPattern =
  /^folder:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const folderKey = (grantId: string) => 'folder:' + grantId.toLowerCase()
export const isFolderKey = (key: string) => folderKeyPattern.test(key)
export const grantOfFolder = (key: string) => key.slice('folder:'.length)
/** One local file outside the folders, approved read-only for this affair only. */
export const fileKeyPattern = /^file:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const fileKey = (grantId: string) => 'file:' + grantId.toLowerCase()
export const isFileKey = (key: string) => fileKeyPattern.test(key)
export const grantOfFile = (key: string) => key.slice('file:'.length)
/** Any local evidence: a granted folder or a single approved file. */
export const isLocalKey = (key: string) => isFolderKey(key) || isFileKey(key)
/** Public web pages searched and fetched by Studio for this affair. */
export const WEB_KEY = 'web'
export const isWebKey = (key: string) => key === WEB_KEY
const sourceKey = z
  .string()
  .refine(
    (k) =>
      publicRepoPattern.test(k) ||
      folderKeyPattern.test(k) ||
      fileKeyPattern.test(k) ||
      isWebKey(k),
    '无效的来源',
  )
/** Local evidence links point at the grant and relative path, never at an absolute path. */
export const localSourceUrl = (grantId: string, path: string) =>
  'cclink-owner-source://' +
  grantId.toLowerCase() +
  '/' +
  path.split('/').map(encodeURIComponent).join('/')
export const planSchema = z
  .object({
    scope: phrase,
    output: phrase,
    timing: phrase.optional(),
    repos: z
      .array(z.string().regex(publicRepoPattern))
      .max(4)
      .refine((rs) => new Set(rs.map((r) => r.toLowerCase())).size === rs.length),
    /** Local folders this agreement lets Owner read; each must be granted to the affair. */
    folders: z
      .array(
        z.object({
          key: z.string().regex(folderKeyPattern),
          label: z.string().trim().min(1).max(200),
        }),
      )
      .max(8)
      .refine((fs) => new Set(fs.map((f) => f.key.toLowerCase())).size === fs.length)
      .optional(),
    /**
     * What the delivery must achieve. A skipped step that a required outcome depends on keeps
     * the affair from being delivered; optional ones are listed as unfinished.
     */
    outcomes: z
      .array(z.object({ text: z.string().trim().min(1).max(300), required: z.boolean() }))
      .max(8)
      .optional(),
    /** Public web search and fetch, at most `limit` calls unless the user approves more. */
    web: z.object({ limit: z.number().int().min(1).max(200) }).optional(),
  })
  .refine(
    (p) => p.repos.length + (p.folders?.length ?? 0) + (p.web ? 1 : 0) > 0,
    '至少需要一个来源',
  )
export type Plan = z.infer<typeof planSchema>
/** Every source the confirmed agreement covers, GitHub repositories first. */
export const planSources = (plan: Plan | null | undefined) =>
  plan
    ? [...plan.repos, ...(plan.folders ?? []).map((f) => f.key), ...(plan.web ? [WEB_KEY] : [])]
    : []
type ApprovedFile = { key: string; label: string }
/** Human label for a source key: the folder's name, the approved file, or the repository. */
export function sourceLabel(plan: Plan | null | undefined, key: string, files?: ApprovedFile[]) {
  if (isWebKey(key)) return '公开网页'
  if (isFileKey(key)) return '本地文件 ' + (files?.find((f) => f.key === key)?.label ?? '')
  if (!isFolderKey(key)) return key
  return '本地 ' + (plan?.folders?.find((f) => f.key === key)?.label ?? '目录')
}
/** Sources a citation may point at: the agreement's plus files approved during the run. */
export const evidenceSources = (r: { plan: Plan | null; files?: ApprovedFile[] }) => [
  ...planSources(r.plan),
  ...(r.files ?? []).map((f) => f.key),
]
type CitedItem = { repo: string; url?: string; line?: number }
/** Where a citation points: a local file and line, or the pinned GitHub URL. */
export function citationPlace(
  r: {
    plan: Plan | null
    files?: ApprovedFile[]
    docs: { repo: string; url: string; path?: string }[]
  },
  item: CitedItem,
) {
  const doc = r.docs.find((d) => d.repo === item.repo && (!item.url || d.url === item.url))
  const line = item.line ? ' 第 ' + item.line + ' 行' : ''
  if (isFileKey(item.repo)) return sourceLabel(r.plan, item.repo, r.files) + line
  if (isFolderKey(item.repo)) return sourceLabel(r.plan, item.repo) + '/' + (doc?.path ?? '') + line
  return (item.url ?? doc?.url ?? '') + (item.line ? '#L' + item.line : '')
}
/** Verified citations by tool, for the deliverable summary. */
export function citationCounts(items: { repo: string }[]) {
  const local = items.filter((i) => isLocalKey(i.repo)).length
  const web = items.filter((i) => isWebKey(i.repo)).length
  return { local, web, github: items.length - local - web }
}
/** A step that waited for approval and was skipped, and what the user did about it later. */
export const skipSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal('file'),
  /** Display path (~/…); the main process resolves and re-checks it before any read. */
  path: z.string().min(1).max(600),
  why: z.enum(['timeout', 'denied']),
  at: z.number(),
  status: z.enum(['skipped', 'granted', 'declined', 'read']),
  /** Set by Owner when it judged delivery: does a required outcome depend on this step? */
  required: z.boolean().optional(),
  affects: z.string().max(300).optional(),
  key: z.string().regex(fileKeyPattern).optional(),
})
export type Skip = z.infer<typeof skipSchema>
export const pendingSkips = (r: { skips?: Skip[] }) =>
  (r.skips ?? []).filter((s) => s.status === 'skipped')
export const sourceSchema = z.object({
  repo: sourceKey,
  path: z.string().max(360).optional(),
  startLine: z.number().int().positive().optional(),
  text: z.string().min(1).max(9000),
  url: z.string().url(),
  /** Git blob SHA-1 for GitHub; SHA-256 of the whole file when a local file was read. */
  sha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
  at: z.number(),
})
export const reportSchema = z.object({
  conclusion: z.string().trim().min(1).max(6000),
  items: z
    .array(
      z.object({
        repo: z.string(),
        url: z.string().url().optional(),
        line: z.number().int().positive().optional(),
        finding: phrase,
        quote: z.string().trim().min(6).max(320),
      }),
    )
    .min(1)
    .max(16),
})
export const researchRequest = z.object({
  repo: sourceKey,
  // Local notes may be named in any language; GitHub tree search still validates its own terms.
  terms: z.array(z.string().regex(/^[\p{L}\p{N}_.+/-]{1,60}$/u)).max(8),
})
export const workerFilesSchema = z
  .array(
    z
      .object({
        repo: sourceKey,
        /** A file path, or for the web source the page URL taken from search results. */
        path: z.string().min(1).max(2048),
        anchor: z.string().max(120).optional(),
        purpose: z.string().min(1).max(500),
      })
      .refine((f) => isWebKey(f.repo) || f.path.length <= 360, '路径过长'),
  )
  .max(4)
// Execution sessions: lowercase keys map to native conversations owner-<id>-<key>; 'a' is the legacy A.
export const workerKey = z.string().regex(/^[a-h]$/)
export const workerSchema = z.object({
  key: workerKey,
  purpose: z.string().trim().min(1).max(300),
  reason: z.string().max(600),
  openedAt: z.number(),
  agent: z.enum(['codex', 'claude-code']).optional(),
  /** Why this runtime was chosen, as shown on the roster. */
  agentWhy: z.string().max(200).optional(),
})
export type Worker = z.infer<typeof workerSchema>
export const workerLabel = (key: string) => key.toUpperCase()
export const researchSchema = z.object({
  plan: planSchema.nullable(),
  phase: z.enum([
    'draft',
    'planning',
    'ready',
    'reading',
    'writing',
    'checking',
    'decide',
    'done',
    'error',
  ]),
  log: z.array(z.string()).max(60),
  chat: z
    .array(
      z.object({
        who: z.enum(['你', 'Owner']),
        text: z.string().max(6000),
        questionId: z.string().uuid().optional(),
        answer: z.string().max(4500).optional(),
        answerError: z.string().max(600).optional(),
      }),
    )
    .max(100),
  docs: z.array(sourceSchema).max(24),
  decisions: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        kind: z.enum(['read', 'more', 'deliver']),
        reason: phrase,
        requests: z.array(researchRequest).min(1).max(4).optional(),
        workerTicket: z.string().uuid().optional(),
        workerFiles: workerFilesSchema.optional(),
        filesProcessed: z.number().int().min(0).max(4).optional(),
        collectionClosed: z.boolean().optional(),
        workerRunId: z.string().min(1).max(240).optional(),
        workerReturned: z.boolean().optional(),
        /** Which execution session this dispatch went to, and why it was continued or opened. */
        worker: workerKey.optional(),
        workerChoice: z.enum(['new', 'continue']).optional(),
        choiceReason: z.string().max(600).optional(),
        /** Dispatch sheet: the question, what to hand back, and when the step counts as done. */
        ask: z.string().max(600).optional(),
        deliverable: z.string().max(600).optional(),
        doneWhen: z.string().max(600).optional(),
        /** Owner's acceptance of this dispatch against doneWhen, recorded at the next judgment. */
        verdict: z.object({ met: z.boolean(), note: z.string().max(600) }).optional(),
        /** Local files outside the folders this step asked to read; each needs approval. */
        localFiles: z.array(z.string().min(1).max(600)).max(2).optional(),
        localFilesDone: z.boolean().optional(),
      }),
    )
    .max(60)
    .optional(),
  report: reportSchema.nullable(),
  workers: z.array(workerSchema).max(8).optional(),
  /** Public web calls made for this affair; counted against plan.web.limit + extra. */
  web: z
    .object({
      used: z.number().int().min(0),
      extra: z.number().int().min(0),
      stopped: z.boolean().optional(),
      searches: z
        .array(z.object({ q: z.string().max(128), hits: z.number().int(), at: z.number() }))
        .max(40),
      pages: z
        .array(
          z.object({
            url: z.string().url(),
            title: z.string().max(200),
            chars: z.number().int(),
            sha: z.string().regex(/^[a-f0-9]{64}$/i),
            truncated: z.boolean(),
            at: z.number(),
          }),
        )
        .max(40),
      failed: z
        .array(z.object({ url: z.string().max(2048), why: z.string().max(300), at: z.number() }))
        .max(20),
    })
    .optional(),
  /** Runtime of the Owner's own session and why it was chosen. */
  owner: z.object({ agent: z.enum(['codex', 'claude-code']), why: z.string().max(200) }).optional(),
  /** Single files approved during the run (or afterwards), read-only, this affair only. */
  files: z
    .array(z.object({ key: z.string().regex(fileKeyPattern), label: z.string().max(600) }))
    .max(16)
    .optional(),
  skips: z.array(skipSchema).max(20).optional(),
  /** A checked report held back because a required step was skipped; never a deliverable. */
  draft: reportSchema.nullable().optional(),
})
export type Research = z.infer<typeof researchSchema>
export function checkReport(r: Research, raw: unknown) {
  const report = reportSchema.parse(raw)
  const sources = evidenceSources(r)
  if (
    !r.plan ||
    !planSources(r.plan)
      .filter((repo) => !isWebKey(repo))
      .every((repo) => report.items.some((item) => item.repo === repo))
  )
    throw Error('没有覆盖本次研究的所有来源')
  for (const item of report.items) {
    // Line numbers come from the immutable snapshot and matching quote, never from the reply.
    delete item.line
    const url = item.url?.replace(/#L\d+(?:-L\d+)?$/, '')
    const docs = r.docs.filter((d) => d.repo === item.repo && (!url || d.url === url))
    const words = item.quote.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(words.join('\\s+'))
    const matches = docs.filter((d) => pattern.test(d.text))
    const urls = new Set(matches.map((d) => d.url))
    const label = sourceLabel(r.plan, item.repo, r.files)
    if (
      !sources.includes(item.repo) ||
      urls.size !== 1 ||
      (!url && new Set(docs.map((d) => d.url)).size !== 1)
    )
      throw Error(label + '：引文与标明的来源不匹配')
    item.url = matches[0].url
    const lines = new Set<number>()
    for (const doc of matches) {
      if (!doc.startLine) continue
      for (const match of doc.text.matchAll(new RegExp(pattern, 'g'))) {
        lines.add(doc.startLine + doc.text.slice(0, match.index).split('\n').length - 1)
        if (lines.size > 1)
          throw Error(label + '：引文在该文件多处出现，请补足前后原文以定位到具体行：' + item.quote)
      }
    }
    item.line = lines.values().next().value
  }
  return report
}
export function researchStatus(r: Research, active: boolean): [string, string] {
  if (!active && ['planning', 'reading', 'writing', 'checking'].includes(r.phase))
    return ['待恢复', '上次操作中断，打开事务后可继续']
  switch (r.phase) {
    case 'draft':
      return ['待交办', '在右侧告诉 Owner 想调研什么']
    case 'planning':
      return ['进行中', 'Owner 正在整理范围和交付物']
    case 'ready':
      return ['等我确认', '确认调研约定，或在右侧继续调整']
    case 'reading':
      return ['进行中', r.decisions?.at(-1)?.reason ?? '正在获取项目资料']
    case 'writing':
      return ['进行中', '执行会话 A 正在比较项目、撰写调研结果']
    case 'checking':
      return ['进行中', 'Owner 正在逐项判断证据是否足以交付']
    case 'decide':
      return [
        '待你决定',
        pendingSkips(r).filter((s) => s.required).length + ' 项必需步骤被跳过，尚未交付',
      ]
    case 'done':
      return ['已交付', '调研简报和逐项出处已就绪']
    case 'error':
      return ['需要处理', '上一步没有完成，已保留现有资料']
  }
}

/** Sessions of an affair, including the implicit legacy A from older records. */
export function workersOf(r: Research): Worker[] {
  if (r.workers?.length) return r.workers
  return r.decisions?.some((d) => d.workerRunId || d.workerTicket)
    ? [{ key: 'a', purpose: '取证', reason: '旧版记录：单一执行会话', openedAt: 0 }]
    : []
}
export const decisionWorker = (d: { worker?: string }) => d.worker ?? 'a'

/** One-line label for a decision, shared by the board, work log and schedule document. */
export function decisionTitle(d: {
  kind: 'read' | 'more' | 'deliver'
  worker?: string
  workerChoice?: 'new' | 'continue'
}) {
  if (d.kind === 'deliver') return 'Owner 判定可以交付'
  const key = workerLabel(decisionWorker(d))
  if (d.workerChoice === 'new') return '新开执行会话 ' + key
  if (d.workerChoice === 'continue') return '续用执行会话 ' + key
  return d.kind === 'read' ? '委派会话 A' : '续用会话 A 补查'
}

/**
 * Applies Owner's session choice: continue an existing execution session whose context the
 * step depends on, or open a new one for independent work. Returns the chosen key.
 */
export function assignWorker(
  r: Research,
  sheet: { worker: { use: string } | { new: string }; workerReason: string; ask: string },
  now = Date.now(),
): { key: string; choice: 'new' | 'continue' } {
  const workers = workersOf(r)
  if ('use' in sheet.worker) {
    const key = sheet.worker.use
    if (workers.some((w) => w.key === key)) {
      if (!r.workers?.length) r.workers = workers.map((w) => ({ ...w }))
      return { key, choice: 'continue' }
    }
    if (workers.length) throw Error('续用的执行会话不存在：' + workerLabel(key))
  }
  if (workers.length >= 8) throw Error('本事务的执行会话已达上限 8 个，请续用已有会话')
  const key = 'abcdefgh'[workers.length]
  r.workers = [
    ...workers,
    {
      key,
      purpose: 'new' in sheet.worker ? sheet.worker.new : sheet.ask.slice(0, 300),
      reason: sheet.workerReason,
      openedAt: now,
    },
  ]
  return { key, choice: 'new' }
}

/** Web calls this affair may still make under its agreement and approved extensions. */
export const webLimit = (r: { plan: Plan | null; web?: { extra: number } }) =>
  (r.plan?.web?.limit ?? 0) + (r.web?.extra ?? 0)
