import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiaryChangeTracker } from './diary-change-tracker'
import { diffLines } from '../../shared/diary-change-report'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'diary-changes-'))
  await mkdir(join(root, 'project/.cclink-studio'), { recursive: true })
  await mkdir(join(root, 'project/个人计划/2026/11'), { recursive: true })
  await writeFile(
    join(root, 'project/.cclink-studio/workspace-settings.json'),
    JSON.stringify({
      version: 1,
      name: '我的空间',
      type: 'diary',
      diary: { directory: '个人计划', timezone: 'Asia/Shanghai', taskIds: [] },
    }),
  )
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('diary change reports', () => {
  it('reports per-file diffs of an AI run and undoes them unless changed again', async () => {
    const project = join(root, 'project')
    const a = join(project, '个人计划/2026/11/1121_周六.md')
    const b = join(project, '个人计划/2026/11/1120_周五.md')
    await writeFile(a, '# 周六\n- [ ] 复查电源\n- [ ] 联系供应商\n')
    await writeFile(b, '# 周五\n样品A\n')
    const tracker = new DiaryChangeTracker(join(root, 'reports.json'))
    await tracker.beforeRun({ conversationId: 'c', runId: 'r1', workspacePath: project })
    await writeFile(a, '# 周六\n- [ ] 【高】联系供应商\n- [ ] 复查电源\n')
    await writeFile(b, '# 周五\n样机A\n')
    await writeFile(join(project, '个人计划/新增.md'), '新文件')
    const report = await tracker.afterRun({ runId: 'r1' })
    expect(report?.files.map((f) => [f.path, f.status])).toEqual([
      ['个人计划/2026/11/1120_周五.md', 'modified'],
      ['个人计划/2026/11/1121_周六.md', 'modified'],
      ['个人计划/新增.md', 'added'],
    ])
    expect(report?.files[0].diff).toEqual(['  # 周五', '- 样品A', '+ 样机A'])
    // The user edits one file again before undoing: that file is left alone.
    await writeFile(b, '# 周五\n样机A\n用户又写了一行\n')
    const undo = await tracker.undo(report!.id)
    expect(undo).toEqual({
      restored: ['个人计划/2026/11/1121_周六.md', '个人计划/新增.md'],
      skipped: ['个人计划/2026/11/1120_周五.md'],
    })
    expect(await readFile(a, 'utf8')).toBe('# 周六\n- [ ] 复查电源\n- [ ] 联系供应商\n')
    await expect(readFile(join(project, '个人计划/新增.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect((await new DiaryChangeTracker(join(root, 'reports.json')).list(project))[0].undone).toBe(
      true,
    )
  })

  it('ignores non-diary projects and runs without changes', async () => {
    const tracker = new DiaryChangeTracker(join(root, 'reports.json'))
    const other = join(root, 'other')
    await mkdir(other)
    await tracker.beforeRun({ conversationId: 'c', runId: 'r', workspacePath: other })
    await writeFile(join(other, 'a.md'), 'x')
    expect(await tracker.afterRun({ runId: 'r' })).toBeNull()
    await tracker.beforeRun({
      conversationId: 'c',
      runId: 'r2',
      workspacePath: join(root, 'project'),
    })
    expect(await tracker.afterRun({ runId: 'r2' })).toBeNull()
  })

  it('reports attachments and large files without diff, and leaves them on undo', async () => {
    const project = join(root, 'project')
    await writeFile(join(project, '个人计划/大文件.md'), 'x'.repeat(600 * 1024))
    const tracker = new DiaryChangeTracker(join(root, 'reports.json'))
    await tracker.beforeRun({ conversationId: 'c', runId: 'att', workspacePath: project })
    await writeFile(join(project, '个人计划/2026/11/1121_周六.md'), '改动')
    await mkdir(join(project, '个人计划/2026/11/1121_周六.assets'))
    await writeFile(join(project, '个人计划/2026/11/1121_周六.assets/图.png'), 'PNG')
    const report = await tracker.afterRun({ runId: 'att' })
    expect(report?.files.map((f) => [f.path, f.status])).toEqual([
      ['个人计划/2026/11/1121_周六.assets/图.png', 'added'],
      ['个人计划/2026/11/1121_周六.md', 'added'],
    ])
    expect(report?.files[0].diff[0]).toContain('附件')
    const undo = await tracker.undo(report!.id)
    expect(undo).toEqual({
      restored: ['个人计划/2026/11/1121_周六.md'],
      skipped: ['个人计划/2026/11/1121_周六.assets/图.png'],
    })
  })

  it('keeps context around changes', () => {
    expect(diffLines('a\nb\nc\nd\ne\nf', 'a\nb\nc\nX\ne\nf').diff).toEqual([
      '  b',
      '  c',
      '- d',
      '+ X',
      '  e',
      '  f',
    ])
  })
})
