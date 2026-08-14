import type { KeyChord } from '@shared/keybindings'
import type { MarkdownEditorAction } from '../../features/context-actions/editor-context-surface'
import { getEditorContextSurface } from '../../features/context-actions/editor-context-surface'
import type { Command } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'

interface MarkdownCommandDefinition {
  id: string
  label: string
  action: MarkdownEditorAction
  bindings: KeyChord[]
}

const definitions: MarkdownCommandDefinition[] = [
  {
    id: 'markdown.undo',
    label: 'Markdown：撤销',
    action: 'undo',
    bindings: [{ code: 'KeyZ', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.redo',
    label: 'Markdown：重做',
    action: 'redo',
    bindings: [
      { code: 'KeyZ', modifiers: ['primary', 'shift'] },
      { code: 'KeyY', modifiers: ['primary'] },
    ],
  },
  {
    id: 'markdown.bold',
    label: 'Markdown：粗体',
    action: 'bold',
    bindings: [{ code: 'KeyB', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.italic',
    label: 'Markdown：斜体',
    action: 'italic',
    bindings: [{ code: 'KeyI', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.strike',
    label: 'Markdown：删除线',
    action: 'strike',
    bindings: [
      { code: 'KeyS', modifiers: ['primary', 'shift'] },
      { code: 'KeyX', modifiers: ['primary', 'shift'] },
    ],
  },
  {
    id: 'markdown.inlineCode',
    label: 'Markdown：行内代码',
    action: 'inline-code',
    bindings: [{ code: 'KeyE', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.bulletList',
    label: 'Markdown：无序列表',
    action: 'bullet-list',
    bindings: [{ code: 'Digit8', modifiers: ['primary', 'shift'] }],
  },
  {
    id: 'markdown.orderedList',
    label: 'Markdown：有序列表',
    action: 'ordered-list',
    bindings: [{ code: 'Digit7', modifiers: ['primary', 'shift'] }],
  },
  {
    id: 'markdown.taskList',
    label: 'Markdown：任务列表',
    action: 'task-list',
    bindings: [{ code: 'Digit9', modifiers: ['primary', 'shift'] }],
  },
  {
    id: 'markdown.blockquote',
    label: 'Markdown：引用',
    action: 'blockquote',
    bindings: [{ code: 'KeyB', modifiers: ['primary', 'shift'] }],
  },
  {
    id: 'markdown.codeBlock',
    label: 'Markdown：代码块',
    action: 'code-block',
    bindings: [{ code: 'KeyC', modifiers: ['primary', 'alt'] }],
  },
  {
    id: 'markdown.hardBreak',
    label: 'Markdown：硬换行',
    action: 'hard-break',
    bindings: [{ code: 'Enter', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.link',
    label: 'Markdown：插入或编辑链接',
    action: 'link',
    bindings: [{ code: 'KeyK', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.paragraph',
    label: 'Markdown：正文',
    action: 'paragraph',
    bindings: [{ code: 'Digit0', modifiers: ['primary', 'alt'] }],
  },
  ...([1, 2, 3, 4, 5, 6] as const).map(
    (level): MarkdownCommandDefinition => ({
      id: `markdown.heading${level}`,
      label: `Markdown：${level} 级标题`,
      action: `heading-${level}` as MarkdownEditorAction,
      bindings: [{ code: `Digit${level}`, modifiers: ['primary', 'alt'] }],
    }),
  ),
  {
    id: 'markdown.indentList',
    label: 'Markdown：增加列表层级',
    action: 'indent-list',
    bindings: [{ code: 'BracketRight', modifiers: ['primary'] }],
  },
  {
    id: 'markdown.outdentList',
    label: 'Markdown：减少列表层级',
    action: 'outdent-list',
    bindings: [{ code: 'BracketLeft', modifiers: ['primary'] }],
  },
]

function getActiveMarkdownSurface() {
  const tab = useTabStore.getState().getActiveTab()
  if (tab?.type !== 'editor') return null
  const surface = getEditorContextSurface(tab.id)
  return surface?.runMarkdownAction ? surface : null
}

export function createMarkdownCommands(): Command[] {
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    category: 'Markdown',
    configurable: true,
    shortcutPolicy: {
      scope: 'markdown',
      inputPolicy: 'allow',
      defaultBindings: definition.bindings,
    },
    enabled: () => ({
      enabled: Boolean(getActiveMarkdownSurface()),
      reason: '当前不是可编辑的 Markdown 文档',
    }),
    action: () => {
      const surface = getActiveMarkdownSurface()
      if (!surface?.runMarkdownAction?.(definition.action)) {
        throw new Error('当前 Markdown 操作不可用')
      }
    },
  }))
}
