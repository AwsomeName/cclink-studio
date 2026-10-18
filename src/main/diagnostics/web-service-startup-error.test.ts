import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  classifyWebServiceStartupError,
  createWebServiceStartupFailure,
  WebServiceStartupError,
} from './web-service-startup-error'
import { WebResourceStore } from '../web-resources/web-resource-store'
import { WebAffairStore } from '../web-affairs/web-affair-store'
import { EMPTY_WEB_RESOURCE_SNAPSHOT } from '../../shared/web-resources/web-resource-types'
import { EMPTY_WEB_AFFAIR_SNAPSHOT } from '../../shared/web-affairs/web-affair-types'

vi.mock('electron', () => ({ app: { getPath: () => '/unused-test-profile' } }))

describe('web service startup diagnostics', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cclink-web-startup-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.each([
    ['EACCES', 'STORAGE_PERMISSION_DENIED', 'check-permissions-and-restart'],
    ['EPERM', 'STORAGE_PERMISSION_DENIED', 'check-permissions-and-restart'],
    ['ENOSPC', 'STORAGE_FULL', 'free-disk-and-restart'],
    ['EDQUOT', 'STORAGE_FULL', 'free-disk-and-restart'],
    ['EIO', 'STORAGE_UNAVAILABLE', 'check-storage-and-restart'],
    ['EROFS', 'STORAGE_UNAVAILABLE', 'check-storage-and-restart'],
  ])(
    'classifies %s without sending exception text or paths to renderer',
    (osCode, code, recovery) => {
      const error = Object.assign(new Error('token=private /Users/alice/private-state.json'), {
        code: osCode,
      })
      const failure = createWebServiceStartupFailure(
        'web-resources',
        classifyWebServiceStartupError(error, 'read-state'),
      )
      expect(failure).toMatchObject({
        service: 'web-resources',
        state: 'failed',
        stage: 'read-state',
        code,
        recovery,
      })
      expect(JSON.stringify(failure)).not.toMatch(/private|alice|token|stack|cause/)
    },
  )

  it('does not infer a reason by parsing an arbitrary exception message', () => {
    expect(
      createWebServiceStartupFailure('web-affairs', new Error('EACCES token=secret')),
    ).toMatchObject({
      stage: 'initialize',
      code: 'INITIALIZATION_FAILED',
      recovery: 'restart-and-copy-diagnostics',
    })
  })

  it.each(['web-resources', 'web-affairs'] as const)(
    'preserves corrupt %s primary and backup',
    async (service) => {
      const path = join(directory, 'state.json')
      await writeFile(path, '{primary-corrupt token=secret')
      await writeFile(`${path}.bak`, '{backup-corrupt')
      const store =
        service === 'web-resources' ? new WebResourceStore(path) : new WebAffairStore(path)
      const error = await store.load().catch((reason: unknown) => reason)
      expect(error).toBeInstanceOf(WebServiceStartupError)
      expect(createWebServiceStartupFailure(service, error)).toMatchObject({
        stage: 'read-state',
        code: 'STATE_INVALID',
        recovery: 'restore-backup-and-restart',
      })
      expect(await readFile(path, 'utf8')).toBe('{primary-corrupt token=secret')
      expect(await readFile(`${path}.bak`, 'utf8')).toBe('{backup-corrupt')
    },
  )

  it.each(['web-resources', 'web-affairs'] as const)(
    'keeps valid backup recovery for %s',
    async (service) => {
      const path = join(directory, 'state.json')
      const snapshot =
        service === 'web-resources' ? EMPTY_WEB_RESOURCE_SNAPSHOT : EMPTY_WEB_AFFAIR_SNAPSHOT
      await writeFile(path, '{corrupt')
      await writeFile(`${path}.bak`, JSON.stringify(snapshot))
      const store =
        service === 'web-resources' ? new WebResourceStore(path) : new WebAffairStore(path)
      expect(await store.load()).toEqual(snapshot)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(snapshot)
    },
  )

  it('distinguishes an unreadable path from a corrupt snapshot', async () => {
    const path = join(directory, 'state.json')
    await mkdir(path)
    await expect(new WebResourceStore(path).load()).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      stage: 'read-state',
    })
    await expect(new WebAffairStore(path).load()).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      stage: 'read-state',
    })
  })

  it('identifies failure to restore a valid backup separately from reading it', async () => {
    const path = join(directory, 'state.json')
    await mkdir(path)
    await writeFile(`${path}.bak`, JSON.stringify(EMPTY_WEB_RESOURCE_SNAPSHOT))
    await expect(new WebResourceStore(path).load()).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      stage: 'restore-state',
    })
  })

  it('retains the oversized state instead of treating it as an empty history', async () => {
    const path = join(directory, 'state.json')
    await writeFile(path, '')
    await truncate(path, 2 * 1024 * 1024 + 1)
    await expect(new WebResourceStore(path).load()).rejects.toMatchObject({
      code: 'STATE_TOO_LARGE',
      stage: 'read-state',
    })
  })

  it('reports a corrupt execution recovery journal at the recovery stage', async () => {
    const path = join(directory, 'state.json')
    await writeFile(path, JSON.stringify(EMPTY_WEB_AFFAIR_SNAPSHOT))
    await writeFile(`${path}.recovery`, '{corrupt token=secret')
    await expect(new WebAffairStore(path).load()).rejects.toMatchObject({
      code: 'STATE_INVALID',
      stage: 'recover-runtime',
    })
    expect(await readFile(`${path}.recovery`, 'utf8')).toBe('{corrupt token=secret')
  })
})
