import { readdir, readFile, writeFile, stat, mkdir, rename, unlink } from 'fs/promises'
import { watch } from 'fs'
import { join, resolve, extname, dirname, parse, sep } from 'path'
import { app } from 'electron'
import { isBinaryFileExtension } from '../../shared/file-types'

/**
 * 文件系统操作服务
 * 提供安全的文件读写能力，限制在工作区目录内
 */
export class FileService {
  /** 允许访问的根目录列表（用户主目录 + Desktop + Documents + Downloads） */
  private allowedRoots: string[]

  constructor() {
    const home = app.getPath('home')
    this.allowedRoots = [
      home,
      app.getPath('desktop'),
      app.getPath('documents'),
      app.getPath('downloads'),
    ]
  }

  /**
   * 安全校验：确保目标路径在允许的根目录下
   * 防止目录穿越攻击（如 ../../etc/passwd）和路径前缀攻击（如 /Users/testuser）
   */
  private validatePath(targetPath: string): string {
    const resolved = resolve(targetPath)
    const isAllowed = this.allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + sep),
    )
    if (!isAllowed) {
      throw new Error(`路径不在允许范围内: ${resolved}`)
    }
    return resolved
  }

  /** 读取目录内容（options.showHiddenFiles 为真时不过滤 . 开头的隐藏文件） */
  async readDir(dirPath: string, options?: { showHiddenFiles?: boolean }): Promise<DirEntry[]> {
    const safe = this.validatePath(dirPath)
    const entries = await readdir(safe, { withFileTypes: true })

    return entries
      .filter((e) => options?.showHiddenFiles || !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: join(safe, e.name),
        type: e.isDirectory() ? ('directory' as const) : ('file' as const),
        extension: e.isFile() ? extname(e.name).toLowerCase() : undefined,
      }))
      .sort((a, b) => {
        // 目录优先，然后按名称排序
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  /** 读取文件内容 */
  async readFile(filePath: string): Promise<{ content: string; encoding: string }> {
    const safe = this.validatePath(filePath)
    const buffer = await readFile(safe)
    const ext = extname(safe).toLowerCase()

    // 二进制文件返回 base64，避免编辑器把模型/压缩包当 UTF-8 文本解析。
    if (isBinaryFileExtension(ext)) {
      return { content: buffer.toString('base64'), encoding: 'base64' }
    }

    return { content: buffer.toString('utf-8'), encoding: 'utf-8' }
  }

  /** 写入文件 */
  async writeFile(filePath: string, content: string): Promise<void> {
    // 写入前确保目录存在
    const safe = this.validatePath(filePath)
    await mkdir(dirname(safe), { recursive: true })
    await writeFile(safe, content, 'utf-8')
  }

  /** 获取文件/目录元数据 */
  async stat(filePath: string): Promise<FileStat> {
    const safe = this.validatePath(filePath)
    const s = await stat(safe)
    const parsed = parse(safe)

    return {
      name: parsed.base,
      path: safe,
      type: s.isDirectory() ? 'directory' : 'file',
      extension: s.isFile() ? extname(safe).toLowerCase() : undefined,
      size: s.size,
      modifiedAt: s.mtimeMs,
      createdAt: s.birthtimeMs,
    }
  }

  /** 创建目录 */
  async mkdir(dirPath: string): Promise<void> {
    const safe = this.validatePath(dirPath)
    await mkdir(safe, { recursive: true })
  }

  /** 重命名/移动文件 */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const safeOld = this.validatePath(oldPath)
    const safeNew = this.validatePath(newPath)
    await rename(safeOld, safeNew)
  }

  /** 删除文件 */
  async delete(filePath: string): Promise<void> {
    const safe = this.validatePath(filePath)
    await unlink(safe)
  }

  /** 监听目录变更 */
  watchDir(
    dirPath: string,
    onChange: (event: 'add' | 'change' | 'unlink', filePath: string) => void,
  ): { stop: () => void } {
    const safe = this.validatePath(dirPath)
    const watcher = watch(safe, { recursive: true }, (event, filename) => {
      if (filename) {
        onChange(event === 'rename' ? 'add' : 'change', join(safe, filename))
      }
    })
    return {
      stop: () => watcher.close(),
    }
  }
}

/** 目录条目 */
export interface DirEntry {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
}

/** 文件元数据 */
export interface FileStat {
  name: string
  path: string
  type: 'directory' | 'file'
  extension?: string
  size: number
  modifiedAt: number
  createdAt: number
}
