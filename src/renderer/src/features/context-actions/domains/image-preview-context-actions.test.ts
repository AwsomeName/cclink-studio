import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../../components/common/Toast'
import {
  registerImagePreviewContextSurface,
  type ImagePreviewContextSurface,
} from '../image-preview-context-surface'
import {
  createImagePreviewContextCommands,
  imagePreviewMenuContributions,
} from './image-preview-context-actions'

const unregister: Array<() => void> = []

afterEach(() => {
  unregister.splice(0).forEach((dispose) => dispose())
  useToastStore.setState({ message: '', type: 'info', visible: false })
})

describe('image preview context actions', () => {
  it('copies through the active preview surface', async () => {
    const copyImage = vi.fn().mockResolvedValue(undefined)
    unregister.push(
      registerImagePreviewContextSurface('image-tab', {
        copyImage,
      } satisfies ImagePreviewContextSurface),
    )
    const command = createImagePreviewContextCommands().find(
      (item) => item.id === 'imagePreview.copyImage',
    )!
    const context = {
      source: 'shortcut' as const,
      target: {
        kind: 'image-preview' as const,
        workspaceKey: '/workspace',
        tabId: 'image-tab',
        filePath: '/workspace/figure.png',
      },
    }

    expect(command.enabled?.(context)).toBe(true)
    await command.action(context)

    expect(copyImage).toHaveBeenCalledOnce()
    expect(useToastStore.getState()).toMatchObject({
      message: '图片已复制',
      type: 'success',
      visible: true,
    })
    expect(imagePreviewMenuContributions[0]).toMatchObject({
      targetKinds: ['image-preview'],
      commandId: 'imagePreview.copyImage',
    })
  })

  it('reports an unavailable preview surface', () => {
    const command = createImagePreviewContextCommands().find(
      (item) => item.id === 'imagePreview.copyImage',
    )!

    expect(
      command.enabled?.({
        source: 'shortcut',
        target: {
          kind: 'image-preview',
          workspaceKey: '/workspace',
          tabId: 'missing-tab',
          filePath: '/workspace/figure.png',
        },
      }),
    ).toEqual({ enabled: false, reason: '图片预览尚未就绪' })
  })
})
