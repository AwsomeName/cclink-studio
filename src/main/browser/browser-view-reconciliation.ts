export function shouldDestroyBrowserViewDuringReconcile(options: {
  tabId: string
  viewWorkspaceKey: string | null
  activeWorkspaceKey: string | null
  validTabIds: Set<string>
}): boolean {
  return (
    options.viewWorkspaceKey === options.activeWorkspaceKey &&
    !options.validTabIds.has(options.tabId)
  )
}
