import { describe, expect, it, vi } from 'vitest'
import { requireXiaohongshuDraft, type XiaohongshuDraftSnapshot } from './xiaohongshu-local-draft'
import { clickXiaohongshuControl, findXiaohongshuControl } from './xiaohongshu-publish-control'

const expected = {
  draftId: '071c3c48-ca3e-49c3-bb52-a43c1a73def8',
  uid: '65361844000000000301e75a',
  title: '研发日记',
}
const fixture = (): XiaohongshuDraftSnapshot => ({
  ...expected,
  description: '原文',
  descriptionHtml: '<p>原文</p>',
  savedAt: 1,
  images: [
    { fileId: 'spectrum/example', name: '01.png', width: 1086, height: 1448, uploaded: true },
  ],
})
describe('小红书原账号本地草稿', () => {
  it('requires the exact ID even when another draft has the same title', () => {
    expect(requireXiaohongshuDraft([fixture()], expected).draftId).toBe(expected.draftId)
    expect(() => requireXiaohongshuDraft([{ ...fixture(), draftId: 'other' }], expected)).toThrow(
      '不存在',
    )
    expect(() => requireXiaohongshuDraft([fixture(), fixture()], expected)).toThrow('不唯一')
  })
  it('does not accept a same-title draft owned by another account', () => {
    expect(() => requireXiaohongshuDraft([{ ...fixture(), uid: 'other' }], expected)).toThrow(
      '账号',
    )
    expect(() => requireXiaohongshuDraft([{ ...fixture(), title: '已改标题' }], expected)).toThrow(
      '标题',
    )
  })
  it('does not call an unfinished image saved', () => {
    const draft = fixture()
    draft.images[0].uploaded = false
    expect(() => requireXiaohongshuDraft([draft], expected)).toThrow('未完成')
    draft.images[0].uploaded = true
    draft.images[0].fileId = ''
    expect(() => requireXiaohongshuDraft([draft], expected)).toThrow('无法核验')
  })
})
function controlFixture() {
  const button = (backendNodeId: number, label: string) => ({
    nodeName: 'BUTTON',
    backendNodeId,
    attributes: ['type', 'button'],
    children: [{ nodeName: '#text', backendNodeId: backendNodeId + 10, nodeValue: label }],
  })
  const host = {
    nodeName: 'XHS-PUBLISH-BTN',
    backendNodeId: 1,
    attributes: [
      'save-text',
      '暂存离开',
      'submit-text',
      '发布',
      'save-disabled',
      'false',
      'submit-disabled',
      'false',
      'submit-loading',
      'false',
    ],
    shadowRoots: [
      {
        nodeName: '#document-fragment',
        backendNodeId: 2,
        children: [button(3, '暂存离开'), button(4, '发布')],
      },
    ],
  }
  const root = { nodeName: 'BODY', backendNodeId: 0, children: [button(9, '发布'), host] }
  return { root, host }
}
describe('小红书独立保存与发布控件', () => {
  it('selects only the exact requested button inside the platform component', () => {
    const { root } = controlFixture()
    expect(findXiaohongshuControl(root, 'save').backendNodeId).toBe(3)
    expect(findXiaohongshuControl(root, 'publish').backendNodeId).toBe(4)
  })
  it('rejects duplicate components, disabled controls and changed labels', () => {
    const { root, host } = controlFixture()
    root.children.push(host)
    expect(() => findXiaohongshuControl(root, 'save')).toThrow('唯一')
    root.children.pop()
    host.attributes[5] = 'true'
    expect(() => findXiaohongshuControl(root, 'save')).toThrow('可用性')
    host.attributes[5] = 'false'
    host.attributes[1] = '发布'
    expect(() => findXiaohongshuControl(root, 'save')).toThrow('文案')
  })
})

it('does not dispatch a physical click when cancelled after the real hit test', async () => {
  const { root } = controlFixture()
  const click = vi.fn()
  const detach = vi.fn()
  const page = {
    url: () => 'https://creator.xiaohongshu.com/publish/publish?target=image',
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      scrollIntoViewIfNeeded: async () => {},
    }),
    context: () => ({
      newCDPSession: async () => ({
        detach,
        send: async (method: string) => {
          if (method === 'DOM.getDocument') return { root }
          if (method === 'DOM.getContentQuads') return { quads: [[0, 0, 100, 0, 100, 40, 0, 40]] }
          return { backendNodeId: 4 }
        },
      }),
    }),
    mouse: { click },
  }
  let checks = 0
  await expect(
    clickXiaohongshuControl(page as never, 'publish', () => {
      if (++checks === 2) throw new Error('cancelled')
    }),
  ).rejects.toThrow('cancelled')
  expect(click).not.toHaveBeenCalled()
  expect(detach).toHaveBeenCalledOnce()
})
