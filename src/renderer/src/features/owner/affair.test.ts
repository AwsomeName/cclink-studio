import { describe, expect, it } from 'vitest'
import { verify, next, type Affair } from './affair'
const a: Affair = {
  id: 'f514fd92-9acc-4fc7-a8a7-c65ccb770784',
  title: '芯片调研',
  goal: '摘出架构说明',
  sources: [
    { name: '处理器', text: '甲核有两级流水线。' },
    { name: '系统', text: '乙芯片包含存储器。' },
  ],
  updated: 0,
  confirmed: true,
  attempt: null,
  run: null,
  issue: '',
  result: null,
  method: 'agent',
}
describe('事务资料与交付的边界', () => {
  it('只收来自对应材料的逐字引文，不能挪用或编造', () => {
    expect(() =>
      verify(a, [
        { index: 1, quote: '存储器' },
        { index: 2, quote: '存储器' },
      ]),
    ).toThrow()
    expect(() =>
      verify(a, [
        { index: 1, quote: '流水线' },
        { index: 1, quote: '流水线' },
      ]),
    ).toThrow()
    expect(() =>
      verify(a, [
        { index: 1, quote: '四级' },
        { index: 2, quote: '存储器' },
      ]),
    ).toThrow()
    expect(
      verify(a, [
        { index: 2, quote: '存储器' },
        { index: 1, quote: '流水线' },
      ])[0].index,
    ).toBe(1)
  })
  it('只提示未提供的那份材料，模型失败不冒充已交付', () => {
    expect(next({ ...a, sources: [a.sources[0], { ...a.sources[1], text: '' }] })).toEqual([
      '等我提供资料',
      '缺：系统',
    ])
    expect(next({ ...a, issue: '没有真实回执' })[0]).toBe('需要处理')
  })
})
