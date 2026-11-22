import { useAgentStore } from '../../stores/agent-store'
import { useUIStore } from '../../stores/ui-store'
import { AGENT_FOCUS_COMPOSER_EVENT } from '../markdown/markdown-navigation'

/** Edit requests ask the AI to confirm multi-file, delete or rename changes first (§8A). */
export const editRule =
  '（如需修改多个文件、删除或重命名，请先列出将修改的文件清单，等我确认后再改；改完说明改了什么。）'

/** Opens the conversation with a prefilled request; the user finishes and sends it. */
export function askAi(text: string): void {
  useUIStore.getState().setAgentPanelMode('right', 'user')
  useAgentStore.getState().setInput(text)
  window.setTimeout(() => {
    window.dispatchEvent(new Event(AGENT_FOCUS_COMPOSER_EVENT))
    // Continue typing after the prefilled file reference.
    const input = document.activeElement
    if (input instanceof HTMLTextAreaElement) input.setSelectionRange(text.length, text.length)
  }, 50)
}
