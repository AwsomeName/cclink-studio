# Official Integration Contract

> Compatibility seam contract. Last updated: 2026-10-12.

## Conclusion

The `OfficialIntegration` no-op seam remains temporarily for compatibility with the old
commercial overlay, but it no longer defines the product boundary. CCLink account, device,
realtime transport, bounded remote file operations, remote Agent sessions and remote PTY are
now a built-in, optional GPL-3.0-only Studio feature domain.

The built-in remote domain is fail-soft: without service configuration, login, or a healthy
remote service, Studio still starts and all local capabilities remain available. Desktop payment,
WebDAV sync, cloud deployment and production service secrets remain outside this repository.

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
- Studio application runtime cannot use system credential stores, migrate keychain data, or access
  Developer ID and notarization credentials. The protected GitHub Release runner may use an
  ephemeral keychain for signing and notarization as defined by ADR 0011.

## Superseded Assembly Route

The old `cclink-dev` commercial overlay is migration-time read-only reference and rollback
history. It is not a current build, package or release route, and it must not receive new
product functionality. ADR 0009 supersedes the earlier dual-desktop premise.

The no-op seam remains only to avoid an unnecessary compatibility-breaking removal. Replacing
`official-integration-loader.ts` is not an extension mechanism for another desktop product.
New CCLink client behavior belongs in the bounded built-in remote domain and must preserve the
Studio-owned Workspace, Tab, Workbench, Terminal adapter, IPC and lifecycle contracts.

## Acceptance

Current Studio checks:

```bash
pnpm verify:oss-boundary
pnpm verify
pnpm smoke:standalone
```

The package identity gate is documented in `docs/ops/package-target-check.md`.
