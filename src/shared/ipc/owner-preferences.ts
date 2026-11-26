import { z } from 'zod'
import { defineIpcInvoke, defineNoArgsIpc } from './contract'

// Owner preferences only choose defaults. They never grant a read permission:
// a registered reference directory becomes readable only after it is granted to one affair.
export type OwnerRootPurpose = 'reference' | 'output'
export type OwnerRoot = {
  id: string
  purpose: OwnerRootPurpose
  label: string
  path: string
  registeredAt: number
  /** Affairs that currently hold a read-only grant on this same directory. */
  grantedAffairs: number
  error?: string
}
export type OwnerSourcePreferences = { github: boolean; docs: boolean; thirdParty: boolean }
export type OwnerReminders = { topbarCount: boolean }
/** Local runtimes Owner can route steps to; ACP runtimes join this list later. */
export const ownerRuntimeKinds = ['claude-code', 'codex'] as const
export type OwnerRuntimeKind = (typeof ownerRuntimeKinds)[number]
/** Work types that pick a runtime today: coordinate = Owner itself, research = execution sessions. */
export const ownerWorkTypes = ['coordinate', 'research'] as const
export type OwnerWorkType = (typeof ownerWorkTypes)[number]
export type OwnerRuntimeOrder = Record<OwnerWorkType, OwnerRuntimeKind[]>
export const defaultRuntimeOrder = (): OwnerRuntimeOrder => ({
  coordinate: ['claude-code', 'codex'],
  research: ['codex', 'claude-code'],
})
const runtimeList = z
  .array(z.enum(ownerRuntimeKinds))
  .min(1)
  .max(ownerRuntimeKinds.length)
  .refine((l) => new Set(l).size === l.length, '运行时不能重复')
export const ownerRuntimeOrder = z
  .object({ coordinate: runtimeList, research: runtimeList })
  .strict()
export type OwnerPreferencesView = {
  roots: OwnerRoot[]
  defaultParentId: string | null
  /** The folder new affairs will actually be created in, or why it is unavailable. */
  saveLocation: { path: string; custom: boolean; error?: string }
  sources: OwnerSourcePreferences
  reminders: OwnerReminders
  runtimes: OwnerRuntimeOrder
}
export const ownerPreferenceUpdate = z
  .object({
    sources: z
      .object({ github: z.boolean(), docs: z.boolean(), thirdParty: z.boolean() })
      .strict()
      .optional(),
    reminders: z.object({ topbarCount: z.boolean() }).strict().optional(),
    runtimes: ownerRuntimeOrder.optional(),
  })
  .strict()
export type OwnerPreferenceUpdate = z.infer<typeof ownerPreferenceUpdate>

const rootId = z.string().uuid()
export const ownerPreferencesIpc = {
  get: defineNoArgsIpc<OwnerPreferencesView>('owner-preferences:get'),
  register: defineIpcInvoke<[OwnerRootPurpose], OwnerPreferencesView | null>(
    'owner-preferences:register',
    (args) => z.tuple([z.enum(['reference', 'output'])]).parse(args),
  ),
  remove: defineIpcInvoke<[string], OwnerPreferencesView>('owner-preferences:remove', (args) =>
    z.tuple([rootId]).parse(args),
  ),
  setDefaultParent: defineIpcInvoke<[string | null], OwnerPreferencesView>(
    'owner-preferences:set-default-parent',
    (args) => z.tuple([rootId.nullable()]).parse(args),
  ),
  update: defineIpcInvoke<[OwnerPreferenceUpdate], OwnerPreferencesView>(
    'owner-preferences:update',
    (args) => z.tuple([ownerPreferenceUpdate]).parse(args),
  ),
}
