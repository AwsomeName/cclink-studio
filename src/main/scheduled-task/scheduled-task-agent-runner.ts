import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { AgentRuntimeEvent } from '../agent-core/runtime/agent-runtime'
import type { AgentBridge } from '../agent/agent-bridge'
import type {
  ScheduledTaskArtifact,
  ScheduledTaskDefinition,
} from '../../shared/scheduled-task/scheduled-task-types'
import { renderScheduledTaskFileName } from '../../shared/scheduled-task/scheduled-task-file-name'

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const RUN_TIMEOUT_MS = 10 * 60 * 1000

export interface ScheduledTaskAgentRunInput {
  runId: string
  conversationId: string
  definition: ScheduledTaskDefinition
  scheduledFor: number | null
}

export interface ScheduledTaskAgentRunResult {
  artifact: ScheduledTaskArtifact
  generationError?: string
}

class ScheduledTaskCancelledError extends Error {}

export interface ScheduledTaskRunExecutor {
  run(input: ScheduledTaskAgentRunInput): Promise<ScheduledTaskAgentRunResult>
  cancel(runId: string): Promise<void>
}

interface ActiveAgentRun {
  conversationId: string
  reject: (error: Error) => void
  unsubscribe: () => void
  timeout: ReturnType<typeof setTimeout> | null
  cancelled: boolean
}

export class ScheduledTaskAgentRunner implements ScheduledTaskRunExecutor {
  private readonly active = new Map<string, ActiveAgentRun>()

  constructor(private readonly agentBridge: AgentBridge) {}

  async run(input: ScheduledTaskAgentRunInput): Promise<ScheduledTaskAgentRunResult> {
    const active: ActiveAgentRun = {
      conversationId: input.conversationId,
      reject: () => {},
      unsubscribe: () => {},
      timeout: null,
      cancelled: false,
    }
    this.active.set(input.runId, active)
    try {
      return await this.execute(input, active)
    } finally {
      if (active.timeout) clearTimeout(active.timeout)
      active.unsubscribe()
      this.active.delete(input.runId)
    }
  }

  private async execute(
    input: ScheduledTaskAgentRunInput,
    active: ActiveAgentRun,
  ): Promise<ScheduledTaskAgentRunResult> {
    const { definition } = input
    const workspaceRoot = await realpath(definition.workspaceRef.path)
    const readRoots = await resolveReadRoots(definition, workspaceRoot)
    const output = await resolveOutput(
      definition,
      workspaceRoot,
      input.scheduledFor ?? Date.now(),
      input.runId,
    )
    await assertOutputDoesNotExist(output.absolutePath)
    assertNotCancelled(active)

    let generationError: string | undefined
    const markdown = await new Promise<string>((resolvePromise, rejectPromise) => {
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        if (active.timeout) clearTimeout(active.timeout)
        active.timeout = null
        active.unsubscribe()
        callback()
      }
      const unsubscribe = this.agentBridge.onRuntimeEvent((event) => {
        if (event.conversationId !== input.conversationId || event.runId !== input.runId) return
        if (event.type === 'complete') {
          if (
            event.data &&
            typeof event.data === 'object' &&
            'is_error' in event.data &&
            event.data.is_error === true
          ) {
            settle(() => rejectPromise(new Error(extractAgentError(event))))
            return
          }
          const result = extractAgentResult(event)
          settle(() =>
            result
              ? resolvePromise(normalizeMarkdown(result))
              : rejectPromise(new Error('Agent 未返回可写入的 Markdown')),
          )
        } else if (event.type === 'error') {
          settle(() => rejectPromise(new Error(extractAgentError(event))))
        }
      })
      const timeout = setTimeout(() => {
        void this.agentBridge.abort(input.conversationId, input.runId).catch(() => {})
        settle(() => rejectPromise(new Error('定时任务 Agent 运行超时')))
      }, RUN_TIMEOUT_MS)
      active.reject = (error) => settle(() => rejectPromise(error))
      active.unsubscribe = unsubscribe
      active.timeout = timeout

      void this.agentBridge
        .sendScheduledTaskMessage({
          message: buildScheduledPrompt(definition, output.relativePath),
          conversationId: input.conversationId,
          runId: input.runId,
          workspacePath: workspaceRoot,
          taskId: definition.id,
          taskRevision: definition.revision,
          readRoots,
        })
        .catch((error) => {
          settle(() => rejectPromise(error instanceof Error ? error : new Error(String(error))))
        })
    })
      .then((value) => {
        if (Buffer.byteLength(value, 'utf-8') > MAX_OUTPUT_BYTES) {
          throw new Error('Agent 生成的 Markdown 超过 2 MiB')
        }
        return value
      })
      .catch((error: unknown) => {
        assertNotCancelled(active)
        const template = definition.outputPolicy.failureTemplate
        if (error instanceof ScheduledTaskCancelledError || !template?.trim()) throw error
        generationError = error instanceof Error ? error.message : String(error)
        return normalizeMarkdown(
          `${template}\n\n> 本次 AI 补充失败，仅保存预设模板。未核实的内容留空，详情见定时任务运行记录。`,
        )
      })

