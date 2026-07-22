import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  contextActionCommands,
  contextActionContributions,
  contextActionExternalCommandIds,
} from './context-action-catalog'
import { validateContextActionCatalog } from './context-action-catalog-validation'
import {
  classifyContextActionCommandFailure,
  formatContextActionDiagnosticsMarkdown,
  sanitizeContextActionDiagnosticMessage,
  useContextActionDiagnosticsStore,
} from './context-action-diagnostics'
import { CONTEXT_TARGET_KINDS } from './context-target'
import { resolveContextMenu } from './resolve-context-menu'

beforeEach(() => {
  useContextActionDiagnosticsStore.getState().clear()
})

describe('M5 context action maintenance gates', () => {
  it('keeps command IDs, contribution IDs, owners, groups, and target coverage valid', () => {
    expect(
      validateContextActionCatalog({
        commands: contextActionCommands,
        contributions: contextActionContributions,
        externalCommandIds: contextActionExternalCommandIds,
      }),
    ).toEqual([])
    expect(new Set(contextActionContributions.flatMap((item) => item.targetKinds))).toEqual(
      new Set(CONTEXT_TARGET_KINDS),
    )
  })

  it('reports duplicate IDs, orphan owners, invalid groups, and uncovered targets', () => {
    const command = { id: 'duplicate', label: 'Duplicate', contextOnly: true, action: vi.fn() }
    const issues = validateContextActionCatalog({
      commands: [command, command],
      contributions: [
        {
          id: 'same',
          targetKinds: ['tab'],
          group: 'broken',
          order: Number.NaN,
          commandId: 'missing',
        },
        {
          id: 'same',
          targetKinds: ['tab'],
          group: '10.valid',
          order: 10,
          commandId: 'duplicate',
        },
      ],
      targetKinds: ['tab', 'file'],
    })

    expect(new Set(issues.map((issue) => issue.code))).toEqual(
      new Set([
        'duplicate-command-id',
        'duplicate-contribution-id',
        'orphan-contribution',
        'invalid-contribution',
        'uncovered-target-kind',
      ]),
    )
  })

  it('isolates a failing contribution predicate without breaking the menu', () => {
    const result = resolveContextMenu({
      commands: [{ id: 'healthy', label: 'Healthy', action: vi.fn() }],
      contributions: [
        {
          id: 'broken',
          targetKinds: ['tab'],
          group: '10.test',
          order: 10,
          commandId: 'healthy',
          when: () => {
            throw new Error('predicate failed')
          },
        },
        {
          id: 'healthy',
          targetKinds: ['tab'],
          group: '10.test',
          order: 20,
          commandId: 'healthy',
        },
      ],
      context: {
        source: 'context-menu',
        target: { kind: 'tab', workspaceKey: null, tabId: 'tab-1', tabType: 'editor' },
      },
    })

    expect(result.items.map((item) => item.contribution.id)).toEqual(['healthy'])
    expect(result.failures).toEqual([{ contributionId: 'broken', message: 'predicate failed' }])
  })

  it('classifies failures and redacts sensitive diagnostic text', () => {
    expect(classifyContextActionCommandFailure({ reason: 'stale-target' })).toBe('stale-target')
    expect(classifyContextActionCommandFailure({ reason: 'failed', message: '权限拒绝' })).toBe(
      'permission-denied',
    )
    expect(classifyContextActionCommandFailure({ reason: 'failed', message: 'owner failed' })).toBe(
      'domain-execution-failed',
    )
    expect(classifyContextActionCommandFailure({ reason: 'missing-command' })).toBe(
      'menu-build-failed',
    )
    expect(
      sanitizeContextActionDiagnosticMessage(
        'token=super-secret https://example.com/path authorization: BearerValue',
      ),
    ).toBe('token=[REDACTED] [URL] authorization=[REDACTED]')
  })

  it('keeps diagnostics bounded and exports only the latest safe events', () => {
    for (let index = 0; index < 55; index += 1) {
      useContextActionDiagnosticsStore.getState().record({
        kind: 'domain-execution-failed',
        commandId: `test.${index}`,
        targetKind: 'tab',
        message: `failure ${index}`,
      })
    }
    const events = useContextActionDiagnosticsStore.getState().events
    expect(events).toHaveLength(50)
    expect(events[0]?.commandId).toBe('test.5')
    const markdown = formatContextActionDiagnosticsMarkdown(events)
    expect(markdown).toContain('domain-execution-failed=50')
    expect(markdown).toContain('test.54')
    expect(markdown).not.toContain('test.5 · failure 5')
  })
})
