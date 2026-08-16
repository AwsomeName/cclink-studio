import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_NATIVE_SCHEDULING_TOOLS,
  inspectNativeSchedulingSymlinkToolUse,
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

  it('denies real dangling symlinks that project to native scheduling state', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-scheduling-symlink-'))
    const claudePath = join(workspacePath, '.claude')
    await mkdir(claudePath)
    await symlink('scheduled_tasks.json', join(claudePath, 'alias.json'))
    try {
      await expect(
        inspectNativeSchedulingSymlinkToolUse(
          'mcp__cclink_studio__editor_write',
          { filePath: '.claude/alias.json', content: '{}' },
          workspacePath,
        ),
      ).resolves.toMatchObject({ code: 'NATIVE_SCHEDULING_FILE_BLOCKED' })
      await expect(
        inspectNativeSchedulingSymlinkToolUse(
          'Bash',
          { command: "echo '{}' > .claude/alias.json" },
          workspacePath,
        ),
      ).resolves.toMatchObject({ code: 'NATIVE_SCHEDULING_FILE_BLOCKED' })
      await expect(
        inspectNativeSchedulingSymlinkToolUse(
          'Bash',
          { command: "cd .claude && echo '{}' > alias.json" },
          workspacePath,
        ),
      ).resolves.toMatchObject({ code: 'NATIVE_SCHEDULING_FILE_BLOCKED' })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('denies external aliases that project into protected scheduling state', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'cclink-external-scheduling-alias-'))
    const workspacePath = join(rootPath, 'workspace')
    const externalPath = join(rootPath, 'external')
    await Promise.all([mkdir(workspacePath), mkdir(externalPath)])
    const aliasPath = join(externalPath, 'alias.json')
    await symlink(join(workspacePath, '.claude', 'scheduled_tasks.json'), aliasPath)
    try {
      await expect(
        inspectNativeSchedulingSymlinkToolUse(
          'mcp__cclink_studio__editor_write',
          { filePath: aliasPath, content: '{}' },
          workspacePath,
        ),
      ).resolves.toMatchObject({ code: 'NATIVE_SCHEDULING_FILE_BLOCKED' })
      await expect(
        inspectNativeSchedulingSymlinkToolUse(
          'Bash',
          { command: `echo '{}' > ${aliasPath}` },
          workspacePath,
        ),
      ).resolves.toMatchObject({ code: 'NATIVE_SCHEDULING_FILE_BLOCKED' })
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
