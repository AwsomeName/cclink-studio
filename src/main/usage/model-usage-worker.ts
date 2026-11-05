import { parentPort, workerData } from 'node:worker_threads'
import { ModelUsageEngine } from './model-usage-engine'
import type { UsageWorkerCommand } from './model-usage-worker-contract'
const engine = new ModelUsageEngine(
  workerData.directory,
  workerData.instanceId,
  workerData.environmentDisabled,
)
let pending = Promise.resolve()
let closing = false
let maintenancePending = false
async function handle(command: UsageWorkerCommand): Promise<unknown> {
  switch (command.type) {
    case 'initialize':
      await engine.reconcile()
      return null
    case 'start':
      return engine.start(command.context)
    case 'observe':
      return engine.observe(command.runId, command.event)
    case 'finish':
      engine.finish(command.runId, command.status)
      scheduleMaintenance()
      return null
    case 'snapshot':
      return engine.snapshot(command.query)
    case 'calls':
      return engine.calls(command.query, command.offset, command.excludeDevelopment)
    case 'setEnabled':
      return engine.setEnabled(command.enabled)
    case 'classify':
      return engine.classify(command.target)
    case 'backfill':
      return engine.backfill(command.root)
    case 'import':
      return engine.importFile(command.path)
    case 'export':
      return engine.exportFile(
        command.path,
        command.format,
        command.query,
        command.excludeDevelopment,
      )
    case 'close':
      closing = true
      clearInterval(timer)
      engine.close()
      return null
  }
}
function scheduleMaintenance() {
  if (maintenancePending || closing) return
  maintenancePending = true
  pending = pending
    .then(async () => {
      if (closing) return
      engine.heartbeat()
      await engine.reconcile()
    })
    .catch((error) => {
      engine.failure(error)
      parentPort?.postMessage({ warning: 'USAGE_RECONCILE_FAILED' })
    })
    .finally(() => {
      maintenancePending = false
    })
}
const timer = setInterval(scheduleMaintenance, 30_000)
parentPort!.on('message', (message: { id: number; command: UsageWorkerCommand; at: string }) => {
  pending = pending.then(async () => {
    try {
      engine.setObservationTime(message.at)
      const value = await handle(message.command)
      parentPort!.postMessage({ id: message.id, value })
      if (closing) parentPort!.close()
    } catch (error) {
      engine.failure(error)
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'USAGE_OPERATION_FAILED'
      parentPort!.postMessage({
        id: message.id,
        error: /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'USAGE_OPERATION_FAILED',
      })
    }
  })
})
