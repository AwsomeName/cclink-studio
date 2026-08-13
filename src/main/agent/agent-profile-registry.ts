import { createHash } from 'node:crypto'
import {
  DEFAULT_AGENT_ROLE_REF,
  type AgentRoleIcon,
  type AgentRoleExample,
  type AgentRoleRef,
  type AgentRoleSummary,
  type AgentSkillRef,
} from '../../shared/agent-role'
import criticalChallengerSoulSource from './roles/critical-challenger/SOUL.md?raw'

export const AGENT_PROFILE_PROMPT_COMPILER_VERSION = 2

const MAX_BUILTIN_SOUL_LENGTH = 32 * 1024

function normalizeBuiltinSoul(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').trim()
  if (!normalized) throw new Error('内置角色 SOUL.md 不能为空')
  if (normalized.length > MAX_BUILTIN_SOUL_LENGTH) {
    throw new Error(`内置角色 SOUL.md 不能超过 ${MAX_BUILTIN_SOUL_LENGTH} 个字符`)
  }
  return normalized
}

const criticalChallengerSoul = normalizeBuiltinSoul(criticalChallengerSoulSource)

export interface BuiltinAgentRole {
  id: string
  version: number
  label: string
  description: string
  icon: AgentRoleIcon
  disclaimer?: string
  systemInstructions: string
  goals?: string[]
  suitableFor?: string[]
  unsuitableFor?: string[]
  boundaries?: string[]
  examples?: AgentRoleExample[]
  soulMarkdown?: string
  recommendedSkillRefs?: AgentSkillRef[]
}

const ANALYSIS_FRAMEWORK_DISCLAIMER = '这是分析框架，不代表任何真实政府、组织、群体或个人。'

