import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { fsIpc, fsIpcEvents, parseFsWatchDirEvent, type FsApiContract } from '../shared/ipc/fs'
import { invokeIpcContract } from './ipc-contract-client'

export const fsApi: FsApiContract = {
  getHomePath: () => invokeIpcContract(fsIpc.getHomePath),
  readDir: (dirPath) => invokeIpcContract(fsIpc.readDir, dirPath),
  searchWorkspace: (input) => invokeIpcContract(fsIpc.searchWorkspace, input),
  readFile: (filePath) => invokeIpcContract(fsIpc.readFile, filePath),
  readTextDocument: (filePath) => invokeIpcContract(fsIpc.readTextDocument, filePath),
  renderFile: (filePath) => invokeIpcContract(fsIpc.renderFile, filePath),
  writeFile: (filePath, content) => invokeIpcContract(fsIpc.writeFile, filePath, content),
  createFile: (filePath) => invokeIpcContract(fsIpc.createFile, filePath),
  saveTextDocument: (input) => invokeIpcContract(fsIpc.saveTextDocument, input),
  importDocumentAsset: (documentPath, sourcePath) =>
    invokeIpcContract(fsIpc.importDocumentAsset, documentPath, sourcePath),
  saveDocumentAsset: (input) => invokeIpcContract(fsIpc.saveDocumentAsset, input),
  inspectMarkdownDocument: (documentPath) =>
    invokeIpcContract(fsIpc.inspectMarkdownDocument, documentPath),
  saveMarkdownDocumentAs: (input) => invokeIpcContract(fsIpc.saveMarkdownDocumentAs, input),
  relocateMarkdownDocument: (input) => invokeIpcContract(fsIpc.relocateMarkdownDocument, input),
  exportMarkdownDocumentZip: (input) => invokeIpcContract(fsIpc.exportMarkdownDocumentZip, input),
  trashMarkdownDocument: (input) => invokeIpcContract(fsIpc.trashMarkdownDocument, input),
  trashPath: (input) => invokeIpcContract(fsIpc.trashPath, input),
  revealPath: (input) => invokeIpcContract(fsIpc.revealPath, input),
  stat: (filePath) => invokeIpcContract(fsIpc.stat, filePath),
  isDirectory: (filePath) => invokeIpcContract(fsIpc.isDirectory, filePath),
  mkdir: (dirPath) => invokeIpcContract(fsIpc.mkdir, dirPath),
  rename: (oldPath, newPath) => invokeIpcContract(fsIpc.rename, oldPath, newPath),
  move: (oldPath, newPath) => invokeIpcContract(fsIpc.move, oldPath, newPath),
  copyEntry: (input) => invokeIpcContract(fsIpc.copyEntry, input),
  delete: (filePath) => invokeIpcContract(fsIpc.delete, filePath),
  extractZip: (filePath) => invokeIpcContract(fsIpc.extractZip, filePath),
  openPath: (path) => invokeIpcContract(fsIpc.openPath, path),
  watchDir: async (dirPath, onChange) => {
    const watchId = await invokeIpcContract(fsIpc.watchDirStart, dirPath)
    const listener = (_event: IpcRendererEvent, value: unknown): void => {
      const payload = parseFsWatchDirEvent(value)
      if (payload?.watchId === watchId) onChange(payload)
    }
    ipcRenderer.on(fsIpcEvents.watchDirChanged, listener)
    return () => {
      ipcRenderer.removeListener(fsIpcEvents.watchDirChanged, listener)
      void invokeIpcContract(fsIpc.watchDirStop, watchId)
    }
  },
}
