import { z } from 'zod'
import { affair, type Affair } from '../owner/affair'
import { defineIpcInvoke, defineNoArgsIpc } from './contract'
const id = z.string().uuid()
export const ownerDirectoryIpc = {
  list: defineNoArgsIpc<{ items: Affair[]; errors: string[] }>('owner-directory:list'),
  save: defineIpcInvoke<[Affair, number], Affair>('owner-directory:save', (args) =>
    z.tuple([affair, z.number().int().nonnegative()]).parse(args),
  ),
  confirm: defineIpcInvoke<[string, number], Affair>('owner-directory:confirm', (args) =>
    z.tuple([id, z.number().int().positive()]).parse(args),
  ),
  upgrade: defineIpcInvoke<[string, number], Affair>('owner-directory:upgrade', (args) =>
    z.tuple([id, z.number().int().positive()]).parse(args),
  ),
  retry: defineIpcInvoke<[string], Affair>('owner-directory:retry', (args) =>
    z.tuple([id]).parse(args),
  ),
  reveal: defineIpcInvoke<[string], void>('owner-directory:reveal', (args) =>
    z.tuple([id]).parse(args),
  ),
  preview: defineIpcInvoke<[string, string], string>('owner-directory:preview', (args) =>
    z.tuple([id, z.string().min(1).max(240)]).parse(args),
  ),
}
