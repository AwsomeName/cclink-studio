import type { RemoteDiagnosticEvent } from '../../shared/remote-protocol'
import type { RemoteError } from '../../shared/remote-error'

export class RemoteDiagnosticLog {
  private readonly events: RemoteDiagnosticEvent[] = []

  record(operation: string, error: RemoteError): void {
    this.events.push({ timestamp: Date.now(), operation, error })
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100)
  }

  recent(endpointId: string, limit = 20): RemoteDiagnosticEvent[] {
    return this.events
      .filter((event) => event.error.context?.endpointId === endpointId)
      .slice(-limit)
  }
}
