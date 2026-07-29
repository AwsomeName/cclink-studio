export interface WechatConvertResult {
  html?: string
  embeddedImages?: number
  warnings?: string[]
  error?: string
}

export interface WechatApiContract {
  convert: (markdown: string, documentPath?: string) => Promise<WechatConvertResult>
}
