import { app } from 'electron'
import { CadConversionService } from '../cad/cad-conversion-service'
import { registerCadIpc } from '../cad/cad-ipc'
import { DataSourceService } from '../data-source/data-source-service'
import { registerDataSourceIpc } from '../data-source/data-source-ipc'
import { HardwareService } from '../hardware/hardware-service'
import { registerHardwareIpc } from '../hardware/hardware-ipc'
import { registerTerminalIpc } from '../ipc/terminal-ipc'
import { MeshyService } from '../meshy/meshy-service'
import { ImageGenerationService } from '../image-generation/image-generation-service'
import { MarkdownIllustrationService } from '../image-generation/markdown-illustration-service'
import { cleanupTerminalOrphans } from '../terminal/terminal-orphan-cleaner'
import { TerminalAuditStore } from '../terminal/terminal-audit-store'
import { createTerminalBrowserEnvironment } from '../terminal/terminal-browser-launcher'
import { TerminalCommandOrchestrator } from '../terminal/terminal-command-orchestrator'
import { CompositeTerminalExecutionAdapter } from '../terminal/terminal-composite-execution-adapter'
import { TerminalConfirmationService } from '../terminal/terminal-confirmation-service'
import { PtyExecutionAdapter } from '../terminal/terminal-pty-execution-adapter'
import { TerminalSessionRegistry } from '../terminal/terminal-session-registry'
import { TerminalSessionStore } from '../terminal/terminal-session-store'
import type { AgentCapabilityName } from '../../shared/agent-protocol'
import type { CclinkStudioRuntimeState } from './app-runtime'

type OptionalMainCapability = Extract<
  AgentCapabilityName,
  'cad' | 'hardware' | 'data-source' | 'meshy' | 'image-generation' | 'terminal'
>

export type OptionalMainServiceBootstrappers = Record<
  OptionalMainCapability,
  (runtime: CclinkStudioRuntimeState) => void | Promise<void>
>

const defaultBootstrappers: OptionalMainServiceBootstrappers = {
  cad: (runtime) => {
    registerCadIpc(() => runtime.cadConversionService, runtime.trustedRendererGuard!)
    runtime.cadConversionService = new CadConversionService(
      () => runtime.settingsService!.getAll(),
      async () => {
        const resource =
          await runtime.runtimeComponentManager?.resolveRuntimeResource('occt-runtime')
        const wasmPath = resource?.files['occt-import-js.wasm']
        return resource && wasmPath
          ? { wasmPath, version: resource.version, source: 'managed' as const }
          : null
      },
    )
    console.log('[CCLink Studio] CAD 转换 IPC 已注册')
  },
  hardware: (runtime) => {
    registerHardwareIpc(() => runtime.hardwareService, runtime.trustedRendererGuard!)
    if (!runtime.cadConversionService) throw new Error('CAD 转换服务未就绪')
    runtime.hardwareService = new HardwareService(runtime.cadConversionService)
    console.log('[CCLink Studio] 硬件工作区 IPC 已注册')
  },
  'data-source': async (runtime) => {
    registerDataSourceIpc(() => runtime.dataSourceService, runtime.trustedRendererGuard!)
    if (!runtime.credentialService) throw new Error('本地凭证服务未就绪')
    runtime.dataSourceService = new DataSourceService(runtime.credentialService)
    await runtime.dataSourceService.load()
    console.log('[CCLink Studio] 数据源 IPC 已注册')
  },
  meshy: (runtime) => {
    runtime.meshyService = new MeshyService(() => runtime.settingsService!.getRuntimeSettings())
    console.log('[CCLink Studio] Meshy 3D 服务已初始化')
  },
  'image-generation': (runtime) => {
    if (!runtime.fileService || !runtime.usageLedgerService || !runtime.credentialService) {
      throw new Error('文件、凭证或用量统计服务未就绪')
    }
    runtime.imageGenerationService = new ImageGenerationService(
      () => runtime.settingsService!.getRuntimeSettings().meshyApiKey,
      () => {
        try {
          const credential = runtime.credentialService!.resolveCredential(
            'extension:jimeng:default',
          )
          return {
            accessKeyId: credential?.accessKeyId ?? '',
            secretAccessKey: credential?.secretAccessKey ?? '',
          }
        } catch {
          return { accessKeyId: '', secretAccessKey: '' }
        }
      },
    )
    runtime.markdownIllustrationService = new MarkdownIllustrationService(
      runtime.imageGenerationService,
      runtime.fileService,
      runtime.usageLedgerService,
    )
    console.log('[CCLink Studio] Markdown 图片生成服务已初始化')
  },
  terminal: bootstrapTerminalServices,
}

