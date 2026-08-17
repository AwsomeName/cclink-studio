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

  it('keeps the Agent Panel production path on one textarea and Enter submission policy', () => {
    const surfaceSource = read('./agent-panel-surface.tsx')
    const localControllerSource = read('./AgentPanel.tsx')
    const remoteControllerSource = read('../../features/cclink-remote/remote-agent-controller.tsx')

    expect(surfaceSource.match(/<textarea/gu)).toHaveLength(1)
    expect(surfaceSource).toContain('nativeEvent.isComposing')
    expect(surfaceSource).toContain('nativeEvent.keyCode === 229')
    expect(localControllerSource).not.toContain('<textarea')
    expect(remoteControllerSource).not.toContain('<textarea')
    expect(remoteControllerSource).not.toContain('agent.sendMessage')
  })
})
