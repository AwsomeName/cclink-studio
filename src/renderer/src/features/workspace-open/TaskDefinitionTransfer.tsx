import { useState } from 'react'
import { parseStoredScheduledTaskDefinition } from '@shared/scheduled-task/scheduled-task-schema'
import { describeSchedule } from '../scheduled-tasks/scheduled-task-view-model'

export function TaskDefinitionTransfer({
  workspacePath,
  taskIds,
  onImported,
}: {
  workspacePath: string
  taskIds: string[]
  onImported: (ids: string[]) => void
}): React.ReactElement {
  const [bundle, setBundle] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  let preview: ReturnType<typeof parseStoredScheduledTaskDefinition>[] = []
  try {
    const raw = JSON.parse(bundle)
    if (raw.version === 1 && Array.isArray(raw.tasks) && raw.tasks.length <= 20)
      preview = raw.tasks.map(parseStoredScheduledTaskDefinition)
  } catch {
    /* Invalid input is reported on import. */
  }
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError('')
    setNotice('')
    void action()
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <details className="workspace-settings-form">
      <summary>导出 / 接回原任务定义</summary>
      <p>只复制定义，保留原身份、时间和内容；不移动原任务，不携带本机启用状态、凭证或运行历史。</p>
      <button
        disabled={busy || !taskIds.length}
        onClick={() =>
          run(async () => {
            const result = await window.cclinkStudio.scheduledTasks.exportBundle(
              workspacePath,
              taskIds,
            )
            if (!result.success) throw Error(result.error?.message)
            setBundle(result.bundle!)
            setReviewed(false)
            setNotice(
              '已生成原定义副本。复制下方内容到另一台电脑，或保存为 JSON 文件。原任务未改变。',
            )
          })
        }
      >
        导出已勾选的原任务
      </button>
      <label>
        任务定义 JSON
        <textarea
          aria-label="任务定义 JSON"
          value={bundle}
          onChange={(e) => {
            setBundle(e.target.value)
            setReviewed(false)
          }}
          rows={6}
        />
      </label>
      <button
        disabled={!bundle}
        onClick={() =>
          run(async () => {
            await navigator.clipboard.writeText(bundle)
            setNotice('已复制任务定义')
          })
        }
      >
        复制定义
      </button>
      <label>
        读取定义文件
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file)
              run(async () => {
                if (file.size > 1000000) throw Error('定义文件过大')
                setBundle(await file.text())
                setReviewed(false)
              })
          }}
        />
      </label>
      {preview.map((task) => (
        <article key={task.id}>
          <strong>{task.title}</strong>
          <p>{describeSchedule(task.schedule)}</p>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
            {task.instruction}
          </pre>
          <p>输出：{JSON.stringify(task.outputPolicy)}</p>
          <p>资源：{JSON.stringify(task.resources)}</p>
        </article>
      ))}
      <label>
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        已核对时间、时区、资源和输出位置；我会另行核对其他电脑的任务执行情况
      </label>
      <button
        disabled={busy || !preview.length || !reviewed}
        onClick={() =>
          run(async () => {
            const result = await window.cclinkStudio.scheduledTasks.importBundle(
              workspacePath,
              bundle,
            )
            if (!result.success) throw Error(result.error?.message)
            onImported(result.taskIds!)
            setNotice(
              '定义已接回；已有相同定义不重复创建。新接回任务未启用，请保存关联并在原任务详情核对后启用。',
            )
          })
        }
      >
        接回定义（不启用）
      </button>
      <p>
        同一身份的不同定义会停止接回，不覆盖旧任务。指令中的旧电脑绝对路径需在任务详情明确修改后才能使用。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </details>
  )
}
