export interface ImageClipboardEnvironment {
  createClipboardItem(items: Record<string, Blob>): ClipboardItem
  write(items: ClipboardItem[]): Promise<void>
  convertToPng(blob: Blob): Promise<Blob>
}

export async function copyBase64ImageToClipboard(
  content: string,
  mimeType: string,
  environment: ImageClipboardEnvironment = browserImageClipboardEnvironment(),
): Promise<void> {
  if (!mimeType.startsWith('image/')) throw new Error('当前内容不是图片')
  const source = base64ToBlob(content, mimeType)
  const png = mimeType === 'image/png' ? source : await environment.convertToPng(source)
  await environment.write([environment.createClipboardItem({ 'image/png': png })])
}

export function base64ToBlob(content: string, mimeType: string): Blob {
  const decoded = atob(content)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

function browserImageClipboardEnvironment(): ImageClipboardEnvironment {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前系统剪贴板不支持复制图片')
  }
  return {
    createClipboardItem: (items) => new ClipboardItem(items),
    write: (items) => navigator.clipboard.write(items),
    convertToPng,
  }
}

async function convertToPng(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片转换画布')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('图片转换为 PNG 失败'))),
        'image/png',
      )
    })
  } finally {
    bitmap.close()
  }
}
