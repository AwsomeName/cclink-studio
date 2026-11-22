import { useEffect, useState } from 'react'
import {
  defaultDiaryDirectory,
  defaultDiaryTimezone,
  diaryDateParts,
  diaryDayLocation,
} from '@shared/personal-diary-source'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import { showWorkspaceHome } from './workspace-home-navigation'
import { revealInFileTree, useDiaryFileBadges } from './diary-files'
import './diary-files.css'

type Found = { path: string; name: string } | null

/** Quick entries above the My Space file tree, default positioning and status marks. */
export function DiaryFileShortcuts(): React.ReactElement | null {
  const ref = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const settings = useWorkspaceStore((state) => state.settingsSnapshot)
  const [today, setToday] = useState<Found>(null)
  const [weekly, setWeekly] = useState<Found>(null)
  const [message, setMessage] = useState('')
  const workspacePath = ref.kind === 'local' ? ref.path : null
  const directory = settings?.settings.diary?.directory ?? defaultDiaryDirectory
  const timezone = settings?.settings.diary?.timezone ?? defaultDiaryTimezone
  const diaryRoot = workspacePath ? `${workspacePath}/${directory}` : ''
  const day = diaryDayLocation(diaryDateParts(timezone, new Date()))
  const monthDir = `${diaryRoot}/${day.folder}`

  useEffect(() => {
    if (!workspacePath) return
    let alive = true
    void (async () => {
      const fs = window.cclinkStudio.fs
      const month = await fs.readDir(monthDir).catch(() => [])
      const todayEntry = month.find((entry) => entry.type === 'file' && day.matchesName(entry.name))
      const year = day.folder.split('/')[0]
      const plans = (await fs.readDir(`${diaryRoot}/${year}/周计划`).catch(() => []))
        .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
      if (!alive) return
      setToday(todayEntry ? { path: todayEntry.path, name: todayEntry.name } : null)
      setWeekly(plans[0] ? { path: plans[0].path, name: plans[0].name } : null)
      // Opening 文件 without an open document: show this month with today's diary selected.
      const active = useTabStore
        .getState()
        .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId)
      if (!active?.filePath?.startsWith(workspacePath + '/'))
        await revealInFileTree(todayEntry ? todayEntry.path : month.length ? monthDir : diaryRoot)
    })()
    return () => {
      alive = false
    }
  }, [workspacePath, diaryRoot, monthDir])

  // Status marks: uncommitted Git changes and AI changes that were not undone.
  useEffect(() => {
    if (!workspacePath) return
    let alive = true
    const load = async (): Promise<void> => {
      const badges: Record<string, '未上传' | 'AI 改'> = {}
      // Local Git status works without a remote; paths are relative to the repository root.
      const git = await window.cclinkStudio.git.getSnapshot(workspacePath).catch(() => null)
      const repoRoot = git?.repositoryRoot ?? workspacePath
      for (const change of git?.changes ?? []) badges[`${repoRoot}/${change.path}`] = '未上传'
      const reports = await window.cclinkStudio.workspaceState
        .listDiaryChanges(workspacePath)
        .catch(() => [])
      for (const report of reports.filter((item) => !item.undone))
        for (const file of report.files)
          if (file.status !== 'deleted') badges[`${workspacePath}/${file.path}`] = 'AI 改'
      if (alive) useDiaryFileBadges.setState({ badges })
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => {
      alive = false
      window.clearInterval(timer)
      useDiaryFileBadges.setState({ badges: {} })
    }
  }, [workspacePath])

  if (!workspacePath || settings?.settings.type !== 'diary') return null
  const open = (file: NonNullable<Found>): void =>
    useTabStore.getState().openTab({
      type: 'editor',
      title: file.name,
      filePath: file.path,
      workspaceRef: ref,
      icon: '📄',
    })
  const reveal = (path: string, label: string): void => {
    setMessage('')
    void window.cclinkStudio.fs
      .readDir(path)
      .then(() => revealInFileTree(path))
      .catch(() => setMessage(`还没有「${label}」目录`))
  }
  return (
    <div className="diary-file-shortcuts" aria-label="日记快捷入口">
      <button
        onClick={() => {
          if (today) {
            open(today)
            void revealInFileTree(today.path)
          } else {
            // A new day's diary is created on 今天 so naming stays consistent.
            useDiaryNavigation.getState().setPage('今天')
            useUIStore.getState().showPanel('workspace-home')
            showWorkspaceHome(ref)
          }
        }}
        title={today ? today.name : '今天还没有日记，去今天页'}
      >
        今天的日记
      </button>
      <button
        disabled={!weekly}
        onClick={() => {
          if (!weekly) return
          open(weekly)
          void revealInFileTree(weekly.path)
        }}
        title={weekly ? weekly.name : '还没有周计划'}
      >
        本周计划
      </button>
      <button onClick={() => reveal(diaryRoot, '日记目录')}>日记目录</button>
      <button onClick={() => reveal(`${diaryRoot}/资料`, '资料')}>资料</button>
      {message && (
        <p className="diary-file-shortcuts-note" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
