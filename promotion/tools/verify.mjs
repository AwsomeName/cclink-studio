import { createRequire } from 'node:module'
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import { createHash } from 'node:crypto'

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(process.env.PROMOTION_NODE_MODULES || '/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', 'promotion-entry.cjs'))
const sharp = require('sharp')
async function filesAt(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await filesAt(path))
    else files.push(path)
  }
  return files
}
const files = await filesAt(kit)
const errors = []
let checkedReferences = 0
async function checkLink(owner, target) {
  if (!target || /^(https?:|data:|mailto:|#)/.test(target)) return
  const relative = decodeURIComponent(target.split('#')[0].split('?')[0])
  try { await stat(resolve(dirname(owner), relative)); checkedReferences++ }
  catch { errors.push(`Broken reference: ${owner.slice(kit.length + 1)} -> ${target}`) }
}
for (const file of files.filter(f => ['.md', '.html'].includes(extname(f)))) {
  const source = await readFile(file, 'utf8')
  if (extname(file) === '.md') {
    const links = []
    marked.walkTokens(marked.lexer(source), token => {
      if (token.type === 'link' || token.type === 'image') links.push(token.href)
    })
    for (const link of links) await checkLink(file, link)
  } else {
    for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) await checkLink(file, match[1])
  }
  if (/^ +$/m.test(source) || /[\t ]+$/m.test(source)) errors.push(`Trailing whitespace: ${file.slice(kit.length + 1)}`)
}
const manifest = JSON.parse(await readFile(join(kit, 'assets/asset-manifest.json'), 'utf8'))
for (const item of manifest.assets) {
  const data = await readFile(join(kit, item.file))
  const meta = await sharp(data).metadata()
  if (meta.width !== item.width || meta.height !== item.height) errors.push(`Dimensions differ: ${item.file}`)
  if (item.file.endsWith('.png') && meta.format !== 'png') errors.push(`Invalid PNG type: ${item.file}`)
  if (item.file.endsWith('.jpg') && meta.format !== 'jpeg') errors.push(`Invalid JPEG type: ${item.file}`)
  if (createHash('sha256').update(data).digest('hex') !== item.sha256) errors.push(`Checksum differs: ${item.file}`)
}
for (const name of ['cover-square', 'card-01-introduction', 'card-02-workspace', 'card-03-get-started']) {
  const a = await readFile(join(kit, 'assets/graphics', name + '.png'))
  const b = await readFile(join(kit, '04-social/images', name + '.png'))
  if (!a.equals(b)) errors.push(`Social copy differs: ${name}`)
}
const drafts = []
for (const file of ['01-wechat/article.md', '02-open-source/article.md', '03-website/copy.md', '04-social/copy.md']) {
  const source = await readFile(join(kit, file), 'utf8')
  if (/TODO|TBD|待补图|图片占位/.test(source)) errors.push(`Placeholder in draft: ${file}`)
  if (!source.includes('费用') || !source.includes('macOS')) errors.push(`Usage conditions missing: ${file}`)
  drafts.push({ file, cjkCharacters: (source.match(/[\u3400-\u9fff]/g) || []).length, embeddedImages: (source.match(/!\[/g) || []).length })
}
const result = {
  date: '2026-10-16', scope: 'local-publicity-documents-and-images',
  passed: errors.length === 0, checkedReferences,
  graphics: manifest.assets.filter(a => a.kind === 'editorial-graphic').length,
  realScreenshots: manifest.assets.filter(a => a.kind === 'real-studio-screenshot').length,
  drafts, errors,
  excluded: ['Studio product acceptance', 'real model execution', 'platform upload or publication'],
}
await writeFile(join(kit, 'review/verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (errors.length) process.exitCode = 1
