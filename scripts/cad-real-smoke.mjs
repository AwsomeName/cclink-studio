import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'

const requiredPaths = [
  ['CCLINK_CAD_REAL_STEP', process.env.CCLINK_CAD_REAL_STEP],
  ['CCLINK_CAD_REAL_FREECAD', process.env.CCLINK_CAD_REAL_FREECAD],
]

for (const [name, value] of requiredPaths) {
  if (!value) {
    console.error(`[cad-real-smoke] 缺少 ${name}，真实 FreeCAD 门禁未运行。`)
    process.exit(1)
  }
  try {
    accessSync(value, constants.R_OK)
  } catch {
    console.error(`[cad-real-smoke] ${name} 不可读取：${value}`)
    process.exit(1)
  }
}

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vitest', 'run', 'src/main/cad/cad-modification-service.test.ts', '--reporter=verbose'],
  { env: process.env, stdio: 'inherit' },
)

if (result.error) {
  console.error(`[cad-real-smoke] 无法启动测试：${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
