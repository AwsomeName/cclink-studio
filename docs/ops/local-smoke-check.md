# CCLink Studio Local Smoke Check

This smoke check verifies the open source desktop shell as a standalone local app. It does not
validate official account, paid features, message routing, quota, artifact delivery, signing, or
notarization.

## Command

```bash
pnpm smoke:local
pnpm smoke:ui
pnpm smoke:workflow
pnpm smoke:restore
pnpm smoke:standalone
pnpm smoke:auth-window
```

The scripts start CCLink Studio with `scripts/restart.sh start` when needed, connect to the Electron
renderer through CDP, run the checks below, and stop the app again unless it was already running.

`smoke:local` verifies the real preload API. `smoke:ui` verifies the visible workbench entry points
by clicking the actual UI. `smoke:workflow` verifies a local workspace task loop. `smoke:restore`
verifies startup restoration from `lastWorkspacePath`. `smoke:standalone` runs the full standalone
desktop shell smoke gate.

`smoke:auth-window` verifies that the isolated login window uses a sandboxed renderer and that its
persistent partition retains local storage and cookies across Electron restarts. It also probes the
live Google OAuth page. The probe reports one of three states:

- `passed`: the clean Electron window reached Google's account-validation flow.
- `failed`: the window, profile, navigation, or Google compatibility check failed.
- `inconclusive-network`: the persistent profile passed, but the live Google page could not be
  reached from the current network. This is not evidence that Google compatibility passed.

Use strict mode on a network that can reach Google when live compatibility is a required gate:

```bash
CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window
```

Strict mode returns nonzero for `inconclusive-network`; Google's unsafe-browser rejection always
returns nonzero in both modes.

The clean-window live probe retries up to three times only when navigation fails with a classified
network error. It does not retry or downgrade an unsafe-browser rejection, and reports every result
in `attemptOutcomes`.

CI runs `CCLINK_AUTH_SMOKE_PROFILE_ONLY=1 pnpm smoke:auth-window`. This mode verifies the isolated
window and Profile persistence without making any Google request, so third-party network behavior
cannot randomly fail the repository gate. Release candidates and human acceptance run strict mode;
only the strict local result can establish live Google compatibility.

Use this variant when you want to keep the app open after the smoke check:

```bash
pnpm smoke:local -- --keep-running
pnpm smoke:ui -- --keep-running
pnpm smoke:workflow -- --keep-running
pnpm smoke:restore -- --keep-running
```

## What `smoke:local` Proves

- The renderer loads the desktop shell and does not fall into the runtime-unavailable screen.
- The preload API exposes local desktop capabilities, not legacy auth, subscription, sync, or remote
  workspace APIs.
- The official integration status is the open source no-op provider.
- A stable local device identity exists without account login.
- Settings can be read, changed, and restored locally.
- Files can be created, read, renamed, listed, and deleted under the local filesystem allowlist.
- Browser preload APIs respond, including current URL, history, and snapshot queries.
- Agent status, capability status, and permission mode are available locally.
- A local terminal PTY can start, emit output, and stop.
- Missing Android/ADB state degrades without blocking the shell.

## What `smoke:ui` Proves

- The first screen is the local workbench, not a login wall.
- Activity Bar entries switch between local panels.
- Settings opens and local search works.
- The tab create menu can open Markdown, browser, and Terminal tabs.
- Paid/account UI copy does not appear during the smoke path.

## What `smoke:workflow` Proves

- A temporary local workspace can be opened from recent projects.
- The file tree can open a Markdown file from that workspace.
- The Markdown editor can save changes back to disk.
- Browser workbench state remains available during the local workflow.
- Terminal execution can run in the local workspace cwd and produce output.

## What `smoke:restore` Proves

- A temporary local workspace persisted as `lastWorkspacePath` is restored after an app restart.
- The restored file tree is usable without manually opening the project again.
- `lastWorkspacePath` is not cleared during successful startup restore.
- Previous workspace settings are restored after the smoke check.

## Current Passing Result

Latest local run:

```text
Local smoke passed: 9/9
UI smoke passed: 5/5
Workflow smoke passed: 5/5
Restore smoke passed: 4/4
```

The filesystem test intentionally writes under the user's home directory, because the app's file
service blocks arbitrary system temporary paths. The script removes its hidden temporary workspace
after the run.

`smoke:workflow` temporarily updates the recent workspace settings, then restores the previous
values and deletes its temporary workspace.

`smoke:restore` temporarily updates `lastWorkspacePath`, restarts the app, restores the previous
settings, and deletes its temporary workspace.

## Failure Policy

Treat a failure here as a Studio-side blocker when it affects standalone local use. Examples:

- The app requires CCLink account login before the workbench loads.
- Browser, editor, terminal, settings, or local filesystem APIs fail in the open source shell.
- First-screen UI, Activity Bar, settings, or tab creation cannot be used without login.
- A local workspace cannot be opened from recent projects, edited, saved, or used as Terminal cwd.
- `lastWorkspacePath` is cleared or ignored when it points at a valid local workspace.
- Official account, paid feature, message, quota, or release capabilities appear in the default
  preload surface.
- Missing ADB or missing official integration stops startup instead of degrading.

Do not use this smoke check to validate official build overlays or paid service behavior. Those are
outside the open source shell's default runtime path.
