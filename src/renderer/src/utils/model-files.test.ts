import { describe, expect, it } from 'vitest'
import { getModelFileIcon, getTabTypeForFile, isModelFileExtension } from './model-files'

describe('model-files', () => {
  it('将常用三维生产文件路由到模型预览 Tab', () => {
    for (const extension of ['.stl', '.3mf', '.step', '.stp']) {
      expect(isModelFileExtension(extension)).toBe(true)
      expect(getTabTypeForFile(extension)).toBe('model')
      expect(getModelFileIcon(extension)).not.toBe('📦')
    }
  })

  it('保持 GLB/GLTF/FBX 的既有模型预览路由', () => {
    for (const extension of ['.glb', '.gltf', '.fbx']) {
      expect(isModelFileExtension(extension)).toBe(true)
      expect(getTabTypeForFile(extension)).toBe('model')
    }
  })

  it('普通文本文件仍进入编辑器', () => {
    expect(isModelFileExtension('.md')).toBe(false)
    expect(getTabTypeForFile('.md')).toBe('editor')
  })

  it('Altium files use read-only preview including mixed-case extensions', () => {
    for (const extension of ['.SchDoc', '.schdoc', '.PCBDOC', '.PrjPcb']) {
      expect(getTabTypeForFile(extension)).toBe('file-preview')
    }
  })

  it('图片、Office 安全降级、主流媒体和压缩包进入只读文件预览 Tab', () => {
    for (const extension of [
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.odt',
      '.ods',
      '.odp',
      '.pages',
      '.numbers',
      '.key',
      '.mp4',
      '.mov',
      '.webm',
      '.m4v',
      '.mp3',
      '.wav',
      '.m4a',
      '.zip',
      '.tar',
      '.7z',
      '.rar',
    ]) {
      expect(getTabTypeForFile(extension)).toBe('file-preview')
    }
  })
})
