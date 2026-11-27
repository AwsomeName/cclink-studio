import { execFile } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  changeShape,
  checkOutline,
  newShape,
  shapeRevision,
  shellShape,
  type ShapeRevision,
} from '../../../shared/cad/product-shape'
import type { AuthorizedFileSnapshot, FileService } from '../../fs/file-service'
import type { CadBackendStatus } from '../../../shared/ipc/cad'
import blenderDriver from './blender.py?raw'
import freecadDriver from './freecad.py?raw'

export type ShapeCommand = 'cad_create_shape' | 'cad_revise_shape' | 'cad_shell_shape'
const schemas = {
  cad_create_shape: newShape,
  cad_revise_shape: changeShape,
  cad_shell_shape: shellShape,
}
const descriptions = {
  cad_create_shape:
    '产品造型：按用户的新描述设计一款直壁单件壳的凸多边形轮廓，用本机 Blender 生成可编辑 .blend 与 3D 预览，返回顶点编号和版本 ID。不能表达的特征应先说明。',
  cad_revise_shape:
    '产品造型：在指定 Blender 版本中锁定一个垂直侧面，修改另一个角的 XY 坐标，核验后另存子版。返回子版 ID。Z 高度保持。',
  cad_shell_shape:
    '产品造型：从用户选定的子版 .blend 实测轮廓生成顶面开口底壳。壁厚垂直于侧面。以 FreeCAD 重开并改参核验，回读 STEP，返回新文件与几何测量。',
}
export const shapeTools = (Object.keys(schemas) as ShapeCommand[]).map((name) => {
  const json = z.toJSONSchema(schemas[name], { target: 'draft-7' })
  return {
    name,
    description: descriptions[name],
    inputSchema: {
      type: 'object' as const,
      properties: json.properties ?? {},
      required: json.required,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }
})
async function blenderExecutable(): Promise<string> {
  for (const candidate of [
    '/Applications/Blender.app/Contents/MacOS/Blender',
    join(homedir(), 'Applications/Blender.app/Contents/MacOS/Blender'),
    '/opt/homebrew/bin/blender',
    '/usr/local/bin/blender',
    '/usr/bin/blender',
  ]) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      /* next installation */
    }
  }
  throw new Error(
    '未找到 Blender。请把 Blender.app 放在「应用程序」或用户 Applications 目录，然后重试。',
  )
}
async function run(
  executable: string,
  args: string[],
  signal: AbortSignal,
  input?: string,
): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      { timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              signal.aborted
                ? '造型操作已取消'
                : '建模后端执行失败：' + (stderr || stdout || error.message).slice(-900),
            ),
          )
        else resolve()
      },
    )
    child.stdin?.on('error', () => {
      /* exit callback reports backend failure */
    })
    child.stdin?.end(input)
  })
}

export class ProductShapeService {
  private readonly lifetime = new AbortController()
  constructor(
    private readonly files: FileService,
    private readonly backend: () => Promise<CadBackendStatus>,
  ) {}
  destroy(): void {
    this.lifetime.abort()
  }

