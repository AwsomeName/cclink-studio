import { webAffairsIpc, type WebAffairsApiContract } from '../shared/web-affairs/web-affair'
import { invokeIpcContract } from './ipc-contract-client'

export const webAffairsApi: WebAffairsApiContract = {
  getSnapshot: () => invokeIpcContract(webAffairsIpc.getSnapshot),
  createAffair: (input) => invokeIpcContract(webAffairsIpc.createAffair, input),
  updateNode: (input) => invokeIpcContract(webAffairsIpc.updateNode, input),
}
