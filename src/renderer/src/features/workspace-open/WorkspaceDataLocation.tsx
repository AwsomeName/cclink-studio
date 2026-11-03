export function WorkspaceDataLocation({ path }: { path: string }): React.ReactElement {
  return (
    <p className="workspace-data-location" title={path}>
      工作空间：{path.split(/[\\/]/).filter(Boolean).at(-1)}
    </p>
  )
}
