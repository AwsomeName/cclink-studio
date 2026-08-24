import assert from 'node:assert/strict'
import test from 'node:test'

import { forbidden } from './verify-oss-boundary.mjs'

const artifactRule = forbidden.find((rule) => rule.label === 'old artifact upload or cloud config')
const splitProjectRule = forbidden.find((rule) => rule.label === 'nonexistent split project')

test('artifact boundary rejects legacy COS identifiers', () => {
  assert.match('COS_SECRET_ID', artifactRule.pattern)
  assert.match('upload-cos.sh', artifactRule.pattern)
})

test('artifact boundary allows macOS signing identifiers', () => {
  assert.doesNotMatch('MACOS_CERTIFICATE_P12_BASE64', artifactRule.pattern)
  assert.doesNotMatch('MACOS_DEVELOPER_IDENTITY', artifactRule.pattern)
})

test('split project boundary allows the bounded experimental backend id', () => {
  assert.doesNotMatch('experimental cclink-agent backend', splitProjectRule.pattern)
  assert.doesNotMatch("type: 'cclink-agent'", splitProjectRule.pattern)
})

test('split project boundary still rejects repository and directory claims', () => {
  assert.match('/workspace/cclink-agent/src', splitProjectRule.pattern)
  assert.match('the cclink-agent repository', splitProjectRule.pattern)
  assert.match('cclink-cloud', splitProjectRule.pattern)
})
