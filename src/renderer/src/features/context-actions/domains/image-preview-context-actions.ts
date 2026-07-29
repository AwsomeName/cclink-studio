import type { Command } from '../../../stores/command-store'
import { useToastStore } from '../../../components/common/Toast'
import type { CommandContext, ContextTarget } from '../context-target'
import { getImagePreviewContextSurface } from '../image-preview-context-surface'
import type { MenuContribution } from '../menu-contribution-registry'

type ImagePreviewTarget = Extract<ContextTarget, { kind: 'image-preview' }>

function imagePreviewTarget(context?: CommandContext): ImagePreviewTarget | null {
  return context?.target?.kind === 'image-preview' ? context.target : null
}

export function createImagePreviewContextCommands(): Command[] {
  return [
    {
      id: 'imagePreview.copyImage',
      label: '复制图片',
      shortcut: 'Cmd/Ctrl+C',
      contextOnly: true,
      category: '图片',
      visible: (context) => Boolean(imagePreviewTarget(context)),
      enabled: (context) => {
        const target = imagePreviewTarget(context)
        return target && getImagePreviewContextSurface(target.tabId)
          ? true
          : { enabled: false, reason: '图片预览尚未就绪' }
      },
      action: async (context) => {
        const target = imagePreviewTarget(context)
        const surface = target ? getImagePreviewContextSurface(target.tabId) : undefined
        if (!surface) throw new Error('图片预览尚未就绪')
        await surface.copyImage()
        useToastStore.getState().show('图片已复制', 'success')
      },
    },
  ]
}

export const imagePreviewMenuContributions: MenuContribution[] = [
  {
    id: 'image-preview.copy',
    targetKinds: ['image-preview'],
    group: '40-copy',
    order: 10,
    commandId: 'imagePreview.copyImage',
    icon: '⧉',
  },
]
