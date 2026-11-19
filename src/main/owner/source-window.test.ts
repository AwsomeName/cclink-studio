import { expect, it } from 'vitest'
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
