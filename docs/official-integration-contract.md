# Official Integration Contract

> Legacy assembly contract. Last updated: 2026-08-13.

## Conclusion

The `OfficialIntegration` no-op seam remains temporarily for compatibility with the old
commercial overlay, but it no longer defines the product boundary. CCLink account, device,
realtime transport and the read-only first-stage remote workspace are now a built-in,
optional GPL-3.0-only Studio feature domain.

The built-in remote domain is fail-soft: without service configuration, login, or a healthy
remote service, Studio still starts and all local capabilities remain available. Publishing,
production secrets, payment UI, WebDAV sync and cloud deployment remain outside this repository.

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

## Legacy Seam Status

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

This legacy seam's renderer access remains limited to the read-only
`window.cclinkStudio.official.getStatus()` probe. It contains capability booleans and a
reason code, not credentials or account data.

## Current Hard Boundaries

- No service secret, publication credential, or commercial update feed may be embedded.
- Local workspace, Agent, browser, editor, Terminal, data-source, and Android capabilities
  cannot depend on CCLink configuration, login, or remote availability.
- The built-in remote domain may own account, device connection, requests and remote-session
  facts. Studio owns Workspace, Tab, Workbench, Terminal integration and IPC lifecycle.
- Official IPC uses `context.ipc.handle(...)` and a bounded runtime parser.
- Access tokens, IM UserSig and complete remote identity stay in main-process memory. Only the
  refresh token uses the private local Session file.
- System credential stores, keychain migration, Developer ID signing and notarization are forbidden.

## Legacy Commercial Assembly

This section records the overlay that still exists during transition; it is not the target
architecture and must not receive new product functionality.

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

The overlay may stop shipping only after the single Studio app passes the real first-stage
acceptance. Until then it remains a rollback artifact, not a second product line.

## Acceptance

OSS:

```bash
pnpm verify:oss-boundary
pnpm verify
pnpm smoke:standalone
```

Legacy overlay, while it remains in service, from `cclink-dev`:

```bash
pnpm commercial:typecheck
pnpm commercial:build
pnpm commercial:package
pnpm commercial:package:check
```

The package identity gate is documented in `docs/ops/package-target-check.md`.
