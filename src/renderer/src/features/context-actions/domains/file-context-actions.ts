import type { AgentMountedResource } from '../../../types'
import { useAgentStore } from '../../../stores/agent-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useFsStore } from '../../../stores/fs-store'
import { useTabStore } from '../../../stores/tab-store'
import type { Command } from '../../../stores/command-store'
import { useToastStore } from '../../../components/common/Toast'
import {
  buildHtmlBrowserTabDraft,
  buildHtmlTextTabDraft,
  isHtmlFileExtension,
} from '../../../utils/html-files'
import type { CommandContext, ContextTarget } from '../context-target'
import type { MenuContribution } from '../menu-contribution-registry'

type FileTarget = Extract<ContextTarget, { kind: 'file' }>

function fileTarget(context?: CommandContext): FileTarget | null {
  return context?.target?.kind === 'file' ? context.target : null
}

function requireFileTarget(context?: CommandContext): FileTarget {
  const target = fileTarget(context)
  if (!target) throw new Error('文件目标已失效')
  const fsState = useFsStore.getState()
  if (
    fsState.workspacePath !== target.workspaceKey ||
    !treeContainsPath(fsState.tree, target.path)
  ) {
    throw new Error('文件或目录已不存在')
  }
  return target
}

function treeContainsPath(
  nodes: ReturnType<typeof useFsStore.getState>['tree'],
  path: string,
): boolean {
  return nodes.some(
    (node) => node.path === path || (node.children ? treeContainsPath(node.children, path) : false),
  )
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : '/'
}

function pasteTargetDirectory(target: FileTarget): string {
  return target.fileType === 'directory' ? target.path : parentPath(target.path)
}

function toWorkspaceRelativePath(filePath: string, workspacePath: string | null): string {
  if (!workspacePath) return filePath
  const root = workspacePath.replace(/\/+$/, '')
  if (filePath === root) return '.'
  if (filePath.startsWith(root + '/')) return filePath.slice(root.length + 1)
  return filePath
}

function isMarkdown(target: FileTarget | null): boolean {
  return Boolean(
    target?.fileType === 'file' && (target.extension === '.md' || target.extension === '.markdown'),
  )
}

function isHtml(target: FileTarget | null): boolean {
  return Boolean(target?.fileType === 'file' && isHtmlFileExtension(target.extension))
}

async function copyText(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    useToastStore.getState().show(successMessage, 'success')
  } catch (error) {
    useToastStore.getState().show(`复制失败: ${String(error)}`, 'error')
  }
}

function removeTrashedTargets(trashedPaths: string[]): void {
  const isTrashed = (path: string | undefined): boolean =>
    Boolean(
      path &&
      trashedPaths.some(
        (trashedPath) => path === trashedPath || path.startsWith(`${trashedPath}/`),
      ),
    )
  const tabStore = useTabStore.getState()
  for (const tab of [...tabStore.tabs]) if (isTrashed(tab.filePath)) tabStore.closeTab(tab.id)
  const editorStore = useEditorStore.getState()
  for (const path of Object.keys(editorStore.files))
    if (isTrashed(path)) editorStore.closeFile(path)
  const agentStore = useAgentStore.getState()
  for (const [conversationId, conversation] of Object.entries(agentStore.conversations)) {
    for (const resource of conversation.mountedResources) {
      if (isTrashed(resource.ref.path)) {
        agentStore.removeMountedResource(resource.id, conversationId)
      }
    }
  }
}

