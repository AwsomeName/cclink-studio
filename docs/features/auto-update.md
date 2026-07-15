# Historical: 自动更新方案（腾讯云 COS）

> 当前状态：历史发布方案，不属于 CCLink Studio OSS 默认路径。
>
> COS 上传脚本、官方更新源、签名、公证和商业发布链路已经迁到 `/Users/apple/Desktop/cclink-dev` 的 commercial/release 基线。开源 Studio 只保留中性 updater shell，不应默认包含 COS SDK、COS 上传脚本、官方 feed URL 或生产发布凭证。

# DeepInk 自动更新方案（腾讯云 COS）

> 适用场景：个人项目、Mac 优先、App **未签名**、国内用户、低成本、快接入、稳定可靠。
>
> 本文档是**操作手册**，按顺序从第一步做到第六步即可上线。

---

## 0. 方案选型：为什么是「自动检查 + 通知 + 一键下载」，而不是 electron-updater 全自动

| 方案 | 是否适合当前（未签名 Mac） |
|------|---------------------------|
| electron-updater 全自动（后台下载 + 退出自动安装） | ❌ **macOS 上要求 App 必须签名**，未签名 App 自动替换不可靠，会偶发失败 |
| **自动检查 + 通知 + 一键下载 dmg**（本文档） | ✅ 不依赖签名，跳过 Squirrel 坑；自动化的恰恰是最烦的「检查 + 下载」，安装那一步保留你已熟知的拖拽 |

**结论**：当前用半自动方案。**等以后做了 Apple 签名 + 公证**（$99/年，商业化时），再平滑升级到 electron-updater 全自动——届时本文档的 COS 基础设施原样复用，只换 App 内的更新逻辑。

### 工作流程

```
App 启动（及每 6 小时）
   │
   ▼
主进程 fetch  COS 上的 latest-mac.yml
   │
   ▼
解析 version → 对比 app.getVersion()
   │  有新版本
   ▼
IPC 通知渲染进程 → 状态栏弹出 "🆕 发现新版本 v0.1.2 [立即下载]"
   │  用户点击
   ▼
主进程下载 dmg 到 ~/Downloads → 自动打开（挂载）→ 用户拖进 Applications 替换
   │
   ▼
完成（用户数据/设置在 ~/Library/Application Support/deepink，不受影响）
```

---

## 1. 腾讯云 COS 控制台配置

> 你已有腾讯云账号（CloudBase 在用），这一步只是新建一个对象存储桶。

### 1.1 创建存储桶

