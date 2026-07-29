import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  convertMarkdownDocumentToWechatHTML,
  convertMarkdownToWechatHTML,
  stripWechatPublishingMetadata,
} from './convert'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('convertMarkdownToWechatHTML', () => {
  it('escapes raw HTML and rejects script-capable Markdown links', () => {
    const html = convertMarkdownToWechatHTML(`
# Safe heading

<script>globalThis.compromised = true</script>
<img src="x" onerror="globalThis.compromised = true">
[unsafe](javascript:globalThis.compromised=true)
`)

    expect(html).toContain('Safe heading')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<[^>]+\sonerror=/i)
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('onerror=&quot;globalThis.compromised = true&quot;')
  })

  it('keeps generated Markdown formatting available for copy and save', () => {
    const html = convertMarkdownToWechatHTML('**bold** and [safe](https://example.com)')

    expect(html).toContain('<strong')
    expect(html).toContain('bold</strong>')
    expect(html).toContain('href="https://example.com"')
  })

  it('removes CCLink metadata and YAML frontmatter only from publishing output', () => {
    const markdown = `<!-- cclink-document: {"version":1,"resources":"article.assets/manifest.json"} -->

---
title: Internal title
draft: true
---

# Public title`

    expect(stripWechatPublishingMetadata(markdown)).toBe('# Public title')
    const html = convertMarkdownToWechatHTML(markdown)
    expect(html).toContain('Public title')
    expect(html).not.toContain('cclink-document')
    expect(html).not.toContain('Internal title')
    expect(html).not.toContain('draft')
  })

  it('preserves a normal leading thematic break that is not YAML frontmatter', () => {
    const markdown = `---

Opening paragraph

---`

    const html = convertMarkdownToWechatHTML(markdown)
    expect(html.match(/<hr/g)).toHaveLength(2)
    expect(html).toContain('Opening paragraph')
  })

  it('embeds local Markdown images as data URLs using the document path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cclink-wechat-'))
    tempDirectories.push(directory)
    const documentPath = join(directory, 'article.md')
    const assetsPath = join(directory, 'article.assets')
    await mkdir(assetsPath)
    await writeFile(join(assetsPath, 'figure.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await convertMarkdownDocumentToWechatHTML(
      '![figure](article.assets/figure.png)',
      documentPath,
    )

    expect(result.embeddedImages).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('src="data:image/png;base64,iVBORw=="')
    expect(result.html).not.toContain('article.assets/figure.png')
  })

  it('keeps the article renderable and reports a missing local image', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cclink-wechat-'))
    tempDirectories.push(directory)
    const result = await convertMarkdownDocumentToWechatHTML(
      '![missing](article.assets/missing.png)',
      join(directory, 'article.md'),
    )

    expect(result.embeddedImages).toBe(0)
    expect(result.warnings).toEqual(['article.assets/missing.png：本地图片不存在或无法读取'])
    expect(result.html).toContain('article.assets/missing.png')
  })
})
