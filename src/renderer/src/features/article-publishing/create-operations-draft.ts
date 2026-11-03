import { useFsStore } from '../../stores/fs-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

/** Ordinary create-only file creation; no account selection or publication authorization. */
export async function createOperationsDraft(): Promise<void> {
  const workspace = useWorkspaceStore.getState()
  if (workspace.activeWorkspaceRef.kind !== 'local') throw new Error('请先打开本地工作空间')
  const ref = workspace.activeWorkspaceRef
  const generation = workspace.generation
  const directory = `${ref.path}/运营/原稿`
  await window.cclinkStudio.fs.mkdir(directory)
  if (useWorkspaceStore.getState().generation !== generation)
    throw new Error('工作空间已切换，请重试')
  const title = `运营稿-${crypto.randomUUID().slice(0, 8)}.md`
  const filePath = `${directory}/${title}`
  await window.cclinkStudio.fs.createFile(filePath)
  if (useWorkspaceStore.getState().generation !== generation) return
  useTabStore.getState().openTab({ type: 'editor', title, filePath, workspaceRef: ref, icon: '📄' })
  await useFsStore.getState().refreshWorkspace()
}
