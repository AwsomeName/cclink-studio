import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(resolve('.github/workflows/release-oss.yml'), 'utf8')

test('release workflow uses native runners for each target architecture', () => {
  assert.match(workflow, /- arch: arm64\s+runner: macos-15/)
  assert.match(workflow, /- arch: x64\s+runner: macos-15-intel/)
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/)
})

test('release workflow verifies the P12 password and Developer ID identity before build', () => {
  assert.match(workflow, /security import "\$certificate_path"/)
  assert.match(workflow, /-P "\$CSC_KEY_PASSWORD"/)
  assert.match(workflow, /security find-identity -v -p codesigning "\$keychain_path"/)
  assert.match(workflow, /grep -F -- "\$CSC_NAME"/)
})

test('release workflow passes electron-builder an identity without the certificate prefix', () => {
  assert.match(workflow, /builder_identity="\$\{CSC_NAME#Developer ID Application: \}"/)
  assert.match(workflow, /unset CSC_NAME/)
  assert.match(workflow, /--config\.mac\.identity="\$builder_identity"/)
  assert.doesNotMatch(workflow, /--config\.mac\.identity="\$CSC_NAME"/)
})
