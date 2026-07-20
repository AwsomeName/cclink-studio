import { describe, expect, it } from 'vitest'
import {
  androidApkPathSchema,
  androidDeviceIdSchema,
  scrcpyTouchSchema,
} from './android-ipc-schema'

describe('Android IPC schemas', () => {
  it('accepts only absolute APK paths', () => {
    expect(androidApkPathSchema.parse('/tmp/app.apk')).toBe('/tmp/app.apk')
    expect(() => androidApkPathSchema.parse('../app.apk')).toThrow()
    expect(() => androidApkPathSchema.parse('/tmp/app.zip')).toThrow()
  })

  it('rejects malformed device identifiers', () => {
    expect(() => androidDeviceIdSchema.parse('device\nmalformed')).toThrow()
    expect(() => androidDeviceIdSchema.parse('x'.repeat(513))).toThrow()
  })

  it('bounds touch events and rejects extra fields', () => {
    expect(scrcpyTouchSchema.parse({ action: 0, x: 10, y: 20, pressure: 0.5 })).toEqual({
      action: 0,
      x: 10,
      y: 20,
      pressure: 0.5,
    })
    expect(() => scrcpyTouchSchema.parse({ action: 3, x: 0, y: 0, pressure: 1 })).toThrow()
    expect(() =>
      scrcpyTouchSchema.parse({ action: 0, x: 0, y: 0, pressure: 1, command: 'shell' }),
    ).toThrow()
  })
})
