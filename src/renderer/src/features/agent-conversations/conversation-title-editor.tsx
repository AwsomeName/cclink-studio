import { useState } from 'react'

export function ConversationTitleEditor({
  title,
  annotation,
  onSave,
  onCancel,
}: {
  title: string
  annotation?: string
  onSave: (title: string, note: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(title)
  const [note, setNote] = useState(annotation ?? '')
  return (
    <form
      className="conversation-inline-form"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) onSave(name.trim(), note.trim())
      }}
    >
      <label>
        会话标题
        <input
          autoFocus
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        个人标注
        <input maxLength={80} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div>
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button disabled={!name.trim()}>保存</button>
      </div>
    </form>
  )
}
