import { describe, expect, it } from 'vitest'
import type { TerminalPermissionPolicy } from '../../shared/terminal'
import { classifyTerminalCommand, evaluateTerminalPermission } from './terminal-permission'

it('requires confirmation for multiline scripts and shell substitutions', () => {
  for (const command of [
    'pwd\nrm file',
    'echo $(touch file)',
    'echo `touch file`',
    'cat <(command)',
  ]) {
    expect(classifyTerminalCommand(command)).toBe('unknown')
  }
})

const askRiskyPolicy: TerminalPermissionPolicy = {
  mode: 'ask-risky-command',
  requireConfirmationFor: ['write', 'network', 'destructive', 'privileged', 'unknown'],
}

describe('classifyTerminalCommand', () => {
  it('classifies read-only commands', () => {
    expect(classifyTerminalCommand('pwd')).toBe('read')
    expect(classifyTerminalCommand('git status --short')).toBe('read')
    expect(classifyTerminalCommand('cat README.md | grep CCLink Studio')).toBe('read')
  })

  it('classifies write commands', () => {
    expect(classifyTerminalCommand('touch notes.md')).toBe('write')
    expect(classifyTerminalCommand('echo hello > notes.md')).toBe('write')
    expect(classifyTerminalCommand('git commit -m test')).toBe('write')
    expect(classifyTerminalCommand('pnpm install')).toBe('write')
  })

  it('classifies network commands', () => {
    expect(classifyTerminalCommand('curl https://example.com')).toBe('network')
    expect(classifyTerminalCommand('ssh app@example.com')).toBe('network')
  })

  it('classifies destructive and privileged commands', () => {
    expect(classifyTerminalCommand('rm -rf dist')).toBe('destructive')
    expect(classifyTerminalCommand('killall node')).toBe('destructive')
    expect(classifyTerminalCommand('sudo npm install -g foo')).toBe('privileged')
    expect(classifyTerminalCommand('chmod 777 /tmp/file')).toBe('privileged')
  })

  it('uses the highest risk across compound commands', () => {
    expect(classifyTerminalCommand('pwd && rm -rf dist')).toBe('destructive')
    expect(classifyTerminalCommand('git status; sudo whoami')).toBe('privileged')
  })

  it('treats unknown commands as unknown', () => {
    expect(classifyTerminalCommand('custom-tool --danger')).toBe('unknown')
    expect(classifyTerminalCommand('')).toBe('unknown')
  })
})

describe('evaluateTerminalPermission', () => {
  it('allows read commands in read-only mode and denies writes', () => {
    const policy: TerminalPermissionPolicy = {
      mode: 'read-only',
      requireConfirmationFor: [],
    }

    expect(evaluateTerminalPermission('pwd', policy)).toMatchObject({
      action: 'allow',
      risk: 'read',
    })
    expect(evaluateTerminalPermission('touch a.txt', policy)).toMatchObject({
      action: 'deny',
      risk: 'write',
    })
  })

  it('requires confirmation for every command in ask-every-command mode', () => {
    const policy: TerminalPermissionPolicy = {
      mode: 'ask-every-command',
      requireConfirmationFor: [],
    }

    expect(evaluateTerminalPermission('pwd', policy)).toMatchObject({
      action: 'confirm',
      risk: 'read',
    })
  })

  it('requires confirmation for configured risky commands', () => {
    expect(evaluateTerminalPermission('pwd', askRiskyPolicy)).toMatchObject({
      action: 'allow',
      risk: 'read',
    })
    expect(evaluateTerminalPermission('curl https://example.com', askRiskyPolicy)).toMatchObject({
      action: 'confirm',
      risk: 'network',
    })
    expect(evaluateTerminalPermission('rm -rf dist', askRiskyPolicy)).toMatchObject({
      action: 'confirm',
      risk: 'destructive',
    })
  })

  it('lets denylist override allowlist and mode', () => {
    const policy: TerminalPermissionPolicy = {
      mode: 'trusted-session',
      requireConfirmationFor: [],
      allowlist: ['rm'],
      denylist: ['rm -rf'],
    }

    expect(evaluateTerminalPermission('rm -rf dist', policy)).toMatchObject({
      action: 'deny',
      matchedRule: 'rm -rf',
    })
  })

  it('allows allowlisted commands before risk confirmation', () => {
    const policy: TerminalPermissionPolicy = {
      ...askRiskyPolicy,
      allowlist: ['curl https://internal.example/health'],
    }

    expect(
      evaluateTerminalPermission('curl https://internal.example/health', policy),
    ).toMatchObject({
      action: 'allow',
      risk: 'network',
      matchedRule: 'curl https://internal.example/health',
    })
  })

  it('still confirms unknown commands in trusted sessions', () => {
    const policy: TerminalPermissionPolicy = {
      mode: 'trusted-session',
      requireConfirmationFor: [],
    }

    expect(evaluateTerminalPermission('internal-deploy-tool', policy)).toMatchObject({
      action: 'confirm',
      risk: 'unknown',
    })
  })

  it('denies empty commands', () => {
    expect(evaluateTerminalPermission('   ', askRiskyPolicy)).toMatchObject({
      action: 'deny',
      risk: 'unknown',
    })
  })
})
