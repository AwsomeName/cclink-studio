import { defineIpcCall } from '../ipc/contract'
import type {
  CreateWebAffairInput,
  UpdateWebAffairNodeInput,
  WebAffair,
  WebAffairOperationResult,
  WebAffairSnapshot,
} from './web-affair-types'

export interface WebAffairsApiContract {
  getSnapshot(): Promise<WebAffairOperationResult<WebAffairSnapshot>>
  createAffair(input: CreateWebAffairInput): Promise<WebAffairOperationResult<WebAffair>>
  updateNode(input: UpdateWebAffairNodeInput): Promise<WebAffairOperationResult<WebAffair>>
}

export const webAffairsIpc = {
  getSnapshot: defineIpcCall<[], WebAffairOperationResult<WebAffairSnapshot>>(
    'webAffairs:getSnapshot',
  ),
  createAffair: defineIpcCall<
    [CreateWebAffairInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:createAffair'),
  updateNode: defineIpcCall<
    [UpdateWebAffairNodeInput],
    WebAffairOperationResult<WebAffair>
  >('webAffairs:updateNode'),
} as const
