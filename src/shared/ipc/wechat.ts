export interface WechatConvertResult {
  html?: string
  embeddedImages?: number
  warnings?: string[]
  error?: string
}

export interface WechatApiContract {
  convert: (markdown: string, documentPath?: string) => Promise<WechatConvertResult>
}

export interface WechatConvertInput {
  markdown: string
  documentPath?: string
}

export const wechatIpc = {
  convert: defineIpcCall<[input: WechatConvertInput], WechatConvertResult>('wechat:convert'),
} as const
import { defineIpcCall } from './contract'
