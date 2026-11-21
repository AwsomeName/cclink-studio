import { describe, expect, it } from 'vitest'
import { sourceWindow } from './source-window'
it('lets A follow a register from its declaration to a later assignment using the real file line', () => {
  const lines = Array.from({ length: 900 }, (_, i) => '// subsequent source line ' + (i + 1))
  lines[5] = 'logic flag_q;'
  lines[745] = '      flag_q    <= next_value;'
  const raw = lines.join('\n')
  const first = sourceWindow(raw, 'flag_q')
  expect(first.text).not.toContain('next_value')
  expect(first.locations).toContain('@L746 flag_q    <= next_value;')
  const next = sourceWindow(raw, '@L746')
  expect(next.text.split('\n')[746 - next.startLine]).toBe(lines[745])
  expect(sourceWindow(raw, 'flag_q <= next_value').matchedAnchor).toBe(true)
  expect(() => sourceWindow(raw, '@L999')).toThrow('末尾')
})

import { renamedRepositoryTarget } from './read-public-readme'
describe('GitHub rename redirect', () => {
  const base = 'https://api.github.com/repos/openhwgroup/cva6/readme'
  it('follows only a same-host /repositories/<id> hop', () => {
    expect(
      renamedRepositoryTarget('https://api.github.com/repositories/118652371/readme', base),
    ).toBe('https://api.github.com/repositories/118652371/readme')
    expect(renamedRepositoryTarget('/repositories/1/commits?per_page=1', base)).toBe(
      'https://api.github.com/repositories/1/commits?per_page=1',
    )
    expect(renamedRepositoryTarget('https://evil.example/repositories/1', base)).toBeUndefined()
    expect(renamedRepositoryTarget('https://api.github.com/user', base)).toBeUndefined()
    expect(renamedRepositoryTarget(null, base)).toBeUndefined()
  })
})
