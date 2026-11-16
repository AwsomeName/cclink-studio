import { executeTtsCommand } from './tts-commands'
import type { CommandContext } from '../context-actions/context-target'

export function TtsIcon(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M11 4 5 9H2v6h3l6 5V4Z" />
      <path d="M15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16" />
    </svg>
  )
}

export function TtsButton({
  selection = false,
  context,
  label,
}: {
  selection?: boolean
  context?: CommandContext
  label?: string
}): React.ReactElement {
  const title = label ?? (selection ? '朗读选区' : '朗读')
  return (
    <button
      type="button"
      className="tts-source-button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void executeTtsCommand(selection ? 'tts.readSelection' : 'tts.read', context)}
    >
      <TtsIcon />
      <span>{title}</span>
    </button>
  )
}
