import { z } from 'zod'

const coordinate = z.number().min(-2000).max(2000)
const point = z.array(coordinate).length(2)
const index = z.number().int().min(0).max(15)
const brief = z.string().trim().min(1).max(3000)
export const shapeRevisionId = z.uuid()
export const newShape = z.strictObject({
  brief,
  points: z
    .array(point)
    .min(3)
    .max(16)
    .describe('毫米，XY 俯视逆时针的凸多边形顶点列表，每个顶点为 [x,y]。轮廓由本轮描述决定。'),
  heightMm: z.number().min(1).max(1000),
})
export const changeShape = z.strictObject({
  brief,
  sourceId: shapeRevisionId,
  lockedEdge: index.describe('从 0 起的边编号，侧面由该点及下一点拉伸，两个端点均锁定'),
  targetVertex: index.describe('从 0 起的待移动顶点编号'),
  newPointMm: point.describe('该顶点修改后的绝对 [x,y] 坐标，单位 mm'),
})
export const shellShape = z.strictObject({
  sourceId: shapeRevisionId.describe('必须使用修改后的子版 ID'),
  wallMm: z.number().min(0.1).max(250),
  floorMm: z.number().min(0.1).max(250),
})
export const shapeRevision = newShape
  .extend({
    id: shapeRevisionId,
    parentId: shapeRevisionId.nullable(),
    blendHash: z.string().regex(/^[a-f0-9]{64}$/),
    parentBlendHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    lockedEdge: index.nullable(),
    targetVertex: index.nullable(),
    lockedFaceDeviationMm: z.number().nonnegative().max(0.001).nullable(),
    targetBeforeMm: point.nullable(),
    targetAfterMm: point.nullable(),
    backend: z.string(),
  })
  .refine((doc) => {
    const details = [
      doc.parentBlendHash,
      doc.lockedEdge,
      doc.targetVertex,
      doc.lockedFaceDeviationMm,
      doc.targetBeforeMm,
      doc.targetAfterMm,
    ]
    if (!doc.parentId) return details.every((value) => value === null)
    return (
      details.every((value) => value !== null) &&
      doc.lockedEdge! < doc.points.length &&
      doc.targetVertex! < doc.points.length &&
      doc.targetVertex !== doc.lockedEdge &&
      doc.targetVertex !== (doc.lockedEdge! + 1) % doc.points.length
    )
  }, '版本缺少有效的父版、锁定面或修改点证据')
export type ShapeRevision = z.infer<typeof shapeRevision>

/** Every other vertex must lie strictly to the left of each directed edge. */
export function checkOutline(points: number[][]): void {
  for (const [i, a] of points.entries()) {
    const next = (i + 1) % points.length
    const b = points[next]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    if (length < 0.05) throw new Error('轮廓边长必须达到 0.05 mm')
    for (const [j, p] of points.entries()) {
      if (j === i || j === next) continue
      if ((dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / length < 0.01) {
        throw new Error('当前支持逆时针、无自交且无共线点的凸轮廓；请调整该处截面')
      }
    }
  }
}
