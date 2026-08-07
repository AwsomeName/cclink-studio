import { describe, expect, it } from 'vitest'
import { isMarkdownHydrationPending } from './markdown-editor-hydration'

describe('isMarkdownHydrationPending', () => {
  const base = {
    hasEditor: true,
    hydratedVersion: 'notes.md:old',
    expectedVersion: 'notes.md:new',
    loadedFileKey: 'notes.md',
    fileKey: 'notes.md',
  }

  it('keeps an already mounted file visible while its saved version is reconciled', () => {
    expect(isMarkdownHydrationPending(base)).toBe(false)
  })

  it('waits for initial editor creation', () => {
    expect(isMarkdownHydrationPending({ ...base, hasEditor: false })).toBe(true)
  })

  it('waits when opening a different file', () => {
    expect(isMarkdownHydrationPending({ ...base, fileKey: 'other.md' })).toBe(true)
  })

  it('waits after an explicit reload clears the loaded file marker', () => {
    expect(isMarkdownHydrationPending({ ...base, loadedFileKey: undefined })).toBe(true)
  })

  it('does not wait when the expected version is already hydrated', () => {
    expect(isMarkdownHydrationPending({ ...base, hydratedVersion: base.expectedVersion })).toBe(
      false,
    )
  })
})
