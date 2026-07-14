# Android Emulator Legacy Archive

This folder preserves the old Android SDK / AVD / emulator implementation for reference.

Current product decision:

- Do not import this folder from `src/`.
- Do not include this folder in TypeScript typecheck or Electron build.
- Do not start, install, or manage Android emulators from DeepInk.
- Android support now means user-owned physical devices connected via USB or Wi-Fi ADB.

The files are kept here only so the implementation is not lost while the product direction settles.
