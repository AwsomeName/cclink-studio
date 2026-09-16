import { expect, it } from 'vitest'
import { gitRelocatedArticleSourceInternals } from './git-relocated-article-source'

it('reads only exact Git renames from nul-delimited name-status output', () => {
  expect(
    gitRelocatedArticleSourceInternals.parseExactRenames(
      [
        'R100',
        'old/article.md',
        'new/article.md',
        'M',
        'other.md',
        'R087',
        'a.png',
        'b.png',
        '',
      ].join('\0'),
    ),
  ).toEqual([{ from: 'old/article.md', to: 'new/article.md' }])
})
