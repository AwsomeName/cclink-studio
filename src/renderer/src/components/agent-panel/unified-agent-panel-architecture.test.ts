import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('unified Agent Panel production boundary', () => {
  it('routes both layout positions through the single AgentPanel entry', () => {
    const appSource = read('../../App.tsx')

    expect(appSource).not.toContain('RemoteAgentPanel')
    expect(appSource.match(/<AgentPanel variant=/gu)).toHaveLength(2)
  })

  it('keeps all production layout and the textarea inside the fixed AgentPanelView', () => {
    const viewSource = read('./agent-panel-view.tsx')
    const localControllerSource = read('./AgentPanel.tsx')
    const remoteControllerSource = read('../../features/cclink-remote/remote-agent-controller.tsx')

    expect(viewSource.match(/<textarea/gu)).toHaveLength(1)
    expect(viewSource).toContain('nativeEvent.isComposing')
    expect(viewSource).toContain('nativeEvent.keyCode === 229')
    expect(viewSource).toContain('onPointerDown={focusRenderer}')
    expect(viewSource).toContain('onFocus={focusRenderer}')
    expect(viewSource).toContain('export function PanelHeader')
    expect(viewSource).toContain('export function ContextBar')
    expect(viewSource).toContain('export function MessageTimeline')
    expect(viewSource).toContain('export function NoticePermissionArea')
    expect(viewSource).toContain('export function EmptyState')
    expect(viewSource).toContain('export function ComposerFrame')
    expect(viewSource).toContain('export function ActionBar')
    expect(localControllerSource).not.toContain('<textarea')
    expect(remoteControllerSource).not.toContain('<textarea')
    expect(localControllerSource).not.toContain('AgentPanelSurface')
    expect(remoteControllerSource).not.toContain('AgentPanelSurface')
    expect(remoteControllerSource).not.toContain('remote-agent-panel-toolbar')
    expect(remoteControllerSource).not.toContain('RemoteAgentMessage')
    expect(remoteControllerSource).not.toContain('agent.sendMessage')
  })

  it('does not expose class or arbitrary layout slots to either controller', () => {
    const viewSource = read('./agent-panel-view.tsx')
    expect(viewSource).not.toContain('containerClassName')
    expect(viewSource).not.toContain('textareaClassName')
    expect(viewSource).not.toContain('inputContainerClassName')
    expect(viewSource).not.toMatch(/children\??:/u)
  })
})
