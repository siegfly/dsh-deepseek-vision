/**
 * install-profile.mjs — build the plugin and install it into a dsh profile
 * through the OFFICIAL bundle mechanism, without requiring the dsh CLI on
 * PATH.
 *
 * `dsh plugin --profile <profile> add file:<repo>` does three things: it
 * initializes the profile layout on first use, forwards to pnpm in the
 * profile directory, and reconciles `dsh.profile.bundles` in the profile
 * manifest so the loader mounts this package's `dsh.bundle.patch` layer
 * (cordis.patch.yml, shipped in the package). This script replicates exactly
 * that: init layout → build → gate → pnpm add → bundle reconcile. It also
 * migrates away from the LEGACY mechanism (a managed insert block in the
 * profile's own cordis.patch.yml) by stripping that block when present.
 *
 * The install is GATED on scripts/check-compat.mjs first, but only
 * release-integrity defects refuse (unbuilt lib/ = exit 2, drifted client
 * preset = exit 3; DSH_VL_GATEWAY_FORCE=1 overrides): the build above already
 * recompiled the plugin against this machine's own dsh, so target-version
 * differences from the release anchor are advisory (exit 1, proceeds;
 * DSH_VL_GATEWAY_STRICT=1 refuses on them for conservative users).
 *
 * Usage:
 *   node scripts/install-profile.mjs [profile] [dshHome]
 *   node scripts/uninstall-profile.mjs [profile] [dshHome]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import {
  ensureBundle, freshManifest, PLUGIN_PACKAGE_NAME, PROFILE_PATCH_TEMPLATE,
  PROFILE_PNPM_WORKSPACE, stripManagedBlock,
} from './profile-layer.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = process.argv[2] ?? 'web'
const dshHome = process.argv[3] ?? process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)

function fail(message) {
  console.error(`dsh-vl-gateway: ${message}`)
  process.exit(1)
}

const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function runPnpm(args) {
  const result = spawnSync(cmd, args, { cwd: profileDir, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) fail(`pnpm ${args.join(' ')} failed in ${profileDir}`)
}

// 1. Build (committed lib/ exists, but rebuild so a source edit always lands).
console.log('dsh-vl-gateway: building…')
execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'], {
  cwd: repo,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

// 2. Compatibility gate BEFORE anything touches the profile. Version
//    differences between the target dsh and the release anchor are ADVISORY
//    (exit 1): the build above already recompiled the plugin against this
//    machine's own dsh, so a newer/older official version does not block the
//    install — released plugins must keep installing after official upgrades.
//    Only release-integrity defects refuse: an unbuilt release (exit 2, no
//    build-anchor stamp) or a drifted client-preset replica (exit 3, checkout
//    machines only). DSH_VL_GATEWAY_FORCE=1 overrides both refusals;
//    DSH_VL_GATEWAY_STRICT=1 additionally refuses on the advisory exit 1.
console.log('')
const check = spawnSync(process.execPath, [join(repo, 'scripts', 'check-compat.mjs'), dshHome], {
  stdio: 'inherit',
})
const checkCode = check.status ?? 1
if (checkCode === 2 || checkCode === 3) {
  if (process.env.DSH_VL_GATEWAY_FORCE !== '1') {
    fail('compatibility check failed — the release is unbuilt or its client preset drifted; see README "版本对齐" or set DSH_VL_GATEWAY_FORCE=1 to install anyway')
  }
  console.log('dsh-vl-gateway: forced install despite the compatibility failure')
} else if (checkCode === 1 && process.env.DSH_VL_GATEWAY_STRICT === '1') {
  fail('target dsh differs from the release anchor — DSH_VL_GATEWAY_STRICT=1 refuses (unset it to install with a warning)')
}
console.log('')

// 3. Profile layout, exactly like the official dsh-app-boot initProfile:
//    manifest + empty user patch layer + pnpm settings. Existing files are
//    never touched, so re-running is a no-op on an initialized profile. The
//    healed fallback ($DSH_HOME/profiles/node_modules) itself is
//    launcher-maintained — a machine still needs to have booted dsh once, and
//    the build in step 1 already proved it exists.
mkdirSync(profileDir, { recursive: true })
{
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify(freshManifest(profile), undefined, 2) + '\n')
    console.log(`dsh-vl-gateway: initialized profile manifest at ${manifestPath}`)
  }
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
}

// 4. Install the plugin into the profile. Remove first: pnpm keys `file:`
//    packages by spec + version, so a rebuild with an unchanged version would
//    report "Already up to date" and keep the stale hardlinked copy — the
//    remove forces the fresh link. pnpm 11 makes `remove` of a not-yet-
//    installed dep a hard error, so only remove when a link actually exists.
console.log(`dsh-vl-gateway: installing into ${profileDir}…`)
const linkPaths = [join(profileDir, 'node_modules', PLUGIN_PACKAGE_NAME), join(dirname(profileDir), 'node_modules', PLUGIN_PACKAGE_NAME)]
if (linkPaths.some(p => existsSync(p))) runPnpm(['remove', PLUGIN_PACKAGE_NAME])
const added = spawnSync(cmd, ['add', `file:${repo}`], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (added.status !== 0) {
  // pnpm 11 exits non-zero with ERR_PNPM_IGNORED_BUILDS when the profile tree
  // contains unapproved native build scripts (dsh toolchain deps) even though
  // the add itself links — the link on disk is the truth.
  if (!linkPaths.some(p => existsSync(p))) {
    fail(`pnpm add file:${repo} failed in ${profileDir} and no plugin link exists`)
  }
  console.log('dsh-vl-gateway: pnpm exited non-zero (ignored build scripts in the profile tree); the plugin link exists — continuing')
}

// 5. Reconcile `dsh.profile.bundles` like the official `dsh plugin` CLI: a
//    dependency that declares `dsh.bundle.patch` joins the layer stack. This
//    package must declare it — otherwise the loader could not mount it.
{
  const self = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  if (self.dsh?.bundle?.patch !== './cordis.patch.yml') {
    fail('this repo no longer declares dsh.bundle.patch = ./cordis.patch.yml — fix package.json before installing')
  }
  const manifestPath = join(profileDir, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`profile manifest ${manifestPath} is unreadable: ${String(error)}`)
  }
  const { manifest: next, changed } = ensureBundle(manifest, PLUGIN_PACKAGE_NAME)
  if (changed) {
    writeFileSync(manifestPath, JSON.stringify(next, undefined, 2) + '\n')
    console.log(`dsh-vl-gateway: joined the profile bundle stack (dsh.profile.bundles) in ${manifestPath}`)
  } else {
    console.log('dsh-vl-gateway: already listed in dsh.profile.bundles')
  }
  // Migration: pre-bundle installs appended a managed insert block to the
  // profile's own patch layer; strip it so the bundle layer is the single
  // mechanism (double registration would mount the plugin twice).
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (existsSync(patchPath)) {
    const { text, removed } = stripManagedBlock(readFileSync(patchPath, 'utf8'))
    if (removed) {
      writeFileSync(patchPath, text)
      console.log(`dsh-vl-gateway: migrated — removed the legacy managed block from ${patchPath}`)
    }
  }
}

console.log(`
Done. Next steps:
1. Restart \`dsh web\` once: the new bundle layer joins the loader composition
   and the client module scan picks up the dsh.client declaration (official
   per-package cache).
2. Models page: select provider "DeepSeek + Vision" (e.g. deepseek-v4-flash).
3. Fill the VL key in Settings → Plugins → plugin config → the
   "DeepSeek + Vision (vision-language bridge)" card (written to the managed
   credentials document), or export QWEN_VL_API_KEY in the launching terminal.
4. Paste an image into the chat — it is described by the VL model and the
   text is sent to DeepSeek.
`)
