import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.json': 'application/json' }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let path = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (path !== root && !path.startsWith(root + sep)) throw Error('Outside root')
    if (url.pathname === '/resources/icon.png') path = resolve(root, '../resources/icon.png')
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html')
    const buffer = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(buffer)
  } catch { res.writeHead(404); res.end('Not found') }
})
server.listen(Number(process.env.PROMOTION_PORT || 0), '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`))
