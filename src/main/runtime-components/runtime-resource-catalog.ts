import type { RuntimeResourceComponentId } from '../../shared/ipc/runtime-components'

export interface RuntimeResourceFile {
  archivePath?: string
  installedPath: string
  sha256: string
  size: number
}

export interface RuntimeResourceCatalogEntry {
  componentId: RuntimeResourceComponentId
  displayName: string
  version: string
  activation: 'domain-managed' | 'awaiting-host'
  source:
    | {
        kind: 'npm'
        packageName: string
        packageVersion: string
        url: string
        integrity: `sha512-${string}`
      }
    | {
        kind: 'direct'
        url: string
        sha256: string
        size: number
      }
  files: RuntimeResourceFile[]
}

const OCCT_RUNTIME: RuntimeResourceCatalogEntry = {
  componentId: 'occt-runtime',
  displayName: 'OCCT Runtime',
  version: '0.0.23',
  activation: 'domain-managed',
  source: {
    kind: 'npm',
    packageName: 'occt-import-js',
    packageVersion: '0.0.23',
    url: 'https://registry.npmjs.org/occt-import-js/-/occt-import-js-0.0.23.tgz',
    integrity:
      'sha512-RFfYQXYFX5C1mB1Aywm0ShcUKzXOr/VzTnlzhBSDJOR6YCAPt1HYCzeXWg1vwwjn/cUxwqRNhhtf1dlewoZYCQ==',
  },
  files: [
    {
      archivePath: 'package/dist/occt-import-js.wasm',
      installedPath: 'occt-import-js.wasm',
      sha256: '33391fc9d94ea5c869a6718488bf0a9a464222bac9bdc764dfe1690cef281952',
      size: 7_604_031,
    },
    {
      archivePath: 'package/dist/license.occt-import-js.txt',
      installedPath: 'license.occt-import-js.txt',
      sha256: '7ffe1954587c77dfba1cf8eb9b2ea743671fa6e63f9e7a2f258119d42e14eefe',
      size: 27_030,
    },
    {
      archivePath: 'package/dist/license.occt.txt',
      installedPath: 'license.occt.txt',
      sha256: '090f8eb6ba63e72887c1f89b009fb1656cfda02d83b6e9805b20468520a5d77f',
      size: 26_936,
    },
  ],
}

const SCRCPY_SERVER: RuntimeResourceCatalogEntry = {
  componentId: 'scrcpy-server',
  displayName: 'Android scrcpy server',
  version: '2.3.1',
  activation: 'domain-managed',
  source: {
    kind: 'direct',
    url: 'https://github.com/Genymobile/scrcpy/releases/download/v2.3.1/scrcpy-server-v2.3.1',
    sha256: 'f6814822fc308a7a532f253485c9038183c6296a6c5df470a9e383b4f8e7605b',
    size: 66_007,
  },
  files: [
    {
      installedPath: 'scrcpy-server.jar',
      sha256: 'f6814822fc308a7a532f253485c9038183c6296a6c5df470a9e383b4f8e7605b',
      size: 66_007,
    },
  ],
}

const AGENT_DEVICE_HELPERS: RuntimeResourceCatalogEntry = {
  componentId: 'agent-device-android-helpers',
  displayName: 'agent-device Android Helper',
  version: '0.17.2',
  activation: 'awaiting-host',
  source: {
    kind: 'npm',
    packageName: 'agent-device',
    packageVersion: '0.17.2',
    url: 'https://registry.npmjs.org/agent-device/-/agent-device-0.17.2.tgz',
    integrity:
      'sha512-ey1HE/PpXypCZhMG3mAkHwXJQ0OrVFMy9iYBVhpvi8N0tOASInHcJGpATbT8ZRbTMe99gasyNSGdizB3R8oIYg==',
  },
  files: [
    {
      archivePath:
        'package/android-snapshot-helper/dist/agent-device-android-snapshot-helper-0.17.2.apk',
      installedPath: 'android-snapshot-helper.apk',
      sha256: '0f91b28c7374fbf1d12fa43c283d01354b3a4d68a44b0dc68ccc22959f02d13e',
      size: 16_811,
    },
    {
      archivePath:
        'package/android-snapshot-helper/dist/agent-device-android-snapshot-helper-0.17.2.manifest.json',
      installedPath: 'android-snapshot-helper.manifest.json',
      sha256: '7dc269523633823d92152989ac68bfd89d288df64586d0dc344aa3add6523875',
      size: 675,
    },
    {
      archivePath:
        'package/android-multitouch-helper/dist/agent-device-android-multitouch-helper-0.17.2.apk',
      installedPath: 'android-multitouch-helper.apk',
      sha256: 'e50fe5576ae7edbb9ae18414ae65d094de416ba3e0f6e418ac3cdc319e491a0d',
      size: 12_715,
    },
    {
      archivePath:
        'package/android-multitouch-helper/dist/agent-device-android-multitouch-helper-0.17.2.manifest.json',
      installedPath: 'android-multitouch-helper.manifest.json',
      sha256: '8c3686e210060601d4a49ee2bf02f08905e5465e4fdd7111e2cecea5edb1ee6c',
      size: 452,
    },
    {
      archivePath: 'package/LICENSE',
      installedPath: 'LICENSE',
      sha256: '64f25cb04776a886b0acd79fe7345a7ae09bed9952fa6774a5b2041ecba763f3',
      size: 1_066,
    },
  ],
}

const ENTRIES = [OCCT_RUNTIME, SCRCPY_SERVER, AGENT_DEVICE_HELPERS] as const

export function listRuntimeResourceCatalogEntries(): RuntimeResourceCatalogEntry[] {
  return [...ENTRIES]
}

export function getRuntimeResourceCatalogEntry(
  componentId: RuntimeResourceComponentId,
): RuntimeResourceCatalogEntry {
  const entry = ENTRIES.find((candidate) => candidate.componentId === componentId)
  if (!entry) throw new Error(`未知 Runtime 资源: ${componentId}`)
  return entry
}
