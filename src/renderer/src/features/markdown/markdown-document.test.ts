import { describe, expect, it } from 'vitest'
import {
  collectMarkdownDestinations,
  cclinkMarkdownMetadataLineOffset,
  parseCclinkMarkdownMetadata,
  rewriteMarkdownDestinations,
  stripCclinkMarkdownMetadata,
  withCclinkMarkdownMetadata,
} from '@shared/markdown-document'

describe('CCLink Markdown document metadata', () => {
  it('adds and removes a controlled invisible resource declaration', () => {
    const source = withCclinkMarkdownMetadata('# Plan\n', '/workspace/Plan.md')

    expect(source).toContain(
      '<!-- cclink-document: {"version":1,"resources":"Plan.assets/manifest.json"} -->',
    )
    expect(parseCclinkMarkdownMetadata(source)?.metadata.resources).toBe(
      'Plan.assets/manifest.json',
    )
    expect(stripCclinkMarkdownMetadata(source)).toBe('# Plan\n')
    expect(cclinkMarkdownMetadataLineOffset(source)).toBe(2)
  })

  it('does not accept unsafe or unknown metadata declarations', () => {
    expect(
      parseCclinkMarkdownMetadata(
        '<!-- cclink-document: {"version":1,"resources":"../outside/manifest.json"} -->\n',
      ),
    ).toBeNull()
    expect(
      parseCclinkMarkdownMetadata(
        '<!-- cclink-document: {"version":2,"resources":"a.assets/manifest.json"} -->\n',
      ),
    ).toBeNull()
  })
})

describe('Markdown resource destinations', () => {
  it('collects inline and reference destinations but ignores code', () => {
    const source = [
      '![diagram](Plan.assets/diagram.png)',
      '[brief][brief-ref]',
      '',
      '[brief-ref]: Plan.assets/brief.pdf',
      '',
      '`![code](Plan.assets/no.png)`',
      '',
      '```md',
      '![fenced](Plan.assets/no-2.png)',
      '```',
    ].join('\n')

    expect(collectMarkdownDestinations(source).map((item) => item.value)).toEqual([
      'Plan.assets/diagram.png',
      'Plan.assets/brief.pdf',
    ])
  })

  it('rewrites only parsed Markdown destinations', () => {
    const source = '![diagram](Plan.assets/a.png)\n\n`Plan.assets/a.png`\n'
    expect(
      rewriteMarkdownDestinations(source, (destination) =>
        destination.replace('Plan.assets', 'Roadmap.assets'),
      ),
    ).toBe('![diagram](Roadmap.assets/a.png)\n\n`Plan.assets/a.png`\n')
  })
})
