/**
 * Agent 操作作用域（Agent Operation Scope）
 *
 * AgentPanel 的目标选择器：用户指定 Agent 当前操作哪个目标（浏览器实例 / Android / 编辑器 / 全部）。
 * 选定后：硬收窄该域工具（allowedTools）+ 强化该域 system prompt。
 *
 * instanceId === 渲染层 tabId（BrowserManager.views 的 key），保证与用户看到的 Tab 对齐。
 */

import type { AgentScope } from '../../../shared/agent-protocol'
import type { ToolDefinition } from '../tools/types.js'

export type { AgentScope } from '../../../shared/agent-protocol'

/** 默认作用域：全部 */
export const DEFAULT_SCOPE: AgentScope = { kind: 'all' }

/**
 * 把作用域映射为 Claude Code 的 --allowedTools glob 列表
 *
 * 服务端（单 MCP server `cclink_studio`）照常广播全部工具；
 * CLI 的客户端 allowlist 只把匹配的暴露给模型。
 * 注意：agent-device 模块的模块名是 `agent-device`，但工具前缀是 `agent_device_`（下划线）。
 */
export function scopeToAllowedTools(scope: AgentScope): string[] {
  switch (scope.kind) {
    case 'all':
      return ['mcp__cclink_studio__*']
    case 'browser':
      return ['mcp__cclink_studio__browser_*']
    case 'android':
      // android_* 与 agent_device_* 并存（互补：语义 UI 感知 + 坐标操作）
      return ['mcp__cclink_studio__android_*', 'mcp__cclink_studio__agent_device_*']
    case 'editor':
      return [
        'mcp__cclink_studio__editor_*',
        'mcp__cclink_studio__image_generation_status',
        'mcp__cclink_studio__markdown_illustrate',
      ]
  }
}

/**
 * 判断一个工具是否属于给定作用域（用于 system prompt 工具表过滤）
 *
 * 按工具名前缀判断，与 scopeToAllowedTools 的 glob 语义保持一致。
 */
export function toolBelongsToScope(toolName: string, scope: AgentScope): boolean {
  switch (scope.kind) {
    case 'all':
      return true
    case 'browser':
      return toolName.startsWith('browser_')
    case 'android':
      return toolName.startsWith('android_') || toolName.startsWith('agent_device_')
    case 'editor':
      return (
        toolName.startsWith('editor_') ||
        toolName === 'image_generation_status' ||
        toolName === 'markdown_illustrate'
      )
  }
}

/** 按作用域过滤工具表（system prompt 工具表用） */
export function filterToolsByScope(tools: ToolDefinition[], scope: AgentScope): ToolDefinition[] {
  return tools.filter((t) => toolBelongsToScope(t.name, scope))
}

/** 作用域的人类可读标签（UI + 日志用） */
export function scopeLabel(scope: AgentScope): string {
  switch (scope.kind) {
    case 'all':
      return '全部'
    case 'android':
      return 'Android'
    case 'editor':
      return '编辑器'
    case 'browser':
      return `浏览器(${scope.instanceId.slice(0, 8)})`
  }
}
