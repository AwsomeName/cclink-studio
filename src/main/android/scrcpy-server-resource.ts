export interface ScrcpyServerResource {
  path: string
  version: '2.3.1'
  source: 'managed' | 'bundled'
  release?: () => void
}

export function selectScrcpyServerResource(
  managed: ScrcpyServerResource | null,
  bundledPath: string,
): ScrcpyServerResource {
  return (
    managed ?? {
      path: bundledPath,
      version: '2.3.1',
      source: 'bundled',
    }
  )
}
