// 仅拥有活动拖拽的释放入口，不保存布局或工作空间状态。
let activeCancel: (() => void) | null = null

export function cancelActivePanelResize(): void {
  const cancel = activeCancel
  activeCancel = null
  cancel?.()
}

export function registerPanelResizeCancel(cancel: () => void): () => void {
  cancelActivePanelResize()
  activeCancel = cancel
  return () => {
    if (activeCancel === cancel) activeCancel = null
  }
}
