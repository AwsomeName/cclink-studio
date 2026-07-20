#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureElectronRuntime } from './ensure-electron-runtime.mjs'

const APP_DISPLAY_NAME = 'CCLink Studio 开源版'
const DEV_BUNDLE_ID = 'com.cclink.studio.dev'
const { electronPackageDir, electronRelativePath, electronVersion } = ensureElectronRuntime()
const sourceExecutable = join(electronPackageDir, 'dist', electronRelativePath)
const sourceBundle = resolve(dirname(sourceExecutable), '../..')
const sourceInfoPlist = join(sourceBundle, 'Contents', 'Info.plist')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheRoot = join(projectRoot, '.cache', 'electron-dev', `${electronVersion}-${process.arch}`)
const targetBundle = join(cacheRoot, `${APP_DISPLAY_NAME}.app`)
const targetExecutable = join(targetBundle, 'Contents', 'MacOS', 'Electron')
const targetInfoPlist = join(targetBundle, 'Contents', 'Info.plist')
const markerPath = join(cacheRoot, '.source.json')
const sourceMarker = JSON.stringify({
  sourceBundle,
  sourceInfoPlistMtimeMs: statSync(sourceInfoPlist).mtimeMs,
})

if (!isCurrentCachedBundle()) {
  rmSync(cacheRoot, { recursive: true, force: true })
  mkdirSync(cacheRoot, { recursive: true })
  cloneElectronBundle()
  setPlistValue('CFBundleDisplayName', APP_DISPLAY_NAME)
  setPlistValue('CFBundleName', APP_DISPLAY_NAME)
  setPlistValue('CFBundleIdentifier', DEV_BUNDLE_ID)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', targetBundle], { stdio: 'ignore' })
  writeFileSync(markerPath, sourceMarker)
}

process.stdout.write(targetExecutable)

function isCurrentCachedBundle() {
  if (!existsSync(targetExecutable) || !existsSync(markerPath)) return false
  return readFileSync(markerPath, 'utf8') === sourceMarker
}

function cloneElectronBundle() {
  try {
    execFileSync('cp', ['-cR', sourceBundle, targetBundle], { stdio: 'ignore' })
  } catch {
    execFileSync('ditto', [sourceBundle, targetBundle], { stdio: 'ignore' })
  }
}

function setPlistValue(key, value) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, targetInfoPlist], {
    stdio: 'ignore',
  })
}
