import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

export const conversationMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
})
const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell'])
const UNLABELLED_COMMAND =
  /^(?:sudo|git|pnpm|npm|yarn|bun|ls|pwd|cat|echo|printf|cd|mkdir|cp|mv|rm|curl|wget|brew|python3?|node|ssh|xcodebuild|read)\b/u

export function runnableCodeBlock(token: Token, source: string): boolean {
  if (token.type !== 'fence' && token.type !== 'code_block') return false
  const code = token.content.trim()
  if (!code || code.length > 4000 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(code)) return false
  const language = token.info.trim().split(/\s+/u)[0].toLowerCase()
  if (language ? !SHELL_LANGUAGES.has(language) : !UNLABELLED_COMMAND.test(code)) return false
  if (token.type === 'fence') {
    // markdown-it 也渲染未闭合 fence；中断生成的半条命令不能执行。
    const end = token.map?.[1]
    const lastLine = end ? source.split('\n')[end - 1]?.trim() : ''
    if (
      !lastLine ||
      !new RegExp(`^${token.markup[0]}{${token.markup.length},}\\s*$`).test(lastLine)
    )
      return false
  }
  return true
}

export function findCommandCodeBlock(source: string, line: number): string | null {
  const token = conversationMarkdown
    .parse(source, {})
    .find((item) => item.map?.[0] === line && runnableCodeBlock(item, source))
  return token?.content.trim() ?? null
}

export function commandNeedsTerminal(command: string): boolean {
  return (
    /(?:^|[\s;&|()])(?:sudo|su|ssh|read|select|vim?|nvim|nano|less|more|top|htop|watch|passwd|login|sftp)(?:\s|$)/u.test(
      command,
    ) ||
    /^(?:node|python3?|bash|zsh|sh)\s*$/u.test(command) ||
    /xcodebuild\s+-license\b/u.test(command)
  )
}

/** 只决定是否展示终端，不推断进程状态或命令成功。 */
export function terminalInteractionPrompt(output: string): string | null {
  const clean = output
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
  const tail =
    clean
      .split(/[\r\n]/u)
      .at(-1)
      ?.trim() ?? ''
  if (
    /(?:password|passphrase|密码|口令)[^\r\n]*[:：?？]\s*$/iu.test(tail) ||
    /(?:\[[yYnN/]+\]|\([yYnN/]+\)|\(yes\/no(?:\/[^)]*)?\))\s*[:?？]?\s*$/u.test(tail) ||
    /(?:press|hit)\s+(?:enter|return|any key)|按.*(?:回车|任意键)|(?:enter|input|请输入|输入).{0,100}[:：?？]\s*$/iu.test(
      tail,
    ) ||
    /^\?\s+.{1,200}/u.test(tail)
  )
    return tail
  return null
}