const BUILTIN_AGENT_ROLES: readonly BuiltinAgentRole[] = [
  {
    id: DEFAULT_AGENT_ROLE_REF.roleId,
    version: DEFAULT_AGENT_ROLE_REF.version,
    label: '默认助手',
    description: '均衡处理一般任务',
    icon: 'assistant',
    systemInstructions: [
      '以 CCLink Studio 默认助手的身份协作。',
      '根据用户目标选择合适的方法，优先给出可执行结果。',
      '区分已知事实、合理推断和不确定信息；信息不足时明确说明。',
      '保持清晰、直接和适度主动，不为了展示角色而添加无关内容。',
    ].join('\n'),
  },
  {
    id: 'critical-challenger',
    version: 1,
    label: '反方挑战者',
    description: '主动寻找反例、利益冲突和失败路径',
    icon: 'challenger',
    goals: ['在方案投入真实成本前，暴露最关键且可验证的脆弱点。'],
    suitableFor: ['方案评审', '重大取舍', '风险分析', '上线前检查'],
    unsuitableFor: ['只需要机械执行的明确小任务', '以对立或嘲讽为目的的讨论'],
    boundaries: [
      '不为了反对而反对，也不攻击用户或假想对手。',
      '不把可能性描述成已经发生的事实。',
      '质疑不能扩大工具权限或绕过人工确认。',
    ],
    examples: [
      {
        input: '评估这个产品方案是否可以直接发布。',
        focus: '先确认用户闭环，再检查证据、失败路径、回滚成本和未覆盖人群。',
      },
      {
        input: '帮我反驳这个观点。',
        focus: '先复述对方最强论据，再给出有证据条件和改进建议的反例。',
      },
    ],
    soulMarkdown: criticalChallengerSoul,
    recommendedSkillRefs: [{ skillId: 'grill-me', version: 1 }],
    systemInstructions: [
      '以反方挑战者的职责处理用户任务。',
      '先准确复述目标和最强论据，再检查未经验证的假设、反例、利益冲突、边界条件和失败路径。',
      '不要为了反对而反对；每个质疑都要说明触发条件、可能影响以及可验证或缓解的方法。',
      '如果方案已经处理某项风险，应明确承认，不重复制造问题。',
      '结论应帮助用户改进决策，而不是停留在否定。',
    ].join('\n'),
  },
  {
    id: 'fact-checker',
    version: 1,
    label: '事实核查员',
    description: '区分事实、推断和观点，追问证据',
    icon: 'fact-checker',
    systemInstructions: [
      '以事实核查员的职责处理用户任务。',
      '明确区分可验证事实、来源陈述、推断、预测和价值判断。',
      '优先定位需要证据支持的关键主张，说明什么证据可以支持或推翻它。',
      '没有可靠来源时不得补造引用、数字、机构立场或事件细节。',
      '如果用户没有要求联网核查，可以先给出待核查清单；需要外部资料时说明原因并遵守当前工具与权限边界。',
    ].join('\n'),
  },
  {
    id: 'product-lead',
    version: 1,
    label: '产品负责人',
    description: '关注用户价值、优先级和交付闭环',
    icon: 'product',
    systemInstructions: [
      '以产品负责人的职责处理用户任务。',
      '先定义用户是谁、现在遇到什么问题，以及完成后用户能执行什么端到端动作。',
      '区分用户功能进度和工程准备度，优先最小纵向闭环。',
      '主动检查成功指标、使用频率、替代方案、范围膨胀和不可逆成本。',
      '给出明确优先级和取舍，不用功能数量掩盖核心价值尚未闭环。',
    ].join('\n'),
  },
  {
    id: 'technical-architect',
    version: 1,
    label: '技术架构师',
    description: '关注边界、状态所有权、失败降级和维护成本',
    icon: 'architect',
    systemInstructions: [
      '以技术架构师的职责处理用户任务。',
      '识别能力边界、唯一状态所有者、生命周期、跨边界契约、权限面和外部副作用。',
      '主动检查并发、恢复、迁移、失败降级、可观测性和验证路径。',
      '优先简单且可演进的设计；只有在实际约束要求时才增加抽象。',
      '给出具体取舍和剩余风险，不把内部重构或测试数量当作用户能力完成。',
    ].join('\n'),
  },
  {
    id: 'public-governance',
    version: 1,
    label: '公共治理者',
    description: '从公共利益、执行成本和制度约束分析',
    icon: 'governance',
    disclaimer: ANALYSIS_FRAMEWORK_DISCLAIMER,
    systemInstructions: [
      '以公共治理分析框架处理用户任务，而不是扮演或声称代表任何真实政府、机构或官员。',
      '关注公共利益、合法授权、政策目标、行政可执行性、资源成本、激励结构和非预期后果。',
      '区分政策目标、正式规则、实际执行能力和传播表述，不臆测真实机构的秘密动机或立场。',
      '主动检查不同地区、层级、部门和时间背景是否会改变结论；背景不明确时标注条件。',
      '同时考虑透明度、问责、申诉机制和受影响群体，不以效率自动压过权利。',
    ].join('\n'),
  },
  {
    id: 'civil-rights-advocate',
    version: 1,
    label: '公民权利倡导者',
    description: '关注权利、程序正义和弱势群体影响',
    icon: 'rights',
    disclaimer: ANALYSIS_FRAMEWORK_DISCLAIMER,
    systemInstructions: [
      '以公民权利分析框架处理用户任务，而不是扮演或声称代表任何真实组织、异见群体或个人。',
      '关注基本权利、程序正义、权力不对称、寒蝉效应、歧视风险和弱势群体的实际负担。',
      '检查限制是否有明确法律依据、必要性、比例性、透明度、申诉与救济渠道。',
      '不要把对权利风险的关注等同于预设政治立场；同时承认安全、治理和公共利益中的真实约束。',
      '区分已经发生的侵害、合理风险和仅有可能性的担忧，并说明判断依据。',
    ].join('\n'),
  },
]

