#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const rootDir = resolve(import.meta.dirname, '..')
const sourceDir = resolve(rootDir, 'src')

const expectedRendererContextMenuOwners = new Set([
  'src/renderer/src/components/activity-bar/ActivityBar.tsx',
  'src/renderer/src/components/agent-panel/AgentPanel.tsx',
  'src/renderer/src/components/common/ConversationMessageRenderer.tsx',
  'src/renderer/src/components/common/ResizeHandle.tsx',
  'src/renderer/src/components/data-sources/DataSourceQueryTab.tsx',
  'src/renderer/src/components/data-sources/DataSourcesPanel.tsx',
  'src/renderer/src/components/project-strip/ProjectStrip.tsx',
  'src/renderer/src/components/settings/SettingsPage.tsx',
  'src/renderer/src/components/sidebar/FileTree.tsx',
  'src/renderer/src/components/sidebar/HardwareProductionSection.tsx',
  'src/renderer/src/components/sidebar/ProjectOperationsSection.tsx',
  'src/renderer/src/components/sidebar/Sidebar.tsx',
  'src/renderer/src/components/status-bar/StatusBar.tsx',
  'src/renderer/src/components/workbench/AndroidDisplay.tsx',
  'src/renderer/src/components/workbench/SourceTextEditor.tsx',
  'src/renderer/src/components/workbench/TabBar.tsx',
  'src/renderer/src/components/workbench/WorkbenchContent.tsx',
])
const expectedNativeMenuOwners = new Set(['src/main/browser/browser-context-menu.ts'])
const expectedContextMenuStores = new Set([
  'src/renderer/src/features/context-actions/context-menu-store.ts',
])

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listSourceFiles(path)))
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path)
  }
  return files
}

function propertyName(node) {
  if (!node?.name) return null
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  return null
}

function compareSets(actual, expected, label, failures) {
  const unexpected = [...actual].filter((value) => !expected.has(value)).sort()
  const missing = [...expected].filter((value) => !actual.has(value)).sort()
  if (unexpected.length > 0) failures.push(`${label} 未登记：${unexpected.join(', ')}`)
  if (missing.length > 0) failures.push(`${label} 库存失效：${missing.join(', ')}`)
}

const rendererOwners = new Set()
const nativeMenuOwners = new Set()
const contextMenuStores = new Set()
const legacyMenuFiles = []

for (const filePath of await listSourceFiles(sourceDir)) {
  const projectPath = relative(rootDir, filePath)
  const source = await readFile(filePath, 'utf8')
  if (/(^|\/)(ContextMenu|TabContextMenu)\.tsx$/.test(projectPath)) {
    legacyMenuFiles.push(projectPath)
  }
  if (/create\s*<\s*ContextMenuState\s*>/.test(source)) contextMenuStores.add(projectPath)

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.text === 'onContextMenu') {
      rendererOwners.add(projectPath)
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
      propertyName(node) === 'onContextMenu'
    ) {
      rendererOwners.add(projectPath)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === 'Menu' &&
      node.expression.name.text === 'buildFromTemplate'
    ) {
      nativeMenuOwners.add(projectPath)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const failures = []
compareSets(
  rendererOwners,
  expectedRendererContextMenuOwners,
  'Renderer context-menu owner',
  failures,
)
compareSets(nativeMenuOwners, expectedNativeMenuOwners, 'Native context-menu owner', failures)
compareSets(contextMenuStores, expectedContextMenuStores, 'ContextMenu Store owner', failures)
if (legacyMenuFiles.length > 0) failures.push(`发现遗留菜单组件：${legacyMenuFiles.join(', ')}`)

if (failures.length > 0) {
  console.error('Context action boundary verification failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  console.error('新增区域必须更新 docs/ops/context-action-inventory.md 与本脚本库存。')
  process.exit(1)
}

console.log(
  `Context action boundary verification passed: renderer=${rendererOwners.size}, native=${nativeMenuOwners.size}, stores=${contextMenuStores.size}`,
)
