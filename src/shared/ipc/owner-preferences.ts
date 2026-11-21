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
export type OwnerPreferencesView = {
  roots: OwnerRoot[]
  defaultParentId: string | null
  /** The folder new affairs will actually be created in, or why it is unavailable. */
  saveLocation: { path: string; custom: boolean; error?: string }
  sources: OwnerSourcePreferences
  reminders: OwnerReminders
}
export const ownerPreferenceUpdate = z
  .object({
    sources: z
      .object({ github: z.boolean(), docs: z.boolean(), thirdParty: z.boolean() })
      .strict()
      .optional(),
    reminders: z.object({ topbarCount: z.boolean() }).strict().optional(),
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
