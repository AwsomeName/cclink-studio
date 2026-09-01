import {
  articlePublishingIpc,
  type ArticlePublishingApiContract,
} from '../shared/article-publishing/article-publishing'
import { invokeIpcContract } from './ipc-contract-client'

export const articlePublishingApi: ArticlePublishingApiContract = {
  inspectSource: (input) => invokeIpcContract(articlePublishingIpc.inspectSource, input),
  createTask: (input) => invokeIpcContract(articlePublishingIpc.createTask, input),
  startTask: (input) => invokeIpcContract(articlePublishingIpc.startTask, input),
  checkRuntime: (input) => invokeIpcContract(articlePublishingIpc.checkRuntime, input),
  continueRuntime: (input) => invokeIpcContract(articlePublishingIpc.continueRuntime, input),
  terminateRuntime: (input) => invokeIpcContract(articlePublishingIpc.terminateRuntime, input),
  resolveAsset: (input) => invokeIpcContract(articlePublishingIpc.resolveAsset, input),
}
