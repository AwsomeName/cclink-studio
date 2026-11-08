import { expect, it } from 'vitest'
import { shouldUseLegacyReadFallback } from './file-preview-errors'

it('only falls back for an unavailable preview API, not parser or authorization failures', () => {
  expect(shouldUseLegacyReadFallback(new Error('fsApi.renderFile is not a function'))).toBe(true)
  expect(shouldUseLegacyReadFallback(new Error("No handler registered for 'fs:renderFile'"))).toBe(
    true,
  )
  for (const reason of ['Altium 解析失败', 'OUTSIDE_WORKSPACE', 'Altium 预览超过 15 秒']) {
    expect(
      shouldUseLegacyReadFallback(
        new Error(`Error invoking remote method 'fs:renderFile': ${reason}`),
      ),
    ).toBe(false)
  }
})
