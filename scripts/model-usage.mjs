// Execute the same TypeScript implementation as Electron, without building or launching Studio.
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const target = fileURLToPath(new URL(specifier, context.parentURL))
      if (!existsSync(target) && existsSync(`${target}.ts`)) {
        return { url: pathToFileURL(`${target}.ts`).href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { runUsageCli } = await import('../src/main/usage/model-usage-cli.ts')
    await runUsageCli(process.argv.slice(2))
  } catch (error) {
    console.error(`[ModelUsage] ${error instanceof Error ? error.message : '统计失败'}`)
    process.exitCode = 1
  }
}
