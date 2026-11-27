import { describe, expect, it } from 'vitest'
import {
  affairKey,
  changeSource,
  affairKeywords,
  diffText,
  findMentions,
  groupTodos,
  isStale,
  notStarted,
  parseAffairsSection,
  summarizeAffairs,
  writeAffair,
} from './diary-affairs'

const diary = (rows: string, extra = ''): string => `今日体重：

## 昨日总结

- **眼镜硬件**：喇叭到了一批，另一批预计周五到。

## 今日待做

### 眼镜项目

- [ ] 看第二批喇叭是否到货。
- [x] 核对生产文件。

### Studio

- [ ] 打磨 Studio。

## 今日打卡

【12:11】喇叭到了，16 点之后测试。

另外买了创可贴。
${extra}
## 项目进度与计划

### 眼镜项目

| 事项 | 进展记录 | 计划 |
| --- | --- | --- |
${rows}

### 芯片与基础研究

最近缺少进展。

| 事项 | 进展记录 | 计划 |
| --- | --- | --- |
| FPGA | 已暂缓采购。 | 优先使用现有条件。 |

## 眼镜 PCB 报价对比

| 费用或条件 | 华秋 | 厂家 A |
| --- | ---: | ---: |
| PCB 制板 | 432.70 | 400.00 |
`

const day1 = diary(`| 硬件—喇叭 | 现有两种喇叭。 | 先选型 |
| 硬件—戒指 | 待启动。 | — |
| 统一账号 | 已开始推进。 | 周末联调 |`)
const day2 = diary(`| 硬件-喇叭 | 现有两种喇叭。已采购。 | 到货后统一对比 |
| 硬件—戒指 | 待启动。 | — |
| 统一账号 | 已开始推进。 | 周末联调 |`)
const day3 = diary(`| 硬件—喇叭 | 现有两种喇叭。已采购。 | 到货后统一对比 |
| 硬件—戒指 | 待启动。 | — |`)

describe('parseAffairsSection', () => {
  it('reads groups and item rows, skipping other tables and text', () => {
    const section = parseAffairsSection(day1)
    expect(section?.groups).toEqual(['眼镜项目', '芯片与基础研究'])
    expect(section?.rows.map((row) => [row.group, row.name])).toEqual([
      ['眼镜项目', '硬件—喇叭'],
      ['眼镜项目', '硬件—戒指'],
      ['眼镜项目', '统一账号'],
      ['芯片与基础研究', 'FPGA'],
    ])
    expect(section?.rows[0]).toMatchObject({ progress: '现有两种喇叭。', plan: '先选型' })
  })

  it('returns null without the section', () => {
    expect(parseAffairsSection('## 今日待做\n\n- [ ] 写日记\n')).toBeNull()
  })

  it('finds columns by header name and unescapes pipes', () => {
    const section = parseAffairsSection(
      '## 项目进度与计划\n\n| 事项 | 负责人 | 进展 | 计划 |\n| - | - | - | - |\n| A | 我 | 一\\|二 | 三 |\n',
    )
    // `| - |` is not a separator (needs ---), so it reads as a row named "-".
    expect(section?.rows.find((row) => row.name === 'A')).toMatchObject({
      progress: '一|二',
      plan: '三',
    })
  })
})

describe('affairKey and keywords', () => {
  it('treats dash variants and spaces as the same item', () => {
    expect(affairKey('眼镜项目', '硬件-喇叭')).toBe(affairKey('眼镜项目', '硬件 — 喇叭'))
    expect(affairKey('眼镜项目', '喇叭')).not.toBe(affairKey('Studio', '喇叭'))
  })

  it('drops generic words from the name', () => {
    expect(affairKeywords('硬件—喇叭')).toEqual(['喇叭'])
    expect(affairKeywords('APP 产品-测试台')).toEqual(['APP', '测试台'])
    expect(affairKeywords('项目管理')).toEqual(['项目管理'])
  })

  it('knows not-started progress', () => {
    expect(notStarted('—')).toBe(true)
    expect(notStarted('待启动。')).toBe(true)
    expect(notStarted('待重启，基于 Studio')).toBe(true)
    expect(notStarted('已暂缓采购。')).toBe(false)
  })
})

describe('summarizeAffairs', () => {
  const summary = summarizeAffairs([
    { date: '2026-11-25', path: 'b.md', content: day2 },
    { date: '2026-11-24', path: 'a.md', content: day1 },
    { date: '2026-11-23', path: 'none.md', content: '## 今日打卡\n\n没写表格' },
    { date: '2026-11-26', path: 'c.md', content: day3 },
  ])
  const byName = (name: string) => summary.affairs.find((affair) => affair.name.endsWith(name))!

  it('lines rows up across days and finds the last progress change', () => {
    expect(summary.diariesWithSection).toBe(3)
    expect(summary.latest?.path).toBe('c.md')
    const speaker = byName('喇叭')
    expect(speaker.versions.map((v) => [v.date, v.progressChanged, v.planChanged])).toEqual([
      ['2026-11-24', true, true],
      ['2026-11-25', true, true],
      ['2026-11-26', false, false],
    ])
    expect(speaker.firstSeen).toBe('2026-11-24')
    expect(speaker.lastChange).toBe('2026-11-25')
    expect(speaker.status).toBe('active')
  })

  it('marks not-started and removed items', () => {
    expect(byName('戒指').status).toBe('idle')
    const account = byName('统一账号')
    expect(account.status).toBe('removed')
    expect(account.missingDates).toEqual(['2026-11-26'])
    // Removed items come after the newest diary's rows.
    expect(summary.affairs.at(-1)?.name).toBe('统一账号')
  })

  it('stalls only items in progress', () => {
    expect(isStale(byName('喇叭'), '2026-12-02')).toBe(false)
    expect(isStale(byName('喇叭'), '2026-12-03')).toBe(true)
    expect(isStale(byName('戒指'), '2026-12-30')).toBe(false)
  })
})

