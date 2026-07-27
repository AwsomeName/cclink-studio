import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(resolve('.github/workflows/release-oss.yml'), 'utf8')
const notarizeDmgScript = readFileSync(resolve('scripts/notarize-dmg.sh'), 'utf8')

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

test('release workflow signs and Gatekeeper-assesses each DMG before upload', () => {
  assert.match(workflow, /CSC_NAME: \$\{\{ secrets\.MACOS_DEVELOPER_IDENTITY \}\}/)
  assert.match(workflow, /codesign --verify --verbose=2 "\$dmg"/)
  assert.match(workflow, /--type open/)
  assert.match(workflow, /context:primary-signature/)

  assert.match(notarizeDmgScript, /security import "\$certificate_path"/)
  assert.match(notarizeDmgScript, /-T \/usr\/bin\/codesign/)
  assert.match(notarizeDmgScript, /-T \/usr\/bin\/security/)
  assert.doesNotMatch(notarizeDmgScript, /security set-key-partition-list/)
  assert.match(notarizeDmgScript, /security find-identity[\s\S]*identity_hash/)
  assert.match(notarizeDmgScript, /--sign "\$identity_hash"/)
  assert.match(notarizeDmgScript, /--keychain "\$keychain_path"/)
  assert.match(notarizeDmgScript, /xcrun notarytool submit "\$dmg"/)
  assert.match(notarizeDmgScript, /xcrun stapler staple "\$dmg"/)
  assert.match(notarizeDmgScript, /spctl[\s\S]*--type open/)
})
