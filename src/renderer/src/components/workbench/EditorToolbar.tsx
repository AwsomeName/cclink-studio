import { type Editor, useEditorState } from '@tiptap/react'
import { IconLink } from '../common/Icons'

interface EditorToolbarProps {
  editor: Editor | null
  filePath?: string
  dirty: boolean
  diagnosticsCount: number
  onSave: () => void
  onInsertLink: () => void
  onInsertImage: () => void
  onInsertTable: () => void
  onEditImage: () => void
}

interface ToolbarButton {
  label: React.ReactNode
  title: string
  isActive?: () => boolean
  onClick: () => void
  disabled?: boolean
}

export function EditorToolbar({
  editor,
  filePath,
  dirty,
  diagnosticsCount,
  onSave,
  onInsertLink,
  onInsertImage,
  onInsertTable,
  onEditImage,
}: EditorToolbarProps): React.ReactElement {
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  })
  const buttons: ToolbarButton[] = editor
    ? [
        {
          label: '↶',
          title: '撤销',
          onClick: () => editor.chain().focus().undo().run(),
          disabled: !editor.can().undo(),
        },
        {
          label: '↷',
          title: '重做',
          onClick: () => editor.chain().focus().redo().run(),
          disabled: !editor.can().redo(),
        },
        {
          label: 'B',
          title: '粗体 (⌘B)',
          isActive: () => editor.isActive('bold'),
          onClick: () => editor.chain().focus().toggleBold().run(),
        },
        {
          label: 'I',
          title: '斜体 (⌘I)',
          isActive: () => editor.isActive('italic'),
          onClick: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          label: 'S',
          title: '删除线',
          isActive: () => editor.isActive('strike'),
          onClick: () => editor.chain().focus().toggleStrike().run(),
        },
        {
          label: '</>',
          title: '行内代码',
          isActive: () => editor.isActive('code'),
          onClick: () => editor.chain().focus().toggleCode().run(),
        },
        {
          label: '•',
          title: '无序列表',
          isActive: () => editor.isActive('bulletList'),
          onClick: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          label: '1.',
          title: '有序列表',
          isActive: () => editor.isActive('orderedList'),
          onClick: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
          label: '☐',
          title: '任务列表',
          isActive: () => editor.isActive('taskList'),
          onClick: () => editor.chain().focus().toggleTaskList().run(),
        },
        {
          label: '❝',
          title: '引用',
          isActive: () => editor.isActive('blockquote'),
          onClick: () => editor.chain().focus().toggleBlockquote().run(),
        },
        {
          label: '{ }',
          title: '代码块',
          isActive: () => editor.isActive('codeBlock'),
          onClick: () => editor.chain().focus().toggleCodeBlock().run(),
        },
        {
          label: '―',
          title: '插入分隔线',
          onClick: () => editor.chain().focus().setHorizontalRule().run(),
        },
        {
          label: <IconLink size={13} />,
          title: '插入链接',
          isActive: () => editor.isActive('link'),
          onClick: onInsertLink,
        },
        {
          label: '▧',
          title: '插入图片',
          onClick: onInsertImage,
        },
        {
          label: '▦',
          title: '插入表格',
          onClick: onInsertTable,
        },
      ]
    : []
  const headingLevel = editor?.getAttributes('heading').level as number | undefined
  const codeLanguage = (editor?.getAttributes('codeBlock').language as string | undefined) ?? ''
  const inTable = editor?.isActive('table') ?? false
  const imageSelected = editor?.isActive('image') ?? false

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <select
          className="toolbar-select heading"
          value={headingLevel ? String(headingLevel) : 'paragraph'}
          title="段落与标题"
          onChange={(event) => {
            if (!editor) return
            const value = event.target.value
            if (value === 'paragraph') editor.chain().focus().setParagraph().run()
            else {
              editor
                .chain()
                .focus()
                .setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })
                .run()
            }
          }}
        >
          <option value="paragraph">正文</option>
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
          <option value="4">H4</option>
          <option value="5">H5</option>
          <option value="6">H6</option>
        </select>
        {buttons.map((button) => (
          <button
            type="button"
            key={button.title}
            title={button.title}
            className={button.isActive?.() ? 'is-active' : ''}
            onClick={button.onClick}
            disabled={button.disabled}
          >
            {button.label}
          </button>
        ))}
        {editor?.isActive('codeBlock') && (
          <select
            className="toolbar-select language"
            value={codeLanguage}
            title="代码块语言"
            onChange={(event) =>
              editor
                .chain()
                .focus()
                .updateAttributes('codeBlock', { language: event.target.value })
                .run()
            }
          >
            <option value="">纯文本</option>
            <option value="bash">Bash</option>
            <option value="css">CSS</option>
            <option value="html">HTML</option>
            <option value="javascript">JavaScript</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
            <option value="python">Python</option>
            <option value="sql">SQL</option>
            <option value="typescript">TypeScript</option>
            <option value="yaml">YAML</option>
          </select>
        )}
      </div>

      {inTable && editor && (
        <div className="toolbar-context-group" aria-label="表格操作">
          <button
            type="button"
            title="前面插入列"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
          >
            +列←
          </button>
          <button
            type="button"
            title="后面插入列"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            列→+
          </button>
          <button
            type="button"
            title="前面插入行"
            onClick={() => editor.chain().focus().addRowBefore().run()}
          >
            +行↑
          </button>
          <button
            type="button"
            title="后面插入行"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            行↓+
          </button>
          <button
            type="button"
            title="删除当前列"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            删列
          </button>
          <button
            type="button"
            title="删除当前行"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            删行
          </button>
          <button
            type="button"
            title="删除表格"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            删表
          </button>
        </div>
      )}

      {imageSelected && (
        <button type="button" className="toolbar-context-command" onClick={onEditImage}>
          编辑图片
        </button>
      )}

      {filePath && <span className="toolbar-filepath">{filePath}</span>}
      {diagnosticsCount > 0 && (
        <span className="toolbar-diagnostics" title="文档包含兼容性提示">
          {diagnosticsCount} 项提示
        </span>
      )}
      <button
        type="button"
        className={`toolbar-save ${dirty ? 'dirty' : ''}`}
        title={filePath ? '保存 (⌘S)' : '另存为 (⌘S)'}
        onClick={onSave}
        disabled={!dirty && Boolean(filePath)}
      >
        {dirty ? (filePath ? '保存' : '另存为') : filePath ? '已保存' : '另存为'}
      </button>
    </div>
  )
}
