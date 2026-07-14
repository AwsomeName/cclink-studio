import { contextBridge, ipcRenderer } from 'electron'
import type { AgentSendMessageInput } from '../shared/ipc/agent'
import type { CclinkFileReadRequest, CclinkFileTreeRequest } from '../shared/ipc/cclink'

contextBridge.exposeInMainWorld('deepink', {
  // 工作区坐标上报（供 WebContentsView 定位）
  reportWorkbenchBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('workbench:bounds', bounds),

  // 窗口控制
  window: {
    /** 切换全屏 */
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    /** 切换开发者工具 */
    toggleDevtools: () => ipcRenderer.invoke('window:toggleDevtools'),
    /** 重新加载窗口 */
    reload: () => ipcRenderer.invoke('window:reload'),
  },

  // 浏览器控制（多视图：所有操作按 tabId 索引视图）
  browser: {
    // ─── 视图生命周期 ───
    /** 创建浏览器视图（已存在则忽略）。opts.restore 用于从快照重建（恢复 viewMode/zoom） */
    createView: (
      tabId: string,
      initialUrl?: string,
      opts?: {
        restore?: {
          viewMode: 'desktop' | 'mobile'
          zoomMode: 'fit' | 'manual'
          manualZoom: number
          history?: string[]
          historyIndex?: number
        }
        profileId?: string | null
      },
    ) => ipcRenderer.invoke('browser:createView', tabId, initialUrl, opts),
    /** 销毁浏览器视图 */
    destroyView: (tabId: string) => ipcRenderer.invoke('browser:destroyView', tabId),
    /** 设置活跃视图（一次只显示一个）；null = 全部隐藏 */
    setActive: (tabId: string | null) => ipcRenderer.invoke('browser:setActive', tabId),

    navigate: (tabId: string, url: string) => ipcRenderer.invoke('browser:navigate', tabId, url),
    goBack: (tabId: string) => ipcRenderer.invoke('browser:goBack', tabId),
    goForward: (tabId: string) => ipcRenderer.invoke('browser:goForward', tabId),
    reload: (tabId: string) => ipcRenderer.invoke('browser:reload', tabId),
    getCurrentURL: (tabId: string) => ipcRenderer.invoke('browser:getCurrentURL', tabId),
    onUrlChanged: (callback: (payload: { tabId: string; url: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { tabId: string; url: string },
      ) => callback(payload)
      ipcRenderer.on('browser:urlChanged', handler)
      return () => ipcRenderer.removeListener('browser:urlChanged', handler)
    },

    // ─── 缩放控制 ───
    zoomIn: (tabId: string) => ipcRenderer.invoke('browser:zoomIn', tabId),
    zoomOut: (tabId: string) => ipcRenderer.invoke('browser:zoomOut', tabId),
    resetZoom: (tabId: string) => ipcRenderer.invoke('browser:resetZoom', tabId),
    setZoom: (tabId: string, factor: number) =>
      ipcRenderer.invoke('browser:setZoom', tabId, factor),
    fitWidth: (tabId: string) => ipcRenderer.invoke('browser:fitWidth', tabId),

    // ─── 设备模式（桌面 / 移动）───
    setDeviceMode: (tabId: string, mode: 'desktop' | 'mobile') =>
      ipcRenderer.invoke('browser:setDeviceMode', tabId, mode),

    // ─── 视图状态 ───
    getViewState: () => ipcRenderer.invoke('browser:getViewState'),

    // ─── 实例快照（重启「恢复上次会话」）───
    /** 列出已保存的实例快照（最近在前） */
    listSnapshots: () => ipcRenderer.invoke('browser:listSnapshots'),
    /** 删除指定快照 */
    removeSnapshot: (id: string) => ipcRenderer.invoke('browser:removeSnapshot', id),
    /** 清空所有快照 */
    clearSnapshots: () => ipcRenderer.invoke('browser:clearSnapshots'),
    /** 列出浏览历史 */
    listHistory: (limit?: number) => ipcRenderer.invoke('browser:listHistory', limit),
    /** 清空浏览历史 */
    clearHistory: () => ipcRenderer.invoke('browser:clearHistory'),
    startTask: (tabId: string, goal: string) =>
      ipcRenderer.invoke('browserTask:start', tabId, goal),
    listTasks: () => ipcRenderer.invoke('browserTask:list'),
    getTask: (taskRunId: string) => ipcRenderer.invoke('browserTask:get', taskRunId),
    getActiveTaskForTab: (tabId: string) =>
      ipcRenderer.invoke('browserTask:getActiveForTab', tabId),
    pauseTask: (taskRunId: string) => ipcRenderer.invoke('browserTask:pause', taskRunId),
    resumeTask: (taskRunId: string) => ipcRenderer.invoke('browserTask:resume', taskRunId),
    cancelTask: (taskRunId: string) => ipcRenderer.invoke('browserTask:cancel', taskRunId),
    finishTask: (taskRunId: string) => ipcRenderer.invoke('browserTask:finish', taskRunId),
    listActionLogs: (taskRunId: string) =>
      ipcRenderer.invoke('browserTask:listActionLogs', taskRunId),
    onTaskChanged: (callback: (payload: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload)
      ipcRenderer.on('browserTask:changed', handler)
      return () => ipcRenderer.removeListener('browserTask:changed', handler)
    },
    onActionLogChanged: (callback: (payload: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload)
      ipcRenderer.on('browserActionLog:changed', handler)
      return () => ipcRenderer.removeListener('browserActionLog:changed', handler)
    },
    listDownloads: () => ipcRenderer.invoke('browserDownload:list'),
    getDownload: (downloadId: string) => ipcRenderer.invoke('browserDownload:get', downloadId),
    keepDownloadToWorkspace: (downloadId: string) =>
      ipcRenderer.invoke('browserDownload:keepToWorkspace', downloadId),
    saveDownloadAs: (downloadId: string) =>
      ipcRenderer.invoke('browserDownload:saveAs', downloadId),
    discardDownload: (downloadId: string) =>
      ipcRenderer.invoke('browserDownload:discard', downloadId),
    openDownload: (downloadId: string) => ipcRenderer.invoke('browserDownload:open', downloadId),
    revealDownload: (downloadId: string) =>
      ipcRenderer.invoke('browserDownload:reveal', downloadId),
    onDownloadChanged: (callback: (payload: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload)
      ipcRenderer.on('browserDownload:changed', handler)
      return () => ipcRenderer.removeListener('browserDownload:changed', handler)
    },
    onViewStateChanged: (callback: (state: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: any) => callback(state)
      ipcRenderer.on('browser:viewStateChanged', handler)
      return () => ipcRenderer.removeListener('browser:viewStateChanged', handler)
    },
  },

  // CCLink 远程连接客户端（DeepInk 作为 chatcc-agent 的桌面工作台）
  cclink: {
    getState: () => ipcRenderer.invoke('cclink:getState'),
    getIdentity: () => ipcRenderer.invoke('cclink:getIdentity'),
    preflightLegacyImport: () => ipcRenderer.invoke('cclink:preflightLegacyImport'),
    ensureIdentity: () => ipcRenderer.invoke('cclink:ensureIdentity'),
    sendLegacySmsCode: () => ipcRenderer.invoke('cclink:sendLegacySmsCode'),
    importLegacyIdentity: (smsCode: string) =>
      ipcRenderer.invoke('cclink:importLegacyIdentity', smsCode),
    clearIdentity: () => ipcRenderer.invoke('cclink:clearIdentity'),
    listServers: () => ipcRenderer.invoke('cclink:listServers'),
    removeServer: (serverId: string) => ipcRenderer.invoke('cclink:removeServer', serverId),
    listSessions: (serverId?: string) => ipcRenderer.invoke('cclink:listSessions', serverId),
    syncPairedAgents: () => ipcRenderer.invoke('cclink:syncPairedAgents'),
    removeSession: (sessionId: string) => ipcRenderer.invoke('cclink:removeSession', sessionId),
    listMessages: (sessionId: string) => ipcRenderer.invoke('cclink:listMessages', sessionId),
    sendLocalMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke('cclink:sendLocalMessage', sessionId, content),
    listFileTree: (request: CclinkFileTreeRequest) =>
      ipcRenderer.invoke('cclink:listFileTree', request),
    readFile: (request: CclinkFileReadRequest) => ipcRenderer.invoke('cclink:readFile', request),
    getRealtimeStatus: () => ipcRenderer.invoke('cclink:getRealtimeStatus'),
    connectRealtime: () => ipcRenderer.invoke('cclink:connectRealtime'),
    disconnectRealtime: () => ipcRenderer.invoke('cclink:disconnectRealtime'),
    clearLocalData: () => ipcRenderer.invoke('cclink:clearLocalData'),
    seedDemoData: () => ipcRenderer.invoke('cclink:seedDemoData'),
  },

  // 认证系统
  auth: {
    /** 查询私有认证服务是否已通过 DEEPINK_API_URL 配置 */
    getServiceStatus: () => ipcRenderer.invoke('auth:getServiceStatus'),
    /** 发送手机验证码 */
    phoneSendCode: (phone: string) => ipcRenderer.invoke('auth:phoneSendCode', phone),
    /** 手机号 + 验证码登录 */
    phoneLogin: (phone: string, code: string) => ipcRenderer.invoke('auth:phoneLogin', phone, code),
    /** 检查本地登录状态（启动时调用） */
    checkSession: () => ipcRenderer.invoke('auth:checkSession'),
    /** 获取缓存的用户资料 */
    getProfile: () => ipcRenderer.invoke('auth:getProfile'),
    /** 登出（清除本地 token + 通知后端吊销） */
    logout: () => ipcRenderer.invoke('auth:logout'),
    /** 监听登录状态变化 */
    onSessionChanged: (callback: (session: { loggedIn: boolean; user: any | null }) => void) => {
      ipcRenderer.removeAllListeners('auth:sessionChanged')
      ipcRenderer.on('auth:sessionChanged', (_event, session) => callback(session))
    },
  },

  // 本地优先身份：不登录也应存在稳定本机身份。
  identity: {
    getLocalIdentity: () => ipcRenderer.invoke('identity:getLocalIdentity'),
  },

  // Agent / Playwright / AI 后端
  agent: {
    // ─── AI 对话 ────────────────────────────────
    // ─── AI 对话 ────────────────────────────────
    /** 发送用户消息给 Claude Code（非阻塞，流式结果通过 onStreamEvent 接收） */
    sendMessage: (
      conversationIdOrMessage: string | AgentSendMessageInput,
      maybeMessage?: AgentSendMessageInput,
    ) =>
      maybeMessage === undefined
        ? ipcRenderer.invoke('agent:sendMessage', conversationIdOrMessage)
        : ipcRenderer.invoke('agent:sendMessage', conversationIdOrMessage, maybeMessage),

    /** 中止当前 AI 响应 */
    abort: (conversationId?: string) => ipcRenderer.invoke('agent:abort', conversationId),

    /** 获取 AI 后端状态 */
    getStatus: (conversationId?: string) => ipcRenderer.invoke('agent:getStatus', conversationId),

    /** 设置操作作用域（选择 Agent 操作目标 + 收窄工具域）。响应进行中会被拒绝 */
    setScope: (
      conversationIdOrScope:
        | string
        | { kind: 'all' }
        | { kind: 'android' }
        | { kind: 'editor' }
        | { kind: 'browser'; instanceId: string },
      maybeScope?:
        | { kind: 'all' }
        | { kind: 'android' }
        | { kind: 'editor' }
        | { kind: 'browser'; instanceId: string },
    ) =>
      maybeScope === undefined
        ? ipcRenderer.invoke('agent:setScope', conversationIdOrScope)
        : ipcRenderer.invoke('agent:setScope', conversationIdOrScope, maybeScope),

    /** 获取当前操作作用域 */
    getScope: (conversationId?: string) => ipcRenderer.invoke('agent:getScope', conversationId),

    /** 清除会话（开始新对话） */
    resetSession: (conversationId?: string) =>
      ipcRenderer.invoke('agent:resetSession', conversationId),

    /** 恢复历史会话的后端 session id */
    restoreConversation: (conversationId: string, sessionId: string | null) =>
      ipcRenderer.invoke('agent:restoreConversation', conversationId, sessionId),

    /** 关闭指定会话并释放后端资源 */
    closeConversation: (conversationId: string) =>
      ipcRenderer.invoke('agent:closeConversation', conversationId),

    // ─── 流式事件监听 ───────────────────────────
    /** 监听 CLI 流式事件（NDJSON 逐行转发） */
    onStreamEvent: (callback: (event: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: any): void => callback(data)
      ipcRenderer.on('agent:stream', listener)
      return () => ipcRenderer.removeListener('agent:stream', listener)
    },

    /** 监听 AI 响应完成 */
    onComplete: (callback: (result: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: any): void => callback(data)
      ipcRenderer.on('agent:complete', listener)
      return () => ipcRenderer.removeListener('agent:complete', listener)
    },

    /** 监听 AI 错误 */
    onError: (callback: (error: { message: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { message: string }): void =>
        callback(data)
      ipcRenderer.on('agent:error', listener)
      return () => ipcRenderer.removeListener('agent:error', listener)
    },

    // ─── 直接 Playwright 操作（保留兼容） ─────────
    executeAction: (action: { type: string; [key: string]: any }) =>
      ipcRenderer.invoke('agent:executeAction', action),

    verifyCapabilities: () => ipcRenderer.invoke('agent:verifyCapabilities'),

    getPlaywrightStatus: () => ipcRenderer.invoke('agent:getPlaywrightStatus'),

    /** 获取 Agent 能力状态（browser/editor/android/mcp 等） */
    getCapabilities: () => ipcRenderer.invoke('agent:getCapabilities'),

    // ─── 权限管理 ──────────────────────────────
    /** 监听工具确认请求 */
    onRequestConfirmation: (callback: (request: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: any): void => callback(data)
      ipcRenderer.on('agent:requestConfirmation', listener)
      return () => ipcRenderer.removeListener('agent:requestConfirmation', listener)
    },

    /** 回传用户确认/拒绝 */
    resolveToolConfirmation: (id: string, approved: boolean, alwaysAllow?: boolean) =>
      ipcRenderer.invoke('agent:resolveToolConfirmation', id, approved, alwaysAllow),

    /** 获取当前权限模式 */
    getPermissionMode: () => ipcRenderer.invoke('agent:getPermissionMode'),

    /** 设置权限模式 */
    setPermissionMode: (mode: string) => ipcRenderer.invoke('agent:setPermissionMode', mode),

    // ─── 外部 MCP Server 管理 ────────────────────────
    /** 列出所有外部 MCP server */
    listMcpServers: () => ipcRenderer.invoke('mcp:listServers'),
    /** 添加外部 MCP server */
    addMcpServer: (server: {
      name: string
      transport: string
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
      enabled: boolean
    }) => ipcRenderer.invoke('mcp:addServer', server),
    /** 移除外部 MCP server */
    removeMcpServer: (name: string) => ipcRenderer.invoke('mcp:removeServer', name),
    /** 更新外部 MCP server */
    updateMcpServer: (name: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('mcp:updateServer', name, updates),
    /** 重新加载 MCP 配置文件 */
    reloadMcpConfig: () => ipcRenderer.invoke('mcp:reloadConfig'),
  },

  // 文件系统
  fs: {
    /** 获取用户 Home 目录路径 */
    getHomePath: () => ipcRenderer.invoke('fs:getHomePath'),
    /** 读取目录内容 */
    readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
    /** 读取文件内容 */
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    /** 写入文件 */
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    /** 获取文件/目录元数据 */
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
    /** 创建目录 */
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    /** 重命名 */
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    /** 删除文件 */
    delete: (filePath: string) => ipcRenderer.invoke('fs:delete', filePath),
    /** 用系统文件管理器打开路径 */
    openPath: (path: string) => ipcRenderer.invoke('fs:openPath', path),
  },

  // 项目内运营助手：项目账号配置、文案草稿和发布记录。
  projectOps: {
    getAccounts: (workspacePath: string) =>
      ipcRenderer.invoke('projectOps:getAccounts', workspacePath),
    createAccountsTemplate: (workspacePath: string) =>
      ipcRenderer.invoke('projectOps:createAccountsTemplate', workspacePath),
    createCopyDraft: (workspacePath: string, input?: unknown) =>
      ipcRenderer.invoke('projectOps:createCopyDraft', workspacePath, input),
    appendPublicationRecord: (workspacePath: string, input: unknown) =>
      ipcRenderer.invoke('projectOps:appendPublicationRecord', workspacePath, input),
  },

  // 对话框（文件选择、保存）
  dialog: {
    /** 打开文件选择对话框（selectDirectory=true 时改为选择文件夹） */
    showOpenDialog: (options?: {
      title?: string
      multiSelections?: boolean
      selectDirectory?: boolean
      filters?: Array<{ name: string; extensions: string[] }>
    }) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    /** 打开保存文件对话框 */
    showSaveDialog: (options?: {
      title?: string
      defaultPath?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    /** 打开普通消息对话框 */
    showMessageBox: (options: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
    }) => ipcRenderer.invoke('dialog:showMessageBox', options),
  },

  // 微信公众号格式转换
  wechat: {
    /** 将 Markdown 转换为微信公众号兼容 HTML */
    convert: (markdown: string) => ipcRenderer.invoke('wechat:convert', { markdown }),
  },

  // 编辑器（Agent ↔ 编辑器双向通信）
  editor: {
    /** 监听 Agent 推送的内容更新 */
    onContentUpdate: (callback: (update: any) => void) => {
      const handler = (_event: any, data: any): void => callback(data)
      ipcRenderer.removeAllListeners('editor:contentUpdate')
      ipcRenderer.on('editor:contentUpdate', handler)
      return () => ipcRenderer.removeListener('editor:contentUpdate', handler)
    },
    /** 确认内容更新已应用 */
    contentUpdateAck: (id: string) => ipcRenderer.invoke('editor:contentUpdateAck', id),
    /** 监听 Agent 读取请求 */
    onReadRequest: (callback: (request: { id: string; filePath?: string }) => void) => {
      const handler = (_event: any, data: any): void => callback(data)
      ipcRenderer.removeAllListeners('editor:readRequest')
      ipcRenderer.on('editor:readRequest', handler)
      return () => ipcRenderer.removeListener('editor:readRequest', handler)
    },
    /** 回传编辑器内容（响应 readRequest） */
    readResponse: (id: string, content: string) =>
      ipcRenderer.invoke('editor:readResponse', id, content),
    /** 监听 Agent 保存请求 */
    onSaveRequest: (callback: (request: { id: string; filePath?: string }) => void) => {
      const handler = (_event: any, data: any): void => callback(data)
      ipcRenderer.removeAllListeners('editor:saveRequest')
      ipcRenderer.on('editor:saveRequest', handler)
      return () => ipcRenderer.removeListener('editor:saveRequest', handler)
    },
    /** 回传保存结果 */
    saveResult: (id: string, success: boolean, error?: string) =>
      ipcRenderer.invoke('editor:saveResult', id, success, error),
  },

  // Android 设备控制（SDK/AVD/模拟器路径已封存，保留 IPC 兼容旧快照）
  android: {
    // ─── 已封存：SDK 设置（一键安装） ───
    /** 获取安装状态（返回 archived=true） */
    getSetupStatus: () => ipcRenderer.invoke('android:getSetupStatus'),
    /** 获取封存说明 */
    getLicense: () => ipcRenderer.invoke('android:getLicense'),
    /** 兼容旧调用：不再接受 SDK License */
    acceptLicense: () => ipcRenderer.invoke('android:acceptLicense'),
    /** 兼容旧调用：不再下载 adb/emulator/系统镜像或创建 AVD */
    setup: () => ipcRenderer.invoke('android:setup'),
    /** 兼容旧调用：不会再收到安装进度 */
    onSetupProgress: (callback: (data: { step: string; progress: any }) => void) => {
      ipcRenderer.removeAllListeners('android:setupProgress')
      ipcRenderer.on('android:setupProgress', (_event, data) => callback(data))
    },

    // ─── 已封存：模拟器生命周期 ───
    /** 兼容旧调用：始终返回空 AVD 列表 */
    listAvds: () => ipcRenderer.invoke('android:listAvds'),
    /** 兼容旧调用：始终拒绝启动 AVD 模拟器 */
    launch: (avdName: string) => ipcRenderer.invoke('android:launch', avdName),
    /** 兼容旧调用：不再控制模拟器进程 */
    terminate: () => ipcRenderer.invoke('android:terminate'),
    /** 兼容旧调用：始终返回 stopped */
    getState: () => ipcRenderer.invoke('android:getState'),
    /** 兼容旧调用：不会再有模拟器状态变化 */
    onStateChanged: (callback: (state: string) => void) => {
      const handler = (_event: unknown, state: string) => callback(state)
      ipcRenderer.on('android:stateChanged', handler)
      return () => {
        ipcRenderer.removeListener('android:stateChanged', handler)
      }
    },
    /** 重连投屏（reconcile + 重绑 + scrcpy connect，替代裸 getDeviceId + connectMirror） */
    reconnect: () => ipcRenderer.invoke('android:reconnect'),
    /** 监听设备丢失（reconcile 检测到 serial 不在线时推送） */
    onDeviceLost: (callback: (info: { reason: string }) => void) => {
      const handler = (_event: unknown, info: any) => callback(info)
      ipcRenderer.on('android:deviceLost', handler)
      return () => {
        ipcRenderer.removeListener('android:deviceLost', handler)
      }
    },

    // ─── 物理真机 ───
    /** 发现物理真机（含 unauthorized 便于 UI 引导授权） */
    listPhysicalDevices: () => ipcRenderer.invoke('android:listPhysicalDevices'),
    /** 连接物理真机 */
    connectPhysical: (serial: string) => ipcRenderer.invoke('android:connectPhysical', serial),
    /** 断开物理真机 */
    disconnectPhysical: () => ipcRenderer.invoke('android:disconnectPhysical'),
    /** 监听真机已连接（主进程推送） */
    onPhysicalConnected: (callback: (data: { serial: string; deviceInfo: any }) => void) => {
      const handler = (_event: unknown, data: any) => callback(data)
      ipcRenderer.on('android:physicalConnected', handler)
      return () => {
        ipcRenderer.removeListener('android:physicalConnected', handler)
      }
    },
    /** 监听真机已断开（主进程推送） */
    onPhysicalDisconnected: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('android:physicalDisconnected', handler)
      return () => {
        ipcRenderer.removeListener('android:physicalDisconnected', handler)
      }
    },

    // ─── 应用商店引导安装（方案 A）───
    /** 监听商店引导进度（下载/安装阶段提示） */
    onStoreInstallProgress: (callback: (msg: string) => void) => {
      const handler = (_event: unknown, msg: string) => callback(msg)
      ipcRenderer.on('android:storeInstallProgress', handler)
      return () => {
        ipcRenderer.removeListener('android:storeInstallProgress', handler)
      }
    },
    /** 监听商店引导结果（已装/成功/失败） */
    onStoreInstallResult: (
      callback: (result: {
        status: 'already-installed' | 'installed' | 'failed'
        storeId: string
        displayName: string
        message?: string
      }) => void,
    ) => {
      const handler = (_event: unknown, result: any) => callback(result)
      ipcRenderer.on('android:storeInstallResult', handler)
      return () => {
        ipcRenderer.removeListener('android:storeInstallResult', handler)
      }
    },
    /** 手动重试商店引导安装（失败后点「重试」） */
    retryStoreInstall: () => ipcRenderer.invoke('android:retryStoreInstall'),

    // ─── 设备操控（ADB） ───
    /** 点击坐标 */
    tap: (x: number, y: number) => ipcRenderer.invoke('android:tap', x, y),
    /** 滑动手势 */
    swipe: (x1: number, y1: number, x2: number, y2: number, duration?: number) =>
      ipcRenderer.invoke('android:swipe', x1, y1, x2, y2, duration),
    /** 按键 */
    pressKey: (key: string) => ipcRenderer.invoke('android:pressKey', key),
    /** 输入文本 */
    typeText: (text: string) => ipcRenderer.invoke('android:typeText', text),
    /** 截图 */
    screenshot: () => ipcRenderer.invoke('android:screenshot'),
    /** 获取设备信息 */
    getDeviceInfo: () => ipcRenderer.invoke('android:getDeviceInfo'),
    /** 列出已安装应用 */
    listPackages: (filter?: string) => ipcRenderer.invoke('android:listPackages', filter),

    // ─── 新增：ADB 操控（补齐缺失的 IPC） ───
    /** 获取当前连接的 deviceId */
    getDeviceId: () => ipcRenderer.invoke('android:getDeviceId'),
    /** 导出 UI 层级 XML */
    dumpUi: () => ipcRenderer.invoke('android:dumpUi'),
    /** 安装 APK */
    installApk: (path: string) => ipcRenderer.invoke('android:installApk', path),
    /** 卸载包 */
    uninstallPackage: (packageName: string) =>
      ipcRenderer.invoke('android:uninstallPackage', packageName),
    /** 推送文件 */
    pushFile: (local: string, remote: string) =>
      ipcRenderer.invoke('android:pushFile', local, remote),
    /** 执行 shell 命令 */
    shell: (command: string) => ipcRenderer.invoke('android:shell', command),

    // ─── Scrcpy 视频流 ───
    /** 连接 scrcpy 投屏 */
    connectMirror: (deviceId: string) => ipcRenderer.invoke('scrcpy:connect', deviceId),
    /** 断开 scrcpy 投屏 */
    disconnectMirror: () => ipcRenderer.invoke('scrcpy:disconnect'),
    /** 发送触摸事件到设备 */
    sendTouch: (data: { action: number; x: number; y: number; pressure: number }) =>
      ipcRenderer.send('scrcpy:touch', data),
    /** 监听视频帧数据（主进程 → 渲染进程） */
    onVideoFrame: (callback: (frame: any) => void) => {
      ipcRenderer.removeAllListeners('scrcpy:videoFrame')
      ipcRenderer.on('scrcpy:videoFrame', (_event, frame) => callback(frame))
    },
    /** 监听 scrcpy 错误（主进程 → 渲染进程） */
    onMirrorError: (callback: (error: string) => void) => {
      ipcRenderer.removeAllListeners('scrcpy:error')
      ipcRenderer.on('scrcpy:error', (_event, error) => callback(error))
    },
    /** 监听 scrcpy 断开连接（视频流结束） */
    onMirrorDisconnected: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.removeAllListeners('scrcpy:disconnected')
      ipcRenderer.on('scrcpy:disconnected', handler)
      return () => {
        ipcRenderer.removeListener('scrcpy:disconnected', handler)
      }
    },
  },

  // 云同步
  sync: {
    /** 获取同步状态 */
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    /** 获取同步配置 */
    getConfig: () => ipcRenderer.invoke('sync:getConfig'),
    /** 保存配置 + 密码（password 可选） */
    saveConfig: (config: any, password?: string) =>
      ipcRenderer.invoke('sync:saveConfig', config, password),
    /** 删除配置 */
    deleteConfig: () => ipcRenderer.invoke('sync:deleteConfig'),
    /** 测试连接 */
    testConnection: (config: any, password: string) =>
      ipcRenderer.invoke('sync:testConnection', config, password),
    /** 触发同步 */
    triggerSync: (workspacePath: string) => ipcRenderer.invoke('sync:triggerSync', workspacePath),
    /** 启动自动同步（定时 + 文件监听） */
    startAutoSync: (workspacePath: string) =>
      ipcRenderer.invoke('sync:startAutoSync', workspacePath),
    /** 停止自动同步 */
    stopAutoSync: () => ipcRenderer.invoke('sync:stopAutoSync'),
    /** 获取同步历史 */
    getHistory: (limit?: number) => ipcRenderer.invoke('sync:getHistory', limit),
    /** 清空同步历史 */
    clearHistory: () => ipcRenderer.invoke('sync:clearHistory'),
    /** 监听同步状态更新，返回取消订阅函数 */
    onStatusChanged: (callback: (status: any) => void) => {
      const handler = (_event: any, data: any): void => callback(data)
      ipcRenderer.removeAllListeners('sync:statusChanged')
      ipcRenderer.on('sync:statusChanged', handler)
      return () => ipcRenderer.removeListener('sync:statusChanged', handler)
    },
    /** 监听同步完成，返回取消订阅函数 */
    onSyncComplete: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any): void => callback(data)
      ipcRenderer.removeAllListeners('sync:syncComplete')
      ipcRenderer.on('sync:syncComplete', handler)
      return () => ipcRenderer.removeListener('sync:syncComplete', handler)
    },
  },

  // Terminal 命令确认、执行事件与受限提交
  terminal: {
    onRequestCommandConfirmation: (callback: (request: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: any): void => callback(request)
      ipcRenderer.on('terminal:requestCommandConfirmation', handler)
      return () => ipcRenderer.removeListener('terminal:requestCommandConfirmation', handler)
    },
    onExecutionEvent: (callback: (event: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: any): void => callback(event)
      ipcRenderer.on('terminal:executionEvent', handler)
      return () => ipcRenderer.removeListener('terminal:executionEvent', handler)
    },
    resolveCommandConfirmation: (id: string, approved: boolean) =>
      ipcRenderer.invoke('terminal:resolveCommandConfirmation', id, approved),
    recordLifecycleEvent: (input: any) =>
      ipcRenderer.invoke('terminal:recordLifecycleEvent', input),
    submitCommand: (input: any) => ipcRenderer.invoke('terminal:submitCommand', input),
    listSessions: () => ipcRenderer.invoke('terminal:listSessions'),
    listAuditEvents: (filter?: any) => ipcRenderer.invoke('terminal:listAuditEvents', filter),
    clearAuditSession: (terminalSessionId: string) =>
      ipcRenderer.invoke('terminal:clearAuditSession', terminalSessionId),
    clearAuditEvents: () => ipcRenderer.invoke('terminal:clearAuditEvents'),
  },

  // 应用设置
  settings: {
    /** 获取所有设置 */
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    /** 更新部分设置 */
    set: (updates: Partial<Record<string, unknown>>) => ipcRenderer.invoke('settings:set', updates),
    /** 恢复默认设置 */
    reset: () => ipcRenderer.invoke('settings:reset'),
    /** 重置单个设置到默认值 */
    resetKey: (key: string) => ipcRenderer.invoke('settings:resetKey', key),
  },

  // 工作台状态（逐步替代 renderer localStorage）
  workspaceState: {
    /** 获取指定工作区的持久化工作台状态；空路径表示全局状态 */
    get: (workspacePath?: string | null, ownerKey?: string | null) =>
      ipcRenderer.invoke('workspaceState:get', workspacePath, ownerKey),
    /** 写入一个状态分区，例如 tabs/browserTabs/layout */
    setSection: (
      workspacePath: string | null | undefined,
      section: string,
      value: unknown,
      ownerKey?: string | null,
    ) => ipcRenderer.invoke('workspaceState:setSection', workspacePath, section, value, ownerKey),
    /** 清空指定工作区的工作台状态；空路径表示全局状态 */
    clear: (workspacePath?: string | null, ownerKey?: string | null) =>
      ipcRenderer.invoke('workspaceState:clear', workspacePath, ownerKey),
  },

  // Meshy 3D 资产生成
  meshy: {
    /** 创建 Text to 3D preview 任务 */
    createPreview: (options: any) => ipcRenderer.invoke('meshy:createPreview', options),
    /** 创建 Text to 3D refine 任务 */
    createRefine: (options: any) => ipcRenderer.invoke('meshy:createRefine', options),
    /** 查询 Text to 3D 任务 */
    getTask: (taskId: string) => ipcRenderer.invoke('meshy:getTask', taskId),
    /** 保存已成功任务的模型资产 */
    saveAsset: (options: any) => ipcRenderer.invoke('meshy:saveAsset', options),
    /** 从 prompt 生成、等待并保存模型资产 */
    generateAndSave: (options: any) => ipcRenderer.invoke('meshy:generateAndSave', options),
  },

  // 订阅系统
  subscription: {
    /** 获取可用套餐列表 */
    getPlans: () => ipcRenderer.invoke('subscription:getPlans'),
    /** 获取当前用户订阅状态 */
    getStatus: () => ipcRenderer.invoke('subscription:getStatus'),
    /** 创建支付订单 */
    createOrder: (planCode: string, channel: string) =>
      ipcRenderer.invoke('subscription:createOrder', planCode, channel),
    /** 轮询订单状态 */
    checkOrder: (orderNo: string) => ipcRenderer.invoke('subscription:checkOrder', orderNo),
    /** Apple IAP 凭据验证 */
    verifyAppleIap: (orderNo: string, receiptData: string) =>
      ipcRenderer.invoke('subscription:verifyAppleIap', orderNo, receiptData),
    /** 取消订阅 */
    cancel: () => ipcRenderer.invoke('subscription:cancel'),
    /** 监听订阅状态变化 */
    onStatusChanged: (callback: (status: any) => void) => {
      ipcRenderer.removeAllListeners('subscription:statusChanged')
      ipcRenderer.on('subscription:statusChanged', (_event, status) => callback(status))
    },
  },

  // 自动更新（检查 + 下载 dmg）
  update: {
    /** 手动触发一次更新检查（返回完整结果，无更新也返回） */
    check: () => ipcRenderer.invoke('updater:check'),
    /** 下载最新版本 dmg 到 ~/Downloads 并自动打开（挂载），返回保存路径 */
    download: () => ipcRenderer.invoke('updater:download'),
    /** 监听「发现新版本」推送，返回取消订阅函数 */
    onUpdateAvailable: (callback: (info: { latest?: string }) => void) => {
      const handler = (_event: unknown, info: { latest?: string }): void => callback(info)
      ipcRenderer.removeAllListeners('updater:update-available')
      ipcRenderer.on('updater:update-available', handler)
      return () => {
        ipcRenderer.removeListener('updater:update-available', handler)
      }
    },
  },
})
