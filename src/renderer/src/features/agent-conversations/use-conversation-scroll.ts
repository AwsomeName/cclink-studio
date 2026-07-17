import {
  useCallback,
  useLayoutEffect,
  useRef,
  type PointerEventHandler,
  type RefObject,
  type TouchEventHandler,
  type UIEventHandler,
  type WheelEventHandler,
} from 'react'

const BOTTOM_THRESHOLD = 48
const scrollPositions = new Map<string, ConversationScrollPosition>()

export interface ConversationScrollPosition {
  scrollTop: number
  atBottom: boolean
}

interface ScrollDimensions {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function isConversationNearBottom(dimensions: ScrollDimensions): boolean {
  return (
    dimensions.scrollHeight - dimensions.clientHeight - dimensions.scrollTop <= BOTTOM_THRESHOLD
  )
}

export function resolveConversationScrollTop(
  position: ConversationScrollPosition | undefined,
  dimensions: Pick<ScrollDimensions, 'scrollHeight' | 'clientHeight'>,
): number {
  const maximum = Math.max(0, dimensions.scrollHeight - dimensions.clientHeight)
  if (!position || position.atBottom) return maximum
  return Math.min(Math.max(0, position.scrollTop), maximum)
}

export interface ConversationScrollController {
  listRef: RefObject<HTMLDivElement | null>
  onScroll: UIEventHandler<HTMLDivElement>
  onWheel: WheelEventHandler<HTMLDivElement>
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onTouchStart: TouchEventHandler<HTMLDivElement>
  followLatest: () => void
}

/** Keeps reading position per conversation and only follows output while already at the bottom. */
export function useConversationScroll(
  conversationKey: string,
  contentRevision: unknown,
): ConversationScrollController {
  const listRef = useRef<HTMLDivElement>(null)
  const followsLatestRef = useRef(true)
  const restoredKeyRef = useRef<string | null>(null)
  const restoringRef = useRef(false)
  const pendingRestoreTopRef = useRef<number | null>(null)
  const userScrollIntentRef = useRef(false)
  const userScrollTimerRef = useRef<number | null>(null)
  const restoreFrameRef = useRef<number | null>(null)
  const followFrameRef = useRef<number | null>(null)

  const rememberPosition = useCallback(
    (element: HTMLDivElement) => {
      if (restoringRef.current || !userScrollIntentRef.current) return
      const atBottom = isConversationNearBottom(element)
      pendingRestoreTopRef.current = null
      scrollPositions.set(conversationKey, {
        scrollTop: element.scrollTop,
        atBottom,
      })
      followsLatestRef.current = atBottom
      if (userScrollTimerRef.current !== null) window.clearTimeout(userScrollTimerRef.current)
      userScrollTimerRef.current = window.setTimeout(() => {
        userScrollIntentRef.current = false
        userScrollTimerRef.current = null
      }, 400)
    },
    [conversationKey],
  )

  const beginUserScroll = useCallback(() => {
    userScrollIntentRef.current = true
    if (userScrollTimerRef.current !== null) window.clearTimeout(userScrollTimerRef.current)
    userScrollTimerRef.current = null
    pendingRestoreTopRef.current = null
    followsLatestRef.current = false
  }, [])

  const handlePointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX >= bounds.right - 18) beginUserScroll()
    },
    [beginUserScroll],
  )

  const followLatest = useCallback(() => {
    pendingRestoreTopRef.current = null
    followsLatestRef.current = true
    const element = listRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    scrollPositions.set(conversationKey, { scrollTop: element.scrollTop, atBottom: true })
  }, [conversationKey])

  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return

    userScrollIntentRef.current = false
    if (userScrollTimerRef.current !== null) {
      window.clearTimeout(userScrollTimerRef.current)
      userScrollTimerRef.current = null
    }
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
    const saved = scrollPositions.get(conversationKey)
    restoringRef.current = true
    pendingRestoreTopRef.current = saved && !saved.atBottom ? saved.scrollTop : null
    element.scrollTop = resolveConversationScrollTop(saved, element)
    followsLatestRef.current = saved?.atBottom ?? true
    restoredKeyRef.current = conversationKey

    // Two frames cover deferred workspace hydration without treating our own scroll as user intent.
    restoreFrameRef.current = requestAnimationFrame(() => {
      if (restoredKeyRef.current !== conversationKey) return
      element.scrollTop = resolveConversationScrollTop(saved, element)
      restoreFrameRef.current = requestAnimationFrame(() => {
        if (restoredKeyRef.current !== conversationKey) return
        restoringRef.current = false
        const pendingTop = pendingRestoreTopRef.current
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
        if (pendingTop !== null && maximum >= pendingTop) pendingRestoreTopRef.current = null
        restoreFrameRef.current = null
      })
    })

    return () => {
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current)
        restoreFrameRef.current = null
      }
    }
  }, [conversationKey])

  useLayoutEffect(() => {
    if (restoredKeyRef.current !== conversationKey) return
    const pendingTop = pendingRestoreTopRef.current
    if (pendingTop !== null) {
      const element = listRef.current
      if (!element) return
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      element.scrollTop = Math.min(pendingTop, maximum)
      if (!restoringRef.current && maximum >= pendingTop) pendingRestoreTopRef.current = null
      return
    }
    if (!followsLatestRef.current) return
    if (followFrameRef.current !== null) cancelAnimationFrame(followFrameRef.current)
    followFrameRef.current = requestAnimationFrame(() => {
      if (restoredKeyRef.current !== conversationKey || !followsLatestRef.current) return
      const element = listRef.current
      if (!element) return
      element.scrollTop = element.scrollHeight
      scrollPositions.set(conversationKey, { scrollTop: element.scrollTop, atBottom: true })
      followFrameRef.current = null
    })

    return () => {
      if (followFrameRef.current !== null) {
        cancelAnimationFrame(followFrameRef.current)
        followFrameRef.current = null
      }
    }
  }, [contentRevision, conversationKey])

  useLayoutEffect(
    () => () => {
      if (userScrollTimerRef.current !== null) window.clearTimeout(userScrollTimerRef.current)
    },
    [],
  )

  return {
    listRef,
    onScroll: (event) => rememberPosition(event.currentTarget),
    onWheel: beginUserScroll,
    onPointerDown: handlePointerDown,
    onTouchStart: beginUserScroll,
    followLatest,
  }
}

export function resetConversationScrollMemoryForTests(): void {
  scrollPositions.clear()
}
