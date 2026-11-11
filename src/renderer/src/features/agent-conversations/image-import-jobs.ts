import { create } from 'zustand'
import type { AgentImageAttachment } from '@shared/ipc/agent'
import { importAgentImageFiles, MAX_AGENT_IMAGES } from './image-attachments'

interface ImageImportJob {
  id: string
  busy: boolean
  error?: string
  controller: AbortController
}

/** Owns only in-flight local preparation. Accepted attachments stay in their conversation store. */
export const useImageImportJobs = create<{ jobs: Record<string, ImageImportJob> }>(() => ({
  jobs: {},
}))

export function cancelImageImport(scope: string, id?: string): void {
  const job = useImageImportJobs.getState().jobs[scope]
  if (!job || (id && job.id !== id)) return
  job.controller.abort()
  useImageImportJobs.setState(({ jobs }) => {
    const next = { ...jobs }
    delete next[scope]
    return { jobs: next }
  })
}

export function imageImportBlockReason(
  scope: string,
  images: AgentImageAttachment[],
): string | null {
  const job = useImageImportJobs.getState().jobs[scope]
  if (job?.busy) return '图片正在处理，请等待完成或取消'
  if (job?.error) return '部分图片未添加，请处理提示后再发送'
  if (images.some((image) => image.preparation?.requiresReview))
    return '图片已缩小，请先预览并确认发送效果'
  return null
}

export function startImageImport(
  scope: string,
  files: File[],
  images: AgentImageAttachment[],
  accept: (images: AgentImageAttachment[]) => void,
  importer = importAgentImageFiles,
): string | null {
  if (useImageImportJobs.getState().jobs[scope]?.busy) return null
  cancelImageImport(scope)
  const job: ImageImportJob = {
    id: crypto.randomUUID(),
    busy: true,
    controller: new AbortController(),
  }
  useImageImportJobs.setState(({ jobs }) => ({ jobs: { ...jobs, [scope]: job } }))
  void importer(files, MAX_AGENT_IMAGES - images.length, { signal: job.controller.signal })
    .then((result) => {
      if (job.controller.signal.aborted || useImageImportJobs.getState().jobs[scope]?.id !== job.id)
        return
      accept(result.attachments)
      if (result.errors.length) {
        useImageImportJobs.setState(({ jobs }) => ({
          jobs: { ...jobs, [scope]: { ...job, busy: false, error: result.errors.join('\n') } },
        }))
      } else cancelImageImport(scope, job.id)
    })
    .catch((error: unknown) => {
      if (job.controller.signal.aborted || useImageImportJobs.getState().jobs[scope]?.id !== job.id)
        return
      useImageImportJobs.setState(({ jobs }) => ({
        jobs: {
          ...jobs,
          [scope]: {
            ...job,
            busy: false,
            error: error instanceof Error ? error.message : '图片处理失败，请重试',
          },
        },
      }))
    })
  return job.id
}
