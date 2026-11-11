import { useCallback, useEffect, useRef } from 'react'
import type { AgentImageAttachment } from '@shared/ipc/agent'
import {
  cancelImageImport,
  imageImportBlockReason,
  startImageImport,
  useImageImportJobs,
} from './image-import-jobs'

export function useImageImport(
  scope: string,
  images: AgentImageAttachment[],
  getImages: () => AgentImageAttachment[],
  accept: (images: AgentImageAttachment[]) => void,
  unavailableReason?: string,
) {
  const job = useImageImportJobs((state) => state.jobs[scope])
  const ownedJob = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (ownedJob.current) cancelImageImport(scope, ownedJob.current)
      ownedJob.current = null
    },
    [scope, unavailableReason],
  )
  const add = useCallback(
    (files: File[]) => {
      if (unavailableReason) return
      ownedJob.current = startImageImport(scope, files, getImages, accept) ?? ownedJob.current
    },
    [scope, unavailableReason, getImages, accept],
  )
  return {
    add,
    busy: Boolean(job?.busy),
    error: job?.error,
    blocked: Boolean(imageImportBlockReason(scope, images)),
    cancel: () => cancelImageImport(scope),
  }
}
