import type {
  UpdateCommandResult,
  UpdateInstallAndRestartInput,
  UpdateInstallPreparation,
  UpdateSnapshot,
  UpdateSnapshotChangedEvent,
} from '../update'

export interface UpdateApiContract {
  getSnapshot(): Promise<UpdateSnapshot>
  check(): Promise<UpdateCommandResult>
  startDownload(): Promise<UpdateCommandResult>
  cancelDownload(): Promise<UpdateCommandResult>
  defer(): Promise<UpdateCommandResult>
  ignoreVersion(): Promise<UpdateCommandResult>
  prepareInstall(): Promise<UpdateInstallPreparation>
  installAndRestart(input: UpdateInstallAndRestartInput): Promise<UpdateCommandResult>
  onSnapshotChanged(callback: (event: UpdateSnapshotChangedEvent) => void): () => void
}
