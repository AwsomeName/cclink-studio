import { describe, expect, it } from 'vitest'
import {
  CLAUDE_NATIVE_SCHEDULING_TOOLS,
  inspectNativeSchedulingToolUse,
} from './claude-native-scheduling-policy'

describe('Claude native scheduling policy', () => {
  it('keeps the complete native tool denylist', () => {
    expect(CLAUDE_NATIVE_SCHEDULING_TOOLS).toEqual([
      'CronCreate',
      'CronDelete',
      'CronList',
      'ScheduleWakeup',
      'RemoteTrigger',
    ])
  })

  it.each([
    ['CronCreate', {}],
    ['CronDelete', { id: 'cron-1' }],
    ['CronList', {}],
    ['ScheduleWakeup', { delaySeconds: 60 }],
    ['RemoteTrigger', { action: 'list' }],
    ['Skill', { skill: '/loop every 5m' }],
    ['Bash', { command: 'crontab -l' }],
    ['Bash', { command: 'cd /tmp && sudo launchctl load agent.plist' }],
    ['Bash', { command: 'bash -c "schtasks /create /tn report"' }],
    ['Bash', { command: 'systemd-run --on-calendar daily echo report' }],
    ['Bash', { command: 'cp report.plist ~/Library/LaunchAgents/com.example.report.plist' }],
    ['Bash', { command: 'printf timer > ~/.config/systemd/user/report.timer' }],
    ['Bash', { command: "python -c \"open('.claude/scheduled_tasks.json', 'w')\"" }],
    ['Write', { file_path: '.claude/scheduled_tasks.json', content: '{}' }],
    ['Edit', { file_path: '~/.config/systemd/user/report.timer' }],
    [
      'mcp__cclink_studio__editor_write',
      { filePath: '.claude/scheduled_tasks.json', content: '{}' },
    ],
    ['Write', { file_path: '.claude/./scheduled_tasks.json', content: '{}' }],
    ['Write', { file_path: '.claude/sub/../scheduled_tasks.json', content: '{}' }],
    ['Write', { file_path: 'workspace-alias/scheduled_tasks.json', content: '{}' }],
    ['Bash', { command: 'cd .claude && mv scheduled_tasks.json.disabled scheduled_tasks.json' }],
    ['mcp__cclink_studio__editor_write', { filePath: ' ', content: '{}' }],
    ['mcp__cclink_studio__editor_insert', { content: '{}', position: 'end' }],
    ['mcp__cclink_studio__editor_insert', { filePath: ' ', content: '{}', position: 'end' }],
    ['mcp__cclink_studio__editor_save', {}],
  ])('denies %s scheduling bypasses', (toolName, input) => {
    expect(inspectNativeSchedulingToolUse(toolName, input)).not.toBeNull()
  })

  it.each([
    ['Bash', { command: 'pnpm test' }],
    ['Bash', { command: 'echo crontab is documented' }],
    ['Bash', { command: 'systemctl status docker.service' }],
    ['Write', { file_path: 'docs/scheduler-notes.md', content: 'crontab examples' }],
    ['Read', { file_path: '.claude/scheduled_tasks.json' }],
    ['Skill', { skill: 'grill-me' }],
  ])('allows bounded non-scheduling use through %s', (toolName, input) => {
    expect(inspectNativeSchedulingToolUse(toolName, input)).toBeNull()
  })
})
