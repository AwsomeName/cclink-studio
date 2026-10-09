import type { CadConversionService } from '../../../cad/cad-conversion-service'
import type { CadModificationService } from '../../../cad/cad-modification-service'
import {
  CAD_SECTION_INSERT_OPERATION,
  type CadModificationAxis,
  type CadModificationDirection,
  type CadModificationFixedSide,
  type CadModificationSnapshot,
} from '../../../cad/cad-modification-types'
import type { FileService } from '../../../fs/file-service'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionPolicy,
  ToolModule,
} from '../../types'

const PLAN_PROPERTIES = {
  inputPath: { type: 'string', description: '当前工作空间内的 STEP/STP 源文件。' },
  operation: {
    type: 'string',
    enum: [CAD_SECTION_INSERT_OPERATION],
    description: '首版固定为 section-insert：沿指定截面插入一段实体。',
  },
  axis: { type: 'string', enum: ['x', 'y', 'z'], description: '加长或加宽的坐标轴。' },
  direction: {
    type: 'string',
    enum: ['positive', 'negative'],
    description: '移动截面一侧的方向。',
  },
  distanceMm: { type: 'number', minimum: 0.1, maximum: 10, description: '插入距离，单位 mm。' },
  splitPlane: { type: 'number', description: '截面在所选坐标轴上的绝对位置，单位 mm。' },
  fixedSide: {
    type: 'string',
    enum: ['min', 'max'],
    description: '保持不动的一端；positive 必须固定 min，negative 必须固定 max。',
  },
  outputPath: {
    type: 'string',
    description: '当前工作空间内的新 STEP/STP 路径；必须与输入不同且尚不存在。',
  },
} as const

const PLAN_REQUIRED = [
  'inputPath',
  'operation',
  'axis',
  'direction',
  'distanceMm',
  'splitPlane',
  'fixedSide',
  'outputPath',
]

