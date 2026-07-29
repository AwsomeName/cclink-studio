/**
 * 微信公众号格式转换引擎
 *
 * 将 Markdown 文本转换为微信公众号编辑器兼容的 HTML（全内联样式）。
 * 在主进程中运行，利用 markdown-it + highlight.js + juice。
 */

import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import juice from 'juice'
import { readFile, stat } from 'fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'path'
import { fileURLToPath } from 'url'
import { imageMimeTypeForExtension } from '../../shared/file-types'
import { stripCclinkMarkdownMetadata } from '../../shared/markdown-document'

const MAX_EMBEDDED_IMAGES = 30
const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_EMBEDDED_IMAGE_BYTES = 25 * 1024 * 1024
const WECHAT_EMBEDDED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

// ─── 微信公众号默认主题 CSS ──────────────────────────────
// Atom One Dark 代码高亮 + 蓝色标题清新排版风格

const THEME_CSS = `
.wechat-content {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.75;
  color: #333333;
  word-break: break-word;
  padding: 0 8px;
}

/* 标题 */
.wechat-content h1 {
  font-size: 22px;
  font-weight: bold;
  color: #135ce0;
  margin: 30px 0 15px;
  text-align: center;
  line-height: 1.4;
}
.wechat-content h2 {
  font-size: 20px;
  font-weight: bold;
  color: #135ce0;
  margin: 25px 0 12px;
  line-height: 1.4;
  padding-bottom: 6px;
  border-bottom: 2px solid #135ce0;
}
.wechat-content h3 {
  font-size: 18px;
  font-weight: bold;
  color: #135ce0;
  margin: 20px 0 10px;
  line-height: 1.4;
}
.wechat-content h4 {
  font-size: 16px;
  font-weight: bold;
  color: #333333;
  margin: 18px 0 8px;
  line-height: 1.4;
}
.wechat-content h5 {
  font-size: 15px;
  font-weight: bold;
  color: #333333;
  margin: 15px 0 6px;
}
.wechat-content h6 {
  font-size: 14px;
  font-weight: bold;
  color: #666666;
  margin: 12px 0 6px;
}

/* 段落 */
.wechat-content p {
  margin: 10px 0;
  letter-spacing: 0.5px;
}

/* 加粗 / 斜体 / 删除线 */
.wechat-content strong {
  color: #135ce0;
  font-weight: bold;
}
.wechat-content em {
  font-style: italic;
  color: #135ce0;
}
.wechat-content del {
  text-decoration: line-through;
  color: #999999;
}

/* 链接 */
.wechat-content a {
  color: #135ce0;
  text-decoration: none;
  border-bottom: 1px solid #135ce0;
}

/* 分割线 */
.wechat-content hr {
  border: none;
  border-top: 1px solid #dddddd;
  margin: 20px 0;
}

/* 引用块 */
.wechat-content blockquote {
  border-left: 3px solid #135ce0;
  background: #f7f7f7;
  padding: 12px 16px;
  margin: 15px 0;
  color: #666666;
  font-size: 14px;
}
.wechat-content blockquote p {
  margin: 5px 0;
}

/* 列表 */
.wechat-content ul {
  padding-left: 24px;
  margin: 10px 0;
  list-style-type: disc;
}
.wechat-content ol {
  padding-left: 24px;
  margin: 10px 0;
  list-style-type: decimal;
}
.wechat-content li {
  margin: 5px 0;
  line-height: 1.75;
}

/* 行内代码 */
.wechat-content code {
  background: #fff5f5;
  color: #ff502c;
  font-size: 90%;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

/* 代码块容器 */
.wechat-content pre {
  background: #282c34;
  border-radius: 5px;
  padding: 16px;
  overflow-x: auto;
  margin: 15px 0;
  line-height: 1.6;
}
.wechat-content pre code {
  background: transparent;
  color: #abb2bf;
  font-size: 13px;
  padding: 0;
  border-radius: 0;
  line-height: 1.6;
}

/* Atom One Dark 语法高亮色 */
.wechat-content .hljs-comment,
.wechat-content .hljs-quote {
  color: #5c6370;
  font-style: italic;
}
.wechat-content .hljs-keyword,
.wechat-content .hljs-selector-tag {
  color: #c678dd;
}
.wechat-content .hljs-string,
.wechat-content .hljs-addition {
  color: #98c379;
}
.wechat-content .hljs-number,
.wechat-content .hljs-literal {
  color: #d19a66;
}
.wechat-content .hljs-built_in,
.wechat-content .hljs-type {
  color: #e6c07b;
}
.wechat-content .hljs-title {
  color: #61afef;
}
.wechat-content .hljs-function .hljs-title {
  color: #61afef;
}
.wechat-content .hljs-attr,
.wechat-content .hljs-parameter {
  color: #d19a66;
}
.wechat-content .hljs-tag,
.wechat-content .hljs-name,
.wechat-content .hljs-property {
  color: #e06c75;
}
.wechat-content .hljs-variable,
.wechat-content .hljs-template-variable {
  color: #e06c75;
}
.wechat-content .hljs-regexp {
  color: #98c379;
}
.wechat-content .hljs-symbol,
.wechat-content .hljs-bullet {
  color: #56b6c2;
}
.wechat-content .hljs-meta {
  color: #61afef;
}
.wechat-content .hljs-deletion {
  color: #e06c75;
}
.wechat-content .hljs-section {
  color: #61afef;
  font-weight: bold;
}
.wechat-content .hljs-link {
  color: #56b6c2;
}
.wechat-content .hljs-selector-class {
  color: #d19a66;
}
.wechat-content .hljs-selector-id {
  color: #61afef;
}
.wechat-content .hljs-emphasis {
  font-style: italic;
}
.wechat-content .hljs-strong {
  font-weight: bold;
}

/* 表格 */
.wechat-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 15px 0;
  font-size: 14px;
}
.wechat-content thead {
  background: #135ce0;
  color: #ffffff;
}
.wechat-content th {
  padding: 8px 12px;
  font-weight: bold;
  text-align: left;
  border: 1px solid #dddddd;
}
.wechat-content td {
  padding: 8px 12px;
  border: 1px solid #dddddd;
}
.wechat-content tbody tr:nth-child(even) {
  background: #f7f7f7;
}

/* 图片 */
.wechat-content img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 15px auto;
  border-radius: 4px;
}
`

