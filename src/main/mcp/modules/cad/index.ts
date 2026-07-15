import type { CadConversionService } from '../../../cad/cad-conversion-service'
import type { ToolDefinition, ToolModule } from '../../types'

const CAD_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'cad_get_backend_status',
    description: '读取 CAD 转换后端状态，用于判断 STEP/STP 预览是否已启用、FreeCAD 是否可用。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_get_model_support',
    description:
      '判断指定模型文件是否可预览：内置 mesh、需要 CAD 转换后端，或暂不支持。适用于 STEP/STP/STL/3MF/GLB/FBX。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '本地模型文件路径。',
        },
      },
      required: ['inputPath'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_inspect_model',
    description:
      '检查指定模型文件的 CAD 预览能力，并读取已缓存的结构 metadata，例如 STEP 转换后的包围盒尺寸、单位置信度和预览文件路径。不会主动转换文件。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '本地模型文件路径。',
        },
      },
      required: ['inputPath'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_get_cache_status',
    description: '读取 CAD 转换缓存状态，包括缓存目录、缓存项数量和占用空间。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'cad_clear_cache',
    description: '清理 CAD 转换缓存。只删除 CCLink Studio 生成的预览缓存，不删除用户源文件。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

export class CadToolModule implements ToolModule {
  readonly name = 'cad'
  readonly tools = CAD_TOOL_DEFINITIONS

  constructor(private readonly cadConversionService: CadConversionService) {}

  async execute(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'cad_get_backend_status':
        return this.cadConversionService.getBackendStatus()
      case 'cad_get_model_support': {
        const inputPath = typeof params.inputPath === 'string' ? params.inputPath : ''
        if (!inputPath) throw new Error('缺少 inputPath')
        return this.cadConversionService.getModelSupport(inputPath)
      }
      case 'cad_inspect_model': {
        const inputPath = typeof params.inputPath === 'string' ? params.inputPath : ''
        if (!inputPath) throw new Error('缺少 inputPath')
        return this.cadConversionService.inspectModel(inputPath)
      }
      case 'cad_get_cache_status':
        return this.cadConversionService.getCacheStatus()
      case 'cad_clear_cache':
        return this.cadConversionService.clearCache()
      default:
        throw new Error(`未知 CAD 工具: ${toolName}`)
    }
  }
}
