import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { marked } from 'marked'

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localRequire = createRequire(import.meta.url)
let sharp
try { sharp = localRequire('sharp') } catch {
  const modules = process.env.PROMOTION_NODE_MODULES || '/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
  sharp = createRequire(join(modules, 'promotion-entry.cjs'))('sharp')
}

const navy = '#1c2d40'
const ink = '#263b4c'
const blue = '#427de4'
const mute = '#687984'
const cream = '#f5f3ee'
const line = '#d9dedf'
const font = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
const icon = `data:image/png;base64,${(await readFile(join(kit, '../resources/icon.png'))).toString('base64')}`
const editor = `data:image/jpeg;base64,${(await readFile(join(kit, 'assets/screenshots/studio-writing.jpg'))).toString('base64')}`
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const text = (x, y, s, size = 24, color = ink, weight = 400, attrs = '') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" ${attrs}>${esc(s)}</text>`
const rect = (x, y, w, h, fill, radius = 0, stroke = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`
const path = (d, stroke = line, width = 2) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`
const image = (x, y, w, h, source) => `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${source}" preserveAspectRatio="xMidYMid meet"/>`
const svg = (w, h, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><rect width="${w}" height="${h}" fill="${cream}"/><g font-family="${font}">${content}</g></svg>`
const brand = (x, y, size = 62) => image(x, y, size, size, icon) + text(x + size + 20, y + size * .68, 'CCLink Studio', size * .43, navy, 650)
const chip = (x, y, label, w = 158) => rect(x, y, w, 48, '#e7edf5', 24) + text(x + w / 2, y + 31, label, 22, '#3d5b7b', 500, 'text-anchor="middle"')
const assets = []
async function saveGraphic(name, source, output = 'assets/graphics') {
  const base = join(kit, output)
  await mkdir(base, { recursive: true })
  const svgPath = join(base, name + '.svg')
  const pngPath = join(base, name + '.png')
  await writeFile(svgPath, source)
  await sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toFile(pngPath)
  const meta = await sharp(pngPath).metadata()
  const buffer = await readFile(pngPath)
  assets.push({ file: `${output}/${name}.png`, source: `${output}/${name}.svg`, kind: 'editorial-graphic', width: meta.width, height: meta.height, sha256: createHash('sha256').update(buffer).digest('hex') })
}

await saveGraphic('cover-wide', svg(1600, 900,
  brand(80, 66, 72) + text(1520, 112, 'OPEN SOURCE / LOCAL FIRST', 19, mute, 500, 'text-anchor="end" letter-spacing="2"') +
  path('M80 176H1520') + text(80, 305, '把 AI 带进', 86, navy, 650) + text(80, 414, '你的工作现场', 86, navy, 650) +
  text(84, 490, '网页、文档、文件与 AI 协作', 28, mute) + chip(80, 546, '本地优先') + chip(254, 546, '免费本地能力', 202) + chip(472, 546, 'GPL-3.0-only', 200) +
  image(1090, 245, 370, 370, icon) + path('M80 694H1520') +
  [ ['01', '本地文件'], ['02', '内嵌网页'], ['03', 'Markdown'], ['04', 'Agent 协作'] ].map(([n, s], i) => text(80 + i * 370, 747, n, 21, blue, 600) + text(125 + i * 370, 747, s, 27, ink, 500)).join('') +
  text(80, 845, '本地能力免费免 CCLink 登录 · AI 服务自行配置并承担费用', 20, mute) + text(1520, 845, 'CCLink Studio', 22, navy, 600, 'text-anchor="end"')
))

const steps = [
  ['01', '材料归位', '打开本地资料', '浏览参考网页'],
  ['02', '说明任务', '明确目标与范围', '提供需要参考的材料'],
  ['03', '工具协作', 'Agent 读取或修改文档', '在授权范围内操作网页'],
  ['04', '检查保存', '核对事实并修改表达', '把成果保存在文件里'],
]
await saveGraphic('workflow', svg(1600, 820,
  text(80, 80, 'CCLink Studio / 协作方式示意', 22, mute, 500) + text(80, 167, '从资料到可修改的成果', 56, navy, 650) + text(80, 221, '在一个工作空间里展开协作', 25, mute) +
  steps.map(([n, title, a, b], i) => {
    const x = 80 + i * 370
    return rect(x, 294, 330, 300, '#ffffff', 22, line) + text(x + 28, 365, n, 46, blue, 550) + text(x + 28, 430, title, 31, navy, 600) + text(x + 28, 490, a, 22, mute) + text(x + 28, 528, b, 22, mute) + (i < 3 ? text(x + 340, 457, '→', 28, blue) : '')
  }).join('') +
  rect(80, 650, 1440, 76, '#e7edf5', 18) + text(800, 698, '打开材料 → 明确范围 → Agent 协助 → 检查并保存', 27, '#395979', 500, 'text-anchor="middle"') +
  text(80, 785, 'Agent 需配置运行时与模型服务。网页操作以本次授权及站点条件为准。', 20, mute)
))

const box = (x, y, title, a, b) => rect(x, y, 360, 180, '#fff', 22, line) + text(x + 30, y + 61, title, 31, navy, 600) + text(x + 30, y + 108, a, 22, mute) + text(x + 30, y + 143, b, 22, mute)
await saveGraphic('capability-map', svg(1600, 1000,
  text(80, 82, 'CCLink Studio / 能力关系示意', 22, mute, 500) + text(80, 170, '围绕一件事情组织工作', 56, navy, 650) +
  path('M440 360H490V455H550M1160 360H1110V455H1050M440 730H490V545H550M1160 730H1110V545H1050M800 610V700', '#9fb7d2', 3) +
  box(80, 280, '本地文件', '组织参考资料', '保存工作成果') + box(1160, 280, 'Markdown', '编辑与检查文档', '继续修改和保存') +
  box(80, 640, '内嵌浏览器', '浏览参考网页', '授权范围内的网页操作') + box(1160, 640, '本地终端', '在工作空间运行命令', '查看命令输出') +
  rect(550, 390, 500, 220, navy, 28) + text(800, 475, '工作空间', 54, '#ffffff', 600, 'text-anchor="middle"') + text(800, 532, '材料 · 操作 · 结果', 26, '#c6d3e4', 400, 'text-anchor="middle"') +
  rect(550, 700, 500, 138, '#e7edf5', 22) + text(800, 753, 'Agent', 32, '#365e9b', 600, 'text-anchor="middle"') + text(800, 796, '结合指定材料，通过工具参与操作', 23, '#49637e', 400, 'text-anchor="middle"') +
  text(80, 939, '本地能力免费免 CCLink 登录 · AI 服务自行配置并承担费用', 22, mute)
))

await saveGraphic('cover-square', svg(1080, 1080,
  brand(64, 58, 66) + path('M64 174H1016') + text(64, 242, '开源 AI 桌面工作台', 25, blue, 500) +
  text(64, 366, '把 AI 带进', 80, navy, 650) + text(64, 465, '你的工作现场', 80, navy, 650) +
  text(68, 542, '文件 · 网页 · Markdown · 终端', 29, mute) +
  path('M64 636H1016') + image(64, 707, 180, 180, icon) + text(292, 778, '本地能力免费', 43, navy, 600) + text(292, 842, '免 CCLink 登录', 34, mute) +
  text(64, 970, 'AI 服务自行配置并承担费用 · 当前支持 macOS', 23, mute) + text(64, 1024, 'github.com/AwsomeName/cclink-studio', 23, navy, 500)
))

await saveGraphic('card-01-introduction', svg(1080, 1440,
  brand(64, 58, 66) + text(1016, 106, '01 / 03', 22, mute, 500, 'text-anchor="end"') + path('M64 172H1016') +
  text(64, 264, '把资料和 AI 协作', 65, navy, 650) + text(64, 352, '放进一个工作空间', 65, navy, 650) + text(64, 419, 'CCLink Studio 开源桌面工作台', 28, mute) +
  rect(64, 508, 952, 242, navy, 24) + text(110, 589, '从一个本地文件夹开始', 39, '#fff', 600) + text(110, 649, '组织资料，展开讨论，保存成果。', 29, '#cbd7e8') + text(110, 705, '文件 · 网页 · Markdown · 终端 · Agent', 25, '#cbd7e8') +
  [ ['01', '打开材料', '让文件与参考网页有共同的归属。'], ['02', '协作处理', '根据指定材料与目标使用 Agent 工具。'], ['03', '检查成果', '回到自己的文件，继续修改和保存。'] ].map(([n, t, s], i) => text(64, 858 + 128 * i, n, 28, blue, 600) + text(126, 858 + 128 * i, t, 32, navy, 600) + text(126, 907 + 128 * i, s, 25, mute)).join('') +
  path('M64 1286H1016') + text(64, 1342, '本地能力免费免 CCLink 登录', 25, navy, 500) + text(64, 1384, 'AI 服务自行配置并承担费用 · 当前支持 macOS', 22, mute)
))

await saveGraphic('card-02-workspace', svg(1080, 1440,
  brand(64, 58, 66) + text(1016, 106, '02 / 03', 22, mute, 500, 'text-anchor="end"') + path('M64 172H1016') +
  text(64, 264, '资料、文档和 AI', 65, navy, 650) + text(64, 352, '待在同一个工作空间', 65, navy, 650) +
  rect(48, 415, 984, 632, '#e5e5e0', 14) + image(56, 425, 968, 602, editor) +
  text(64, 1124, '左侧', 25, blue, 600) + text(164, 1124, '组织本地资料', 31, navy, 500) +
  text(64, 1194, '中间', 25, blue, 600) + text(164, 1194, '阅读和编辑 Markdown', 31, navy, 500) +
  text(64, 1264, '右侧', 25, blue, 600) + text(164, 1264, '准备 Agent 协作任务', 31, navy, 500) +
  path('M64 1310H1016') + text(64, 1362, '真实开发版界面 · 演示材料 · 指令待发送', 23, mute)
))

await saveGraphic('card-03-get-started', svg(1080, 1440,
  brand(64, 58, 66) + text(1016, 106, '03 / 03', 22, mute, 500, 'text-anchor="end"') + path('M64 172H1016') +
  text(64, 270, '从一个文件夹开始', 65, navy, 650) + text(64, 338, '带着一件具体的工作，来试试。', 30, mute) +
  [ ['01', '打开本地工作空间', '把笔记、草稿和参考材料放在一起。'], ['02', '根据需要配置 Agent', '当前完整工具 Agent 使用 Claude Code 后端。'], ['03', '参与这个开源项目', '试用、反馈、完善文档或贡献代码。'] ].map(([n, t, s], i) => rect(64, 414 + i * 158, 952, 136, '#fff', 18, line) + text(92, 473 + i * 158, n, 27, blue, 600) + text(158, 472 + i * 158, t, 32, navy, 550) + text(158, 519 + i * 158, s, 24, mute)).join('') +
  rect(64, 945, 952, 220, '#e7edf5', 22) + text(96, 1003, 'GPL-3.0-only 开源 · 当前支持 macOS', 29, '#365e9b', 550) + text(96, 1061, '本地能力免费，免 CCLink 登录。', 27, ink) + text(96, 1114, '模型账号、API 与调用费用由用户自行配置和承担。', 24, mute) +
  text(64, 1270, '查看源码与上手说明', 32, navy, 600) + text(64, 1330, 'github.com/AwsomeName/cclink-studio', 28, blue, 500)
))

const stylesheet = `
:root{color-scheme:light;--ink:#203448;--mute:#697b88;--paper:#f6f4ef;--blue:#3c73d3;--line:#dde1e1}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif;-webkit-font-smoothing:antialiased}a{color:var(--blue);text-underline-offset:4px}a:hover{color:#174d9c}img{max-width:100%;height:auto;display:block}header.top{background:rgba(246,244,239,.96);border-bottom:1px solid var(--line);padding:16px 5%;display:flex;justify-content:space-between;align-items:center;gap:16px}.wordmark{display:flex;align-items:center;gap:12px;color:var(--ink);text-decoration:none;font-size:17px;font-weight:650}.wordmark img{width:36px;height:36px}.top nav{display:flex;gap:22px;font-size:13px}.top nav a{color:var(--mute);text-decoration:none}.preview-meta{max-width:1060px;margin:44px auto 18px;padding:0 42px;display:flex;justify-content:space-between;gap:12px;color:var(--mute);font-size:13px;letter-spacing:.5px}.article{max-width:1060px;margin:0 auto 72px;background:#fff;padding:52px 64px 72px;border:1px solid #e2e5e4;border-radius:4px;box-shadow:0 12px 45px #23384c05;font-size:18px;line-height:1.95;overflow-wrap:anywhere}.article h1{font-size:36px;line-height:1.45;letter-spacing:-.5px;margin:0 0 32px;font-weight:650}.article h2{font-size:26px;line-height:1.5;margin:54px 0 22px;letter-spacing:-.3px}.article p{margin:20px 0}.article strong{color:#1d3956;font-weight:650}.article p:has(>em:only-child){font-size:13px;color:var(--mute);line-height:1.75;margin-top:12px}.article em{font-style:normal}.article figure{margin:34px -26px 16px}.article figure img{width:100%;border:1px solid #e3e7e7;border-radius:4px}.article figure a{display:block}.article ul,.article ol{padding-left:1.5em}.article li{margin:10px 0}.article pre{background:#1b2c3e;color:#dce7f4;padding:26px;border-radius:10px;overflow:auto;font-size:14px;line-height:1.8}.article code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.article p code{background:#eef2f4;padding:2px 5px;border-radius:4px;font-size:.86em}.article table{border-collapse:collapse;width:100%;margin:30px 0;font-size:15px;line-height:1.8}.article td,.article th{padding:15px 17px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}.article th{background:#f2f5f7;font-weight:600}.article td:first-child{min-width:130px}.article blockquote{border-left:3px solid var(--blue);margin:30px 0;padding:2px 22px;background:#f0f4fa}.article figure:has(img[src*="graphics/card"]),.article figure:has(img[src*="graphics/cover-square"]){max-width:570px;margin-left:auto;margin-right:auto}.bottom{max-width:1060px;margin:0 auto 50px;padding:0 42px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:15px;font-size:13px;color:var(--mute)}.kit{max-width:1240px;margin:0 auto;padding:68px 42px}.eyebrow{color:var(--blue);font-size:13px;letter-spacing:1.8px}.kit h1{font-size:48px;letter-spacing:-1px;line-height:1.3;margin:18px 0}.lead{font-size:19px;color:var(--mute);max-width:770px;line-height:1.9}.summary{display:flex;gap:10px;flex-wrap:wrap;margin:25px 0 44px}.summary span{font-size:13px;padding:8px 14px;border:1px solid #d6dfe5;border-radius:30px;color:#47637e}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:38px 0 64px}.channel{background:#fff;border:1px solid #e1e5e5;border-radius:12px;overflow:hidden}.channel>a{display:block}.channel .thumb{width:100%;aspect-ratio:16/9;object-fit:cover}.channel .info{padding:26px 28px 30px}.channel .num{font-size:12px;color:var(--blue);letter-spacing:2px}.channel h2{font-size:25px;margin:10px 0 13px}.channel p{color:var(--mute);font-size:15px;line-height:1.9;margin:0 0 20px}.actions{display:flex;gap:20px;font-size:14px}.asset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:24px 0 54px}.asset{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13px;line-height:1.8}.asset img{width:100%;aspect-ratio:1.6;object-fit:contain;background:#f0eee9}.asset p{padding:0 16px}.section-title{font-size:26px;margin:48px 0 16px}.note{font-size:14px;color:var(--mute);line-height:1.9}.resource-links{display:flex;gap:25px;flex-wrap:wrap;font-size:14px;padding:25px 0;border-top:1px solid var(--line)}
@media(max-width:680px){header.top{padding:14px 18px}.top nav{gap:13px;font-size:12px}.top nav .secondary{display:none}.preview-meta{padding:0 18px;margin-top:27px;font-size:12px}.article{border-left:0;border-right:0;padding:30px 22px 44px;margin-bottom:35px;border-radius:0;font-size:17px;line-height:1.95}.article h1{font-size:28px;margin-bottom:26px}.article h2{font-size:23px;margin-top:40px}.article figure{margin:26px -10px 12px}.article table{font-size:13px}.article td,.article th{padding:11px 9px}.article td:first-child{min-width:86px}.article pre{padding:18px;font-size:12px}.bottom{padding:0 20px}.kit{padding:39px 20px}.kit h1{font-size:35px}.lead{font-size:17px}.gallery{grid-template-columns:1fr;gap:22px}.channel .info{padding:22px}.asset-grid{grid-template-columns:1fr 1fr;gap:12px}.resource-links{gap:16px}.asset p{padding:0 10px;font-size:12px}}
@media print{header.top,.preview-meta,.bottom{display:none}body{background:#fff}.article{border:0;box-shadow:none;padding:0;max-width:100%;font-size:12pt}.article h2{break-after:avoid}.article figure{break-inside:avoid;margin:20px 0}.article pre{white-space:pre-wrap}.article table{font-size:10pt}}
`
await writeFile(join(kit, 'assets/style.css'), stylesheet)

const channels = [
  { directory: '01-wechat', source: 'article.md', title: '公众号与项目首发', desc: '从日常工作的麻烦讲起，介绍工作空间、Agent 协作和使用条件。', image: 'assets/graphics/cover-wide.png' },
  { directory: '02-open-source', source: 'article.md', title: 'GitHub 与开源社区', desc: '交代当前本地能力、技术栈、启动方式和参与入口。', image: 'assets/graphics/capability-map.png' },
  { directory: '03-website', source: 'copy.md', title: '官网首页文案', desc: '提供首屏、功能介绍、使用条件和行动入口的完整文案。', image: 'assets/screenshots/studio-browser.jpg' },
  { directory: '04-social', source: 'copy.md', title: '朋友圈与社交媒体', desc: '朋友圈长短文、三图介绍，以及可直接取用的方形和竖版 PNG。', image: 'assets/graphics/cover-square.png' },
]
function shell(title, body, prefix = '../') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self';"><title>${esc(title)} · CCLink Studio</title><link rel="stylesheet" href="${prefix}assets/style.css"></head><body><header class="top"><a class="wordmark" href="${prefix}index.html"><img src="${prefix}../resources/icon.png" alt="">CCLink Studio</a><nav><a href="${prefix}index.html">宣传资料</a><a class="secondary" href="${prefix}README.md">使用说明</a><a href="https://github.com/AwsomeName/cclink-studio">GitHub ↗</a></nav></header>${body}</body></html>`
}
for (const channel of channels) {
  const markdown = await readFile(join(kit, channel.directory, channel.source), 'utf8')
  let body = marked.parse(markdown)
  body = body.replace(/<p>\s*<img src="([^"]+)" alt="([^"]*)"[^>]*>\s*<\/p>/g, (_, src, alt) => `<figure><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${alt}" loading="eager" decoding="async"></a></figure>`)
  const html = shell(channel.title, `<div class="preview-meta"><span>${channel.title}</span><span>图文初稿 · 2026.10</span></div><main class="article">${body}</main><footer class="bottom"><span>CCLink Studio 宣传资料</span><a href="${channel.source}">打开可编辑正文</a><a href="../index.html">返回图文总览</a></footer>`)
  await writeFile(join(kit, channel.directory, 'preview.html'), html)
}
const gallery = channels.map((c, i) => `<section class="channel"><a href="${c.directory}/preview.html"><img class="thumb" src="${c.image}" alt="${c.title}预览"></a><div class="info"><span class="num">0${i + 1} / CHANNEL</span><h2>${c.title}</h2><p>${c.desc}</p><div class="actions"><a href="${c.directory}/preview.html">阅读图文稿 →</a><a href="${c.directory}/${c.source}">编辑正文</a></div></div></section>`).join('')
const pictures = [ ['assets/graphics/cover-wide.png', '横版封面', '1600 × 900'], ['assets/graphics/workflow.png', '协作流程示意', '1600 × 820'], ['assets/graphics/capability-map.png', '工作空间关系示意', '1600 × 1000'], ['assets/screenshots/studio-writing.jpg', '真实文档界面', '演示文档与待发送指令'], ['assets/screenshots/studio-browser.jpg', '真实内嵌浏览器', '原创演示网页'], ['assets/graphics/card-02-workspace.png', '社交媒体竖版图卡', '1080 × 1440'] ]
const assetGallery = pictures.map(([src, title, size]) => `<section class="asset"><a href="${src}"><img src="${src}" alt="${title}" loading="eager"></a><p><strong>${title}</strong><br>${size}<br><a href="${src}" download>保存图片</a></p></section>`).join('')
await writeFile(join(kit, 'index.html'), shell('宣传图文总览', `<main class="kit"><div class="eyebrow">CCLINK STUDIO / PRESS MATERIALS</div><h1>项目宣传图文资料</h1><p class="lead">围绕同一个产品定位，按公众号、开源社区、官网和社交媒体逐个整理。每版都有独立正文、实际配图和本地排版预览。</p><div class="summary"><span>4 套渠道文案</span><span>真实应用截图</span><span>可编辑 SVG 配图</span><span>本地文件完整保存</span></div><div class="gallery">${gallery}</div><h2 class="section-title">共用图片与社交图卡</h2><p class="note">真实截图使用原创演示材料，保留实际界面状态。示意图说明协作方式，Agent 指令停留在待发送状态。</p><div class="asset-grid">${assetGallery}</div><h2 class="section-title">继续梳理</h2><p class="note">建议先审公众号版的定位和表达，再确认社区版的能力范围，最后定官网首屏与社交媒体图卡。所有稿件均为本地图文初稿，尚未公开发布。</p><div class="resource-links"><a href="positioning.md">统一定位</a><a href="sources.md">事实与图片来源</a><a href="review/editorial-review.md">逐稿审阅记录</a><a href="README.md">文件使用说明</a></div></main>`, ''))

for (const name of ['studio-writing', 'studio-browser']) {
  const file = `assets/screenshots/${name}.jpg`
  const buffer = await readFile(join(kit, file))
  const meta = await sharp(buffer).metadata()
  assets.push({ file, kind: 'real-studio-screenshot', capture: 'native-window-cua', source: name === 'studio-writing' ? 'demo-materials/从资料到初稿.md' : 'demo-materials/reference.html', width: meta.width, height: meta.height, sha256: createHash('sha256').update(buffer).digest('hex') })
}
await writeFile(join(kit, 'assets/asset-manifest.json'), JSON.stringify({ date: '2026-10-16', assets }, null, 2) + '\n')
console.log(JSON.stringify({ graphics: assets.filter(a => a.kind === 'editorial-graphic').length, screenshots: 2, previews: channels.length, output: kit }))
await import('./build-wechat.mjs')
await import('./build-open-source.mjs')
