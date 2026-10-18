#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBuildProvenance, verifyBuildProvenance } from './source-fingerprint.mjs'

if (process.argv.slice(2).some((arg) => !['--', '--help', '-h'].includes(arg))) {
  throw new Error('未知参数；使用 pnpm package:windows -- --help 查看用法')
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    'pnpm package:windows — 在 Windows x64 上构建未签名 NSIS 测试安装包（不改版本、不上传）',
  )
  process.exit(0)
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(
    'Windows 测试包必须在 Windows x64 上构建，以验证 node-pty 原生依赖；可使用 windows-package Actions',
  )
}

const root = resolve(import.meta.dirname, '..')
process.chdir(root)
const pnpmCli = process.env.npm_execpath
if (!pnpmCli || !existsSync(pnpmCli)) throw new Error('请使用 pnpm package:windows 运行')
const runPnpm = (args) =>
  execFileSync(process.execPath, [pnpmCli, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  })
const provenance = createBuildProvenance()
const metadata = JSON.parse(readFileSync('package.json', 'utf8'))
const output = join(root, 'dist', 'windows')
rmSync(join(root, 'out'), { recursive: true, force: true })
rmSync(output, { recursive: true, force: true })
runPnpm(['build'])
verifyBuildProvenance(provenance)
writeFileSync('out/build-provenance.json', `${JSON.stringify(provenance, null, 2)}\n`)
runPnpm([
  'exec',
  'electron-builder',
  '--win',
  'nsis',
  '--x64',
  '--publish',
  'never',
  '--config.directories.output=dist/windows',
])

const appDir = join(output, 'win-unpacked')
const executable = join(appDir, 'cclink-studio.exe')
const resources = join(appDir, 'resources')
for (const forbidden of ['agent-runtime', 'update-helper']) {
  if (existsSync(join(resources, forbidden))) throw new Error(`Windows 包不应携带 ${forbidden}`)
}
// 用目标 Electron 读取 ASAR 并加载原生模块，防止只生成一个无法启动的 EXE。
const inspected = JSON.parse(
  execFileSync(
    executable,
    [
      '-e',
      `
  const path = require('node:path');
  const fs = require('node:fs');
  const root = path.join(process.resourcesPath, 'app.asar');
  const pkg = require(path.join(root, 'package.json'));
  require(path.join(root, 'node_modules/node-pty'));
  process.stdout.write(JSON.stringify({name:pkg.name,version:pkg.version,
    provenance:JSON.parse(fs.readFileSync(path.join(root,'out/build-provenance.json'),'utf8'))}));
`,
    ],
    { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000 },
  ),
)
if (inspected.name !== metadata.name || inspected.version !== metadata.version) {
  throw new Error('打包应用名称或版本不一致')
}
verifyBuildProvenance(inspected.provenance)
const installers = readdirSync(output).filter((name) => name.endsWith('-test-setup.exe'))
if (installers.length !== 1) throw new Error(`预期一个 NSIS 测试安装包，实际 ${installers.length}`)
const name = installers[0]
const sha256 = createHash('sha256')
  .update(readFileSync(join(output, name)))
  .digest('hex')
writeFileSync(join(output, 'checksums-windows-x64.txt'), `${sha256}  ${name}\n`)
writeFileSync(
  join(output, 'build-record-windows-x64.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      channel: 'test',
      signed: false,
      platform: 'win32',
      arch: 'x64',
      version: metadata.version,
      artifact: name,
      sha256,
      ...provenance,
    },
    null,
    2,
  )}\n`,
)
console.log(`Windows x64 未签名测试包：${join(output, name)}`)
console.log('打包与原生模块加载通过；安装及真实工作台 smoke 需另运行 pnpm smoke:windows-packaged。')
