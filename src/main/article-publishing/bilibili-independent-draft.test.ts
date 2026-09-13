import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isIndependentBilibiliDraft } from './bilibili-independent-draft'
import type { WebAffair } from '../../shared/web-affairs/web-affair-types'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'

describe('B站 independent document beside an interrupted unknown post', () => {
  it.each([
    'different',
    'same-body',
    'same-title',
    'same-path',
    'running',
    'waiting-human',
    'source-changed',
    'missing-attempt',
    'non-bilibili',
    'empty-body',
  ])('%s keeps the original unknown evidence and denies unsafe admission', async (mode) => {
    const dir = await mkdtemp(join(tmpdir(), 'bili-independent-'))
    try {
      const oldPath = join(dir, 'old.md'),
        newPath = join(dir, 'new.md')
      await writeFile(oldPath, '# Old\n\nOriginal body\n\n![old image](image.png)')
      await writeFile(
        newPath,
        '# New\n\n' +
          (mode === 'same-body'
            ? 'Original **body**'
            : mode === 'empty-body'
              ? ''
              : 'Different test body') +
          '\n\n![new label](image.png)',
      )
      const source = async (markdownPath: string) => {
        const meta = await stat(markdownPath)
        return { markdownPath, modifiedAt: meta.mtimeMs, size: meta.size }
      }
      const previous = {
        attempts:
          mode === 'missing-attempt'
            ? []
            : [
                {
                  id: 'a',
                  status:
                    mode === 'running'
                      ? 'running-ai'
                      : mode === 'waiting-human'
                        ? 'waiting-human'
                        : 'interrupted',
                },
              ],
        articlePublishing: {
          adapterId: mode === 'non-bilibili' ? 'weibo' : 'bilibili',
          execution: { status: 'result-unknown', currentAttemptId: 'a' },
          publication: { status: 'result-unknown' },
          source: await source(oldPath),
          fields: { title: 'Old' },
        },
      } as unknown as WebAffair
      const preview = {
        source: await source(mode === 'same-path' ? oldPath : newPath),
        title: mode === 'same-title' ? 'Old' : 'New',
      } as ArticlePublishingSourcePreview
      const snapshot = JSON.stringify(previous)
      if (mode === 'source-changed') await writeFile(oldPath, 'changed')
      expect(await isIndependentBilibiliDraft(previous, preview)).toBe(mode === 'different')
      expect(JSON.stringify(previous)).toBe(snapshot)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