// ─── 初始化 markdown-it 解析器 ──────────────────────────

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
})
const defaultImageRenderer =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

/** 自定义围栏代码块渲染：带 class="hljs" 的 <pre> */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info?.trim() || ''
  const code = token.content || ''

  let highlighted: string
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(code, { language: lang }).value
    } catch {
      highlighted = md.utils.escapeHtml(code)
    }
  } else {
    highlighted = md.utils.escapeHtml(code)
  }

  return `<pre class="hljs"><code>${highlighted}</code></pre>`
}

/** 缩进代码块也用相同样式 */
md.renderer.rules.code_block = (tokens, idx) => {
  const code = md.utils.escapeHtml(tokens[idx].content)
  return `<pre class="hljs"><code>${code}</code></pre>`
}

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const source = tokens[idx].attrGet('src')
  const embeddedSources = (env as WechatMarkdownEnvironment | undefined)?.embeddedImageSources
  const embedded = source ? embeddedSources?.get(source) : undefined
  if (embedded) tokens[idx].attrSet('src', embedded)
  return defaultImageRenderer(tokens, idx, options, env, self)
}

// ─── 导出函数 ──────────────────────────────────────────

interface WechatMarkdownEnvironment {
  embeddedImageSources?: Map<string, string>
}

export interface WechatDocumentConversion {
  html: string
  embeddedImages: number
  warnings: string[]
}

/**
 * 将 Markdown 文本转换为微信公众号兼容的 HTML
 *
 * 所有样式通过 juice 内联化，可直接粘贴到公众号编辑器。
 */
export function convertMarkdownToWechatHTML(
  markdown: string,
  environment: WechatMarkdownEnvironment = {},
): string {
  // 预处理：GFM task list → Unicode checkbox
  const src = stripWechatPublishingMetadata(markdown)
    .replace(/^- \[x\] /gim, '- ☑ ')
    .replace(/^- \[ \] /gm, '- ☐ ')

  // 1. Markdown → HTML
  let html = md.render(src, environment)

  // 2. 包裹主题容器
  html = `<section class="wechat-content">${html}</section>`

  // 3. CSS 内联化：class 选择器 → inline style
  html = juice(html, {
    extraCss: THEME_CSS,
    preserveImportant: false,
  })

  // 4. 清洗：移除 class / data-* / 空 style
  html = cleanHTML(html)

  return html
}

