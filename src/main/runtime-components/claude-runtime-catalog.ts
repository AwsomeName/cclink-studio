export interface ManagedClaudeRuntimeCatalogEntry {
  componentId: 'claude-runtime'
  runtimeVersion: string
  sdkVersion: string
  platform: 'darwin'
  arch: 'arm64' | 'x64'
  packageName: string
  packageVersion: string
  tarballUrl: string
  tarballIntegrity: `sha512-${string}`
  binaryPath: 'package/claude'
  binarySha256: string
  binarySize: number
}

const CLAUDE_2_1_211_DARWIN_ARM64: ManagedClaudeRuntimeCatalogEntry = {
  componentId: 'claude-runtime',
  runtimeVersion: '2.1.211',
  sdkVersion: '0.3.211',
  platform: 'darwin',
  arch: 'arm64',
  packageName: '@anthropic-ai/claude-code-darwin-arm64',
  packageVersion: '2.1.211',
  tarballUrl:
    'https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.211.tgz',
  tarballIntegrity:
    'sha512-ogsLXqbHlHSFE9ApgpoeoP6wXJKkcUyYM4f8rrAbTvQStvqQ/bpHLV5mgbuEGn/N9NPWBQt826bfH/XvlYi0kg==',
  binaryPath: 'package/claude',
  binarySha256: '5a728a76198b6eca7f3c7cdbff43bab44b77b48c2108f7a3107d889773382629',
  binarySize: 242_445_680,
}

export function getManagedClaudeRuntimeCatalogEntry(
  platform: NodeJS.Platform,
  arch: string,
): ManagedClaudeRuntimeCatalogEntry | null {
  if (platform === 'darwin' && arch === 'arm64') return CLAUDE_2_1_211_DARWIN_ARM64
  return null
}
