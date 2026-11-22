import { create } from 'zustand'
import { useFsStore } from '../../stores/fs-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { findFileTreeNode } from '../../utils/workspace-tree'
import { defaultDiaryDirectory } from '@shared/personal-diary-source'

/** A dated diary under the diary root: YYYY/MM(-MM)/MMDD_… or MMDD-….md */
export function isRecognizedDiary(relativeToDiaryRoot: string): boolean {
  return /^\d{4}\/\d{2}(?:-\d{2})?\/\d{4}[_-][^/]+\.md$/i.test(relativeToDiaryRoot)
}

/** The active diary project's root and diary directory, or null outside diary projects. */
export function activeDiaryRoot(): { workspacePath: string; diaryRoot: string } | null {
  const ws = useWorkspaceStore.getState()
  const settings = ws.settingsSnapshot
  const ref = ws.activeWorkspaceRef
  if (ref.kind !== 'local' || settings?.settings.type !== 'diary') return null
  const directory = settings.settings.diary?.directory ?? defaultDiaryDirectory
  return { workspacePath: ref.path, diaryRoot: `${ref.path}/${directory}` }
}

/**
 * Renaming or moving a recognized diary so that history and drafting no longer find it needs
 * confirmation (file-view.md 操作规则). Returns false when the user cancels.
 */
export function confirmDiaryPathChange(from: string, to: string): boolean {
  const diary = activeDiaryRoot()
  if (!diary) return true
  const inside = (path: string): string | null =>
    path.startsWith(diary.diaryRoot + '/') ? path.slice(diary.diaryRoot.length + 1) : null
  const before = inside(from)
  if (!before || !isRecognizedDiary(before)) return true
  const after = inside(to)
  if (after && isRecognizedDiary(after)) return true
  return window.confirm(
    `改名或移动后，「${from.split('/').pop()}」将不再被识别为日记：历史日记、今天页和每日起草都不会再找到它。文件内容不变。仍然继续吗？`,
  )
}

/** Expands every collapsed ancestor and selects the path in the file tree. */
export async function revealInFileTree(path: string): Promise<void> {
  const workspacePath = useFsStore.getState().workspacePath
  if (!workspacePath || !path.startsWith(workspacePath + '/')) return
  for (let i = 0; i < 40 && !useFsStore.getState().tree.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  let dir = workspacePath
  const parts = path.slice(workspacePath.length + 1).split('/')
  for (const part of parts.slice(0, -1)) {
    dir = `${dir}/${part}`
    const state = useFsStore.getState()
    if (state.workspacePath !== workspacePath) return
    const node = findFileTreeNode(state.tree, dir)
    if (!node || node.symbolicLink) return
    if (!node.expanded) await state.toggleDir(dir)
  }
  const last = `${workspacePath}/${parts.join('/')}`
  const target = findFileTreeNode(useFsStore.getState().tree, last)
  if (target?.type === 'directory' && !target.expanded) await useFsStore.getState().toggleDir(last)
  useFsStore.getState().setSelectedPath(last)
}

/** Per-file marks for the diary file tree: uncommitted (Git) and AI-changed, not undone. */
export const useDiaryFileBadges = create<{ badges: Record<string, '未上传' | 'AI 改'> }>(() => ({
  badges: {},
}))
