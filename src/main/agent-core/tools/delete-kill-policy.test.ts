import { describe, expect, it } from 'vitest'
import { deleteKillReasonFor, deleteKillReasonForShellCommand } from './delete-kill-policy'

describe('deleteKillReasonFor structured tools', () => {
  it('flags kill and delete structured tools', () => {
    expect(deleteKillReasonFor('KillShell', { shellId: 'shell-1' })).toContain('终止进程类')
    expect(deleteKillReasonFor('browser_clear_cookies', {})).toContain('删除类')
    expect(deleteKillReasonFor('android_uninstall_package', { packageName: 'com.a' })).toContain(
      '删除类',
    )
    expect(deleteKillReasonFor('cad_clear_cache', {})).toContain('删除类')
  })

  it('does not flag ordinary structured tools', () => {
    expect(deleteKillReasonFor('browser_click', { selector: '#a' })).toBeNull()
    expect(deleteKillReasonFor('editor_write', { filePath: '/tmp/a.md' })).toBeNull()
    expect(deleteKillReasonFor('browser_close_tab', { tabId: 'tab-1' })).toBeNull()
  })

  it('fail-closes when Bash has no command parameter', () => {
    expect(deleteKillReasonFor('Bash', {})).toContain('缺少 command 参数')
    expect(deleteKillReasonFor('Bash', undefined)).toContain('缺少 command 参数')
  })
})

describe('deleteKillReasonForShellCommand direct hits', () => {
  const deleteCommands = [
    'rm -rf /tmp/canary',
    'rm "/tmp/my file.txt"',
    'rmdir /tmp/empty',
    'unlink /tmp/a.txt',
    'shred /tmp/secret',
    'trash /tmp/old',
    '/bin/rm -rf /tmp/canary',
    'git clean -fd',
    'git -C /repo rm -r build',
    'find /tmp -name "*.log" -delete',
    'find /tmp -exec rm {} +',
    'find /tmp -execdir rm -rf {} \\;',
    'kill 1234',
    'kill -9 1234',
    'pkill -f canary',
    'killall Safari',
    'shutdown -h now',
    'reboot',
  ]
  for (const command of deleteCommands) {
    it(`flags "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).not.toBeNull()
    })
  }
})

describe('deleteKillReasonForShellCommand prefixes and compounds', () => {
  const compoundCommands = [
    'sudo -u root rm /tmp/example',
    'env -u NAME kill 12345',
    'if true; then rm /tmp/example; fi',
    'echo ok # comment\nrm /tmp/example',
    'xargs -I {} rm {}',
    'xargs -n 1 kill',
    'nice -n 10 rm /tmp/example',
    'cd /tmp && rm -rf canary',
    'echo hi; pkill -f canary',
    'ls || kill 123',
    'cat notes | grep x; rm notes.txt',
    'FOO=1 rm -rf /tmp/canary',
    'sudo rm -rf /tmp/canary',
    'env rm /tmp/a',
    'nohup kill 42 &',
    '(rm -rf /tmp/canary)',
    'time pkill canary',
    'find . -name x | xargs rm',
    'xargs -0 rm -rf /tmp/canary',
  ]
  for (const command of compoundCommands) {
    it(`flags "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).not.toBeNull()
    })
  }
})

describe('deleteKillReasonForShellCommand inline code and substitution', () => {
  const inlineCommands = [
    'bash -c "rm -rf /tmp/canary"',
    "sh -c 'pkill -f canary'",
    'bash -lc "rm /tmp/a"',
    'zsh -c "echo hi && kill 42"',
    "node -e \"require('fs').unlinkSync('/tmp/a')\"",
    'python -c "import os; os.remove(\'/tmp/a\')"',
    'osascript -e \'tell application "X" to quit\' ; kill 42',
    'eval "rm -rf /tmp/canary"',
    'echo $(rm -rf /tmp/canary)',
    'echo `pkill canary`',
    'diff <(rm /tmp/a) <(ls)',
    'bash -c "bash -c \'rm /tmp/a\'"',
  ]
  for (const command of inlineCommands) {
    it(`flags "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).not.toBeNull()
    })
  }
})

describe('deleteKillReasonForShellCommand dynamic constructions fail closed', () => {
  const dynamicCommands = ['eval "$CMD"', 'bash -c "$SCRIPT"', 'sh -c "$1"', '$CMD --flag']
  for (const command of dynamicCommands) {
    it(`flags "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).toContain('动态构造')
    })
  }

  it('flags heredocs whose body mentions delete/kill commands', () => {
    expect(deleteKillReasonForShellCommand('bash <<EOF\nrm -rf /tmp/canary\nEOF')).toContain(
      'heredoc',
    )
  })
})

