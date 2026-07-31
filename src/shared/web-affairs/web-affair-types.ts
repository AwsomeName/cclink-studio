import type { WorkspaceRef } from '../workspace-ref'

export type WebAffairStatus =
  | 'draft'
  | 'active'
  | 'needs-attention'
  | 'waiting-external'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type WebAffairNodeStatus =
  | 'blocked'
  | 'ready'
  | 'running'
  | 'waiting-human'
  | 'waiting-external'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type WebAffairNodeExecutor = 'ai' | 'user' | 'external'

export interface WebAffairMaterialRef {
  id: string
  path: string
  name: string
  addedAt: string
}

export interface WebAffairNode {
  id: string
  type: 'web-task'
  title: string
  status: WebAffairNodeStatus
  executor: WebAffairNodeExecutor
  accountIds: string[]
  materialIds: string[]
  successCriteria: string[]
  availableTransitions: WebAffairNodeStatus[]
  lastResultNote?: string
  createdAt: string
  updatedAt: string
}

export interface WebAffairEdge {
  id: string
  fromNodeId: string
  toNodeId: string
}

export interface WebAffairFlow {
  version: 1
  nodes: WebAffairNode[]
  edges: WebAffairEdge[]
}

export interface WebAffairEvent {
  id: string
  type: 'created' | 'node-status-changed'
  nodeId?: string
  summary: string
  occurredAt: string
}

export interface WebAffair {
  id: string
  title: string
  objective: string
  status: WebAffairStatus
  principalId: string
  websiteIds: string[]
  accountIds: string[]
  materials: WebAffairMaterialRef[]
  flow: WebAffairFlow
  events: WebAffairEvent[]
  workspaceRef?: WorkspaceRef
  createdAt: string
  updatedAt: string
}

export interface WebAffairSnapshot {
  schemaVersion: 1
  revision: number
  affairs: WebAffair[]
}

export interface CreateWebAffairInput {
  title: string
  objective: string
  principalId: string
  accountIds: string[]
  materialPaths: string[]
  nodeTitles: string[]
  workspaceRef?: WorkspaceRef
}

export interface UpdateWebAffairNodeInput {
  affairId: string
  nodeId: string
  status: WebAffairNodeStatus
  resultNote?: string
}

export type WebAffairErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_RESOURCE_REFERENCE'
  | 'INVALID_TRANSITION'
  | 'NOT_FOUND'
  | 'RESOURCE_LIMIT_REACHED'
  | 'STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN'

export interface WebAffairOperationError {
  code: WebAffairErrorCode
  message: string
}

export type WebAffairOperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: WebAffairOperationError }

export const EMPTY_WEB_AFFAIR_SNAPSHOT: WebAffairSnapshot = {
  schemaVersion: 1,
  revision: 0,
  affairs: [],
}