    const bytes = Buffer.byteLength(markdown, 'utf-8')
    if (bytes === 0 || bytes > MAX_OUTPUT_BYTES) {
      throw new Error('Agent 生成的 Markdown 为空或超过 2 MiB')
    }
    const currentOutputDirectory = await realpath(dirname(output.absolutePath))
    if (currentOutputDirectory !== output.canonicalDirectory) {
      throw new Error('输出目录在运行期间发生变化，已拒绝写入')
    }
    assertNotCancelled(active)
    await writeFile(output.absolutePath, markdown, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    })
    const persisted = await readFile(output.absolutePath, 'utf-8')
    if (persisted !== markdown) throw new Error('Markdown 写后校验失败')
    return {
      ...(generationError === undefined ? {} : { generationError }),
      artifact: {
        relativePath: output.relativePath,
        bytes,
        sha256: createHash('sha256').update(persisted).digest('hex'),
      },
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.active.get(runId)
    if (!active) return
    const agentRunning = active.timeout !== null
    active.cancelled = true
    active.reject(new ScheduledTaskCancelledError('定时任务运行已取消'))
    if (agentRunning) await this.agentBridge.abort(active.conversationId, runId)
  }
}

function assertNotCancelled(active: ActiveAgentRun): void {
  if (active.cancelled) throw new ScheduledTaskCancelledError('定时任务运行已取消')
}

async function resolveReadRoots(
  definition: ScheduledTaskDefinition,
  workspaceRoot: string,
): Promise<string[]> {
  const roots: string[] = []
  for (const resource of definition.resources) {
    const candidate =
      resource.kind === 'workspace' ? workspaceRoot : resolve(workspaceRoot, resource.path)
    const canonical = await realpath(candidate)
    if (!isPathWithin(workspaceRoot, canonical)) {
      throw new Error('绑定资源逃逸出工作空间')
    }
    roots.push(canonical)
  }
  return Array.from(new Set(roots))
}

async function resolveOutput(
  definition: ScheduledTaskDefinition,
  workspaceRoot: string,
  occurrenceAt: number,
  runId: string,
): Promise<{ absolutePath: string; relativePath: string; canonicalDirectory: string }> {
  const outputDirectory = resolve(workspaceRoot, definition.outputPolicy.directory)
  await mkdir(outputDirectory, { recursive: true })
  const canonicalDirectory = await realpath(outputDirectory)
  if (!isPathWithin(workspaceRoot, canonicalDirectory)) {
    throw new Error('输出目录逃逸出工作空间')
  }
  const fileName = renderScheduledTaskFileName({
    template: definition.outputPolicy.fileNameTemplate,
    timestamp: occurrenceAt,
    timezone: definition.schedule.timezone,
    taskId: definition.id,
    runId,
  })
  const absolutePath = resolve(canonicalDirectory, fileName)
  if (!isPathWithin(canonicalDirectory, absolutePath) || basename(absolutePath) !== fileName) {
    throw new Error('输出文件路径无效')
  }
  return {
    absolutePath,
    relativePath: relative(workspaceRoot, absolutePath).replaceAll('\\', '/'),
    canonicalDirectory,
  }
}

async function assertOutputDoesNotExist(filePath: string): Promise<void> {
  try {
    await stat(filePath)
    throw new Error('输出文件已存在；create-only 任务不会覆盖它')
  } catch (error) {
    if (isMissingFileError(error)) return
    throw error
  }
}

function buildScheduledPrompt(
  definition: ScheduledTaskDefinition,
  relativeOutputPath: string,
): string {
  const resources = definition.resources
    .map((resource) => (resource.kind === 'workspace' ? '当前工作空间' : resource.path))
    .join('、')
  return [
    '你正在执行 CCLink Studio 的受限定时任务。',
    `任务：${definition.instruction}`,
    `允许读取的资源：${resources}`,
    `目标产物：${relativeOutputPath}`,
    ...(definition.outputPolicy.failureTemplate
      ? [
          '以下是用户预设的 Markdown 结构，请在此结构内补充有资料依据的内容；未知事实留空，示例不能当作实际记录：',
          definition.outputPolicy.failureTemplate,
        ]
      : []),
    '只可使用 editor_read 和 editor_list 读取资料。',
    '禁止使用 Terminal、Browser、Android、Git、数据源、网络、删除、追加或任何外部动作。',
    '不要调用写入工具。最终回答必须只包含完整 Markdown 正文，不要解释，不要使用代码围栏。',
  ].join('\n')
}

function extractAgentResult(event: AgentRuntimeEvent): string | null {
  if (!event.data || typeof event.data !== 'object') return null
  const result = (event.data as { result?: unknown }).result
  return typeof result === 'string' && result.trim() ? result : null
}

function extractAgentError(event: AgentRuntimeEvent): string {
  if (!event.data || typeof event.data !== 'object') return 'Agent 运行失败'
  const { message, result, errors } = event.data as {
    message?: unknown
    result?: unknown
    errors?: unknown
  }
  if (typeof message === 'string' && message.trim()) return message
  if (typeof result === 'string' && result.trim()) return result
  if (Array.isArray(errors)) {
    const text = errors.filter((item): item is string => typeof item === 'string').join('\n')
    if (text.trim()) return text
  }
  return 'Agent 运行失败'
}

function normalizeMarkdown(value: string): string {
  const trimmed = value.trim()
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return `${(fenced?.[1] ?? trimmed).trim()}\n`
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const fromRoot = relative(resolve(rootPath), resolve(candidatePath))
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
