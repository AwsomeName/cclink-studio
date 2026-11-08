import { AltiumDimensionRecord, type AltiumPcbDocument } from 'altiumts'

/** Adapt the disposable render model only; never serialize these changes back to Altium. */
export function preparePcbDimensionsForPreview(
  document: AltiumPcbDocument,
  warnings: Set<string>,
): void {
  for (const record of document.getRecordsByKind('Dimension')) {
    if (!(record instanceof AltiumDimensionRecord)) continue
    if (record.dimensionKind !== '1' || record.referencePoints.length !== 2) {
      warnings.add('包含尚未校验的非线性尺寸标注，请在原生 Altium 中核对尺寸')
      continue
    }
    const [start, end] = record.referencePoints
    const anchor = record.dimensionLineAnchor
    if (!anchor) {
      warnings.add('尺寸标注缺少定位点，数值和方向可能不准确')
      continue
    }
    // X1/Y1 locates the dimension line. Measure perpendicular to its extension from
    // the first reference, rather than the diagonal distance between the two references.
    // Format semantics cross-checked against KiCad's HelperParseDimensions6Linear:
    // https://docs.kicad.org/doxygen/altium__pcb_8cpp_source.html
    const dx = anchor.x - start.x
    const dy = anchor.y - start.y
    const lengthSquared = dx * dx + dy * dy
    let measuredEnd = end
    if (lengthSquared > 0) {
      const projection = ((end.x - start.x) * -dy + (end.y - start.y) * dx) / lengthSquared
      measuredEnd = { x: start.x - dy * projection, y: start.y + dx * projection }
      record.set('REFERENCE1POINTX', `${measuredEnd.x}mil`)
      record.set('REFERENCE1POINTY', `${measuredEnd.y}mil`)
    }
    if (record.getCaseInsensitive('TEXTPOSITION')?.toUpperCase() === 'AUTO') {
      // Altium's cached text anchor is not the SVG renderer's centered anchor.
      // Auto placement belongs between the arrows; preserve manually placed labels.
      record.set('TEXTX', `${anchor.x + (measuredEnd.x - start.x) / 2}mil`)
      record.set('TEXTY', `${anchor.y + (measuredEnd.y - start.y) / 2}mil`)
    }
    // altiumts 0.0.95 treats TEXTFORMAT (e.g. "10mil") as literal text even for
    // linear dimensions. Request its computed label using the source unit/precision.
    record.set('TEXTFORMAT', '<>')
  }
}
