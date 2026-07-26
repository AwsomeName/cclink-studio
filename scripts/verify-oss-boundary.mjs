#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()

const ignoredFiles = new Set(['pnpm-lock.yaml', 'verify-oss-boundary.mjs'])

// 旧产品名只允许存在于显式迁移模块，不能回流到业务代码、测试或产品文档。
const scopedAllowances = new Map([
  ['src/main/migrations/project-ops-legacy-account-paths.ts', new Set(['old product name'])],
  ['scripts/verify-oss-boundary.test.mjs', new Set(['old artifact upload or cloud config'])],
])

export const forbidden = [
  { label: 'old product name', pattern: /DeepInk|deepink|DEEPINK/ },
  { label: 'old private service naming', pattern: /private-serv|private service|private-service/ },
  { label: 'nonexistent split project', pattern: /cclink-cloud|cclink-agent/ },
  { label: 'old IM credential or provider', pattern: /\bTIM\b|腾讯 IM|Tencent IM|UserSig/ },
  { label: 'secret-bearing renderer field', pattern: /authToken|imUserSig/ },
  { label: 'legacy identity flow', pattern: /legacy identity|importLegacy/ },
  {
    label: 'remote workspace residue',
    pattern: /Remote Workspace|remote workspace|remote-session/,
  },
  {
    label: 'migrated store/module residue',
    pattern: /SyncPanel|sync-store|auth-store|subscription-store|cclink-store/,
  },
  {
    label: 'old artifact upload or cloud config',
    pattern: /upload-cos|\bCOS_|CloudBase/,
  },
  { label: 'old MCP server name', pattern: /mcp__deepink/ },
]

const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
])

const matches = []
const structuralFailures = []

function extname(path) {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : ''
}

function shouldSkip(path) {
  const name = path.split('/').pop()
  if (!name) return true
  if (ignoredFiles.has(name)) return true
  return !textExtensions.has(extname(path))
}

function scanFile(relativePath) {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) return
  const text = readFileSync(absolutePath, 'utf8')
  if (text.includes('\0')) return

  const lines = text.split(/\r?\n/)
  for (const [lineIndex, line] of lines.entries()) {
    for (const rule of forbidden) {
      const match = line.match(rule.pattern)
      if (match) {
        if (scopedAllowances.get(relativePath)?.has(rule.label)) continue
        matches.push({
          path: relativePath,
          line: lineIndex + 1,
          column: match.index + 1,
          label: rule.label,
          value: match[0],
        })
      }
    }
  }
}

function readRepoFile(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function failStructure(path, message) {
  structuralFailures.push({ path, message })
}

function assertOfficialSeams() {
  const coreServicesPath = 'src/main/runtime/core-services.ts'
  const coreServices = readRepoFile(coreServicesPath)
  if (
    !coreServices.includes(
      "import { loadOfficialIntegration } from '../official/official-integration-loader'",
    )
  ) {
    failStructure(
      coreServicesPath,
      'runtime must load official integration only through the loader',
    )
  }
  const directOfficialImports = coreServices
    .split(/\r?\n/)
    .filter((line) => line.includes("from '../official/"))
    .filter((line) => !line.includes('../official/official-integration-loader'))
  for (const line of directOfficialImports) {
    failStructure(
      coreServicesPath,
      `runtime must not import official implementation directly: ${line}`,
    )
  }

  const preloadPath = 'src/preload/index.ts'
  const preload = readRepoFile(preloadPath)
  const officialBlock = preload.match(/official:\s*{([\s\S]*?)\n\s*},\n\s*\/\/ Agent/)
  if (!officialBlock) {
    failStructure(preloadPath, 'preload must expose an official status probe block')
  } else {
    const officialApi = officialBlock[1]
    if (!officialApi.includes('getStatus')) {
      failStructure(preloadPath, 'preload official API must expose getStatus')
    }
    const forbiddenOfficialApi = officialApi.match(
      /\b(login|account|device|message|entitlement|quota|runtime|release|token|credential|sig)\b/i,
    )
    if (forbiddenOfficialApi) {
      failStructure(
        preloadPath,
        `preload official API must not expose privileged capability: ${forbiddenOfficialApi[0]}`,
      )
    }
  }

  const sharedContractPath = 'src/shared/ipc/official.ts'
  const sharedContract = readRepoFile(sharedContractPath)
  const officialContract = sharedContract.match(
    /export interface OfficialApiContract\s*{([\s\S]*?)\n}/,
  )
  if (!officialContract) {
    failStructure(sharedContractPath, 'shared official API contract is missing')
  } else {
    const contractBody = officialContract[1]
    if (!contractBody.includes('getStatus')) {
      failStructure(sharedContractPath, 'shared official API contract must expose getStatus')
    }
    const extraOfficialMethod = contractBody.match(
      /\b(login|account|device|message|entitlement|quota|runtime|release|token|credential|sig)\b/i,
    )
    if (extraOfficialMethod) {
      failStructure(
        sharedContractPath,
        `shared official API contract must not expose privileged capability: ${extraOfficialMethod[0]}`,
      )
    }
  }

  const loaderPath = 'src/main/official/official-integration-loader.ts'
  const loader = readRepoFile(loaderPath)
  if (!loader.includes('createNoopOfficialIntegration')) {
    failStructure(loaderPath, 'OSS loader must return the no-op official integration')
  }
  const nonNoopImports = loader
    .split(/\r?\n/)
    .filter((line) => line.startsWith('import '))
    .filter((line) => !line.includes('./official-integration'))
  for (const line of nonNoopImports) {
    failStructure(loaderPath, `OSS loader must not import official/private packages: ${line}`)
  }
}

function listRepositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
  return output.split('\0').filter(Boolean)
}

function main() {
  for (const path of listRepositoryFiles()) {
    if (!shouldSkip(path)) scanFile(path)
  }

  assertOfficialSeams()

  if (matches.length > 0 || structuralFailures.length > 0) {
    console.error('OSS boundary verification failed:')
    for (const match of matches) {
      console.error(
        `${match.path}:${match.line}:${match.column} ${match.label}: ${JSON.stringify(match.value)}`,
      )
    }
    for (const failure of structuralFailures) {
      console.error(`${failure.path}: ${failure.message}`)
    }
    process.exit(1)
  }

  console.log('OSS boundary verification passed.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
