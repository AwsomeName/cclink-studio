import { useCallback, useMemo, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { AgentMessage } from '../../types'

export interface ComposerHistoryNavigation {
  index: number | null
  draft: string
}

export function collectComposerHistory(messages: AgentMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === 'user' && message.rawText.trim() ? [message.rawText] : [],
  )
}

export function navigateComposerHistory(
  entries: string[],
  navigation: ComposerHistoryNavigation,
  currentValue: string,
  direction: 'older' | 'newer',
): { navigation: ComposerHistoryNavigation; value: string } | null {
  if (entries.length === 0) return null

  if (direction === 'older') {
    const draft = navigation.index === null ? currentValue : navigation.draft
    const index = navigation.index === null ? entries.length - 1 : Math.max(0, navigation.index - 1)
    return { navigation: { index, draft }, value: entries[index] }
  }

  if (navigation.index === null) return null
  if (navigation.index < entries.length - 1) {
    const index = navigation.index + 1
    return {
      navigation: { ...navigation, index },
      value: entries[index],
    }
  }
  return {
    navigation: { index: null, draft: '' },
    value: navigation.draft,
  }
}

export function canStartComposerHistory(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): boolean {
  return value.length === 0 || (selectionStart === 0 && selectionEnd === 0)
}

export function useComposerHistory({
  conversationId,
  messages,
  value,
  onValueChange,
  textareaRef,
}: {
  conversationId: string
  messages: AgentMessage[]
  value: string
  onValueChange: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}): (event: KeyboardEvent<HTMLTextAreaElement>) => boolean {
  const entries = useMemo(() => collectComposerHistory(messages), [messages])
  const revision = `${conversationId}:${entries.length}:${messages.at(-1)?.id ?? ''}`
  const stateRef = useRef<{
    revision: string
    navigation: ComposerHistoryNavigation
  }>({
    revision,
    navigation: { index: null, draft: '' },
  })

  if (stateRef.current.revision !== revision) {
    stateRef.current = {
      revision,
      navigation: { index: null, draft: '' },
    }
  }

  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return false
      }

      const navigation = stateRef.current.navigation
      const isBrowsing = navigation.index !== null
      if (
        event.key === 'ArrowUp' &&
        !isBrowsing &&
        !canStartComposerHistory(
          value,
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        )
      ) {
        return false
      }
      if (event.key === 'ArrowDown' && !isBrowsing) return false

      const result = navigateComposerHistory(
        entries,
        navigation,
        value,
        event.key === 'ArrowUp' ? 'older' : 'newer',
      )
      if (!result) return false

      event.preventDefault()
      stateRef.current.navigation = result.navigation
      onValueChange(result.value)
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(result.value.length, result.value.length)
      })
      return true
    },
    [entries, onValueChange, textareaRef, value],
  )
}