  async execute(
    command: ShapeCommand,
    params: Record<string, unknown>,
    root: string,
    abort?: AbortSignal,
  ) {
    const signal = abort ? AbortSignal.any([abort, this.lifetime.signal]) : this.lifetime.signal
    const input = schemas[command].parse(params)
    const blender = await blenderExecutable()
    const base = join(root, '产品造型')
    const id = randomUUID()
    const scratch = await mkdtemp(join(tmpdir(), 'cclink-shape-'))
    const snapshots: AuthorizedFileSnapshot[] = []
    const folder = join(base, id)
    const staging = join(base, '.building-' + id)
    const stagedFiles: string[] = []
    let stagingStarted = false
    try {
      let parent: ShapeRevision | null = null
      if ('sourceId' in input) {
        const directory = join(base, input.sourceId)
        const manifest = await this.files.createAuthorizedFileSnapshot(
          join(directory, 'revision.json'),
        )
        snapshots.push(manifest)
        parent = shapeRevision.parse(JSON.parse(await readFile(manifest.snapshotPath, 'utf8')))
        if (parent.id !== input.sourceId) throw new Error('文件夹和版本 ID 不一致')
        const blend = await this.files.createAuthorizedFileSnapshot(join(directory, 'shape.blend'))
        snapshots.push(blend)
        if (blend.hash !== parent.blendHash)
          throw new Error('源 .blend 已在外部变化；请回到对应的原始版本')
        await copyFile(blend.snapshotPath, join(scratch, 'source.blend'))
      }
      let points = 'points' in input ? input.points : parent!.points
      const heightMm = 'heightMm' in input ? input.heightMm : parent!.heightMm
      if ('targetVertex' in input) {
        const { lockedEdge, targetVertex, newPointMm } = input
        if (parent!.lockedEdge !== null && parent!.lockedEdge !== lockedEdge)
          throw new Error('请保留子版已经锁定的侧面，或基于父版创建另一分支')
        if (lockedEdge >= points.length || targetVertex >= points.length)
          throw new Error('目标或锁定面的编号超出此版本范围')
        if (targetVertex === lockedEdge || targetVertex === (lockedEdge + 1) % points.length)
          throw new Error('该顶点属于锁定侧面，请另选顶点')
        if (
          Math.hypot(
            points[targetVertex][0] - newPointMm[0],
            points[targetVertex][1] - newPointMm[1],
          ) < 0.01
        )
          throw new Error('指定的顶点移动不足 0.01 mm')
        points = points.map((p, i) => (i === targetVertex ? newPointMm : p))
      }
      checkOutline(points)
      if (
        'wallMm' in input &&
        (!parent?.parentId || parent.lockedEdge === null || parent.targetVertex === null)
      )
        throw new Error('请先锁定侧面并生成修改子版，再将该子版交给 FreeCAD')
      const mode = 'points' in input ? 'create' : 'targetVertex' in input ? 'revise' : 'inspect'
      await writeFile(
        join(scratch, 'job.json'),
        JSON.stringify({
          ...input,
          mode,
          points,
          heightMm,
          sourcePoints: parent?.points,
          lock: 'lockedEdge' in input ? input.lockedEdge : null,
          target: 'targetVertex' in input ? input.targetVertex : null,
        }),
      )
      const script = join(scratch, 'driver.py')
      await writeFile(script, blenderDriver)
      await run(
        blender,
        [
          '--background',
          '--factory-startup',
          '--disable-autoexec',
          '--python-exit-code',
          '1',
          '--python',
          script,
          '--',
          scratch,
        ],
        signal,
      )
      const geometry = JSON.parse(await readFile(join(scratch, 'geometry.json'), 'utf8'))
      let receipt
      let artifacts: string[]
      let outputName: string
      if ('wallMm' in input) {
        const backend = await this.backend()
        if (!backend.available || !backend.path)
          throw new Error('未找到 FreeCAD，请安装或在设置中填写 FreeCADCmd 路径；子版已保留')
        await run(
          backend.path,
          ['-c'],
          signal,
          '__studio_job_dir__=' +
            JSON.stringify(scratch) +
            '\nexec(' +
            JSON.stringify(freecadDriver) +
            ')\n',
        )
        const failure = await readFile(join(scratch, 'failure.txt'), 'utf8').catch(() => null)
        if (failure) throw new Error('FreeCAD：' + failure.slice(0, 1000))
        const checked = JSON.parse(await readFile(join(scratch, 'checked.json'), 'utf8'))
        receipt = {
          id,
          sourceId: parent!.id,
          sourceBlendHash: parent!.blendHash,
          points: geometry.points,
          ...checked,
        }
        artifacts = ['housing.FCStd', 'housing.step', 'check.json']
        outputName = 'housing.step'
      } else {
        receipt = shapeRevision.parse({
          id,
          parentId: parent?.id ?? null,
          brief: input.brief,
          points: geometry.points,
          heightMm: geometry.heightMm,
          backend: geometry.backend,
          lockedEdge: 'lockedEdge' in input ? input.lockedEdge : null,
          targetVertex: 'targetVertex' in input ? input.targetVertex : null,
          lockedFaceDeviationMm: geometry.lockedFaceDeviationMm ?? null,
          targetBeforeMm: geometry.targetBeforeMm ?? null,
          targetAfterMm: geometry.targetAfterMm ?? null,
          blendHash: createHash('sha256')
            .update(await readFile(join(scratch, 'shape.blend')))
            .digest('hex'),
          parentBlendHash: parent?.blendHash ?? null,
        })
        artifacts = ['shape.blend', 'shape.glb', 'revision.json']
        outputName = 'shape.glb'
      }
      await writeFile(join(scratch, artifacts[2]), JSON.stringify(receipt, null, 2))
      stagingStarted = true
      for (const name of artifacts) {
        stagedFiles.push(
          await this.files.publishAuthorizedFile(join(scratch, name), join(staging, name)),
        )
      }
      for (const source of snapshots) await source.verifyUnchanged()
      signal.throwIfAborted()
      await this.files.rename(staging, folder)
      stagingStarted = false
      return {
        kind: 'product-shape-result',
        success: true,
        outputPath: join(folder, outputName),
        files: artifacts.map((name) => join(folder, name)),
        ...receipt,
      }
    } finally {
      if (stagingStarted) {
        await Promise.allSettled(stagedFiles.map((file) => this.files.delete(file)))
        await this.files
          .assertWritableTarget(staging)
          .then((path) => rmdir(path))
          .catch(() => undefined)
      }
      await Promise.allSettled(snapshots.map((source) => source.cleanup()))
      await rm(scratch, { recursive: true, force: true })
    }
  }
}
