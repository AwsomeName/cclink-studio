import type { IpcInvokeDefinition } from './contract'
import { bindIpcParser, bindNoArgsIpc, ipcArgs } from './contract'
import { fsIpc } from './fs'
import {
  fsDocumentPathPairSchema,
  fsDocumentTargetPathSchema,
  fsCopyEntrySchema,
  fsMarkdownSaveAsSchema,
  fsMarkdownTrashSchema,
  fsPathPairSchema,
  fsPathSchema,
  fsSaveDocumentAssetSchema,
  fsSaveTextDocumentSchema,
  fsScopedPathSchema,
  fsTextContentSchema,
  fsWatchIdSchema,
} from './fs-schema'

function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`IPC ${channel} 需要 ${count} 个参数`)
}

function bindPath<Result>(definition: IpcInvokeDefinition<[string], Result>) {
  return bindIpcParser(definition, (args) => {
    requireArgs(args, 1, definition.channel)
    return ipcArgs(fsPathSchema.parse(args[0]))
  })
}

function bindPathPair<Result>(definition: IpcInvokeDefinition<[string, string], Result>) {
  return bindIpcParser(definition, (args) => {
    requireArgs(args, 2, definition.channel)
    const parsed = fsPathPairSchema.parse({ sourcePath: args[0], targetPath: args[1] })
    return ipcArgs(parsed.sourcePath, parsed.targetPath)
  })
}

export const fsIpcContracts = {
  getHomePath: bindNoArgsIpc(fsIpc.getHomePath),
  readDir: bindPath(fsIpc.readDir),
  readFile: bindPath(fsIpc.readFile),
  readTextDocument: bindPath(fsIpc.readTextDocument),
  renderFile: bindPath(fsIpc.renderFile),
  writeFile: bindIpcParser(fsIpc.writeFile, (args) => {
    requireArgs(args, 2, fsIpc.writeFile.channel)
    return ipcArgs(fsPathSchema.parse(args[0]), fsTextContentSchema.parse(args[1]))
  }),
  saveTextDocument: bindIpcParser(fsIpc.saveTextDocument, (args) => {
    requireArgs(args, 1, fsIpc.saveTextDocument.channel)
    return ipcArgs(fsSaveTextDocumentSchema.parse(args[0]))
  }),
  importDocumentAsset: bindIpcParser(fsIpc.importDocumentAsset, (args) => {
    requireArgs(args, 2, fsIpc.importDocumentAsset.channel)
    const parsed = fsDocumentPathPairSchema.parse({
      documentPath: args[0],
      sourcePath: args[1],
    })
    return ipcArgs(parsed.documentPath, parsed.sourcePath)
  }),
  saveDocumentAsset: bindIpcParser(fsIpc.saveDocumentAsset, (args) => {
    requireArgs(args, 1, fsIpc.saveDocumentAsset.channel)
    return ipcArgs(fsSaveDocumentAssetSchema.parse(args[0]))
  }),
  inspectMarkdownDocument: bindPath(fsIpc.inspectMarkdownDocument),
  saveMarkdownDocumentAs: bindIpcParser(fsIpc.saveMarkdownDocumentAs, (args) => {
    requireArgs(args, 1, fsIpc.saveMarkdownDocumentAs.channel)
    return ipcArgs(fsMarkdownSaveAsSchema.parse(args[0]))
  }),
  relocateMarkdownDocument: bindIpcParser(fsIpc.relocateMarkdownDocument, (args) => {
    requireArgs(args, 1, fsIpc.relocateMarkdownDocument.channel)
    return ipcArgs(fsPathPairSchema.parse(args[0]))
  }),
  exportMarkdownDocumentZip: bindIpcParser(fsIpc.exportMarkdownDocumentZip, (args) => {
    requireArgs(args, 1, fsIpc.exportMarkdownDocumentZip.channel)
    return ipcArgs(fsDocumentTargetPathSchema.parse(args[0]))
  }),
  trashMarkdownDocument: bindIpcParser(fsIpc.trashMarkdownDocument, (args) => {
    requireArgs(args, 1, fsIpc.trashMarkdownDocument.channel)
    return ipcArgs(fsMarkdownTrashSchema.parse(args[0]))
  }),
  trashPath: bindIpcParser(fsIpc.trashPath, (args) => {
    requireArgs(args, 1, fsIpc.trashPath.channel)
    return ipcArgs(fsScopedPathSchema.parse(args[0]))
  }),
  revealPath: bindIpcParser(fsIpc.revealPath, (args) => {
    requireArgs(args, 1, fsIpc.revealPath.channel)
    return ipcArgs(fsScopedPathSchema.parse(args[0]))
  }),
  stat: bindPath(fsIpc.stat),
  isDirectory: bindPath(fsIpc.isDirectory),
  mkdir: bindPath(fsIpc.mkdir),
  rename: bindPathPair(fsIpc.rename),
  move: bindPathPair(fsIpc.move),
  copyEntry: bindIpcParser(fsIpc.copyEntry, (args) => {
    requireArgs(args, 1, fsIpc.copyEntry.channel)
    return ipcArgs(fsCopyEntrySchema.parse(args[0]))
  }),
  delete: bindPath(fsIpc.delete),
  extractZip: bindPath(fsIpc.extractZip),
  openPath: bindPath(fsIpc.openPath),
  watchDirStart: bindPath(fsIpc.watchDirStart),
  watchDirStop: bindIpcParser(fsIpc.watchDirStop, (args) => {
    requireArgs(args, 1, fsIpc.watchDirStop.channel)
    return ipcArgs(fsWatchIdSchema.parse(args[0]))
  }),
} as const