describe('who changed a row', () => {
  const row = (progress: string, plan = '') => ({ progress, plan })
  it('tells the draft, you and both apart', () => {
    expect(changeSource(row('一'), row('一'), row('一'))).toBeUndefined()
    expect(changeSource(row('二'), row('一'), row('二'))).toBe('draft')
    expect(changeSource(row('二'), row('一'), row('一'))).toBe('you')
    expect(changeSource(row('三'), row('一'), row('二'))).toBe('both')
    // A row the draft did not have was added by you; a first row the draft wrote is the draft's.
    expect(changeSource(row('一'), null, undefined)).toBe('you')
    expect(changeSource(row('一'), null, row('一'))).toBe('draft')
  })

  it('tags versions only on days whose draft is known', () => {
    const draft3 = day2.replace('已采购。 | 到货后', '已采购。一批已到。 | 到货后')
    const today = draft3.replace('一批已到。', '一批已到，另一批 27 日到。')
    const summary = summarizeAffairs([
      { date: '2026-11-24', path: 'a.md', content: day1 },
      { date: '2026-11-25', path: 'b.md', content: day2 },
      { date: '2026-11-26', path: 'c.md', content: today, draft: draft3 },
    ])
    const speaker = summary.affairs.find((affair) => affair.name.endsWith('喇叭'))!
    expect(speaker.versions.map((version) => version.source)).toEqual([
      undefined,
      undefined,
      'both',
    ])
    expect(speaker.versions[2].drafted?.progress).toBe('现有两种喇叭。已采购。一批已到。')
    // Unchanged rows carry no tag even with a draft.
    const ring = summary.affairs.find((affair) => affair.name.endsWith('戒指'))!
    expect(ring.versions[2].source).toBeUndefined()
  })
})

describe('diffText', () => {
  it('marks added and removed clauses', () => {
    expect(
      diffText(
        '现有两种喇叭。一批已到，另一批待定。',
        '现有两种喇叭。一批已到，另一批预计 27 日到。',
      ),
    ).toEqual([
      { kind: 'same', text: '现有两种喇叭。一批已到，' },
      { kind: 'add', text: '另一批预计 27 日到。' },
      { kind: 'del', text: '另一批待定。' },
    ])
    expect(diffText('先选型', '先选型')).toEqual([{ kind: 'same', text: '先选型' }])
  })
})

describe('findMentions and groupTodos', () => {
  it('finds paragraphs and list items in 打卡 / 待做 / 总结', () => {
    expect(findMentions(day1, ['喇叭'])).toEqual([
      { section: '今日打卡', text: '【12:11】喇叭到了，16 点之后测试。' },
      { section: '今日待做', text: '☐ 看第二批喇叭是否到货。' },
      { section: '昨日总结', text: '眼镜硬件：喇叭到了一批，另一批预计周五到。' },
    ])
    expect(findMentions(day1, [])).toEqual([])
  })

  it('counts the group task list', () => {
    expect(groupTodos(day1, '眼镜项目')).toEqual({ done: 1, total: 2 })
    expect(groupTodos(day1, '其他')).toEqual({ done: 0, total: 0 })
  })
})

describe('writeAffair', () => {
  it('changes only that row and keeps the rest', () => {
    const result = writeAffair(day1, {
      group: '眼镜项目',
      name: '硬件-喇叭',
      progress: '两批都已到货。\n晚上试听',
      plan: '逐板试听 | 换型号复核',
    })
    expect(result.before).toBe('| 硬件—喇叭 | 现有两种喇叭。 | 先选型 |')
    expect(result.after).toBe('| 硬件—喇叭 | 两批都已到货。 晚上试听 | 逐板试听 \\| 换型号复核 |')
    expect(result.content.split('\n')[result.line - 1]).toBe(result.after)
    expect(result.content.replace(result.after, result.before!)).toBe(day1)
    expect(parseAffairsSection(result.content)?.rows[0].plan).toBe('逐板试听 | 换型号复核')
  })

  it('adds a missing row to its group table', () => {
    const result = writeAffair(day1, {
      group: '芯片与基础研究',
      name: '可视化',
      progress: '开始了',
      plan: '',
    })
    expect(result.before).toBeNull()
    expect(result.content.split('\n')[result.line - 1]).toBe('| 可视化 | 开始了 |  |')
    expect(parseAffairsSection(result.content)?.rows.map((row) => row.name)).toContain('可视化')
    expect(result.content).toContain('## 眼镜 PCB 报价对比')
  })

  it('adds a missing group at the end of the section', () => {
    const result = writeAffair(day1, { group: 'Chatcc', name: 'Agent', progress: '一', plan: '二' })
    const section = parseAffairsSection(result.content)
    expect(section?.groups).toEqual(['眼镜项目', '芯片与基础研究', 'Chatcc'])
    expect(result.content.split('\n')[result.line - 1]).toBe('| Agent | 一 | 二 |')
    expect(result.content.indexOf('### Chatcc')).toBeLessThan(
      result.content.indexOf('## 眼镜 PCB 报价对比'),
    )
  })

  it('adds the section to a diary without one', () => {
    const result = writeAffair('# 1127\n\n正文\n', {
      group: '眼镜项目',
      name: '喇叭',
      progress: '到了',
      plan: '',
    })
    expect(result.content.split('\n')[result.line - 1]).toBe('| 喇叭 | 到了 |  |')
    expect(parseAffairsSection(result.content)?.rows).toEqual([
      { group: '眼镜项目', name: '喇叭', progress: '到了', plan: '' },
    ])
  })
})
