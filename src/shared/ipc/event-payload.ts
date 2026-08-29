export interface IpcEventPayloadLimits {
  maxDepth?: number
  maxNodes?: number
  maxArrayLength?: number
  maxObjectKeys?: number
  maxStringLength?: number
  maxTotalStringLength?: number
}

/**
 * preload 可用的轻量结构上限检查。它不改变 payload，也不依赖 Zod；具体事件仍需校验核心字段。
 */
export function isBoundedIpcEventPayload(
  value: unknown,
  limits: IpcEventPayloadLimits = {},
): boolean {
  const maxDepth = limits.maxDepth ?? 16
  const maxNodes = limits.maxNodes ?? 10_000
  const maxArrayLength = limits.maxArrayLength ?? 2_000
  const maxObjectKeys = limits.maxObjectKeys ?? 500
  const maxStringLength = limits.maxStringLength ?? 1_000_000
  const maxTotalStringLength = limits.maxTotalStringLength ?? 4_000_000
  const visited = new WeakSet<object>()
  let nodes = 0
  let totalStringLength = 0

  const visit = (candidate: unknown, depth: number): boolean => {
    nodes += 1
    if (nodes > maxNodes || depth > maxDepth) return false
    if (candidate === null || candidate === undefined || typeof candidate === 'boolean') return true
    if (typeof candidate === 'number') return Number.isFinite(candidate)
    if (typeof candidate === 'string') {
      totalStringLength += candidate.length
      return candidate.length <= maxStringLength && totalStringLength <= maxTotalStringLength
    }
    if (typeof candidate !== 'object') return false
    if (visited.has(candidate)) return false
    visited.add(candidate)

    if (Array.isArray(candidate)) {
      return (
        candidate.length <= maxArrayLength && candidate.every((entry) => visit(entry, depth + 1))
      )
    }

    const prototype = Object.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) return false
    const entries = Object.entries(candidate)
    return entries.length <= maxObjectKeys && entries.every(([, entry]) => visit(entry, depth + 1))
  }

  return visit(value, 0)
}

export function isBoundedIpcEventString(
  value: unknown,
  maxLength: number,
  options: { allowEmpty?: boolean; allowNullByte?: boolean } = {},
): value is string {
  return (
    typeof value === 'string' &&
    (options.allowEmpty === true || value.length > 0) &&
    value.length <= maxLength &&
    (options.allowNullByte === true || !value.includes('\0'))
  )
}
