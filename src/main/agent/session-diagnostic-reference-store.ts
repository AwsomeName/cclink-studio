import { randomUUID } from 'node:crypto'

export class SessionDiagnosticReferenceStore {
  private readonly references = new Map<string, string>()

  get(sessionId: string | null): string | null {
    if (!sessionId) return null
    const existing = this.references.get(sessionId)
    if (existing) return existing
    const reference = `session-${randomUUID()}`
    this.references.set(sessionId, reference)
    return reference
  }

  delete(sessionId: string | null): void {
    if (sessionId) this.references.delete(sessionId)
  }

  clear(): void {
    this.references.clear()
  }
}
