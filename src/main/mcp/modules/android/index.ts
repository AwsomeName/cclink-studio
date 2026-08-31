/**
 * Android 工具模块
 *
 * 提供 15 个 ADB 操控工具，对标 modules/browser/index.ts 的 16 个浏览器工具。
 * 实现统一的 ToolModule 接口，可注册到 McpToolHost。
 *
 * 执行逻辑委托给 android-actions.ts 的共享 Action Executor，
 * IPC 处理器也使用同一个 executor，避免重复代码。
 */

import type { ToolModule, ToolDefinition, ToolExecutionContext } from '../../types'
import type { AdbBridge } from '../../../android/adb-bridge'
import type { ScrcpyBridge } from '../../../android/scrcpy-bridge'
import { executeAndroidAction } from '../../../android/android-actions'
import type { FileService } from '../../../fs/file-service'

/**
 * 将 MCP 工具名映射为 action type
 *
 * android_screenshot → screenshot
 * android_go_home → goHome
 * android_dump_ui → dumpUi
 */
export function toolNameToActionType(toolName: string): string {
  const withoutPrefix = toolName.replace(/^android_/, '')
  return withoutPrefix.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * 15 个 Android 工具定义
 */
const ANDROID_TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── 只读工具 ──────────────────────────────
  {
    name: 'android_screenshot',
    description: '截取 Android 设备屏幕截图，返回 base64 编码的 PNG 图片',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'android_dump_ui',
    description: '导出 Android 设备当前界面的 UI 层级 XML（用于分析界面元素和坐标）',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'android_device_info',
    description: '获取 Android 设备信息（型号、Android 版本、SDK 版本、制造商）',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'android_list_packages',
    description: '列出 Android 设备上已安装的应用包名',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '可选的包名过滤关键字（如 "wechat"）' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'android_current_activity',
    description: '获取 Android 设备当前前台 Activity 信息',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },

  // ── 操作工具 ──────────────────────────────
  {
    name: 'android_tap',
    description: '在 Android 设备的指定坐标点击',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '点击的 X 坐标（像素）' },
        y: { type: 'number', description: '点击的 Y 坐标（像素）' },
      },
      required: ['x', 'y'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_swipe',
    description: '在 Android 设备上执行滑动手势',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number', description: '起始 X 坐标' },
        y1: { type: 'number', description: '起始 Y 坐标' },
        x2: { type: 'number', description: '结束 X 坐标' },
        y2: { type: 'number', description: '结束 Y 坐标' },
        duration: { type: 'number', description: '滑动持续时间（毫秒），默认 300' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_press_key',
    description:
      '按下 Android 按键。支持: home, back, recent, volume_up, volume_down, power, enter, delete, tab, escape, menu',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '按键名称（如 home, back, enter）' },
      },
      required: ['key'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_type_text',
    description:
      '向 Android 设备输入文本（当前焦点输入框）。支持中文/Emoji。' +
      '优先通过 scrcpy 通道注入（需投屏已连接），否则回退到 ADB input text（仅 ASCII）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要输入的文本（支持中文）' },
      },
      required: ['text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_launch_package',
    description: '启动 Android 设备上的指定应用',
    inputSchema: {
      type: 'object',
      properties: {
        packageName: { type: 'string', description: '应用包名（如 com.tencent.mm）' },
      },
      required: ['packageName'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_go_home',
    description: '按下 Android Home 键，回到桌面',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── 写入工具 ──────────────────────────────
  {
    name: 'android_install_apk',
    description: '安装 APK 文件到 Android 设备',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'APK 文件在主机上的路径' },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_uninstall_package',
    description: '从 Android 设备卸载指定应用',
    inputSchema: {
      type: 'object',
      properties: {
        packageName: { type: 'string', description: '要卸载的应用包名' },
      },
      required: ['packageName'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_push_file',
    description: '推送文件到 Android 设备',
    inputSchema: {
      type: 'object',
      properties: {
        local: { type: 'string', description: '主机上的文件路径' },
        remote: { type: 'string', description: '设备上的目标路径' },
      },
      required: ['local', 'remote'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'android_shell',
    description: '在 Android 设备上执行任意 shell 命令（高权限操作）',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
      },
      required: ['command'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
]

/**
 * Android 工具模块
 *
 * 实现 ToolModule 接口，将 15 个 ADB 操作
 * 封装为可注册到 McpToolHost 的工具模块。
 * 执行委托给 android-actions.ts 的共享 executor。
 *
 * 如果传入 scrcpy 桥接，typeText 等工具会优先走 scrcpy 通道
 * （支持中文/Unicode），不可用时回退到 ADB（仅 ASCII）。
 */
export class AndroidToolModule implements ToolModule {
  readonly name = 'android'
  readonly tools: ToolDefinition[] = ANDROID_TOOL_DEFINITIONS

  constructor(
    private adbBridge: AdbBridge,
    private scrcpyBridge?: ScrcpyBridge,
    private fileService?: FileService | null,
  ) {}

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    if (!this.adbBridge.isConnected()) {
      throw new Error('ADB 未连接，Android 设备可能未启动')
    }
    const actionType = toolNameToActionType(toolName)
    if (actionType === 'installApk' || actionType === 'pushFile') {
      if (!this.fileService) throw new Error('本地文件授权服务不可用，已拒绝 Android 文件操作')
      if (context?.trustedWorkspace?.kind !== 'local') {
        throw new Error('Android 文件操作仅允许使用本次 Run 启动时固定的本地工作空间')
      }
      const localPath = actionType === 'installApk' ? params.path : params.local
      if (typeof localPath !== 'string') throw new Error('Android 文件操作缺少本地文件路径')
      await this.fileService.withAccess({ trustedWorkspace: context.trustedWorkspace }, () =>
        this.fileService!.assertReadableFile(localPath),
      )
    }
    return executeAndroidAction(this.adbBridge, { type: actionType, ...params }, this.scrcpyBridge)
  }
}
