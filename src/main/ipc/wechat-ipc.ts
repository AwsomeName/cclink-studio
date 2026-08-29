/**
 * 微信公众号格式转换 IPC 处理器
 */

import { wechatIpcContracts } from '../../shared/ipc/workbench-contract'
import { convertMarkdownDocumentToWechatHTML } from '../wechat/convert'
import { registerTrustedIpcContract, type TrustedRendererGuard } from './trusted-renderer-guard'

export function registerWechatIPC(trustedRendererGuard: TrustedRendererGuard): void {
  registerTrustedIpcContract(
    wechatIpcContracts.convert,
    trustedRendererGuard,
    async (_event, input) => {
      try {
        return await convertMarkdownDocumentToWechatHTML(input.markdown, input.documentPath)
      } catch (error) {
        return { error: String(error) }
      }
    },
  )
}
