# Agent Core Boundary

> Current fact source. Last updated: 2026-07-28.

## Conclusion

CCLink Studio owns its Agent kernel under `src/main/agent-core`. There is no external
`coreAgent` repository, `core-agent/*` package, or re-export compatibility layer in the
current architecture.

## Ownership

`src/main/agent-core` owns:

- local Agent backend contracts and the Claude Code backend;
- conversation execution and tool dispatch;
- Agent capability status and failure isolation;
- host adapters for editor, browser, terminal, file system, data sources, and devices.

The Electron host continues to own trusted IPC registration, application lifecycle,
workspace projection, permission confirmation, and renderer delivery. Renderer code must
not start Agent processes or import Node.js runtime APIs directly.

## Boundary Rules

- Agent backends depend on typed host capabilities, not renderer stores or BrowserWindow
  instances.
- Optional tools fail independently and must not prevent the local workspace from opening.
- Credentials are obtained from the main-process `CredentialService`; they do not enter
  workspace files, ordinary settings, renderer-wide state, or diagnostics.
- New IPC contracts use the shared definition/parser pattern and trusted renderer guard.
- A future extraction of `agent-core` requires an ADR. Until then, code must not introduce
  compatibility shims or pretend that an external package is the state owner.

## Verification

The current boundary is covered by the repository quality gates:

```bash
pnpm verify:oss-boundary
pnpm verify:credential-boundary
pnpm typecheck
pnpm test
pnpm build
```
