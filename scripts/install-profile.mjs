/**
 * install-profile.mjs — build the plugin and install it into a dsh profile,
 * then ensure the loader patch row exists in the profile's cordis.patch.yml.
 *
 * The profile lives at $DSH_HOME/profiles/<profile> (default: web). This
 * script is equivalent to `dsh plugin --profile <profile> add file:<repo>`
 * plus the patch-row edit, without requiring the dsh CLI on PATH.
 *
 * Usage:
 *   node scripts/install-profile.mjs [profile] [dshHome]
 *   node scripts/uninstall-profile.mjs [profile] [dshHome]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = process.argv[2] ?? 'web'
const dshHome = process.argv[3] ?? process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)

const PATCH_START = '# >>> dsh-vl-gateway (managed by install-profile.mjs)'
const PATCH_END = '# <<< dsh-vl-gateway'
const PATCH_BLOCK = `${PATCH_START}
- insert:
    - id: llm-vl-gateway
      name: dsh-vl-gateway
${PATCH_END}`

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

// 2. Profile must exist (a default dsh web install has it; create the layout otherwise).
if (!existsSync(profileDir)) fail(`profile ${profile} not found at ${profileDir}; boot 'dsh web' once first`)

// 3. Install the plugin into the profile (pnpm hoisted linker; the healed
//    $DSH_HOME/profiles/node_modules fallback resolves all @deepseek-ai peers).
//    Remove first: pnpm keys `file:` packages by spec + version, so a rebuild
//    with an unchanged version would report "Already up to date" and keep the
//    stale hardlinked copy — the remove forces the fresh link.
console.log(`dsh-vl-gateway: installing into ${profileDir}…`)
spawnSync(cmd, ['remove', 'dsh-vl-gateway'], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
}) // a not-yet-installed dep is a no-op; failures surface through the add below
runPnpm(['add', `file:${repo}`])

// 4. Ensure the loader row exists in the profile's patch layer. The row makes
//    the running dsh web hot-reload the plugin (config-only HMR on the profile
//    patch), so no restart is needed.
const patchPath = join(profileDir, 'cordis.patch.yml')
const before = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n'
if (before.includes('llm-vl-gateway')) {
  console.log('dsh-vl-gateway: patch row already present, leaving it untouched')
} else {
  const body = before.trimEnd()
  const next = body === '[]'
    ? `${PATCH_BLOCK}\n`
    : `${body}\n${PATCH_BLOCK}\n`
  writeFileSync(patchPath, next)
  console.log(`dsh-vl-gateway: appended loader row to ${patchPath}`)
}

// 5. Compatibility check against the target machine's installed dsh (the
//    healed fallback the launcher maintains). Informational only: installs
//    proceed regardless, but a mismatch names the rebuild path.
console.log('')
const check = spawnSync(process.execPath, [join(repo, 'scripts', 'check-compat.mjs'), dshHome], {
  stdio: 'inherit',
})
void check

console.log(`
Done. Next steps:
1. FIRST install on a machine: restart \`dsh web\` so the client module scan
   picks up the dsh.client declaration (the provider route itself hot-reloads,
   the client card does not — official per-package cache).
2. Models page: select provider "DeepSeek + Vision" (e.g. deepseek-v4-flash).
3. Fill the VL key in Settings → Plugins → plugin config → the
   "DeepSeek + Vision (vision-language bridge)" card (written to the managed
   credentials document), or export QWEN_VL_API_KEY in the launching terminal.
4. Paste an image into the chat — it is described by the VL model and the
   text is sent to DeepSeek.
`)
