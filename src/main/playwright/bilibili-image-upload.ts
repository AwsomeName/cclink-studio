import type { FileChooser, Page } from 'playwright-core'

/** B站动态上传临时创建文件控件；由 Studio 接管本次文件选择，避免人工选图。 */
export async function uploadBilibiliImage(
  page: Page,
  selector: string,
  paths: string[],
  assertCurrent: () => void,
): Promise<void> {
  if (
    page.url() !== 'https://t.bilibili.com/' ||
    !['div.bili-dyn-publishing__tools__item.pic', 'div.bili-pics-uploader__add'].includes(
      selector,
    ) ||
    paths.length !== 1 ||
    !/\.(?:png|jpe?g|webp)$/iu.test(paths[0])
  )
    throw new Error('B站动态只允许通过当前图片入口选择一张已授权本地图')
  const target = page.locator(selector)
  if ((await target.count()) !== 1 || !(await target.isVisible()))
    throw new Error('B站图片入口不可见或不唯一')
  let resolveChooser!: (value: FileChooser) => void
  let rejectChooser!: (reason: Error) => void
  const ready = new Promise<FileChooser>((resolve, reject) => {
    resolveChooser = resolve
    rejectChooser = reject
  })
  void ready.catch(() => undefined)
  const onChooser = (chooser: FileChooser) => resolveChooser(chooser)
  const timeout = setTimeout(
    () => rejectChooser(new Error('B站没有返回本次图片入口的文件选择器，停止上传')),
    10_000,
  )
  page.on('filechooser', onChooser)
  try {
    assertCurrent()
    await target.click({ timeout: 8_000 })
    const chooser = await ready
    assertCurrent()
    if (chooser.page() !== page || page.url() !== 'https://t.bilibili.com/')
      throw new Error('B站文件选择器已离开当前页面')
    await chooser.setFiles(paths)
  } finally {
    clearTimeout(timeout)
    page.off('filechooser', onChooser)
  }
}
