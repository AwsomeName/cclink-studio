import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(resolve('.github/workflows/release-oss.yml'), 'utf8')
const notarizeDmgScript = readFileSync(resolve('scripts/notarize-dmg.sh'), 'utf8')

test('release workflow packages only Apple Silicon on the native runner', () => {
  assert.match(workflow, /package:[\s\S]*runs-on: macos-15/)
  assert.match(workflow, /stage-claude-runtime\.mjs --arch arm64/)
  assert.match(workflow, /--mac --arm64/)
  assert.doesNotMatch(workflow, /x64|macos-15-intel|matrix\.arch|matrix\.runner/)
})

test('release validation reuses exact successful main CI without rerunning the full suite', () => {
  const validateSection = workflow.slice(
    workflow.indexOf('  validate:'),
    workflow.indexOf('  package:'),
  )
  assert.match(validateSection, /runs-on: ubuntu-latest/)
  assert.match(validateSection, /git -C source rev-parse HEAD\^/)
  assert.match(validateSection, /Release commit must modify only package\.json/)
  assert.match(validateSection, /package\.json fields other than version/)
  assert.match(validateSection, /actions\/workflows\/ci\.yml\/runs/)
  assert.match(validateSection, /\.head_sha == \$sha/)
  assert.doesNotMatch(validateSection, /pnpm --dir source verify/)
  assert.doesNotMatch(validateSection, /pnpm --dir source smoke:standalone/)
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
  assert.match(notarizeDmgScript, /-A[\s\S]*-t cert[\s\S]*-f pkcs12/)
  assert.match(notarizeDmgScript, /security set-key-partition-list[\s\S]*apple-tool:,apple:/)
  assert.match(notarizeDmgScript, /security list-keychains -d user -s "\$keychain_path"/)
  assert.match(notarizeDmgScript, /security find-identity[\s\S]*identity_hash/)
  assert.match(notarizeDmgScript, /--sign "\$identity_hash"/)
  assert.doesNotMatch(notarizeDmgScript, /codesign[\s\S]*--keychain/)
  assert.match(notarizeDmgScript, /xcrun notarytool submit "\$dmg"/)
  assert.match(notarizeDmgScript, /xcrun stapler staple "\$dmg"/)
  assert.match(notarizeDmgScript, /spctl[\s\S]*--type open/)
})

test('release workflow normalizes public asset names before checksums and upload', () => {
  assert.match(workflow, /Expected exactly one DMG and one ZIP/)
  assert.match(workflow, /cclink-studio-\$\{VERSION\}-arm64\.dmg/)
  assert.match(workflow, /cclink-studio-\$\{VERSION\}-arm64\.zip/)
  assert.doesNotMatch(workflow, /cp dist\/\*\.dmg dist\/\*\.zip "\.\.\/release-assets-arm64\/"/)
})

test('draft release consumes one arm64 artifact and generates a verified update manifest', () => {
  assert.match(workflow, /name: studio-\$\{\{ inputs\.tag \}\}-arm64/)
  assert.doesNotMatch(workflow, /pattern: studio-\$\{\{ inputs\.tag \}\}-\*/)
  assert.doesNotMatch(workflow, /merge-multiple: true/)
  assert.match(workflow, /generate-update-manifest\.mjs/)
  assert.match(workflow, /verify-update-manifest\.mjs/)
  assert.match(workflow, /--minimum-system-version 13\.0/)
  assert.match(workflow, /--release-workflow-sha "\$RELEASE_WORKFLOW_SHA"/)
  assert.match(workflow, /--workflow-run-id "\$GITHUB_RUN_ID"/)

  const generateIndex = workflow.indexOf('generate-update-manifest.mjs')
  const verifyIndex = workflow.indexOf('verify-update-manifest.mjs')
  const draftIndex = workflow.indexOf('gh release create')
  assert.ok(generateIndex > 0)
  assert.ok(verifyIndex > generateIndex)
  assert.ok(draftIndex > verifyIndex)
})

test('U0 failure injection stops manifest aggregation before draft upload', () => {
  assert.match(workflow, /failure_injection:[\s\S]*default: none/)
  assert.match(workflow, /omit-arm64-build-record/)
  const injectIndex = workflow.indexOf('Inject U0 manifest validation failure')
  const manifestIndex = workflow.indexOf('Generate and verify update manifest')
  const draftIndex = workflow.indexOf('Create draft release')
  assert.ok(injectIndex > 0)
  assert.ok(injectIndex < manifestIndex)
  assert.ok(manifestIndex < draftIndex)
})
