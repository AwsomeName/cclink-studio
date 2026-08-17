import type {
  RemoteAgentSessionDiagnosticEvent,
  RemoteDiagnosticEvent,
} from '../../shared/remote-protocol'
import type { RemoteError } from '../../shared/remote-error'

const MAX_SESSION_EVENTS = 500
export const REMOTE_SESSION_DIAGNOSTIC_EVENT_LIMIT = 100

export class RemoteDiagnosticLog {
  private readonly events: RemoteDiagnosticEvent[] = []
  private readonly sessionEvents: Array<
    RemoteAgentSessionDiagnosticEvent & { endpointId: string; sessionId: string }
  > = []

  record(operation: string, error: RemoteError): void {
    this.events.push({ timestamp: Date.now(), operation, error })
    if (this.events.length > 100) this.events.splice(0, this.events.length - 100)
  }

  recent(endpointId: string, limit = 20): RemoteDiagnosticEvent[] {
    return this.events
      .filter((event) => event.error.context?.endpointId === endpointId)
      .slice(-limit)
  }

  recordSession(
    endpointId: string,
    sessionId: string,
    event: RemoteAgentSessionDiagnosticEvent,
  ): void {
    const last = this.sessionEvents.at(-1)
    if (
      event.type === 'stream_chunk' &&
      last?.type === 'stream_chunk' &&
      last.endpointId === endpointId &&
      last.sessionId === sessionId &&
      last.messageId === event.messageId
    ) {
      Object.assign(last, event, { count: (last.count ?? 1) + 1 })
      return
    }
    this.sessionEvents.push({ endpointId, sessionId, ...event })
    if (this.sessionEvents.length > MAX_SESSION_EVENTS) {
      this.sessionEvents.splice(0, this.sessionEvents.length - MAX_SESSION_EVENTS)
    }
  }

  recentSession(
    endpointId: string,
    sessionId: string,
    limit = REMOTE_SESSION_DIAGNOSTIC_EVENT_LIMIT,
  ): RemoteAgentSessionDiagnosticEvent[] {
    return this.sessionEvents
      .filter((event) => event.endpointId === endpointId && event.sessionId === sessionId)
      .slice(-limit)
      .map(({ endpointId: _endpointId, sessionId: _sessionId, ...event }) => event)
  }
}
