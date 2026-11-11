import { prepareAgentImage } from './prepare-agent-image'

globalThis.onmessage = async (event: MessageEvent<File>) => {
  try {
    globalThis.postMessage({ result: await prepareAgentImage(event.data) })
  } catch (error) {
    globalThis.postMessage({
      error: error instanceof Error ? error.message : '图片解码失败，请检查文件是否损坏',
    })
  }
}
