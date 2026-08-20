import { resolve, sep } from 'path'
import { copyFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// electron-vite 5 isolatedEntries writes progress through TTY-only methods even in CI.
// Provide no-op fallbacks so the required sandbox-safe single-file preload build is deterministic.
process.stdout.clearLine ??= (() => true) as typeof process.stdout.clearLine
process.stdout.cursorTo ??= (() => true) as typeof process.stdout.cursorTo
process.stdout.moveCursor ??= (() => true) as typeof process.stdout.moveCursor

const rendererStoreDir = `${resolve(__dirname, 'src/renderer/src/stores')}${sep}`
const configuredRendererPort = Number(process.env.CCLINK_STUDIO_RENDERER_PORT)
const rendererServer =
  Number.isInteger(configuredRendererPort) &&
  configuredRendererPort >= 1024 &&
  configuredRendererPort <= 65_535
    ? { port: configuredRendererPort, strictPort: true }
    : undefined

function reloadRendererOnStoreUpdate(): Plugin {
  return {
    name: 'reload-renderer-on-store-update',
    apply: 'serve',
    handleHotUpdate(context) {
      if (!context.file.startsWith(rendererStoreDir)) return
      context.server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          // juice 是纯 ESM 包，不可 require()，需由 rollup 内联打包
          'juice',
        ],
      }),
      {
        // 复制静态资源到构建输出（test-page.html 等）
        name: 'copy-static-assets',
        writeBundle(options) {
          const outDir = options.dir ?? resolve(__dirname, 'out/main')
          copyFileSync(
            resolve(__dirname, 'src/main/playwright/test-page.html'),
            resolve(outDir, 'test-page.html'),
          )
        },
      },
    ],
    build: {
      rollupOptions: {
        external: [
          'playwright-core',
          'playwright',
          'chromium-bidi',
          // node-pty 是 native 模块，必须保持 external，由 Electron runtime 加载 .node
          'node-pty',
          // @yume-chan 系列包：ESM-only，含 Node.js 依赖，需 externalize
          '@yume-chan/adb',
          '@yume-chan/adb-scrcpy',
          '@yume-chan/scrcpy',
          '@yume-chan/scrcpy-decoder-webcodecs',
          '@yume-chan/stream-extra',
          '@yume-chan/event',
          '@yume-chan/async',
          '@yume-chan/struct',
          // agent-device：ESM-only，daemon/helper 需外部解析，参考 @yume-chan 模式
          'agent-device',
          'yaml',
        ],
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preload cannot require shared local chunks. Keep main and auxiliary
      // entries fully bundled and isolated even though they share typed IPC contracts.
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          auxiliary: resolve(__dirname, 'src/preload/auxiliary.ts'),
        },
      },
    },
  },
  renderer: {
    server: rendererServer,
    resolve: {
      alias: [
        { find: '@', replacement: resolve('src/renderer/src') },
        { find: '@shared', replacement: resolve('src/shared') },
      ],
    },
    plugins: [reloadRendererOnStoreUpdate(), react()],
  },
})
