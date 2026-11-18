import { z } from 'zod'
const bounded = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/[\0\r\n]/.test(value))
export const gitTransferInputSchema = z
  .object({
    action: z.enum(['clone', 'inspect', 'fetch', 'update-copy']),
    workspacePath: bounded.optional(),
    url: bounded.optional(),
    destinationParent: bounded.optional(),
    branch: z
      .string()
      .max(240)
      .regex(/^[A-Za-z0-9._/-]*$/)
      .optional(),
    username: z.string().max(256).optional(),
    token: z.string().max(4096).optional(),
    sshKeyPath: bounded.optional(),
    expectedHead: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
    expectedTarget: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
  })
  .strict()
export type GitTransferInput = z.infer<typeof gitTransferInputSchema>
export interface GitTransferSnapshot {
  workspacePath: string
  remoteUrl: string
  branch: string
  head: string
  target: string
  checkedAt: string
  changes: string
  diff?: string
  diffTruncated?: boolean
  localChanges: string
  diverged: boolean
  newCopy?: boolean
}

export type GitTransferResult =
  | { success: true; snapshot: GitTransferSnapshot }
  | {
      success: false
      error: { code: string; message: string; operation: GitTransferInput['action'] }
    }
