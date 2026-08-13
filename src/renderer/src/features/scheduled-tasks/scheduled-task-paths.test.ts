import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceRelativePath } from './scheduled-task-paths'

describe('normalizeWorkspaceRelativePath', () => {
  it('converts an absolute path inside the workspace to a relative path', () => {
    expect(
      normalizeWorkspaceRelativePath(
        '/Users/lc/Desktop/woniu-forward/000-个人计划',
        '/Users/lc/Desktop/woniu-forward',
        '绑定资源',
      ),
    ).toBe('000-个人计划')
  })

  it('keeps and normalizes relative workspace paths', () => {
    expect(
      normalizeWorkspaceRelativePath('./docs\\日报.md', '/Users/lc/Desktop/project', '绑定资源'),
    ).toBe('docs/日报.md')
  })

  it('supports Windows workspace paths case-insensitively', () => {
    expect(
      normalizeWorkspaceRelativePath('c:\\Project\\docs\\日报.md', 'C:\\Project', '绑定资源'),
    ).toBe('docs/日报.md')
  })

  it('rejects absolute and relative paths outside the workspace', () => {
    expect(() =>
      normalizeWorkspaceRelativePath(
        '/Users/lc/Desktop/other/secret.md',
        '/Users/lc/Desktop/project',
        '绑定资源',
      ),
    ).toThrow('绑定资源必须位于当前工作空间内')
    expect(() =>
      normalizeWorkspaceRelativePath('../secret.md', '/Users/lc/Desktop/project', '绑定资源'),
    ).toThrow('绑定资源必须位于当前工作空间内')
  })
})
