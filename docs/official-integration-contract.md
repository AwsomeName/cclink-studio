# Official Integration Contract

> Current OSS contract. Last updated: 2026-07-28.

## Conclusion

CCLink Studio exposes a minimal, inert main-process integration contract. The OSS build
always loads `oss-noop`; it does not ship official account, message network, entitlement,
quota, production runtime, release provider, production endpoints, or publication secrets.

The current commercial build is assembled by `cclink-dev`: it copies the OSS tree into an
isolated build directory and overlays commercial-only source, configuration, resources, scripts, and
package metadata. The overlay is an assembly mechanism, not permission for OSS runtime files
to import official-only implementations.

## Current Interface

The contract is defined in `src/main/official/official-integration.ts`:

```ts
export interface OfficialIntegration {
  readonly id: string
  readonly buildProfile: OfficialBuildProfile
  getStatus(): OfficialIntegrationStatus
  registerMainServices?(context: OfficialMainContext): void | Promise<void>
  registerIpc?(context: OfficialIpcContext): void | Promise<void>
}
```

`OfficialIpcContext` exposes only the Studio-owned trusted IPC registrar. It never exposes
raw `ipcMain`.

The OSS loader in `src/main/official/official-integration-loader.ts` returns
`createNoopOfficialIntegration()`. Runtime startup may call the two optional hooks, but the
no-op implementation registers nothing.

## OSS Status

```ts
{
  id: 'oss-noop',
  buildProfile: 'oss',
  available: false,
  reason: 'official-integration-not-installed',
  features: {
    account: false,
    deviceRegistry: false,
    messageNetwork: false,
    entitlement: false,
    quota: false,
    officialRuntime: false,
    releaseProvider: false,
  },
}
```

Renderer access is limited to the read-only
`window.cclinkStudio.official.getStatus()` probe. It contains capability booleans and a
reason code, not credentials or account data.

## Hard Boundaries

- OSS defaults contain no official production endpoint or update feed.
- Local workspace, Agent, browser, editor, Terminal, data-source, and Android capabilities
  cannot depend on the official integration being present.
- Official IPC uses `context.ipc.handle(...)` and a bounded runtime parser.
- Credentials never cross into preload globals, renderer-wide stores, localStorage, logs,
  screenshots, or diagnostics.
- OSS runtime entry points do not import account, message, entitlement, quota, official
  runtime, release upload, signing, or notarization packages.
- The commercial assembler must work in its isolated `.build` directory and must not patch
  the OSS checkout in place.

## Commercial Assembly

The current assembly implementation is owned by
`cclink-dev/scripts/prepare-commercial-build.mjs`:

1. Copy `cclink-studio` into `.build/cclink-studio-commercial`.
2. Overlay `commercial/src` onto the copied `src`.
3. Install the commercial Vite and electron-builder configurations.
4. Install commercial resources, scripts, and package metadata.
5. Link the OSS dependency installation.
6. Build and package only from the isolated assembly directory.
7. Run `commercial:package:check` against product identity and artifacts.

The commercial source may use the shared `OfficialIntegration` type, but the current
commercial runtime also owns private composition files through the overlay. Documentation
must not claim that replacing `official-integration-loader.ts` alone describes the complete
commercial assembly.

## Acceptance

OSS:

```bash
pnpm verify:oss-boundary
pnpm verify
pnpm smoke:standalone
```

Commercial, from `cclink-dev`:

```bash
pnpm commercial:typecheck
pnpm commercial:build
pnpm commercial:package
pnpm commercial:package:check
```

The package identity gate is documented in `docs/ops/package-target-check.md`.
