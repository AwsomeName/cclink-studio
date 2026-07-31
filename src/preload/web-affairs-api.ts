import { ipcRenderer } from 'electron'
import {
  webAffairsIpc,
  webAffairsIpcEvents,
  type WebAffairsApiContract,
} from '../shared/web-affairs/web-affair'
import { invokeIpcContract } from './ipc-contract-client'

export const webAffairsApi: WebAffairsApiContract = {
  getSnapshot: () => invokeIpcContract(webAffairsIpc.getSnapshot),
  getCatalog: () => invokeIpcContract(webAffairsIpc.getCatalog),
  createAffair: (input) => invokeIpcContract(webAffairsIpc.createAffair, input),
  updateNode: (input) => invokeIpcContract(webAffairsIpc.updateNode, input),
  reviseFlow: (input) => invokeIpcContract(webAffairsIpc.reviseFlow, input),
  inspectMaterials: (affairId) => invokeIpcContract(webAffairsIpc.inspectMaterials, affairId),
  startAttempt: (input) => invokeIpcContract(webAffairsIpc.startAttempt, input),
  bindAttempt: (input) => invokeIpcContract(webAffairsIpc.bindAttempt, input),
  handoffAttempt: (input) => invokeIpcContract(webAffairsIpc.handoffAttempt, input),
  returnAttempt: (input) => invokeIpcContract(webAffairsIpc.returnAttempt, input),
  confirmFinalAction: (input) => invokeIpcContract(webAffairsIpc.confirmFinalAction, input),
  finishAttempt: (input) => invokeIpcContract(webAffairsIpc.finishAttempt, input),
  scheduleCheck: (input) => invokeIpcContract(webAffairsIpc.scheduleCheck, input),
  completeCheck: (input) => invokeIpcContract(webAffairsIpc.completeCheck, input),
  proposeFlowDiff: (input) => invokeIpcContract(webAffairsIpc.proposeFlowDiff, input),
  decideFlowProposal: (input) => invokeIpcContract(webAffairsIpc.decideFlowProposal, input),
  onChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof callback>[0],
    ): void => callback(payload)
    ipcRenderer.on(webAffairsIpcEvents.changed, listener)
    return () => ipcRenderer.removeListener(webAffairsIpcEvents.changed, listener)
  },
}
