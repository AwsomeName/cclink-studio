import { clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type {
  BrowserContext,
  BrowserContextAgentRequest,
  BrowserOpenTabRequest,
} from '../../shared/ipc/browser'
import { browserContextSchema, browserUrlSchema } from '../../shared/ipc/browser-schema'

const MAX_CONTEXT_TEXT_LENGTH = 8_000

export type BrowserContextActionId =
  | 'back'
  | 'forward'
  | 'reload'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'delete'
  | 'select-all'
  | 'copy-selection'
  | 'copy-link'
  | 'copy-image-url'
  | 'open-link'
  | 'open-image'
  | 'send-selection-to-agent'
  | 'send-link-to-agent'
  | 'send-image-to-agent'
  | 'send-page-to-agent'

export interface BrowserContextMenuBinding {
  workspaceKey: string | null
  tabId: string
  profileId: string | null
}

interface BrowserContextMenuOptions {
  context: BrowserContext
  webContents: WebContents
  validate: () => boolean
  requestOpenTab: (request: BrowserOpenTabRequest) => void
  requestAgentMount: (request: BrowserContextAgentRequest) => void
}

function boundedText(value: string): string {
  return value.replaceAll('\0', '').slice(0, MAX_CONTEXT_TEXT_LENGTH)
}

function optionalBrowserUrl(value: string | undefined): string | null {
  if (!value) return null
  const parsed = browserUrlSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function normalizeBrowserContext(
  binding: BrowserContextMenuBinding,
  pageUrl: string,
  params: {
    selectionText?: string
    linkURL?: string
    srcURL?: string
    isEditable?: boolean
    mediaType?: string
    editFlags?: Partial<BrowserContext['editFlags']>
  },
): BrowserContext | null {
  const candidate = {
    ...binding,
    pageUrl,
    selectionText: boundedText(params.selectionText ?? ''),
    linkUrl: optionalBrowserUrl(params.linkURL),
    srcUrl: optionalBrowserUrl(params.srcURL),
    isEditable: params.isEditable === true,
    mediaType: params.mediaType ?? 'none',
    editFlags: {
      canUndo: params.editFlags?.canUndo === true,
      canRedo: params.editFlags?.canRedo === true,
      canCut: params.editFlags?.canCut === true,
      canCopy: params.editFlags?.canCopy === true,
      canPaste: params.editFlags?.canPaste === true,
      canDelete: params.editFlags?.canDelete === true,
      canSelectAll: params.editFlags?.canSelectAll === true,
    },
  }
  const parsed = browserContextSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function separator(): MenuItemConstructorOptions {
  return { type: 'separator' }
}

export function buildBrowserContextMenuTemplate({
  context,
  webContents,
  validate,
  requestOpenTab,
  requestAgentMount,
}: BrowserContextMenuOptions): MenuItemConstructorOptions[] {
  const run =
    (action: () => void): (() => void) =>
    () => {
      if (!validate() || webContents.isDestroyed()) return
      action()
    }
  const open = (url: string): void =>
    requestOpenTab({
      initialUrl: url,
      workspaceKey: context.workspaceKey,
      profileId: context.profileId,
      forceNew: true,
    })
  const send = (
    source: BrowserContextAgentRequest['source'],
    values: Pick<BrowserContextAgentRequest, 'text' | 'url'> = {},
  ): void =>
    requestAgentMount({
      workspaceKey: context.workspaceKey,
      tabId: context.tabId,
      profileId: context.profileId,
      source,
      pageUrl: context.pageUrl,
      ...values,
    })

  const template: MenuItemConstructorOptions[] = [
    {
      id: 'back',
      label: '后退',
      enabled: webContents.canGoBack(),
      click: run(() => webContents.goBack()),
    },
    {
      id: 'forward',
      label: '前进',
      enabled: webContents.canGoForward(),
      click: run(() => webContents.goForward()),
    },
    { id: 'reload', label: '刷新', click: run(() => webContents.reload()) },
  ]

  if (context.isEditable) {
    template.push(
      separator(),
      {
        id: 'undo',
        label: '撤销',
        enabled: context.editFlags.canUndo,
        click: run(() => webContents.undo()),
      },
      {
        id: 'redo',
        label: '重做',
        enabled: context.editFlags.canRedo,
        click: run(() => webContents.redo()),
      },
      separator(),
      {
        id: 'cut',
        label: '剪切',
        enabled: context.editFlags.canCut,
        click: run(() => webContents.cut()),
      },
      {
        id: 'copy',
        label: '复制',
        enabled: context.editFlags.canCopy,
        click: run(() => webContents.copy()),
      },
      {
        id: 'paste',
        label: '粘贴',
        enabled: context.editFlags.canPaste,
        click: run(() => webContents.paste()),
      },
      {
        id: 'delete',
        label: '删除',
        enabled: context.editFlags.canDelete,
        click: run(() => webContents.delete()),
      },
      {
        id: 'select-all',
        label: '全选',
        enabled: context.editFlags.canSelectAll,
        click: run(() => webContents.selectAll()),
      },
    )
  } else if (context.selectionText) {
    template.push(separator(), {
      id: 'copy-selection',
      label: '复制选中文本',
      click: run(() => clipboard.writeText(context.selectionText)),
    })
  }

  if (context.linkUrl) {
    template.push(
      separator(),
      { id: 'open-link', label: '在新 Tab 打开链接', click: run(() => open(context.linkUrl!)) },
      {
        id: 'copy-link',
        label: '复制链接',
        click: run(() => clipboard.writeText(context.linkUrl!)),
      },
      {
        id: 'send-link-to-agent',
        label: '将链接挂到 Agent',
        click: run(() => send('link', { url: context.linkUrl! })),
      },
    )
  }

  if (context.mediaType === 'image' && context.srcUrl) {
    template.push(
      separator(),
      {
        id: 'open-image',
        label: '在新 Tab 打开图片',
        click: run(() => open(context.srcUrl!)),
      },
      {
        id: 'copy-image-url',
        label: '复制图片地址',
        click: run(() => clipboard.writeText(context.srcUrl!)),
      },
      {
        id: 'send-image-to-agent',
        label: '将图片挂到 Agent',
        click: run(() => send('image', { url: context.srcUrl! })),
      },
    )
  }

  if (context.selectionText) {
    template.push({
      id: 'send-selection-to-agent',
      label: '将选中文本挂到 Agent',
      click: run(() => send('selection', { text: context.selectionText })),
    })
  } else if (!context.linkUrl && !(context.mediaType === 'image' && context.srcUrl)) {
    template.push(separator(), {
      id: 'send-page-to-agent',
      label: '将当前页面挂到 Agent',
      click: run(() => send('page', { url: context.pageUrl })),
    })
  }

  return template
}

export function showBrowserContextMenu(
  window: Electron.BrowserWindow,
  options: BrowserContextMenuOptions,
): void {
  Menu.buildFromTemplate(buildBrowserContextMenuTemplate(options)).popup({ window })
}
