import { runShutdownStep } from './shutdown'

export interface RuntimeService {
  name: string
  start?: () => void | Promise<void>
  stop?: () => void | Promise<void>
}

export class ServiceRegistry {
  private readonly services: RuntimeService[] = []

  register(service: RuntimeService): void {
    this.services.push(service)
  }

  async startAll(): Promise<void> {
    for (const service of this.services) {
      if (!service.start) continue
      try {
        await service.start()
      } catch (error) {
        console.error(`[CCLink Studio] ${service.name} 启动失败:`, error)
        throw error
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const service of [...this.services].reverse()) {
      if (!service.stop) continue
      await runShutdownStep(service.name, service.stop)
    }
  }
}
