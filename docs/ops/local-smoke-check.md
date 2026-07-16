# CCLink Studio Local Smoke Check

This smoke check verifies the open source desktop shell as a standalone local app. It does not
validate official account, paid features, message routing, quota, artifact delivery, signing, or
notarization.

## Command

```bash
pnpm smoke:local
pnpm smoke:ui
pnpm smoke:workflow
```

The scripts start CCLink Studio with `scripts/restart.sh start` when needed, connect to the Electron
renderer through CDP, run the checks below, and stop the app again unless it was already running.

`smoke:local` verifies the real preload API. `smoke:ui` verifies the visible workbench entry points
by clicking the actual UI. `smoke:workflow` verifies a local workspace task loop.

Use this variant when you want to keep the app open after the smoke check:

```bash
pnpm smoke:local -- --keep-running
pnpm smoke:ui -- --keep-running
pnpm smoke:workflow -- --keep-running
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

## Current Passing Result

Latest local run:

```text
Local smoke passed: 9/9
UI smoke passed: 5/5
Workflow smoke passed: 5/5
```

The filesystem test intentionally writes under the user's home directory, because the app's file
service blocks arbitrary system temporary paths. The script removes its hidden temporary workspace
after the run.

`smoke:workflow` temporarily updates the recent workspace settings, then restores the previous
values and deletes its temporary workspace.

## Failure Policy

Treat a failure here as a Studio-side blocker when it affects standalone local use. Examples:

- The app requires CCLink account login before the workbench loads.
- Browser, editor, terminal, settings, or local filesystem APIs fail in the open source shell.
- First-screen UI, Activity Bar, settings, or tab creation cannot be used without login.
- A local workspace cannot be opened from recent projects, edited, saved, or used as Terminal cwd.
- Official account, paid feature, message, quota, or release capabilities appear in the default
  preload surface.
- Missing ADB or missing official integration stops startup instead of degrading.

Do not use this smoke check to validate official build overlays or paid service behavior. Those are
outside the open source shell's default runtime path.
