import {
  AltiumBinaryPcbDoc,
  AltiumPcbDoc,
  AltiumPrjPcb,
  AltiumSchDoc,
  getAltiumPcbDocumentLayerStackEntries,
  getAltiumPcbLayerAliasKey,
  getAltiumPcbLayerAliasMap,
  parseAltiumFile,
  serializeAltiumPcbToSvg,
  serializeAltiumSheetToSvg,
  validateAltiumDocument,
} from 'altiumts'
import {
  ALTIUM_MAX_FILE_BYTES,
  type AltiumDrawingPreview,
  type AltiumRenderOptions,
} from '../../shared/altium-preview'
import { preparePcbDimensionsForPreview } from './altium-preview-dimensions'

export type ParsedAltiumPreview =
  | AltiumDrawingPreview
  | { kind: 'project-references'; references: string[] }

export interface AltiumPreviewJob {
  bytes: Uint8Array
  fileName: string
  path: string
  options?: AltiumRenderOptions
}

/** Pure read-only conversion; runs in a disposable worker, without filesystem or network access. */
export function parseAltiumPreview(job: AltiumPreviewJob): ParsedAltiumPreview {
  if (job.bytes.byteLength > ALTIUM_MAX_FILE_BYTES)
    throw new Error('Altium 文件超过 32 MB 预览上限')
  const warnings = new Set<string>()
  const { document } = parseAltiumFile(job.bytes, {
    maxFileSize: ALTIUM_MAX_FILE_BYTES,
    maxDirectoryEntries: 16_384,
    maxChainLength: 65_536,
    maxRecordLength: 4 * 1024 * 1024,
    maxPrimitiveRecordLength: 4 * 1024 * 1024,
    maxPropertyRecordLength: 4 * 1024 * 1024,
    maxLineCount: 100_000,
    maxLineLength: 1024 * 1024,
    redactSourceText: true,
    onDiagnostic: (diagnostic) => {
      if (warnings.size < 30)
        warnings.add(`${diagnostic.code}: ${diagnostic.message}`.slice(0, 500))
    },
  })
  const extension = job.fileName.split('.').pop()?.toLowerCase()
  if (document instanceof AltiumPrjPcb && extension === 'prjpcb') {
    if (document.documents.length > 256) throw new Error('工程引用超过 256 项，无法预览')
    return { kind: 'project-references', references: document.documents.map((entry) => entry.path) }
  }
  const schematic = document instanceof AltiumSchDoc
  const pcb = document instanceof AltiumBinaryPcbDoc || document instanceof AltiumPcbDoc
  if ((!schematic || extension !== 'schdoc') && (!pcb || extension !== 'pcbdoc')) {
    throw new Error('文件内容与 Altium 扩展名不匹配，或格式尚不支持')
  }
  if (!schematic && !pcb) throw new Error('不支持此 Altium 文件')
  if (document.records.length > 100_000) throw new Error('图纸对象超过 100,000 项，无法预览')
  const validation = validateAltiumDocument(document, { maxIssues: 30 })
  for (const issue of validation.issues) {
    if (warnings.size < 30) warnings.add(`${issue.code}: ${issue.message}`.slice(0, 500))
  }
  if (validation.summary.fatals > 0) throw new Error('图纸结构损坏，无法可靠预览')
  const layerAliases = pcb
    ? getAltiumPcbLayerAliasMap(getAltiumPcbDocumentLayerStackEntries(document))
    : undefined
  const layers = pcb
    ? [
        ...new Set(
          document.records
            .map((record) => record.getCaseInsensitive('LAYER'))
            .filter((layer): layer is string => Boolean(layer) && layer !== 'UNKNOWN')
            .map((layer) => getAltiumPcbLayerAliasKey(layer, layerAliases)),
        ),
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : []
  const layer = job.options?.altiumLayer
  if (layer && (!pcb || !layers.includes(layer)))
    throw new Error('所选 PCB 层不存在，请重新打开图纸')
  if (document instanceof AltiumBinaryPcbDoc) {
    for (const stream of document.streamSummaries) {
      if (
        /^(Arcs6|Pads6|Tracks6|Vias6|Texts6|Regions6|ShapeBasedRegions6|Fills6)$/.test(
          stream.family,
        ) &&
        stream.declaredRecordCount !== undefined &&
        stream.declaredRecordCount !== stream.decodedPrimitiveRecordCount
      ) {
        warnings.add(
          `${stream.family}：读取 ${stream.decodedPrimitiveRecordCount} / ${stream.declaredRecordCount} 项，显示可能不完整`,
        )
      }
    }
  }
  if (pcb) preparePcbDimensionsForPreview(document, warnings)
  const svg = schematic
    ? serializeAltiumSheetToSvg(document, {
        documentName: job.fileName,
        title: job.fileName,
        showHidden: job.options?.altiumShowHidden,
      })
    : serializeAltiumPcbToSvg(document, {
        layers: layer ? [layer] : undefined,
        title: job.fileName,
        showHidden: job.options?.altiumShowHidden,
      })
  if (Buffer.byteLength(svg) > 16 * 1024 * 1024)
    throw new Error('预览图超过 16 MB，请用专业软件查看')
  const counts = schematic
    ? [
        { label: '元件', value: document.components.length },
        { label: '引脚', value: document.pins.length },
        { label: '导线', value: document.wires.length },
      ]
    : [
        { label: '元件', value: document.components.length },
        { label: '走线', value: document.getRecordsByKind('Track').length },
        { label: '焊盘', value: document.getRecordsByKind('Pad').length },
        { label: '过孔', value: document.getRecordsByKind('Via').length },
        { label: '网络', value: document.nets.length },
      ]
  return {
    kind: 'altium-drawing',
    documentKind: schematic ? 'schematic' : 'pcb',
    fileName: job.fileName,
    path: job.path,
    content: Buffer.from(svg).toString('base64'),
    layers,
    selectedLayer: layer ?? null,
    showHidden: job.options?.altiumShowHidden ?? false,
    counts,
    warnings: [...warnings].slice(0, 30),
  }
}
