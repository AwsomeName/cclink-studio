import { z } from 'zod'

/** 用户订阅的更新轨道。测试轨道同时接收公开正式版与 GitHub Pre-release。 */
export const updateTrackSchema = z.enum(['stable', 'beta'])

export type UpdateTrack = z.infer<typeof updateTrackSchema>
