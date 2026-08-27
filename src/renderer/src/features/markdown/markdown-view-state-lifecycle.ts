type MarkdownViewStateFlusher = () => void

const markdownViewStateFlushers = new Set<MarkdownViewStateFlusher>()

/**
 * Markdown DOM 滚动位置仍在组件内防抖时，允许工作区切换边界强制采样。
 * Store 仍是唯一持久化状态所有者，这里只管理可见编辑器的生命周期回调。
 */
export function registerMarkdownViewStateFlusher(flusher: MarkdownViewStateFlusher): () => void {
  markdownViewStateFlushers.add(flusher)
  return () => markdownViewStateFlushers.delete(flusher)
}

export function flushMountedMarkdownViewStates(): void {
  for (const flusher of [...markdownViewStateFlushers]) flusher()
}
