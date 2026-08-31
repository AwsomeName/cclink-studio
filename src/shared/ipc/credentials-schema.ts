import type { CredentialKind, SetCredentialInput } from './credentials'

const CREDENTIAL_ID_PATTERN =
  /^(agent|git|data-source|extension|mcp):[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const CREDENTIAL_KINDS = new Set<CredentialKind>(['api-key', 'token', 'basic', 'bearer', 'generic'])
const MAX_FIELD_LENGTH = 65_536
const MAX_FIELDS = 32
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function parseCredentialId(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_ID_PATTERN.test(value)) {
    throw new Error('凭证 ID 无效')
  }
  return value
}

export function parseCredentialFieldName(value: unknown): string {
  if (typeof value !== 'string' || !FIELD_NAME_PATTERN.test(value) || DANGEROUS_KEYS.has(value)) {
    throw new Error('凭证字段名无效')
  }
  return value
}

export function parseSetCredentialInput(value: unknown): SetCredentialInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('凭证输入无效')
  }
  const input = value as Partial<SetCredentialInput>
  const id = parseCredentialId(input.id)
  if (typeof input.kind !== 'string' || !CREDENTIAL_KINDS.has(input.kind as CredentialKind)) {
    throw new Error('凭证类型无效')
  }
  if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) {
    throw new Error('凭证字段无效')
  }
  const entries = Object.entries(input.fields)
  if (entries.length === 0 || entries.length > MAX_FIELDS) {
    throw new Error('凭证字段数量无效')
  }
  const fields: Record<string, string> = Object.create(null)
  for (const [field, rawValue] of entries) {
    const fieldName = parseCredentialFieldName(field)
    if (typeof rawValue !== 'string') throw new Error('凭证字段值必须是字符串')
    const normalized = rawValue.trim()
    if (!normalized || normalized.length > MAX_FIELD_LENGTH) {
      throw new Error('凭证字段值为空或超过长度限制')
    }
    fields[fieldName] = normalized
  }
  return { id, kind: input.kind as CredentialKind, fields }
}
