import { describe, expect, it } from 'vitest'
import {
  commandNeedsTerminal,
  findCommandCodeBlock,
  terminalInteractionPrompt,
} from './conversation-command'

describe('conversation command eligibility', () => {
  it('accepts completed shell fences and conservative unlabelled commands', () => {
    expect(findCommandCodeBlock('```sh\npwd\n```', 0)).toBe('pwd')
    expect(findCommandCodeBlock('文字\n\n```\nsudo xcodebuild -license\n```', 2)).toBe(
      'sudo xcodebuild -license',
    )
    expect(findCommandCodeBlock('```bash\necho one\necho two\n```', 0)).toBe('echo one\necho two')
  })
  it('rejects incomplete fences, non-shell code, controls, oversize and stale locations', () => {
    for (const source of [
      '```sh\necho unfinished',
      '```ts\necho()\n```',
      '```json\n{}\n```',
      '```\nThis is prose\n```',
      '```sh\necho \u001b[2J\n```',
      '```sh\n' + 'a'.repeat(4001) + '\n```',
    ]) {
      expect(findCommandCodeBlock(source, 0)).toBeNull()
    }
    expect(findCommandCodeBlock('```sh\npwd\n```', 1)).toBeNull()
  })
  it('opens known interactive commands but leaves ordinary work in the background', () => {
    for (const command of [
      'sudo xcodebuild -license',
      'read answer',
      'ssh host',
      'vim README.md',
      'python3',
    ])
      expect(commandNeedsTerminal(command)).toBe(true)
    for (const command of ['pwd', 'pnpm test', 'git status', 'python3 check.py'])
      expect(commandNeedsTerminal(command)).toBe(false)
  })
  it('recognizes password, choice and ANSI prompts without treating ordinary output as completion', () => {
    for (const prompt of [
      'Password: ',
      '请输入密码：',
      'Proceed? [y/N] ',
      'Enter a value: ',
      '\u001b[32m? Select a package\u001b[0m',
      'Press ENTER to continue',
    ])
      expect(terminalInteractionPrompt(prompt)).not.toBeNull()
    expect(terminalInteractionPrompt('Password checked successfully\n')).toBeNull()
    expect(terminalInteractionPrompt('build finished\n$ ')).toBeNull()
  })
})
