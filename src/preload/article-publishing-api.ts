import {
  articlePublishingIpc,
  type ArticlePublishingApiContract,
} from '../shared/article-publishing/article-publishing'
import { invokeIpcContract } from './ipc-contract-client'

export const articlePublishingApi: ArticlePublishingApiContract = {
  inspectSource: (input) => invokeIpcContract(articlePublishingIpc.inspectSource, input),
  createTask: (input) => invokeIpcContract(articlePublishingIpc.createTask, input),
  startTask: (input) => invokeIpcContract(articlePublishingIpc.startTask, input),
  reportCheckpoint: (input) => invokeIpcContract(articlePublishingIpc.reportCheckpoint, input),
  reportAsset: (input) => invokeIpcContract(articlePublishingIpc.reportAsset, input),
}