1. 登录 [腾讯云 COS 控制台](https://console.cloud.tencent.com/cos) → 「存储桶列表」→ 「创建存储桶」
2. 填写：
   - **名称**：`deepink-update`（最终桶名会带 APPID 后缀，如 `deepink-update-1300000000`）
   - **地域**：选离你近的，例如 `ap-shanghai`（上海）、`ap-guangzhou`（广州）
   - **访问权限**：选 **「公有读私有写」**（更新包需要被 App 匿名读取）
3. 其余默认，点「创建」

### 1.2 拿到默认域名（免备案的关键）

进入桶 → 「文件列表」→ 上传任意一个测试文件 → 点该文件，在右侧详情里看 **「对象地址」**，形如：

```
https://deepink-update-1300000000.cos.ap-shanghai.myqcloud.com/test.txt
```

**这个默认域名（`xxx.cos.<region>.myqcloud.com`）可直接公开 HTTPS 下载，不需要 ICP 备案。** electron-updater / 我们的更新检查器都用这个域名。

> ⚠️ 记下三个值，后面要用：
> - **COS_BASE** = `https://deepink-update-1300000000.cos.ap-shanghai.myqcloud.com`（去掉文件名）
> - **COS_BUCKET** = `deepink-update-1300000000`
> - **COS_REGION** = `ap-shanghai`

### 1.3 防盗刷（必做，2 个设置就够）

公有读有被刷流量的风险。两个一键设置封死：

1. **费用告警**：[费用中心 → 账单 → 预算管理](https://console.cloud.tencent.com/expense) 新建预算，**实际费用 > 10 元**时短信/邮件通知你。
2. **流量上限**：桶 → 「安全管理 → 流量限速」或对接 CDN 时设带宽封顶（控制台直接设）。

> 你的 dmg URL 没有在任何公开网页外链，被随机扫到的概率极低；加上费用告警，盗刷第一时间能发现。**个人项目到这里就够了，不需要签名 URL 那套复杂方案。**

### 1.4 创建 API 密钥（用于打包脚本上传，不是给 App 用）

1. 进入 [访问管理 CAM → 用户列表](https://console.cloud.tencent.com/cam) → 「新建用户」→ 选「自定义创建」
2. 类型：**可访问资源并接收消息**
3. 用户名：`deepink-uploader`，登录方式只勾「编程访问」
4. 权限：搜索并勾选 **`QcloudCOSDataFullControl`**（仅对象存储读写，最小权限）
5. 完成后**立即复制** `SecretId` 和 `SecretKey`（只显示一次）

> 这对密钥**只在你的开发机**用于上传。**目标机的 App 永远不需要它**——App 只用公开的 COS_BASE URL 读 latest-mac.yml。

---

## 2. electron-builder 配置（生成 latest-mac.yml）

编辑 [electron-builder.yml](../../electron-builder.yml)，在文件末尾追加 `publish` 段：

```yaml
publish:
  provider: generic
  url: https://deepink-update-1300000000.cos.ap-shanghai.myqcloud.com
```

> 把 `url` 换成你的 **COS_BASE**。
>
> 作用：electron-builder 打包时会生成 `latest-mac.yml`（含版本号、文件名、校验哈希）+ blockmap。我们的更新检查器只读这个 yml 里的 `version` 字段。
>
> 注意：`generic` provider **不会自动上传**，上传由第六步的脚本完成。

---

## 3. 主进程：检查更新（新增 `src/main/updater/`）

### 3.1 新建 `src/main/updater/update-checker.ts`

```ts
/**
 * update-checker — 轻量更新检查器（不依赖 electron-updater，适配未签名 Mac）
 *
 * 原理：fetch COS 上的 latest-mac.yml → 解析 version → 对比 app.getVersion()
 * 有新版本则通过回调通知调用方（IPC 层 → 渲染进程状态栏）。
 */

import { app } from 'electron'
import { net } from 'electron'
import { compareVersions, parseLatestMacYml, type UpdateInfo } from './update-utils'

/** COS 更新源基础地址（公开 URL，无密钥；改动很少，直接常量） */
const UPDATE_BASE_URL = normalizeServiceUrl(process.env['DEEPINK_UPDATE_BASE_URL'])

/** 检查间隔：6 小时 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdateCheckResult {
  hasUpdate: boolean
  current: string
  latest?: string
  /** 完整 dmg 下载地址 */
  downloadUrl?: string
}

/**
 * 执行一次更新检查
 * - 返回 null 表示网络/解析失败（静默忽略，不打扰用户）
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  const current = app.getVersion()
  try {
    const ymlText = await fetchText(`${UPDATE_BASE_URL}/latest-mac.yml`)
    const info: UpdateInfo = parseLatestMacYml(ymlText)
    if (!info.version || !info.dmgPath) return null

    const hasUpdate = compareVersions(info.version, current) > 0
    return {
      hasUpdate,
      current,
      latest: info.version,
      downloadUrl: `${UPDATE_BASE_URL}/${info.dmgPath}`,
    }
  } catch (err) {
    console.warn('[UpdateChecker] 检查更新失败（已忽略）:', err)
    return null
  }
}

/** 启动周期性检查，并通过 onResult 回调上报结果 */
export function startPeriodicCheck(onResult: (r: UpdateCheckResult) => void): void {
  const run = async () => {
    const r = await checkForUpdates()
    if (r && r.hasUpdate) onResult(r)
  }
  // 启动后 10 秒检查一次（给其它初始化让路）
  setTimeout(run, 10_000)
  // 之后每 6 小时一次
  setInterval(run, CHECK_INTERVAL_MS)
}

/** 用 Electron net 模块抓取文本 */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    let body = ''
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      response.on('data', (chunk) => (body += chunk.toString()))
      response.on('end', () => resolve(body))
    })
    request.on('error', reject)
    request.end()
  })
}
```

### 3.2 新建 `src/main/updater/update-utils.ts`

> 不引入 `js-yaml` 依赖，最小化解析 latest-mac.yml（只需 version + dmg 文件名）。

```ts
/**
 * update-utils — latest-mac.yml 最小解析 + 语义化版本比较
 */

export interface UpdateInfo {
  version: string
  /** latest-mac.yml 里 files[].url 中以 .dmg 结尾的条目 */
  dmgPath: string
}

/**
 * 解析 latest-mac.yml（electron-builder 生成的格式）：
 *   version: 0.1.2
 *   files:
 *     - url: DeepInk-0.1.2-arm64-mac.zip
 *       ...
 *     - url: DeepInk-0.1.2-arm64.dmg
 *       ...
 */
export function parseLatestMacYml(yml: string): UpdateInfo {
  const versionMatch = yml.match(/^version:\s*(.+)$/m)
  const version = versionMatch ? versionMatch[1].trim() : ''

  // 找到 .dmg 结尾的 url 行（文件名相对路径）
  const dmgMatch = yml.match(/url:\s*([^\s]+\.dmg)\b/m)
  const dmgPath = dmgMatch ? dmgMatch[1].trim() : ''

  return { version, dmgPath }
}

/**
 * 语义化版本比较：返回 >0 表示 a 更新，<0 表示 a 更旧，0 表示相等
 * 仅处理纯数字 x.y.z（忽略 -beta 等后缀）
 */
export function compareVersions(a: string, b: string): number {
  // 忽略 -beta 等预发布后缀，只比 x.y.z 数字段
  const pa = a.split('-')[0].split('.')
  const pb = b.split('-')[0].split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? '0', 10)
    const nb = parseInt(pb[i] ?? '0', 10)
    if (na !== nb) return na - nb
  }
  return 0
}
```

---

## 4. 主进程：下载 + IPC（新增 `src/main/ipc/updater-ipc.ts`）

```ts
/**
 * updater-ipc — 更新检查 + 下载的 IPC 通道
 *
 * 通道：
 * - updater:check          — 手动触发一次检查
 * - updater:download       — 下载 dmg 到 ~/Downloads 并自动打开（挂载）
 */

import { ipcMain, app, shell, BrowserWindow } from 'electron'
import { net } from 'electron'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { checkForUpdates, startPeriodicCheck, type UpdateCheckResult } from '../updater/update-checker'

let latestResult: UpdateCheckResult | null = null

export function registerUpdaterIpc(mainWindow: BrowserWindow): void {
  // 周期性检查：有更新时推送给渲染进程
  startPeriodicCheck((r) => {
    latestResult = r
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-available', r)
    }
  })

  /** 手动检查一次 */
  ipcMain.handle('updater:check', async () => {
    const r = await checkForUpdates()
    if (r && r.hasUpdate) {
      latestResult = r
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('updater:update-available', r)
    }
    return r
  })

  /** 下载 dmg 并打开（挂载到 Finder） */
  ipcMain.handle('updater:download', async () => {
    if (!latestResult?.downloadUrl) return { success: false, error: '无可用更新' }
    const dmgName = latestResult.downloadUrl.split('/').pop() ?? 'DeepInk.dmg'
    const savePath = join(app.getPath('downloads'), dmgName)

    await new Promise<void>((resolve, reject) => {
      const request = net.request(latestResult!.downloadUrl!)
      const stream = createWriteStream(savePath)
      request.on('response', (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        response.on('data', (chunk) => stream.write(chunk))
        response.on('end', () => { stream.end(); resolve() })
      })
      request.on('error', reject)
      request.end()
    })

    // 打开 dmg → macOS 自动挂载 → 用户拖进 Applications 替换
    await shell.openPath(savePath)
    return { success: true, path: savePath }
  })

  console.log('[UpdaterIPC] 更新检查 IPC 已注册')
}
```

### 4.1 在 `src/main/index.ts` 接入

在 `app.whenReady().then(...)` 内、其它 IPC 注册附近（约 228 行 `registerSettingsIpc` 之后）加一行：

```ts
import { registerUpdaterIpc } from './ipc/updater-ipc'
// ...
  registerUpdaterIpc(mainWindow!)   // ← 加这行（紧跟 registerSettingsIpc 之后）
  console.log('[DeepInk] 更新检查 IPC 已注册')
```

> 位置参考：[src/main/index.ts](../../src/main/index.ts) 第 227–229 行附近。`registerUpdaterIpc` 不依赖 CDP/Playwright，放在 `try` 块外面即可，确保更新功能在任何初始化失败时仍可用。

---

## 5. 渲染进程：状态栏通知

### 5.1 新建 `src/renderer/src/stores/update-store.ts`

```ts
import { create } from 'zustand'

interface UpdateState {
  hasUpdate: boolean
  latestVersion: string
  downloading: boolean
  /** 收到主进程的更新通知 */
  setUpdate: (version: string) => void
  clear: () => void
  setDownloading: (v: boolean) => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  latestVersion: '',
  downloading: false,
  setUpdate: (version) => set({ hasUpdate: true, latestVersion: version }),
  clear: () => set({ hasUpdate: false, latestVersion: '' }),
  setDownloading: (v) => set({ downloading: v }),
}))
```

在 `src/renderer/src/stores/index.ts` 导出它（参照其它 store 的导出方式加一行 `export { useUpdateStore } from './update-store'`）。

### 5.2 在 App 启动时监听更新事件

在 [src/renderer/src/App.tsx](../../src/renderer/src/App.tsx) 的根组件里加一个 `useEffect`（放在已有的 hooks 附近）：

```ts
import { useEffect } from 'react'
import { useUpdateStore } from './stores'

// 在组件内：
const setUpdate = useUpdateStore((s) => s.setUpdate)
useEffect(() => {
  const handler = (_e: unknown, info: { latest?: string }) => {
    if (info.latest) setUpdate(info.latest)
  }
  window.deepink.onUpdateAvailable?.(handler)
  return () => window.deepink.offUpdateAvailable?.(handler)
}, [setUpdate])
```

### 5.3 preload 暴露 API

在 [src/preload/index.ts](../../src/preload/index.ts) 的 `contextBridge.exposeInMainWorld('deepink', { ... })` 对象里加一个 `update` 命名空间：

```ts
  update: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    onUpdateAvailable: (cb: (info: { latest?: string }) => void) =>
      ipcRenderer.on('updater:update-available', (_e, info) => cb(info)),
    offUpdateAvailable: (cb: (...args: unknown[]) => void) =>
      ipcRenderer.removeAllListeners('updater:update-available'),
  },
```

> 别忘了在 [src/preload/index.d.ts](../../src/preload/index.d.ts) 的 `DeepinkAPI` 接口里补上对应类型声明。

### 5.4 状态栏显示通知

在 [src/renderer/src/components/status-bar/StatusBar.tsx](../../src/renderer/src/components/status-bar/StatusBar.tsx) 里接入：

```tsx
import { useUpdateStore } from '../../stores'

// 组件内：
const { hasUpdate, latestVersion, downloading, setDownloading, clear } = useUpdateStore()

const handleDownload = async () => {
  setDownloading(true)
  await window.deepink.update.download()
  setDownloading(false)
  clear()  // 下载完清掉提示
}

// JSX 里，放在版本号 <span> 前面：
{hasUpdate && (
  <button
    className="status-bar-item update-badge"
    onClick={handleDownload}
    title={`下载 v${latestVersion}`}
  >
    🆕 新版本 v{latestVersion} {downloading ? '下载中...' : '立即下载'}
  </button>
)}
```

> 顺手把 StatusBar 里硬编码的 `DeepInk v0.1.0` 改成动态版本（可选）：渲染进程可通过 `window.deepink.app?.getVersion?.()` 或打包时注入。非必须，更新检查用的是主进程 `app.getVersion()`，与显示无关。

---

## 6. 扩展打包脚本：自动上传 COS

### 6.1 安装 COS SDK（开发依赖）

```bash
pnpm add -D cos-nodejs-sdk-v5
```

### 6.2 新建 `scripts/upload-cos.mjs`

```js
// upload-cos.mjs — 把 dist/ 里的更新产物上传到腾讯云 COS
// 需要 env：COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION

import COS from 'cos-nodejs-sdk-v5'
import { readdirSync } from 'fs'
import { join, resolve } from 'path'

const { COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION } = process.env
const distDir = resolve(process.cwd(), 'dist')

for (const k of ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION']) {
  if (!process.env[k]) {
    console.error(`[upload-cos] 缺少环境变量 ${k}，跳过上传`)
    process.exit(0) // 缺凭证不报错，仅跳过（本地测试时不强制上传）
  }
}

const cos = new COS({ SecretId: COS_SECRET_ID, SecretKey: COS_SECRET_KEY })

// 上传 latest-mac.yml + dmg + zip + blockmap（当前构建产物）
const targets = readdirSync(distDir).filter((f) =>
  /\.(yml|dmg|zip|blockmap)$/.test(f),
)

console.log(`[upload-cos] 上传 ${targets.length} 个文件到 ${COS_BUCKET} ...`)
for (const file of targets) {
  await new Promise((resolveP, rejectP) => {
    cos.putObject(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: file,
        FilePath: join(distDir, file),
      },
      (err) => (err ? rejectP(err) : resolveP()),
    )
  })
  console.log(`  ✓ ${file}`)
}
console.log('[upload-cos] 上传完成')
```

### 6.3 在 [scripts/package.sh](../../scripts/package.sh) 末尾「结果摘要」之前插入上传步骤

找到脚本第 5 步打包完成后、第 6 步结果摘要之前，加入：

```bash
# ── 5.5 上传更新产物到 COS（有凭证才上传）──
if [ "$NO_UPLOAD" -ne 1 ]; then
  if [ -n "$COS_SECRET_ID" ] && [ -n "$COS_SECRET_KEY" ] && [ -n "$COS_BUCKET" ] && [ -n "$COS_REGION" ]; then
    info "上传更新产物到 COS ..."
    node scripts/upload-cos.mjs || warn "COS 上传失败（不影响本地产物）"
    ok "COS 上传完成"
  else
    warn "未配置 COS_* 环境变量，跳过上传（仅本地打包）"
  fi
fi
```

并在脚本顶部参数解析里加一个 `--no-upload` 开关：

```bash
NO_UPLOAD=0
# ...参数解析 case 里加：
    --no-upload) NO_UPLOAD=1; shift ;;
```

### 6.4 配置 COS 凭证（开发机，不入 git）

在项目根建 `.env`（**务必加入 `.gitignore`**）：

```bash
COS_SECRET_ID=AKIDxxxxxxxxxxxxxxxxxxxxxx
COS_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxx
COS_BUCKET=deepink-update-1300000000
COS_REGION=ap-shanghai
```

然后让 `package.sh` 在执行时加载它——在脚本「1. 依赖安装」之前加：

```bash
# 加载本地 COS 凭证（不进 git）
[ -f .env ] && set -a && . ./.env && set +a
```

> 这样 `pnpm release -- --bump` 会自动构建 + 打包 + 上传 COS，一条命令发版。

---

## 7. 完整发版流程（上线后每次发新版只需这一条命令）

```bash
# 开发机上：
pnpm release -- --bump      # 版本号自增 + 构建 + 打包 + 上传 COS
```

目标机行为（全自动，无需操作）：
1. App 启动 10 秒后自动检查 → 发现新版本
2. 状态栏显示 `🆕 新版本 vX.Y.Z 立即下载`
3. 点击 → 下载 dmg 到 ~/Downloads → 自动挂载打开
4. 拖进 Applications 替换 → 完成（数据不丢）

---

## 8. 踩坑清单 & 安全注意

| 项 | 说明 |
|----|------|
| **版本号必须递增** | `app.getVersion()` 读 package.json version；`--bump` 自增 patch。latest-mac.yml 的 version 必须大于本地才会触发更新 |
| **未签名 Mac 的限制** | 本方案绕过了 electron-updater 的签名要求，用「下载 dmg 手动拖拽」。每次新版本首次打开可能需 `xattr -cr /Applications/DeepInk.app`（仅目标机首次或 Gatekeeper 重新拦截时） |
| **密钥安全** | COS_SECRET_ID/KEY 只在开发机 `.env`，**已加入 .gitignore**。App 本身只用公开 COS_BASE 读 yml，无任何密钥 |
| **流量费** | ~0.5 元/GB。几十台每次更新约 2 元，忽略不计。已配费用告警封顶 |
| **CDN 缓存** | 本方案直连 COS 默认域名，不走 CDN，无缓存刷新问题。若将来套 CDN，发布后需刷新 latest-mac.yml 缓存 |
| **多架构** | arm64/x64 的 dmg 文件名不同（`-arm64.dmg` / `-x64.dmg`），latest-mac.yml 只记录本次构建的架构。若同时分发两种架构，分别上传到不同子目录或分别建桶 |

---

## 9. 附录：将来升级到 electron-updater 全自动（需 Apple 签名后）

当 App 做了 Apple Developer ID 签名 + notarize 公证后，可启用无缝自动更新：

1. `pnpm add electron-updater`
2. 主进程：
   ```ts
   import { autoUpdater } from 'electron-updater'
   autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_BASE_URL })
   autoUpdater.autoDownload = true
   autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall())
   app.whenReady().then(() => autoUpdater.checkForUpdatesAndNotify())
   ```
3. electron-builder.yml 的 mac 段加 `identity`（开发者证书）、`notarize` 配置
4. **COS 基础设施原样复用**——只是 App 端从「半自动」换成 electron-updater

> 这正是本方案的设计价值：基础设施一次搭建，签名前后都能用，不浪费。
