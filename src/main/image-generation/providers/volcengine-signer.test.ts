import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signVolcengineRequest } from './volcengine-signer'

describe('signVolcengineRequest', () => {
  it('builds a deterministic Volcengine HMAC-SHA256 authorization header', () => {
    const result = signVolcengineRequest({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      method: 'POST',
      url: new URL(
        'https://visual.volcengineapi.com/?Version=2022-08-31&Action=CVSync2AsyncSubmitTask',
      ),
      body: '{"req_key":"t2i_v40_jimeng","prompt":"test"}',
      region: 'cn-north-1',
      service: 'cv',
      now: new Date('2026-07-29T03:04:05.000Z'),
    })

    expect(result.xDate).toBe('20260729T030405Z')
    expect(result.xContentSha256).toBe(
      createHash('sha256').update('{"req_key":"t2i_v40_jimeng","prompt":"test"}').digest('hex'),
    )
    expect(result.authorization).toMatch(
      /^HMAC-SHA256 Credential=test-access-key\/20260729\/cn-north-1\/cv\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[a-f0-9]{64}$/,
    )
    expect(result.authorization).not.toContain('test-secret-key')
  })
})
