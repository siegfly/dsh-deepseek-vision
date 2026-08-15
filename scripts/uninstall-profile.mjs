/**
 * uninstall-profile.mjs — remove the plugin from a dsh profile and drop the
 * managed patch block from the profile's cordis.patch.yml.
 *
 * Usage: node scripts/uninstall-profile.mjs [profile] [dshHome]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const profile = process.argv[2] ?? 'web'
const dshHome = process.argv[3] ?? process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profile)

const PATCH_START = '# >>> dsh-vl-gateway (managed by install-profile.mjs)'
const PATCH_END = '# <<< dsh-vl-gateway'

if (!existsSync(profileDir)) {
  console.error(`dsh-vl-gateway: profile ${profile} not found at ${profileDir}`)
  process.exit(1)
}

const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(cmd, ['remove', 'dsh-vl-gateway'], {
  cwd: profileDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status !== 0 && result.status !== null) {
  console.error('dsh-vl-gateway: pnpm remove failed')
  process.exit(result.status)
}

const patchPath = join(profileDir, 'cordis.patch.yml')
if (existsSync(patchPath)) {
  const text = readFileSync(patchPath, 'utf8')
  const start = text.indexOf(PATCH_START)
  if (start !== -1) {
    const end = text.indexOf(PATCH_END, start)
    const tail = end === -1 ? text.length : end + PATCH_END.length
    const rest = text.slice(0, start) + text.slice(tail)
    // The patch file is a top-level YAML array: removing the last remaining
    // block must leave a valid empty list, not a blank file.
    const next = rest.trim().length === 0 ? '[]\n' : `${rest.trim()}\n`
    writeFileSync(patchPath, next)
    console.log(`dsh-vl-gateway: removed managed patch block from ${patchPath}`)
  }
}
console.log('dsh-vl-gateway: uninstalled')
