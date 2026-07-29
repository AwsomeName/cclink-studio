# cclink-dev Official Integration Handoff

> Current assembly handoff. Last updated: 2026-07-28.

## Conclusion

`cclink-dev` currently assembles the commercial application through an isolated source
overlay. It does not modify the OSS checkout in place and it is not limited to replacing the
OSS official loader.

The OSS official contract remains useful as a typed status and lifecycle boundary. The
complete commercial composition, product identity, official-only implementations, release configuration,
and packaging policy are owned by `cclink-dev`.

## Assembly Owner

Run commercial commands from the `cclink-dev` root:

```bash
pnpm commercial:prepare
pnpm commercial:typecheck
pnpm commercial:build
pnpm commercial:package
pnpm commercial:package:check
```

`scripts/prepare-commercial-build.mjs` creates
`.build/cclink-studio-commercial` and performs this order:

1. Copy the OSS `cclink-studio` tree.
2. Overlay `commercial/src`.
3. Replace the Vite and electron-builder configuration in the assembly directory.
4. Install commercial resources, scripts, and package metadata.
5. Build and package inside the assembly directory.
6. Write and validate the commercial build record.

## Shared Contract

Private source that participates in the OSS lifecycle uses:

```ts
export interface OfficialIntegration {
  readonly id: string
  readonly buildProfile: OfficialBuildProfile
  getStatus(): OfficialIntegrationStatus
  registerMainServices?(context: OfficialMainContext): void | Promise<void>
  registerIpc?(context: OfficialIpcContext): void | Promise<void>
}
```

`OfficialIpcContext` provides `context.ipc.handle(...)`, not raw Electron `ipcMain`.

The OSS fallback remains `oss-noop`. Commercial assembly may overlay runtime composition,
but it must preserve trusted sender checks, bounded schemas, independent capability failure,
and local workspace availability.

## Hard Rules

- Do not write generated private source or configuration into the OSS checkout.
- Do not put production endpoints, account logic, update feeds, or publication credentials
  into OSS defaults.
- Do not expose secrets through preload, renderer stores, logs, diagnostics, screenshots, or
  localStorage.
- Do not make local capabilities depend on CCLink account or network availability.
- Do not bypass the shared `CredentialService` with a commercial-only credential store.
- Do not report a package as OSS or commercial until the target-specific identity check has
  passed.

## Required Product Identity

| Target     | Product name           | Bundle identifier              | Output                                 |
| ---------- | ---------------------- | ------------------------------ | -------------------------------------- |
| OSS        | `CCLink Studio 开源版` | `com.cclink.studio`            | `cclink-studio/dist`                   |
| Commercial | `CCLink Studio`        | `com.cclink.studio.commercial` | `.build/cclink-studio-commercial/dist` |

The complete operator checklist is
`cclink-studio/docs/ops/package-target-check.md`.

## Failure Paths

- Private overlay missing: commercial preparation fails before build.
- Commercial service unavailable: unrelated local capabilities still start or report an
  isolated failure.
- No adb installed: Studio starts and Android reports unavailable.
- Invalid commercial identity or missing build record: `commercial:package:check` fails.
- OSS source contains production values: `verify:oss-boundary` fails.
- A package came from the wrong output directory: delivery stops even if the app launches.
