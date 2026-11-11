import { createHash } from 'node:crypto'
import type { CredentialService } from '../credentials/credential-service'
import {
  parseBrowserHttpAuthRendererResponse,
  type BrowserHttpAuthRequest,
} from '../../shared/ipc/browser-http-auth'

/** Hash the exact realm, never the shortened/sanitized display label. */
export function browserHttpAuthCredentialId(
  profileId: string | null,
  origin: string,
  realm: string,
): string {
  return `browser-http-auth:${createHash('sha256')
    .update(JSON.stringify([profileId, origin, realm]))
    .digest('hex')}`
}

export function resolveBrowserHttpAuthCredential(
  service: CredentialService | null,
  request: BrowserHttpAuthRequest,
): { username: string; password: string } | null {
  if (!service || !request.credentialId || service.getStatus().status !== 'ready') return null
  const fields = service.resolveCredential(request.credentialId)
  if (!fields || fields.origin !== request.origin) return null
  if (request.transport === 'insecure-http' && fields.allowInsecureAutoLogin !== 'true') return null
  const response = parseBrowserHttpAuthRendererResponse({
    action: 'submit',
    requestId: request.requestId,
    username: fields.username,
    password: fields.password,
    remember: true,
    allowInsecure: fields.allowInsecureAutoLogin === 'true',
    allowInsecureAutoLogin: fields.allowInsecureAutoLogin === 'true',
  })
  return response?.action === 'submit'
    ? { username: response.username, password: response.password }
    : null
}
