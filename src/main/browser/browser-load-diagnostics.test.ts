import { describe, expect, it } from 'vitest'
import { loadDiagnostic } from './browser-load-diagnostics'

describe('browser load diagnostics', () => {
  it('reports network facts without URL credentials, path, query, fragment or free-form errors', () => {
    const result = loadDiagnostic({
      id: 7,
      url: 'https://user:password@mp.toutiao.com/private?token=secret#secret',
      resourceType: 'mainFrame',
      fromCache: true,
      webContentsId: 3,
      statusCode: 200,
      error: 'net::ERR_FAILED secret',
    })
    expect(result).toEqual({
      requestId: 7,
      origin: 'https://mp.toutiao.com',
      resourceType: 'mainFrame',
      fromCache: true,
      webContentsId: 3,
      statusCode: 200,
      error: 'net::ERR_FAILED',
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|password|private/)
  })
  it('does not log local or inline URL contents', () => {
    for (const url of ['file:///private/secret', 'data:text/plain,secret', 'invalid secret']) {
      expect(
        loadDiagnostic({ id: 1, url, resourceType: 'other', fromCache: false }).origin,
      ).toBeUndefined()
    }
  })
})
