# cclink-dev Official Integration Handoff

> Superseded by ADR 0009 on 2026-08-13. Last reconciled: 2026-10-12.

## Current Status

This document no longer defines an active assembly or release procedure. CCLink Studio is the
only GPL-3.0-only desktop App. The CCLink account, device, realtime transport and remote workspace
client are optional built-in Studio domains; local capabilities remain available without login or
remote service configuration.

`/Users/apple/Desktop/cclink-dev` is migration-time read-only reference and cloud/release
operations workspace. Its legacy commercial overlay must not receive new desktop functionality,
assemble a second product, trigger a separate desktop Release, or replace Studio-owned Workspace,
Tab, Workbench, Terminal, IPC, lifecycle or diagnostics.

Current boundaries and implementation rules are defined by:

- `docs/architecture.md`
- `docs/development.md`
- `docs/decisions/0009-single-studio-remote-service-boundary.md`
- `docs/official-integration-contract.md`

Cloud functions and account services remain in `/Users/apple/Desktop/chat-cc/deploy`. The remote
Agent runtime remains in `/Users/apple/Desktop/chat-cc/Agent`. They are deployed and published
independently, but neither location owns another desktop App.
