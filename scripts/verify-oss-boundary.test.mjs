import assert from 'node:assert/strict'
import test from 'node:test'

import { forbidden } from './verify-oss-boundary.mjs'

const artifactRule = forbidden.find((rule) => rule.label === 'old artifact upload or cloud config')

test('artifact boundary rejects legacy COS identifiers', () => {
  assert.match('COS_SECRET_ID', artifactRule.pattern)
  assert.match('upload-cos.sh', artifactRule.pattern)
})

test('artifact boundary allows macOS signing identifiers', () => {
  assert.doesNotMatch('MACOS_CERTIFICATE_P12_BASE64', artifactRule.pattern)
  assert.doesNotMatch('MACOS_DEVELOPER_IDENTITY', artifactRule.pattern)
})
