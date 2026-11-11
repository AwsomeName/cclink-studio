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
  useImageImportJobs.setState(({ jobs }) => {
    const next = { ...jobs }
    delete next[scope]
    return { jobs: next }
  })
  job.controller.abort()
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
  getImages: () => AgentImageAttachment[],
  accept: (images: AgentImageAttachment[]) => void,
  importer = importAgentImageFiles,
): string | null {
  const previous = useImageImportJobs.getState().jobs[scope]
  if (previous?.busy) {
    useImageImportJobs.setState(({ jobs }) => ({
      jobs: {
        ...jobs,
        [scope]: {
          ...previous,
          error: joinErrors(
            previous.error,
            '图片仍在处理，本次新选图片未添加，请处理完成后重新添加',
          ),
        },
      },
    }))
    return null
  }
  cancelImageImport(scope)
  const job: ImageImportJob = {
    id: crypto.randomUUID(),
    busy: true,
    error: previous?.error,
    controller: new AbortController(),
  }
  useImageImportJobs.setState(({ jobs }) => ({ jobs: { ...jobs, [scope]: job } }))
  void Promise.resolve()
    .then(() => {
      job.controller.signal.throwIfAborted()
      return importer(files, Math.max(0, MAX_AGENT_IMAGES - getImages().length), {
        signal: job.controller.signal,
      })
    })
    .then((result) => {
      if (job.controller.signal.aborted || useImageImportJobs.getState().jobs[scope]?.id !== job.id)
        return
      // Another event (for example a failed Run restoring its draft) can fill slots
      // while the Worker is decoding. Re-read the attachment owner's current state.
      const available = Math.max(0, MAX_AGENT_IMAGES - getImages().length)
      const errors = [
        ...result.errors,
        ...result.attachments
          .slice(available)
          .map((image) => `${image.name}：当前附件已满（最多 ${MAX_AGENT_IMAGES} 张），请重新添加`),
      ]
      accept(result.attachments.slice(0, available))
      const current = useImageImportJobs.getState().jobs[scope]
      if (job.controller.signal.aborted || current?.id !== job.id) return
      const error = joinErrors(current.error, ...errors)
      if (error) {
        useImageImportJobs.setState(({ jobs }) => ({
          jobs: { ...jobs, [scope]: { ...current, busy: false, error } },
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
            error: joinErrors(
              jobs[scope]?.error,
              error instanceof Error ? error.message : '图片处理失败，请重试',
            ),
          },
        },
      }))
    })
  return job.id
}

function joinErrors(...errors: (string | undefined)[]): string | undefined {
  return (
    [...new Set(errors.flatMap((error) => (error ? error.split('\n') : [])))].join('\n') ||
    undefined
  )
}
