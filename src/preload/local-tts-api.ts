import { localTtsIpc, type LocalTtsApi } from '../shared/local-tts'
import { invokeIpcContract } from './ipc-contract-client'

export const localTtsApi: LocalTtsApi = {
  getSnapshot: () => invokeIpcContract(localTtsIpc.getSnapshot),
  start: (input) => invokeIpcContract(localTtsIpc.start, input),
  control: (input) => invokeIpcContract(localTtsIpc.control, input),
  audio: (key) => invokeIpcContract(localTtsIpc.audio, key),
  report: (input) => invokeIpcContract(localTtsIpc.report, input),
  install: () => invokeIpcContract(localTtsIpc.install),
}
