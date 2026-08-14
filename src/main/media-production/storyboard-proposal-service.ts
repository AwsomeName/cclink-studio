import { createHash, randomUUID } from 'node:crypto'
import type { AgentBridge } from '../agent/agent-bridge'
import type {
  MediaProject,
  MediaProjectFailure,
  MediaStoryboardProposal,
  MediaStoryboardProposalResult,
} from '../../shared/media-production/media-project-types'

const MAX_PROMPT_SOURCE_CHARACTERS = 60_000

interface StoryboardModelOutput {
  title: string
  scenes: Array<{
    durationSeconds: number
    narration: string
    subtitle: string
    visualDescription: string
    searchTerms: string[]
    generationPrompt: string
  }>
}

export class StoryboardProposalService {
  constructor(
    private readonly getAgentBridge: () => AgentBridge | null,
    private readonly now: () => number = Date.now,
  ) {}

  async propose(project: MediaProject): Promise<MediaStoryboardProposalResult> {
    const agentBridge = this.getAgentBridge()
    if (!agentBridge) {
      return failure(
        'MEDIA_PROJECT_AGENT_UNAVAILABLE',
        '本地 Agent 尚未就绪，无法生成智能分镜',
        '检查 Agent Runtime 后重试；当前手工分镜不会丢失',
      )
    }

    try {
      const response = await agentBridge.requestInternalText({
        purpose: 'media-storyboard',
        prompt: buildStoryboardPrompt(project),
        workspacePath: project.workspaceRef.path,
      })
      const output = parseStoryboardModelOutput(response)
      const proposal: MediaStoryboardProposal = {
        id: randomUUID(),
        projectId: project.id,
        baseRevision: project.revision,
        sourceSnapshotSha256: createHash('sha256').update(project.source.snapshot).digest('hex'),
        title: output.title,
        scenes: output.scenes.map((scene, order) => ({
          ...scene,
          id: randomUUID(),
          order,
          materialKind: 'unassigned',
        })),
        createdAt: this.now(),
      }
      return { success: true, proposal }
    } catch (error) {
      console.warn('[StoryboardProposalService] Agent 分镜提案失败:', error)
      return failure(
        'MEDIA_PROJECT_PROPOSAL_INVALID',
        error instanceof Error ? error.message : 'Agent 分镜提案生成失败',
        '保留当前分镜并重试，或继续手工编辑',
      )
    }
  }
}

export function parseStoryboardModelOutput(value: string): StoryboardModelOutput {
  const json = extractJsonObject(value)
  const root = requireRecord(JSON.parse(json), 'Agent 返回的分镜不是 JSON 对象')
  assertExactKeys(root, ['title', 'scenes'], 'Agent 分镜包含未知字段')
  const title = requireText(root.title, 'Agent 分镜标题无效', 120)
  if (!Array.isArray(root.scenes) || root.scenes.length < 2 || root.scenes.length > 20) {
    throw new Error('Agent 分镜场景数必须在 2 到 20 之间')
  }
  const scenes = root.scenes.map((value, index) => {
    const scene = requireRecord(value, `Agent 分镜场景 ${index + 1} 无效`)
    assertExactKeys(
      scene,
      [
        'durationSeconds',
        'narration',
        'subtitle',
        'visualDescription',
        'searchTerms',
        'generationPrompt',
      ],
      `Agent 分镜场景 ${index + 1} 包含未知字段`,
    )
    if (
      typeof scene.durationSeconds !== 'number' ||
      !Number.isFinite(scene.durationSeconds) ||
      scene.durationSeconds < 1 ||
      scene.durationSeconds > 60
    ) {
      throw new Error(`Agent 分镜场景 ${index + 1} 时长无效`)
    }
    if (!Array.isArray(scene.searchTerms) || scene.searchTerms.length > 12) {
      throw new Error(`Agent 分镜场景 ${index + 1} 搜索词无效`)
    }
    return {
      durationSeconds: Math.round(scene.durationSeconds * 10) / 10,
      narration: requireText(scene.narration, `Agent 分镜场景 ${index + 1} 旁白无效`, 4000),
      subtitle: requireText(scene.subtitle, `Agent 分镜场景 ${index + 1} 字幕无效`, 1000),
      visualDescription: requireText(
        scene.visualDescription,
        `Agent 分镜场景 ${index + 1} 画面说明无效`,
        4000,
      ),
      searchTerms: scene.searchTerms.map((term) =>
        requireText(term, `Agent 分镜场景 ${index + 1} 搜索词无效`, 120),
      ),
      generationPrompt: requireText(
        scene.generationPrompt,
        `Agent 分镜场景 ${index + 1} 生成提示词无效`,
        8000,
      ),
    }
  })
  return { title, scenes }
}

function buildStoryboardPrompt(project: MediaProject): string {
  const source = project.source.snapshot.slice(0, MAX_PROMPT_SOURCE_CHARACTERS)
  const truncated = source.length < project.source.snapshot.length
  return [
    '你是宣发视频分镜策划。根据稿件和简报生成一个可执行的分镜提案。',
    '只返回一个 JSON 对象，不要 Markdown、代码围栏、解释或额外字段。',
    'JSON 结构必须严格为：',
    '{"title":"工程标题","scenes":[{"durationSeconds":6,"narration":"旁白","subtitle":"屏幕字幕","visualDescription":"具体画面","searchTerms":["中文关键词"],"generationPrompt":"适合图像或视频模型的中文提示词，避免画面文字"}]}',
    '要求：2-20 个场景；单场景 1-60 秒；总时长尽量接近目标；字幕精炼；搜索词不超过 12 个；不要编造稿件没有的产品事实。',
    `发布平台：${project.brief.platform}`,
    `画幅：${project.brief.aspectRatio}`,
    `目标时长：${project.brief.targetDurationSeconds} 秒`,
    `品牌 CTA：${project.brief.brand.callToAction || '未设置'}`,
    `当前工程标题：${project.title}`,
    truncated ? '注意：超长稿件已截取前 60000 个字符。' : '',
    '稿件：',
    source,
  ]
    .filter(Boolean)
    .join('\n')
}

function extractJsonObject(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || value.trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Agent 未返回 JSON 分镜')
  return candidate.slice(start, end + 1)
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requireText(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(message)
  }
  return value.trim()
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], message: string): void {
  const expected = new Set(keys)
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new Error(message)
  }
}

function failure(
  code: MediaProjectFailure['code'],
  message: string,
  recovery: string,
): MediaStoryboardProposalResult {
  return { success: false, error: { code, message, recovery } }
}
