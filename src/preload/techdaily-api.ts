import { techDailyIpc, type TechDailyApiContract } from '../shared/ipc/techdaily'
import { invokeIpcContract } from './ipc-contract-client'

export const techDailyApi: TechDailyApiContract = {
  getSettings: (input) => invokeIpcContract(techDailyIpc.getSettings, input),
  saveSettings: (input) => invokeIpcContract(techDailyIpc.saveSettings, input),
  getStatus: (input) => invokeIpcContract(techDailyIpc.getStatus, input),
  getSearxng: () => invokeIpcContract(techDailyIpc.getSearxng),
  saveSearxng: (input) => invokeIpcContract(techDailyIpc.saveSearxng, input),
  testSearxng: (input) => invokeIpcContract(techDailyIpc.testSearxng, input),
  collect: (input) => invokeIpcContract(techDailyIpc.collect, input),
  listMonth: (input) => invokeIpcContract(techDailyIpc.listMonth, input),
  getRun: (input) => invokeIpcContract(techDailyIpc.getRun, input),
  generate: (input) => invokeIpcContract(techDailyIpc.generate, input),
  stop: (input) => invokeIpcContract(techDailyIpc.stop, input),
}
