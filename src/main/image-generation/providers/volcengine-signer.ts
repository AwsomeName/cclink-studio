import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'HMAC-SHA256'

export interface VolcengineSignInput {
  accessKeyId: string
  secretAccessKey: string
  method: 'POST'
  url: URL
  body: string
  region: string
  service: string
  now: Date
}

export interface VolcengineSignedRequest {
  authorization: string
  xContentSha256: string
  xDate: string
}

export function signVolcengineRequest(input: VolcengineSignInput): VolcengineSignedRequest {
  const xDate = formatVolcengineDate(input.now)
  const shortDate = xDate.slice(0, 8)
  const xContentSha256 = sha256Hex(input.body)
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders = [
    'content-type:application/json',
    `host:${input.url.host}`,
    `x-content-sha256:${xContentSha256}`,
    `x-date:${xDate}`,
    '',
  ].join('\n')
  const canonicalRequest = [
    input.method,
    input.url.pathname || '/',
    canonicalQuery(input.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    xContentSha256,
  ].join('\n')
  const credentialScope = `${shortDate}/${input.region}/${input.service}/request`
  const stringToSign = [ALGORITHM, xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmac(input.secretAccessKey, shortDate)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, input.service)
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  return {
    authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    xContentSha256,
    xDate,
  }
}

function formatVolcengineDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error('火山引擎签名时间无效')
  return value.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function canonicalQuery(searchParams: URLSearchParams): string {
  return Array.from(searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? compareAscii(leftValue, rightValue) : compareAscii(leftKey, rightKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')
}

function compareAscii(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}
