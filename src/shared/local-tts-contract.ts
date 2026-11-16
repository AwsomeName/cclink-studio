import { z } from 'zod'
import { bindIpcParser, bindNoArgsIpc } from './ipc/contract'
import { TTS_MAX_TEXT, localTtsIpc } from './local-tts'
const key = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !s.includes('\0'))
export const ttsSourceSchema = z
  .object({
    kind: z.enum(['markdown', 'browser', 'message']),
    workspaceKey: key.nullable(),
    tabId: key.optional(),
    conversationId: key.optional(),
    messageId: key.optional(),
    title: z.string().min(1).max(256),
    selection: z.boolean().default(false),
  })
  .strict()
export const ttsStartSchema = z
  .object({
    source: ttsSourceSchema,
    text: z.string().max(TTS_MAX_TEXT).optional(),
  })
  .strict()
export const ttsControlSchema = z
  .object({
    sessionId: key.nullable(),
    action: z.enum(['pause', 'resume', 'stop', 'seek', 'rate', 'voice', 'volume']),
    value: z.number().finite().optional(),
  })
  .strict()
export const ttsReportSchema = z
  .object({
    sessionId: key,
    audioKey: key,
    event: z.enum(['playing', 'paused', 'ended', 'error']),
  })
  .strict()
export const localTtsIpcContracts = {
  getSnapshot: bindNoArgsIpc(localTtsIpc.getSnapshot),
  start: bindIpcParser(localTtsIpc.start, (args) => z.tuple([ttsStartSchema]).parse(args)),
  control: bindIpcParser(localTtsIpc.control, (args) => z.tuple([ttsControlSchema]).parse(args)),
  audio: bindIpcParser(localTtsIpc.audio, (args) => z.tuple([key]).parse(args)),
  report: bindIpcParser(localTtsIpc.report, (args) => z.tuple([ttsReportSchema]).parse(args)),
  install: bindNoArgsIpc(localTtsIpc.install),
}
