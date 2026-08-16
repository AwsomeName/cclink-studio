#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const policyPath = join(root, 'src/main/agent-core/backends/claude-native-scheduling-policy.json')

export async function auditClaudeNativeScheduling({
  packageJsonPath = join(root, 'package.json'),
  sdkToolsPath = join(root, 'node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts'),
  manifestPath = policyPath,
} = {}) {
  const [packageJson, manifest, sdkTools] = await Promise.all([
    readJson(packageJsonPath),
    readJson(manifestPath),
    readFile(sdkToolsPath, 'utf8'),
  ])
  const configuredVersion = packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk']
  if (configuredVersion !== manifest.sdkVersion || !/^\d+\.\d+\.\d+$/.test(configuredVersion)) {
    throw new Error(
      `Claude Agent SDK 必须精确固定为 ${manifest.sdkVersion}，当前是 ${configuredVersion ?? 'missing'}`,
    )
  }

  const auditPattern = new RegExp(manifest.toolNameAuditPattern, 'i')
  const discovered = Array.from(
    new Set(
      Array.from(sdkTools.matchAll(/export interface ([A-Za-z0-9_]+)Input\b/g), (match) => match[1])
        .filter((name) => auditPattern.test(name))
        .sort(),
    ),
  )
  const denied = [...manifest.deniedTools].sort()
  const missingFromPolicy = discovered.filter((name) => !denied.includes(name))
  const missingFromSdk = denied.filter((name) => !discovered.includes(name))
  if (missingFromPolicy.length || missingFromSdk.length) {
    throw new Error(
      [
        'Claude 原生调度能力发生变化，必须人工复审 denylist。',
        `新增或未封锁: ${missingFromPolicy.join(', ') || '无'}`,
        `策略中已不存在: ${missingFromSdk.join(', ') || '无'}`,
      ].join('\n'),
    )
  }
  if (!manifest.disabledBundledSkills.includes('loop')) {
    throw new Error('原生 /loop Skill 未登记为禁用')
  }
  return { sdkVersion: configuredVersion, deniedTools: denied }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  auditClaudeNativeScheduling()
    .then((result) => {
      console.log(
        `Claude native scheduling boundary verified: sdk=${result.sdkVersion}, denied=${result.deniedTools.join(',')}`,
      )
    })
    .catch((error) => {
      console.error(error.message || String(error))
      process.exitCode = 1
    })
}