export function createFileContextCommands(): Command[] {
  return [
    {
      id: 'fileTree.newFile',
      label: '新建文件',
      contextOnly: true,
      category: '文件',
      risk: 'local-write',
      visible: (context) => fileTarget(context)?.fileType === 'directory',
      action: (context) => {
        const target = requireFileTarget(context)
        if (!target.expanded) void useFsStore.getState().toggleDir(target.path)
        useFsStore.getState().startEditing('new-file', target.path)
      },
    },
    {
      id: 'fileTree.newFolder',
      label: '新建文件夹',
      contextOnly: true,
      category: '文件',
      risk: 'local-write',
      visible: (context) => fileTarget(context)?.fileType === 'directory',
      action: (context) => {
        const target = requireFileTarget(context)
        if (!target.expanded) void useFsStore.getState().toggleDir(target.path)
        useFsStore.getState().startEditing('new-folder', target.path)
      },
    },
    {
      id: 'fileTree.openHtmlInBrowser',
      label: '用浏览器打开',
      contextOnly: true,
      category: '文件',
      visible: (context) => isHtml(fileTarget(context)),
      action: (context) => {
        const target = requireFileTarget(context)
        useTabStore.getState().openTab(buildHtmlBrowserTabDraft(target.path, target.name))
      },
    },
    {
      id: 'fileTree.openHtmlAsText',
      label: '以文本打开',
      contextOnly: true,
      category: '文件',
      visible: (context) => isHtml(fileTarget(context)),
      action: (context) => {
        const target = requireFileTarget(context)
        useTabStore.getState().openTab(buildHtmlTextTabDraft(target.path, target.name))
      },
    },
    {
      id: 'fileTree.sendToConversation',
      label: '发送到当前会话',
      contextOnly: true,
      category: '文件',
      action: (context) => {
        const target = requireFileTarget(context)
        const kind = target.fileType === 'directory' ? 'folder' : 'file'
        const resource: AgentMountedResource = {
          id: `${kind}:${target.path}`,
          kind,
          label: target.name,
          detail: target.path,
          ref: { type: kind, path: target.path },
        }
        const agentStore = useAgentStore.getState()
        agentStore.addMountedResource(resource, agentStore.activeConversationId)
        useToastStore.getState().show('已发送到当前会话资源栏', 'success')
      },
    },
    {
      id: 'fileTree.rename',
      label: '重命名',
      contextOnly: true,
      category: '文件',
      risk: 'local-write',
      action: async (context) => {
        const target = requireFileTarget(context)
        const inputValue = context?.inputValue
        if (inputValue === undefined) {
          useFsStore.getState().startEditing(target.path)
          return
        }
        const renamed = await useFsStore.getState().confirmRename(target.path, inputValue)
        if (!renamed) {
          throw new Error(useFsStore.getState().operationError ?? '文件重命名失败')
        }
      },
    },
    {
      id: 'fileTree.copyEntry',
      label: '复制',
      shortcut: '⌘C',
      contextOnly: true,
      category: '文件',
      action: (context) => {
        const target = requireFileTarget(context)
        if (!target.workspaceKey) throw new Error('当前文件没有本地工作区归属')
        useFsStore.getState().copyEntryToClipboard({
          workspacePath: target.workspaceKey,
          path: target.path,
          name: target.name,
          fileType: target.fileType,
        })
        useToastStore.getState().show(`已复制 ${target.name}`, 'success')
      },
    },
    {
      id: 'fileTree.pasteEntry',
      label: '粘贴',
      shortcut: '⌘V',
      contextOnly: true,
      category: '文件',
      risk: 'local-write',
      enabled: (context) => {
        const target = fileTarget(context)
        const clipboardEntry = useFsStore.getState().clipboardEntry
        if (!target) return { enabled: false, reason: '粘贴目标已失效' }
        if (!clipboardEntry) return { enabled: false, reason: '尚未复制文件或文件夹' }
        const targetDirectory = pasteTargetDirectory(target)
        if (
          clipboardEntry.fileType === 'directory' &&
          (targetDirectory === clipboardEntry.path ||
            targetDirectory.startsWith(`${clipboardEntry.path}/`))
        ) {
          return { enabled: false, reason: '文件夹不能复制到自身或其子目录' }
        }
        return true
      },
      action: async (context) => {
        const target = requireFileTarget(context)
        const result = await useFsStore.getState().pasteClipboardEntry(target.path, target.fileType)
        if (!result) {
          throw new Error(useFsStore.getState().operationError ?? '文件粘贴失败')
        }
        useToastStore
          .getState()
          .show(
            `已粘贴为 ${result.destinationPath.slice(result.destinationPath.lastIndexOf('/') + 1)}`,
            'success',
          )
      },
    },
    {
      id: 'fileTree.copyAbsolutePath',
      label: '复制绝对路径',
      contextOnly: true,
      category: '文件',
      action: (context) => copyText(requireFileTarget(context).path, '已复制绝对路径'),
    },
    {
      id: 'fileTree.copyRelativePath',
      label: '复制相对路径',
      contextOnly: true,
      category: '文件',
      action: (context) => {
        const target = requireFileTarget(context)
        const relativePath = toWorkspaceRelativePath(
          target.path,
          useFsStore.getState().workspacePath,
        )
        return copyText(
          relativePath,
          relativePath === target.path ? '已复制路径' : '已复制相对路径',
        )
      },
    },
    {
      id: 'fileTree.revealInFileManager',
      label: '在 Finder 中显示',
      contextOnly: true,
      category: '文件',
      action: async (context) => {
        const target = requireFileTarget(context)
        if (!target.workspaceKey) throw new Error('当前文件没有本地工作区归属')
        await window.cclinkStudio.fs.revealPath({
          workspacePath: target.workspaceKey,
          targetPath: target.path,
        })
      },
    },
    {
      id: 'fileTree.extractZip',
      label: '解压到同名文件夹',
      contextOnly: true,
      category: '文件',
      risk: 'local-write',
      visible: (context) => fileTarget(context)?.extension === '.zip',
      action: async (context) => {
        const target = requireFileTarget(context)
        try {
          const result = await window.cclinkStudio.fs.extractZip(target.path)
          await useFsStore.getState().refreshDir(parentPath(target.path))
          useToastStore.getState().show(`已解压到 ${result.targetDir}`, 'success')
        } catch (error) {
          useToastStore.getState().show(`解压失败: ${String(error)}`, 'error')
        }
      },
    },
    {
      id: 'fileTree.exportMarkdownZip',
      label: '导出 Markdown ZIP',
      contextOnly: true,
      category: '文件',
      visible: (context) => isMarkdown(fileTarget(context)),
      action: async (context) => {
        const target = requireFileTarget(context)
        const result = await window.cclinkStudio.dialog.showSaveDialog({
          title: '导出 Markdown 文档包',
          defaultPath: target.path.replace(/\.(?:md|markdown)$/i, '.zip'),
          filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
        })
        if (result.canceled || !result.filePath) return
        try {
          const exported = await window.cclinkStudio.fs.exportMarkdownDocumentZip({
            documentPath: target.path,
            targetPath: result.filePath,
          })
          await useFsStore.getState().refreshDir(parentPath(target.path))
          useToastStore
            .getState()
            .show(`已导出 ${exported.entries} 个文件到 ${exported.zipPath}`, 'success')
        } catch (error) {
          useToastStore
            .getState()
            .show(error instanceof Error ? error.message : 'Markdown ZIP 导出失败', 'error')
        }
      },
    },
    {
      id: 'fileTree.previewWechat',
      label: '预览微信格式',
      contextOnly: true,
      category: '文件',
      visible: (context) => isMarkdown(fileTarget(context)),
      action: (context) => {
        const target = requireFileTarget(context)
        useTabStore.getState().openTab({
          type: 'preview',
          title: `预览: ${target.name}`,
          icon: '👁️',
          filePath: target.path,
        })
      },
    },
    {
      id: 'fileTree.exportWechat',
      label: '导出微信格式',
      contextOnly: true,
      category: '文件',
      visible: (context) => isMarkdown(fileTarget(context)),
      action: async (context) => {
        const target = requireFileTarget(context)
        try {
          const file = await window.cclinkStudio.fs.readFile(target.path)
          const content = typeof file === 'string' ? file : file.content
          const result = await window.cclinkStudio.wechat.convert(content, target.path)
          if (result.error || !result.html) {
            useToastStore.getState().show(`转换失败: ${result.error ?? '未生成 HTML'}`, 'error')
            return
          }
          const blob = new Blob([result.html], { type: 'text/html' })
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
          const warnings = result.warnings ?? []
          useToastStore
            .getState()
            .show(
              warnings.length > 0
                ? `已复制，但有 ${warnings.length} 项图片提示`
                : `已复制${result.embeddedImages ? `，包含 ${result.embeddedImages} 张本地图片` : ''}`,
              warnings.length > 0 ? 'info' : 'success',
            )
        } catch (error) {
          useToastStore.getState().show(`导出失败: ${String(error)}`, 'error')
        }
      },
    },
    {
      id: 'fileTree.wechatUnsupported',
      label: '微信格式仅支持 Markdown 文件',
      contextOnly: true,
      category: '文件',
      visible: (context) => {
        const target = fileTarget(context)
        return Boolean(target && !isMarkdown(target) && !isHtml(target))
      },
      enabled: () => false,
      action: () => undefined,
    },
    {
      id: 'fileTree.trash',
      label: '移到废纸篓…',
      contextOnly: true,
      category: '文件',
      risk: 'destructive',
      action: async (context) => {
        const target = requireFileTarget(context)
        if (!target.workspaceKey) throw new Error('当前文件没有本地工作区归属')
        const markdown = isMarkdown(target)
        const inspection = markdown
          ? await window.cclinkStudio.fs.inspectMarkdownDocument(target.path)
          : null
        const hasAssets = Boolean(inspection?.assetDirectoryPresent || inspection?.legacyAssetDir)
        const confirmation = await window.cclinkStudio.dialog.showMessageBox({
          type: 'warning',
          title: '移到废纸篓',
          message: `要删除 ${target.name} 吗？`,
          detail: hasAssets
            ? '该文档有配套资源目录。你可以只删除 Markdown，或将正文和资源一起移到废纸篓。'
            : '文件将移到系统废纸篓，可以从废纸篓恢复。',
          buttons: hasAssets ? ['取消', '仅 Markdown', 'Markdown 和资源'] : ['取消', '移到废纸篓'],
          defaultId: hasAssets ? 2 : 1,
          cancelId: 0,
        })
        if (confirmation.response === 0) return
        const includeAssets = hasAssets && confirmation.response === 2
        const result = markdown
          ? await window.cclinkStudio.fs.trashMarkdownDocument({
              workspacePath: target.workspaceKey,
              documentPath: target.path,
              includeAssets,
            })
          : {
              trashedPaths: [
                (
                  await window.cclinkStudio.fs.trashPath({
                    workspacePath: target.workspaceKey,
                    targetPath: target.path,
                  })
                ).trashedPath,
              ],
              failedPaths: [],
            }
        removeTrashedTargets(result.trashedPaths)
        await useFsStore.getState().refreshDir(parentPath(target.path))
        if (result.failedPaths.length > 0) {
          useToastStore
            .getState()
            .show(
              `Markdown 已移到废纸篓，但 ${result.failedPaths.length} 个资源目录未能移动`,
              'error',
            )
        } else {
          useToastStore
            .getState()
            .show(
              includeAssets ? 'Markdown 和资源已移到废纸篓' : `${target.name} 已移到废纸篓`,
              'success',
            )
        }
      },
    },
  ]
}