export async function bootstrapOptionalMainServices(
  runtime: CclinkStudioRuntimeState,
  overrides: Partial<OptionalMainServiceBootstrappers> = {},
): Promise<void> {
  if (!runtime.mainWindow || !runtime.settingsService || !runtime.trustedRendererGuard) {
    throw new Error('可选主进程服务依赖的窗口、设置或可信 renderer 尚未初始化')
  }

  const bootstrappers = { ...defaultBootstrappers, ...overrides }
  for (const capability of [
    'cad',
    'hardware',
    'data-source',
    'meshy',
    'image-generation',
    'terminal',
  ] as const) {
    await startIsolatedCapability(runtime, capability, bootstrappers[capability])
  }

  try {
    registerTerminalIpc(
      runtime.terminalConfirmationService,
      runtime.trustedRendererGuard,
      runtime.terminalAuditStore ?? undefined,
      runtime.terminalSessionRegistry ?? undefined,
      runtime.terminalCommandOrchestrator ?? undefined,
      runtime.terminalExecutionAdapter ?? undefined,
      runtime.mainWindow.webContents,
      runtime.terminalSessionStore ?? undefined,
    )
  } catch (error) {
    resetCapability(runtime, 'terminal')
    runtime.capabilities.failed('terminal', error)
    console.error('[CCLink Studio] terminal IPC 注册失败:', error)
  }
}

async function startIsolatedCapability(
  runtime: CclinkStudioRuntimeState,
  capability: OptionalMainCapability,
  bootstrap: (runtime: CclinkStudioRuntimeState) => void | Promise<void>,
): Promise<void> {
  try {
    await bootstrap(runtime)
    runtime.capabilities.ready(capability)
  } catch (error) {
    resetCapability(runtime, capability)
    runtime.capabilities.failed(capability, error)
    console.error(`[CCLink Studio] ${capability} 主服务初始化失败:`, error)
  }
}

async function bootstrapTerminalServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.terminalAuditStore = new TerminalAuditStore()
  await runtime.terminalAuditStore.load()
  runtime.terminalSessionStore = new TerminalSessionStore()
  await runtime.terminalSessionStore.load()
  const terminalOrphanSummary = await cleanupTerminalOrphans(runtime.terminalSessionStore)
  if (terminalOrphanSummary.scanned > 0) {
    console.log(
      `[CCLink Studio] Terminal 残留进程清理完成: scanned=${terminalOrphanSummary.scanned}, killed=${terminalOrphanSummary.killed}, missing=${terminalOrphanSummary.missing}, skipped=${terminalOrphanSummary.skipped}, failed=${terminalOrphanSummary.failed}`,
    )
  }
  runtime.terminalConfirmationService = new TerminalConfirmationService(runtime.mainWindow!, {
    auditStore: runtime.terminalAuditStore,
  })
  runtime.terminalSessionRegistry = new TerminalSessionRegistry()
  const terminalBrowserEnvironment = createTerminalBrowserEnvironment({
    executablePath: process.execPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    tempPath: app.getPath('temp'),
  })
  const localTerminalExecutionAdapter = new PtyExecutionAdapter({
    browserEnvironment: terminalBrowserEnvironment,
  })
  runtime.terminalExecutionAdapter = new CompositeTerminalExecutionAdapter({
    local: localTerminalExecutionAdapter,
  })
  runtime.terminalCommandOrchestrator = new TerminalCommandOrchestrator({
    sessionRegistry: runtime.terminalSessionRegistry,
    confirmationService: runtime.terminalConfirmationService,
    executionAdapter: runtime.terminalExecutionAdapter,
    auditStore: runtime.terminalAuditStore,
  })
  console.log('[CCLink Studio] Terminal 服务已初始化')
}

function resetCapability(
  runtime: CclinkStudioRuntimeState,
  capability: OptionalMainCapability,
): void {
  switch (capability) {
    case 'cad':
      runtime.cadConversionService = null
      break
    case 'hardware':
      runtime.hardwareService = null
      break
    case 'data-source':
      runtime.dataSourceService = null
      break
    case 'meshy':
      runtime.meshyService = null
      break
    case 'image-generation':
      runtime.imageGenerationService = null
      runtime.markdownIllustrationService = null
      break
    case 'terminal':
      runtime.terminalConfirmationService?.destroy()
      runtime.terminalAuditStore = null
      runtime.terminalSessionStore = null
      runtime.terminalConfirmationService = null
      runtime.terminalSessionRegistry = null
      runtime.terminalExecutionAdapter = null
      runtime.terminalCommandOrchestrator = null
      break
  }
}
