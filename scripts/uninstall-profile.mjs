/**
 * uninstall-profile.mjs — remove the plugin from a dsh profile through the
 * official mechanism: drop the dependency and take its name out of
 * `dsh.profile.bundles` (dependency-managed entries are removed on uninstall,
 * mirroring the official `dsh plugin` reconcile), then strip the LEGACY
 * managed block from the profile's cordis.patch.yml if one is still present.
 *
 * Usage: node scripts/uninstall-profile.mjs [profile] [dshHome]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { PLUGIN_PACKAGE_NAME, removeBundle, stripManagedBlock } from './profile-layer.mjs'

const profile = process.argv[2] ?? 'web'
const dshHome = process.argv[3] ?? process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)

function fail(message) {
  console.error(`dsh-deepseek-vision: ${message}`)
  process.exit(1)
}

if (!existsSync(profileDir)) {
  fail(`profile ${profile} not found at ${profileDir}`)
}

// pnpm 11 hard-errors on removing a not-yet-installed dep, so only remove
// when a link actually exists (hoisted into the profile dir or its parent).
const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const linkPaths = [join(profileDir, 'node_modules', PLUGIN_PACKAGE_NAME), join(profileDir, '..', 'node_modules', PLUGIN_PACKAGE_NAME)]
if (linkPaths.some(p => existsSync(p))) {
  const result = spawnSync(cmd, ['remove', PLUGIN_PACKAGE_NAME], {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0 && result.status !== null) {
    fail(`pnpm remove ${PLUGIN_PACKAGE_NAME} failed in ${profileDir}`)
  }
} else {
  console.log('dsh-deepseek-vision: no installed link — skipping pnpm remove')
}

// Reconcile the bundle stack: a dependency-managed bundle entry leaves with
// its dependency (template bundles like dsh-base are never touched).
{
  const manifestPath = join(profileDir, 'package.json')
  if (existsSync(manifestPath)) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      fail(`profile manifest ${manifestPath} is unreadable: ${String(error)}`)
    }
    const { manifest: next, changed } = removeBundle(manifest, PLUGIN_PACKAGE_NAME)
    if (changed) {
      writeFileSync(manifestPath, JSON.stringify(next, undefined, 2) + '\n')
      console.log(`dsh-deepseek-vision: removed from dsh.profile.bundles in ${manifestPath}`)
    } else {
      console.log('dsh-deepseek-vision: not listed in dsh.profile.bundles')
    }
  }
}

// Legacy cleanup: pre-bundle installs appended a managed block to the user
// patch layer; strip it if still present.
const patchPath = join(profileDir, 'cordis.patch.yml')
if (existsSync(patchPath)) {
  const { text, removed } = stripManagedBlock(readFileSync(patchPath, 'utf8'))
  if (removed) {
    writeFileSync(patchPath, text)
    console.log(`dsh-deepseek-vision: removed legacy managed block from ${patchPath}`)
  }
}
console.log('dsh-deepseek-vision: uninstalled')
