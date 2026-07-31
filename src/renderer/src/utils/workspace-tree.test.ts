import { describe, expect, it, vi } from 'vitest'
import { prepareWorkspaceTree, resolveFileTreeCreationParent } from './workspace-tree'

describe('workspace tree projection', () => {
  const readDir = vi.fn(async (path: string) => [
    {
      name: 'docs',
      path: `${path}/docs`,
      type: 'directory' as const,
      size: 0,
      modifiedAt: 1,
    },
  ])

  it('does not inherit file-tree selection from a different workspace', async () => {
    const projection = await prepareWorkspaceTree(
      '/workspace/b',
      undefined,
      {
        workspacePath: '/workspace/a',
        expandedPaths: ['/workspace/a/docs'],
        selectedPath: '/workspace/a/note.md',
      },
      readDir,
    )

    expect(projection.expandedPaths).toEqual([])
    expect(projection.selectedPath).toBeNull()
    expect(projection.tree).toEqual([
      expect.objectContaining({ path: '/workspace/b/docs', expanded: false }),
    ])
  })

  it('restores the target workspace file-tree projection', async () => {
    const projection = await prepareWorkspaceTree(
      '/workspace/b',
      {
        expandedPaths: ['/workspace/b/docs'],
        selectedPath: '/workspace/b/note.md',
      },
      {
        workspacePath: '/workspace/a',
        expandedPaths: [],
        selectedPath: null,
      },
      readDir,
    )

    expect(projection.expandedPaths).toEqual(['/workspace/b/docs'])
    expect(projection.selectedPath).toBe('/workspace/b/note.md')
    expect(projection.tree[0]?.expanded).toBe(true)
  })

  it('creates entries inside the selected directory', () => {
    const tree = [
      {
        name: 'docs',
        path: '/workspace/docs',
        type: 'directory' as const,
        children: [
          {
            name: 'draft.md',
            path: '/workspace/docs/draft.md',
            type: 'file' as const,
          },
        ],
      },
    ]

    expect(resolveFileTreeCreationParent('/workspace', tree, '/workspace/docs')).toBe(
      '/workspace/docs',
    )
    expect(resolveFileTreeCreationParent('/workspace', tree, '/workspace/docs/draft.md')).toBe(
      '/workspace/docs',
    )
  })

  it('falls back to the workspace root without a valid selection', () => {
    const tree = [
      {
        name: 'docs',
        path: '/workspace/docs',
        type: 'directory' as const,
      },
    ]

    expect(resolveFileTreeCreationParent('/workspace', tree, null)).toBe('/workspace')
    expect(resolveFileTreeCreationParent('/workspace', tree, '/workspace/missing.md')).toBe(
      '/workspace',
    )
  })
})