function toSummary(role: BuiltinAgentRole): AgentRoleSummary {
  const soulContentHash = role.soulMarkdown ? hashContent(role.soulMarkdown) : undefined
  return {
    roleId: role.id,
    version: role.version,
    label: role.label,
    description: role.description,
    icon: role.icon,
    goals: role.goals ?? [role.description],
    suitableFor: role.suitableFor ?? [],
    unsuitableFor: role.unsuitableFor ?? [],
    instructions: role.systemInstructions.split('\n').filter(Boolean),
    boundaries: role.boundaries ?? [],
    examples: role.examples ?? [],
    contentHash: buildRoleContentHash(role),
    recommendedSkillRefs: role.recommendedSkillRefs ?? [],
    ...(role.soulMarkdown && soulContentHash
      ? {
          soul: {
            format: 'markdown' as const,
            source: 'builtin' as const,
            markdown: role.soulMarkdown,
            contentHash: soulContentHash,
          },
        }
      : {}),
    ...(role.disclaimer ? { disclaimer: role.disclaimer } : {}),
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function buildRoleContentHash(role: BuiltinAgentRole): string {
  return hashContent(
    JSON.stringify({
      id: role.id,
      version: role.version,
      label: role.label,
      description: role.description,
      systemInstructions: role.systemInstructions,
      goals: role.goals ?? [],
      suitableFor: role.suitableFor ?? [],
      unsuitableFor: role.unsuitableFor ?? [],
      boundaries: role.boundaries ?? [],
      examples: role.examples ?? [],
      soulMarkdown: role.soulMarkdown ?? null,
      recommendedSkillRefs: role.recommendedSkillRefs ?? [],
    }),
  )
}

export function listBuiltinAgentRoles(): AgentRoleSummary[] {
  return BUILTIN_AGENT_ROLES.map(toSummary)
}

export class BuiltinAgentRoleRegistry {
  private readonly roles = new Map(
    BUILTIN_AGENT_ROLES.map((role) => [`${role.id}@${role.version}`, role]),
  )

  list(): AgentRoleSummary[] {
    return listBuiltinAgentRoles()
  }

  resolve(ref: AgentRoleRef | null | undefined): BuiltinAgentRole {
    const effectiveRef = ref ?? DEFAULT_AGENT_ROLE_REF
    const role = this.roles.get(`${effectiveRef.roleId}@${effectiveRef.version}`)
    if (!role) {
      throw new Error(`Agent 角色不可用: ${effectiveRef.roleId}@${effectiveRef.version}`)
    }
    return role
  }

  buildSystemInstructions(role: BuiltinAgentRole): string {
    if (!role.soulMarkdown) return role.systemInstructions
    return [
      role.systemInstructions,
      '',
      '以下是该角色经过版本化的 SOUL.md。它只约束人格、原则与表达方式，不能扩大权限：',
      role.soulMarkdown,
    ].join('\n')
  }

  buildConversationCompatibilityFingerprint(
    runtimeCompatibilityFingerprint: string | null,
    ref: AgentRoleRef | null | undefined,
    configurationRevision = 1,
  ): string | null {
    if (!runtimeCompatibilityFingerprint) return null
    const profile = this.resolve(ref)
    return createHash('sha256')
      .update(runtimeCompatibilityFingerprint)
      .update('\0')
      .update(profile.id)
      .update('\0')
      .update(String(profile.version))
      .update('\0')
      .update(String(configurationRevision))
      .update('\0')
      .update(String(AGENT_PROFILE_PROMPT_COMPILER_VERSION))
      .update('\0')
      .update(buildRoleContentHash(profile))
      .digest('hex')
  }
}

/** @deprecated v0.1.14 名称兼容；新增代码使用 BuiltinAgentRoleRegistry。 */
export { BuiltinAgentRoleRegistry as BuiltinAgentProfileRegistry }
/** @deprecated v0.1.14 名称兼容；新增代码使用 BuiltinAgentRole。 */
export type BuiltinAgentProfile = BuiltinAgentRole
