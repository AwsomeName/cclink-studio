import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const builderConfig = readFileSync(join(projectRoot, 'electron-builder.yml'), 'utf8')

const rendererBuildOnlyDependencies = [
  '@tiptap/core',
  '@tiptap/extension-code-block-lowlight',
  '@tiptap/extension-image',
  '@tiptap/extension-link',
  '@tiptap/extension-placeholder',
  '@tiptap/extension-table',
  '@tiptap/extension-table-cell',
  '@tiptap/extension-table-header',
  '@tiptap/extension-table-row',
  '@tiptap/extension-task-item',
  '@tiptap/extension-task-list',
  '@tiptap/markdown',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@xterm/addon-fit',
  '@xterm/xterm',
  'lowlight',
  'three',
  'zustand',
]

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    return ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(entry.name)) ? [path] : []
  })
}

test('packaged application uses an allowlist instead of copying the repository', () => {
  const filesBlock = builderConfig.match(/^files:\n([\s\S]*?)^asar:/m)?.[1]
  assert.ok(filesBlock, 'electron-builder files block must exist')
  assert.match(filesBlock, /^  - out\/\*\*$/m)
  assert.match(filesBlock, /^  - package\.json$/m)
  assert.doesNotMatch(filesBlock, /\*\*\/\*/)
  assert.doesNotMatch(filesBlock, /^  - !/m)
})

test('renderer-bundled libraries are build-only dependencies', () => {
  for (const dependency of rendererBuildOnlyDependencies) {
    assert.equal(
      packageJson.dependencies?.[dependency],
      undefined,
      `${dependency} must not be copied as a production dependency`,
    )
    assert.ok(
      packageJson.devDependencies?.[dependency],
      `${dependency} must remain available to the renderer build`,
    )
  }
})

test('build-only renderer dependencies are not imported by main or preload', () => {
  const runtimeSource = [
    ...collectSourceFiles(join(projectRoot, 'src', 'main')),
    ...collectSourceFiles(join(projectRoot, 'src', 'preload')),
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')

  for (const dependency of rendererBuildOnlyDependencies) {
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const runtimeImport = new RegExp(
      `(?:from\\s+|import\\s*\\(|require\\s*\\()\\s*['\"]${escaped}(?:['\"/])`,
    )
    assert.doesNotMatch(
      runtimeSource,
      runtimeImport,
      `${dependency} is now used at runtime and must return to dependencies`,
    )
  }
})

test('unused Mermaid runtime package is not installed', () => {
  assert.equal(packageJson.dependencies?.mermaid, undefined)
  assert.equal(packageJson.devDependencies?.mermaid, undefined)
})
