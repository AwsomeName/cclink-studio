import type { Tab } from '../types'
import { isHtmlFilePath } from './html-files'
import { isAltiumFileExtension } from '@shared/file-types'

export function isMarkdownPath(path?: string): boolean {
  return !path || /\.(md|markdown)$/i.test(path)
}

/** Available presentations only; never promises an unsupported editor. */
export function contentPresentation(tab: Tab): {
  label: string
  detail: string
  options: Array<{ id: string; label: string }>
  selected: string
} | null {
  if (tab.type === 'editor') {
    const markdown = isMarkdownPath(tab.filePath)
    return {
      label: markdown ? 'Markdown' : '源码',
      detail: '编辑与保存沿用当前文件；切换打开方式不创建文件副本',
      options:
        tab.filePath && markdown
          ? [
              { id: 'markdown', label: '正文编辑' },
              { id: 'source', label: 'Markdown 源码' },
            ]
          : isHtmlFilePath(tab.filePath)
            ? [
                { id: 'source', label: 'HTML 源码' },
                { id: 'html', label: '网页预览' },
              ]
            : [
                {
                  id: markdown ? 'markdown' : 'source',
                  label: markdown ? '正文编辑' : '文本 / 代码',
                },
              ],
      selected: markdown && tab.editorPresentation !== 'source' ? 'markdown' : 'source',
    }
  }
  if (tab.type === 'browser')
    return {
      label: '网页',
      detail: '原浏览器页面、账号与任务上下文保持不变',
      selected: 'html',
      options: isHtmlFilePath(tab.filePath)
        ? [
            { id: 'html', label: '网页预览' },
            { id: 'source', label: 'HTML 源码' },
          ]
        : [{ id: 'html', label: '浏览网页' }],
    }
  if (tab.type === 'model')
    return {
      label: '3D',
      detail: '模型查看；STEP 转换与受限修改需要已配置的 CAD 后端',
      selected: 'model',
      options: [{ id: 'model', label: '3D 查看' }],
    }
  if (
    tab.type === 'hardware-gerber' ||
    (tab.type === 'file-preview' && isAltiumFileExtension(tab.filePath?.match(/\.[^.]+$/)?.[0]))
  )
    return {
      label: '电路',
      detail: '只读查看图纸 / 板层；不会修改原工程',
      selected: 'circuit',
      options: [{ id: 'circuit', label: '电路预览（只读）' }],
    }
  if (tab.type === 'file-preview')
    return {
      label: '文件预览',
      detail: '支持的格式由原查看器展示；不支持时可使用系统应用打开',
      selected: 'preview',
      options: [{ id: 'preview', label: '预览（只读）' }],
    }
  return null
}
