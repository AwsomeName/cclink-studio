/** 按步骤执行退出清理，单个资源失败不阻断后续资源释放。 */
export async function runShutdownStep(label: string, cleanup: () => void | Promise<void>): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    console.warn(`[CCLink Studio] ${label} 清理出错:`, error)
  }
}