const CAD_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'cad_get_backend_status',
    description: '读取 CAD 预览后端状态。编辑能力由 cad_plan_modification 独立检测 FreeCADCmd。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_get_model_support',
    description: '判断当前工作空间内的模型文件是否可预览。',
    inputSchema: {
      type: 'object',
      properties: { inputPath: { type: 'string', description: '本地模型文件路径。' } },
      required: ['inputPath'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_inspect_model',
    description: '检查当前工作空间内模型的预览能力和缓存 metadata，不修改文件。',
    inputSchema: {
      type: 'object',
      properties: { inputPath: { type: 'string', description: '本地模型文件路径。' } },
      required: ['inputPath'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_convert_model',
    description:
      '把当前工作空间内的 STEP/STP 转为只用于显示的 STL 预览缓存；不能把预览结果当作可制造 STEP。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: '本地源模型文件路径。' },
        targetFormat: { type: 'string', enum: ['stl'], description: '当前仅支持 stl。' },
        force: { type: 'boolean', description: '是否忽略缓存并重新转换。' },
      },
      required: ['inputPath'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'cad_get_cache_status',
    description: '读取 CAD 预览缓存状态。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_clear_cache',
    description: '清理 Studio 生成的 CAD 预览缓存，不删除用户源文件。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'cad_plan_modification',
    description:
      '使用独立 FreeCADCmd 编辑后端分析一种简单截面插入修改，返回源哈希、截面证据和必须原样提交给 cad_modify_step 的参数快照。不会写入 STEP。',
    inputSchema: { type: 'object', properties: PLAN_PROPERTIES, required: PLAN_REQUIRED },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_modify_step',
    description:
      '按 cad_plan_modification 返回的完整参数快照生成一个新的 STEP 副本并自动核验。每次调用都强制用户确认；不得省略或改写快照字段。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PLAN_PROPERTIES,
        sourceHash: {
          type: 'string',
          pattern: '^[a-f0-9]{64}$',
          description: '计划阶段的源 SHA-256。',
        },
        expectedSizeX: { type: 'number', description: '计划阶段给出的预期 X 尺寸。' },
        expectedSizeY: { type: 'number', description: '计划阶段给出的预期 Y 尺寸。' },
        expectedSizeZ: { type: 'number', description: '计划阶段给出的预期 Z 尺寸。' },
      },
      required: [...PLAN_REQUIRED, 'sourceHash', 'expectedSizeX', 'expectedSizeY', 'expectedSizeZ'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少 ${key}`)
  return value
}

function numberParam(params: Record<string, unknown>, key: string): number {
  const value = params[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} 必须是有限数字`)
  return value
}

function enumParam<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = stringParam(params, key)
  if (!allowed.includes(value as T)) throw new Error(`${key} 参数无效`)
  return value as T
}

function requireLocalContext(context?: ToolExecutionContext): {
  kind: 'local'
  rootPath: string
  workspaceKey: string
} {
  if (context?.trustedWorkspace?.kind !== 'local') {
    throw new Error('LOCAL_WORKSPACE_REQUIRED: CAD 文件操作只允许当前可信本地工作空间')
  }
  return context.trustedWorkspace
}

export class CadToolModule implements ToolModule {
  readonly name = 'cad'
  readonly tools = CAD_TOOL_DEFINITIONS

  constructor(
    private readonly cadConversionService: CadConversionService,
    private readonly cadModificationService: CadModificationService,
    private readonly fileService: FileService,
  ) {}

  getExecutionPolicy(toolName: string): ToolExecutionPolicy | null {
    if (toolName !== 'cad_modify_step') return null
    return {
      requireConfirmation: true,
      riskLevel: 'write',
      allowAlways: false,
      reason: '将按下列已确认参数生成新的 STEP 文件；原文件不会被覆盖。',
    }
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    switch (toolName) {
      case 'cad_get_backend_status':
        return this.cadConversionService.getBackendStatus()
      case 'cad_get_cache_status':
        return this.cadConversionService.getCacheStatus()
      case 'cad_clear_cache':
        return this.cadConversionService.clearCache()
    }

    const trustedWorkspace = requireLocalContext(context)
    return this.fileService.withAccess({ trustedWorkspace }, async () => {
      switch (toolName) {
        case 'cad_get_model_support': {
          const inputPath = await this.fileService.assertReadableFile(
            stringParam(params, 'inputPath'),
          )
          return this.cadConversionService.getModelSupport(inputPath)
        }
        case 'cad_inspect_model': {
          const inputPath = await this.fileService.assertReadableFile(
            stringParam(params, 'inputPath'),
          )
          return this.cadConversionService.inspectModel(inputPath)
        }
        case 'cad_convert_model': {
          const inputPath = await this.fileService.assertReadableFile(
            stringParam(params, 'inputPath'),
          )
          const targetFormat = typeof params.targetFormat === 'string' ? params.targetFormat : 'stl'
          if (targetFormat !== 'stl') {
            throw new Error(`暂不支持转换为 ${targetFormat}。当前只支持 STEP/STP -> STL 预览转换。`)
          }
          return this.cadConversionService.convertModel({
            inputPath,
            targetFormat,
            force: params.force === true,
          })
        }
        case 'cad_plan_modification':
          return this.cadModificationService.plan(await this.readPlanParams(params))
        case 'cad_modify_step': {
          if (context?.confirmationGranted !== true) {
            throw new Error('CONFIRMATION_REQUIRED: cad_modify_step 必须取得本次参数快照确认')
          }
          const request = await this.readPlanParams(params)
          const snapshot: CadModificationSnapshot = {
            ...request,
            sourceHash: stringParam(params, 'sourceHash'),
            expectedSizeX: numberParam(params, 'expectedSizeX'),
            expectedSizeY: numberParam(params, 'expectedSizeY'),
            expectedSizeZ: numberParam(params, 'expectedSizeZ'),
          }
          return this.cadModificationService.modify(snapshot, { signal: context.abortSignal })
        }
        default:
          throw new Error(`未知 CAD 工具: ${toolName}`)
      }
    })
  }

  private async readPlanParams(params: Record<string, unknown>) {
    const inputPath = await this.fileService.assertReadableFile(stringParam(params, 'inputPath'))
    const outputPath = await this.fileService.assertWritableTarget(
      stringParam(params, 'outputPath'),
    )
    return {
      inputPath,
      operation: enumParam(params, 'operation', [CAD_SECTION_INSERT_OPERATION]),
      axis: enumParam<CadModificationAxis>(params, 'axis', ['x', 'y', 'z']),
      direction: enumParam<CadModificationDirection>(params, 'direction', ['positive', 'negative']),
      distanceMm: numberParam(params, 'distanceMm'),
      splitPlane: numberParam(params, 'splitPlane'),
      fixedSide: enumParam<CadModificationFixedSide>(params, 'fixedSide', ['min', 'max']),
      outputPath,
    }
  }
}
