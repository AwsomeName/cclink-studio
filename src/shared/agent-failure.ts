export const CONTEXT_COMPACTION_FAILURE_CODES = [
  'context_compaction_content_rejected',
  'context_compaction_context_limit',
  'context_compaction_authentication_failed',
  'context_compaction_rate_limited',
  'context_compaction_network_unavailable',
  'context_compaction_proxy_gateway_error',
  'context_compaction_failed',
] as const

export type ContextCompactionFailureCode = (typeof CONTEXT_COMPACTION_FAILURE_CODES)[number]

export function isContextCompactionFailure(
  code: string | null | undefined,
): code is ContextCompactionFailureCode {
  return CONTEXT_COMPACTION_FAILURE_CODES.some((candidate) => candidate === code)
}