export const fileMenuContributions: MenuContribution[] = [
  {
    id: 'file.new-file',
    targetKinds: ['file'],
    group: '10-create',
    order: 10,
    commandId: 'fileTree.newFile',
    icon: '📄',
  },
  {
    id: 'file.new-folder',
    targetKinds: ['file'],
    group: '10-create',
    order: 20,
    commandId: 'fileTree.newFolder',
    icon: '📁',
  },
  {
    id: 'file.open-html-browser',
    targetKinds: ['file'],
    group: '20-open',
    order: 10,
    commandId: 'fileTree.openHtmlInBrowser',
    icon: '🌐',
  },
  {
    id: 'file.open-html-text',
    targetKinds: ['file'],
    group: '20-open',
    order: 20,
    commandId: 'fileTree.openHtmlAsText',
    icon: '</>',
  },
  {
    id: 'file.send',
    targetKinds: ['file'],
    group: '30-edit',
    order: 10,
    commandId: 'fileTree.sendToConversation',
    icon: '↗',
  },
  {
    id: 'file.rename',
    targetKinds: ['file'],
    group: '30-edit',
    order: 20,
    commandId: 'fileTree.rename',
    icon: '✎',
    inlineInput: {
      ariaLabel: '重命名文件或文件夹',
      initialValue: (context) => fileTarget(context)?.name ?? '',
    },
  },
  {
    id: 'file.copy-entry',
    targetKinds: ['file'],
    group: '40-copy',
    order: 10,
    commandId: 'fileTree.copyEntry',
    icon: '⧉',
  },
  {
    id: 'file.paste-entry',
    targetKinds: ['file'],
    group: '40-copy',
    order: 20,
    commandId: 'fileTree.pasteEntry',
    icon: '▣',
  },
  {
    id: 'file.copy-absolute',
    targetKinds: ['file'],
    group: '40-copy',
    order: 30,
    commandId: 'fileTree.copyAbsolutePath',
    icon: '📋',
  },
  {
    id: 'file.copy-relative',
    targetKinds: ['file'],
    group: '40-copy',
    order: 40,
    commandId: 'fileTree.copyRelativePath',
    icon: '📎',
  },
  {
    id: 'file.reveal',
    targetKinds: ['file'],
    group: '40-copy',
    order: 50,
    commandId: 'fileTree.revealInFileManager',
    icon: '↗',
  },
  {
    id: 'file.extract-zip',
    targetKinds: ['file'],
    group: '50-package',
    order: 10,
    commandId: 'fileTree.extractZip',
    icon: '📦',
  },
  {
    id: 'file.export-md-zip',
    targetKinds: ['file'],
    group: '50-package',
    order: 20,
    commandId: 'fileTree.exportMarkdownZip',
    icon: '📦',
  },
  {
    id: 'file.preview-wechat',
    targetKinds: ['file'],
    group: '60-wechat',
    order: 10,
    commandId: 'fileTree.previewWechat',
    icon: '👁️',
  },
  {
    id: 'file.export-wechat',
    targetKinds: ['file'],
    group: '60-wechat',
    order: 20,
    commandId: 'fileTree.exportWechat',
    icon: '📋',
  },
  {
    id: 'file.wechat-unsupported',
    targetKinds: ['file'],
    group: '60-wechat',
    order: 30,
    commandId: 'fileTree.wechatUnsupported',
    icon: 'ⓘ',
  },
  {
    id: 'file.trash',
    targetKinds: ['file'],
    group: '90-danger',
    order: 10,
    commandId: 'fileTree.trash',
    icon: '⌫',
  },
]