describe('deleteKillReasonForShellCommand ordinary commands pass', () => {
  const ordinaryCommands = [
    'sudo -u root ls /tmp',
    'env -u NAME pnpm test',
    'xargs -I {} echo {}',
    'echo ok # comment\npnpm test',
    'pwd',
    'ls -la /tmp',
    'pnpm install',
    'pnpm build && pnpm test',
    'pnpm test -- --run',
    'npm run dev',
    'node scripts/build.js',
    'python scripts/check.py',
    'bash scripts/restart.sh restart',
    './scripts/dev.sh',
    'source scripts/env.sh',
    'make clean && make all',
    'git status',
    'git commit -m "remove legacy code"',
    'git push origin main',
    'git log --oneline | head -5',
    'echo "rm is a command word in a quoted string"',
    'cat file > /tmp/out 2>&1',
    'mkdir -p build && touch build/x',
    'cp -r src build',
    'mv notes.txt notes2.txt',
    'curl -s https://example.com | grep title',
    'grep -rn "kill" src/ | head',
    'echo hello world',
    'open README.md',
    'rg "rm -rf" docs/',
    'docker compose up -d',
  ]
  for (const command of ordinaryCommands) {
    it(`allows "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).toBeNull()
    })
  }
})

describe('deleteKillReasonForShellCommand control structures analyze transparently', () => {
  const passingCommands = [
    'for f in *.png; do cp "$f" "/tmp/$f"; done',
    'for f in a b c; do echo "$f"; done',
    'for file in src/*.ts; do wc -l "$file"; done',
    'while read -r line; do echo "$line" >> out.log; done < input.txt',
    'until ping -c 1 host; do sleep 1; done',
    'if [ -f config.json ]; then echo exists; fi',
    'if grep -q foo bar.txt; then echo found; else echo missing; fi',
    'case "$mode" in a) echo 1;; b) echo 2;; *) echo other;; esac',
    'function greet { echo hi; }',
    'greet() { echo hi; }',
    'for ((i = 0; i < 5; i++)); do echo "$i"; done',
    'then echo later',
    'select opt in a b; do echo "$opt"; done',
  ]
  for (const command of passingCommands) {
    it(`allows "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).toBeNull()
    })
  }

  const flaggedCommands = [
    'for f in *.log; do rm "$f"; done',
    'for f in *; do rm -rf "$f"; done',
    'while read -r pid; do kill "$pid"; done',
    'if [ -f x ]; then rm -rf x; fi',
    'if rm /tmp/a; then echo done; fi',
    'case "$1" in clean) git clean -fd;; esac',
    'case $branch in main) rm ./canary;; esac',
    'function cleanup { rm -rf build; }',
    'cleanup() { kill 123; }',
    'else rm /tmp/a',
    'elif true; then pkill canary',
    'do rm /tmp/a',
  ]
  for (const command of flaggedCommands) {
    it(`flags "${command}"`, () => {
      expect(deleteKillReasonForShellCommand(command)).not.toBeNull()
    })
  }

  it('fail-closes on dynamic command positions inside control structures', () => {
    expect(deleteKillReasonForShellCommand('for f in *; do $f; done')).toContain('动态构造')
    expect(deleteKillReasonForShellCommand('if [ -n "$x" ]; then bash -c "$CMD"; fi')).toContain(
      '动态构造',
    )
  })
})

describe('deleteKillReasonForShellCommand quoting and edge cases', () => {
  it('does not treat quoted mentions of command words as calls', () => {
    expect(deleteKillReasonForShellCommand("echo 'rm'")).toBeNull()
    expect(deleteKillReasonForShellCommand('echo "kill"')).toBeNull()
  })

  it('still flags deletes with variable targets', () => {
    expect(deleteKillReasonForShellCommand('rm "$TARGET_FILE"')).toContain('删除类')
    expect(deleteKillReasonForShellCommand('rm -rf ${DIR}/canary')).toContain('删除类')
  })

  it('handles multi-line scripts and comments', () => {
    expect(deleteKillReasonForShellCommand('set -e\npnpm install\npnpm test')).toBeNull()
    expect(deleteKillReasonForShellCommand('# run rm tomorrow\npnpm test')).toBeNull()
    expect(deleteKillReasonForShellCommand('pnpm install\nrm -rf node_modules')).toContain('删除类')
  })

  it('caps recursion depth fail-closed on pathological nesting', () => {
    let nested = 'rm /tmp/a'
    for (let index = 0; index < 20; index += 1) nested = `bash -c "${nested.replace(/"/g, '\\"')}"`
    expect(deleteKillReasonForShellCommand(nested)).not.toBeNull()
  })
})
