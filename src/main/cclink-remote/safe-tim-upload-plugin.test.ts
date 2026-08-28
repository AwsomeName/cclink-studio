import { describe, expect, it, vi } from 'vitest'
import { SafeTimUploadPlugin, TIM_UPLOAD_ABORT_SIGNAL } from './safe-tim-upload-plugin'

function fakeRequest() {
  const request = {
    status: 200,
    statusText: 'OK',
    responseType: '',
    timeout: 0,
    upload: { onprogress: null as ((event: { total: number; loaded: number }) => void) | null },
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    ontimeout: null as (() => void) | null,
    onabort: null as (() => void) | null,
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    getAllResponseHeaders: vi.fn(() => 'etag: image-etag\r\n'),
    send: vi.fn(),
    abort: vi.fn(),
  }
  request.abort.mockImplementation(() => request.onabort?.())
  return request
}

describe('SafeTimUploadPlugin', () => {
  it('uploads bytes without logging a signed URL and returns only the download URL', () => {
    const request = fakeRequest()
    const callback = vi.fn()
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const plugin = new SafeTimUploadPlugin(() => request as never)
    const bytes = Buffer.from([1, 2, 3])

    plugin.uploadFile(
      {
        url: 'https://upload.example/object?signature=secret',
        downloadUrl: 'https://download.example/screen.png',
        resources: bytes,
        headers: { authorization: 'signed-header', host: 'blocked-host' },
      },
      callback,
    )
    request.onload?.()
    request.onerror?.()

    expect(request.open).toHaveBeenCalledWith(
      'PUT',
      'https://upload.example/object?signature=secret',
      true,
    )
    expect(request.setRequestHeader).toHaveBeenCalledWith('authorization', 'signed-header')
    expect(request.setRequestHeader).not.toHaveBeenCalledWith('host', expect.anything())
    expect(request.send).toHaveBeenCalledWith(bytes)
    expect(callback).toHaveBeenCalledWith(null, {
      statusCode: 200,
      statusMessage: 'OK',
      headers: { etag: 'image-etag' },
      data: { location: 'https://download.example/screen.png' },
    })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(consoleLog).not.toHaveBeenCalled()
    consoleLog.mockRestore()
  })

  it('reports byte progress and aborts the active request exactly once', () => {
    const request = fakeRequest()
    const callback = vi.fn()
    const onProgress = vi.fn()
    const controller = new AbortController()
    const bytes = Buffer.from([1, 2, 3])
    Object.defineProperty(bytes, TIM_UPLOAD_ABORT_SIGNAL, {
      value: controller.signal,
      enumerable: false,
    })
    const plugin = new SafeTimUploadPlugin(() => request as never)

    plugin.uploadFile(
      {
        url: 'https://upload.example/object',
        downloadUrl: 'https://download.example/screen.png',
        resources: bytes,
        onProgress,
      },
      callback,
    )
    request.upload.onprogress?.({ loaded: 2, total: 3 })
    controller.abort()
    request.onerror?.()

    expect(onProgress).toHaveBeenCalledWith({ loaded: 2, total: 3, percent: 2 / 3 })
    expect(request.abort).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: '图片上传已取消' }),
      expect.objectContaining({ statusCode: 200 }),
    )
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('rejects non-HTTPS upload or download URLs before sending bytes', () => {
    const request = fakeRequest()
    const callback = vi.fn()
    const plugin = new SafeTimUploadPlugin(() => request as never)

    expect(
      plugin.uploadFile(
        {
          url: 'http://upload.example/object',
          downloadUrl: 'https://download.example/screen.png',
          resources: Buffer.from([1]),
        },
        callback,
      ),
    ).toBeNull()
    expect(request.send).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: '图片上传地址必须使用 HTTPS' }),
      expect.objectContaining({ statusCode: 0 }),
    )
  })
})
