import type { AppSettings, ClaudeCodeStatus } from '@shared/ipc/settings'
import type { PermissionMode } from '../../types'

export interface PermissionModeOption {
  value: PermissionMode
  label: string
  description: string
  color: string
}

export const PERMISSION_MODE_OPTIONS: PermissionModeOption[] = [
  {
    value: 'auto',
    label: '自动',
    description: '低风险操作自动放行',
    color: '#22c55e',
  },
  {
    value: 'auto-except-destructive',
    label: '除删除/终止外自动',
    description: '仅删除与终止进程类操作逐次确认；其余自动放行',
    color: '#f97316',
  },
  {
    value: 'categorized',
    label: '分类',
    description: '写入和高风险操作需要确认',
    color: '#eab308',
  },
  {
    value: 'strict',
    label: '严格',
    description: '所有工具操作都先确认',
    color: '#ef4444',
  },
]

export function getPermissionModeOption(mode: PermissionMode): PermissionModeOption {
  return (
    PERMISSION_MODE_OPTIONS.find((option) => option.value === mode) ?? PERMISSION_MODE_OPTIONS[0]
  )
}

export function getRuntimeLabel(settings: AppSettings): string {
  if (settings.agentEngine === 'local-claude-code') return 'Claude Code'
  return 'Agent'
}

export function getRuntimeDetail(settings: AppSettings): string {
  if (settings.agentEngine === 'local-claude-code') {
    if (settings.claudeRuntimeSource === 'bundled') return '内置固定版本'
    if (settings.claudeRuntimeSource === 'custom') return '自定义路径'
    return '系统安装'
  }
  return '设置'
}

export function getClaudeCodeStatusLabel(status: ClaudeCodeStatus | null): string {
  if (!status) return '未检测'
  return status.installed ? '已就绪' : '未找到'
}

export function getClaudeCodeStatusDetail(status: ClaudeCodeStatus | null): string {
  if (!status) return '打开菜单时检测本机 Claude Code'
  if (status.installed) return status.path ?? '已找到可用 Claude Code'
  return status.error ?? '未找到 Claude Code CLI'
}

export function getClaudeCodeSourceLabel(source: ClaudeCodeStatus['source'] | null): string {
  switch (source) {
    case 'bundled':
      return '内置固定版本'
    case 'configured':
      return '手动路径'
    case 'known-path':
      return '常用路径'
    case 'shell-path':
      return 'Shell PATH'
    case 'spawn-path':
      return '进程 PATH'
    case 'not-found':
    case null:
      return '未检测'
  }
}