export async function convertMarkdownDocumentToWechatHTML(
  markdown: string,
  documentPath?: string,
): Promise<WechatDocumentConversion> {
  const publishableMarkdown = stripWechatPublishingMetadata(markdown)
  if (!documentPath) {
    return {
      html: convertMarkdownToWechatHTML(publishableMarkdown),
      embeddedImages: 0,
      warnings: [],
    }
  }

  const imageSources = collectMarkdownImageSources(publishableMarkdown)
  const embeddedImageSources = new Map<string, string>()
  const warnings: string[] = []
  let totalBytes = 0

  for (const source of imageSources) {
    if (!isLocalImageSource(source)) continue
    if (embeddedImageSources.size >= MAX_EMBEDDED_IMAGES) {
      warnings.push(`本地图片超过 ${MAX_EMBEDDED_IMAGES} 张，剩余图片未嵌入`)
      break
    }

    try {
      const imagePath = resolveLocalImagePath(source, documentPath)
      const mimeType = imageMimeTypeForExtension(extname(imagePath))
      if (!mimeType || !WECHAT_EMBEDDED_IMAGE_TYPES.has(mimeType)) {
        warnings.push(`${source}：微信导出仅嵌入 PNG、JPEG、GIF 和 WebP`)
        continue
      }

      const fileStat = await stat(imagePath)
      if (!fileStat.isFile()) {
        warnings.push(`${source}：不是可读取的图片文件`)
        continue
      }
      if (fileStat.size <= 0 || fileStat.size > MAX_EMBEDDED_IMAGE_BYTES) {
        warnings.push(`${source}：单张图片不能超过 5MB`)
        continue
      }
      if (totalBytes + fileStat.size > MAX_TOTAL_EMBEDDED_IMAGE_BYTES) {
        warnings.push('本地图片总大小超过 25MB，剩余图片未嵌入')
        break
      }

      const content = await readFile(imagePath)
      embeddedImageSources.set(source, `data:${mimeType};base64,${content.toString('base64')}`)
      totalBytes += content.byteLength
    } catch {
      warnings.push(`${source}：本地图片不存在或无法读取`)
    }
  }

  return {
    html: convertMarkdownToWechatHTML(publishableMarkdown, { embeddedImageSources }),
    embeddedImages: embeddedImageSources.size,
    warnings: [...new Set(warnings)],
  }
}

export function stripWechatPublishingMetadata(markdown: string): string {
  let source = markdown.replace(/^\uFEFF/, '')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const withoutCclink = stripCclinkMarkdownMetadata(source).replace(
      /^<!--\s*cclink-document:\s*\{[^\r\n]*\}\s*-->\s*(?:\r?\n(?:\r?\n)?)?/,
      '',
    )
    const withoutFrontmatter = stripYamlFrontmatter(withoutCclink)
    if (withoutFrontmatter === source) break
    source = withoutFrontmatter
  }

  return source.replace(/^\s*\n/, '')
}

function stripYamlFrontmatter(source: string): string {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source)
  if (!match || !/^[A-Za-z0-9_-]+[ \t]*:/m.test(match[1])) return source
  return source.slice(match[0].length)
}

function collectMarkdownImageSources(markdown: string): string[] {
  const sources = new Set<string>()
  const visit = (tokens: ReturnType<typeof md.parse>): void => {
    for (const token of tokens) {
      if (token.type === 'image') {
        const source = token.attrGet('src')
        if (source) sources.add(source)
      }
      if (token.children) visit(token.children)
    }
  }
  visit(md.parse(markdown, {}))
  return [...sources]
}

function isLocalImageSource(source: string): boolean {
  return !/^(?:https?:|data:|blob:)/i.test(source) && !source.startsWith('#')
}

function resolveLocalImagePath(source: string, documentPath: string): string {
  const pathWithoutSuffix = source.split(/[?#]/, 1)[0]
  const decoded = decodeURIComponent(pathWithoutSuffix)
  if (/^file:/i.test(decoded)) return fileURLToPath(decoded)
  return isAbsolute(decoded) ? decoded : resolve(dirname(documentPath), decoded)
}

/** 清洗 HTML，移除微信公众号不需要的属性 */
function cleanHTML(html: string): string {
  // 移除 class 属性（样式已内联，class 无用）
  html = html.replace(/ class="[^"]*"/g, '')
  // 移除 data-* 属性
  html = html.replace(/ data-[a-z-]+="[^"]*"/g, '')
  // 移除空 style=""
  html = html.replace(/ style=""/g, '')
  return html
}
