import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OwnerPreferences } from './owner-preferences'

describe('OwnerPreferences', () => {
  let dir: string, picked: string | undefined, prefs: OwnerPreferences
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'owner-prefs-')))
    await mkdir(join(dir, 'personal'))
    await mkdir(join(dir, 'research-out'))
    await mkdir(join(dir, 'notes'))
    prefs = new OwnerPreferences(
      join(dir, 'registry'),
      async () => join(dir, 'personal'),
      async () => picked,
      async () => 2,
    )
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('defaults new affairs to 我的空间/Owner 事务 and keeps preference defaults', async () => {
    const view = await prefs.get()
    expect(view.saveLocation).toEqual({ path: join(dir, 'personal', 'Owner 事务'), custom: false })
    expect(view.sources).toEqual({ github: true, docs: true, thirdParty: false })
    expect(await prefs.affairParent()).toEqual({
      path: join(dir, 'personal', 'Owner 事务'),
      custom: false,
    })
  })

  it('uses a registered output directory and refuses to fall back when it disappears', async () => {
    picked = join(dir, 'research-out')
    const view = (await prefs.register('output'))!
    expect(view.saveLocation).toEqual({ path: picked, custom: true })
    expect(await prefs.affairParent()).toEqual({ path: picked, custom: true })
    await rename(picked, picked + '-moved')
    await expect(prefs.affairParent()).rejects.toThrow(/默认保存位置不可用/)
    expect((await prefs.get()).saveLocation.error).toMatch(/不存在/)
    const reset = await prefs.setDefaultParent(null)
    expect(reset.saveLocation.custom).toBe(false)
  })

  it('registers reference directories without granting them, and counts grants', async () => {
    picked = join(dir, 'notes')
    const view = (await prefs.register('reference'))!
    expect(view.roots).toMatchObject([{ purpose: 'reference', label: 'notes', grantedAffairs: 2 }])
    expect(view.defaultParentId).toBeNull()
    expect((await prefs.reference(view.roots[0].id)).path).toBe(picked)
    await expect(prefs.setDefaultParent(view.roots[0].id)).rejects.toThrow(/登记保存位置/)
    expect((await prefs.remove(view.roots[0].id)).roots).toEqual([])
  })

  it('returns null when the picker is cancelled and stores source preferences', async () => {
    picked = undefined
    expect(await prefs.register('reference')).toBeNull()
    const view = await prefs.update({ sources: { github: true, docs: false, thirdParty: true } })
    expect(view.sources).toEqual({ github: true, docs: false, thirdParty: true })
  })
})
