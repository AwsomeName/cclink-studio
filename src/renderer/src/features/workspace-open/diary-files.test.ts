import { describe, expect, it } from 'vitest'
import { isRecognizedDiary } from './diary-files'

describe('diary file recognition for rename/move warnings', () => {
  it('accepts dated diaries in month folders, including merged months and dash names', () => {
    expect(isRecognizedDiary('2026/11/1121_周六.md')).toBe(true)
    expect(isRecognizedDiary('2026/07-08/0715_周三.md')).toBe(true)
    expect(isRecognizedDiary('2026/11/1118-周三.md')).toBe(true)
  })
  it('rejects names or places that history and drafting would not find', () => {
    expect(isRecognizedDiary('2026/11/杂记.md')).toBe(false)
    expect(isRecognizedDiary('2026/1121_周六.md')).toBe(false)
    expect(isRecognizedDiary('项目记录/1121_周六.md')).toBe(false)
    expect(isRecognizedDiary('2026/11/1121_周六.txt')).toBe(false)
  })
})
