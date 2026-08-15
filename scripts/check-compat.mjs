/**
 * check-compat.mjs — compare the target machine's installed dsh version
 * against the anchor version this release's committed lib/ was built against.
 *
 * The plugin resolves `@deepseek-ai/*` at RUNTIME from the target's own dsh
 * installation (the profile healed fallback), so the risk on a foreign
 * machine is API drift between the build anchor and the installed dsh — not
 * file placement. This script reads the installed versions from
 * $DSH_HOME/profiles/node_modules (the launcher-maintained fallback), grades
 * each against the anchor, and prints rebuild guidance when they diverge.
 *
 * Usage:
 *   node scripts/check-compat.mjs [dshHome]
 *
 * Exit codes: 0 = every spot-check matches the anchor; 1 = adjacent
 * prerelease (same base, different rc — probably compatible, smoke-test it);
 * 2 = version mismatch (rebuild against the target dsh).
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))

/** Packages whose installed versions the check spot-checks. */
export const SPOT_CHECKS = [
  { pkg: '@deepseek-ai/dsh', label: 'dsh (launcher)' },
  { pkg: '@deepseek-ai/dsh-llm', label: 'llm seam' },
  { pkg: '@deepseek-ai/dsh-llm-deepseek', label: 'DeepSeek adapter base' },
  { pkg: '@deepseek-ai/dsh-client-ui-settings-plugins', label: 'client card slot section' },
]

/** The anchor this repo's committed lib/ was built against. */
export function anchorVersion() {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const anchor = manifest.dshCompat?.anchorVersion
  if (typeof anchor !== 'string' || anchor.length === 0) {
    throw new Error('check-compat: package.json dshCompat.anchorVersion is missing')
  }
  return anchor
}

/** Strip a prerelease suffix: `0.1.0-rc.5` → `0.1.0`. */
export function baseOf(version) {
  const match = /^(\d+\.\d+\.\d+)/.exec(version ?? '')
  return match?.[1] ?? ''
}

/** Numeric comparison of two dotted version strings (equal length assumed). */
function compareDotted(left, right) {
  const l = left.split('.').map(Number)
  const r = right.split('.').map(Number)
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const a = l[i] ?? 0
    const b = r[i] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/**
 * Grade one installed version against the anchor.
 * @returns `match` (exact), `adjacent` (same base, different prerelease),
 *   or `mismatch` (different base).
 */
export function compare(anchor, actual) {
  if (anchor === actual) return 'match'
  if (baseOf(anchor) === baseOf(actual)) return 'adjacent'
  return 'mismatch'
}

/** Resolve the installed version of one package from the healed fallback. */
export function installedVersion(profilesNodeModules, pkg) {
  const manifestPath = join(profilesNodeModules, pkg, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  try {
    const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    return typeof version === 'string' && version.length > 0 ? version : undefined
  } catch {
    return undefined
  }
}

/**
 * Grade every spot-check against the anchor.
 * @returns the per-package rows and the process exit code.
 */
export function assess(profilesNodeModules) {
  const anchor = anchorVersion()
  const rows = SPOT_CHECKS.map(({ pkg, label }) => {
    const actual = installedVersion(profilesNodeModules, pkg)
    return { pkg, label, actual, verdict: actual === undefined ? 'missing' : compare(anchor, actual) }
  })
  const worst = rows.reduce((level, row) => {
    if (row.verdict === 'mismatch') return 'mismatch'
    if (row.verdict === 'adjacent' && level === 'match') return 'adjacent'
    if (row.verdict === 'missing' && level === 'match') return 'missing'
    return level
  }, 'match')
  return { anchor, rows, exitCode: worst === 'mismatch' ? 2 : worst === 'match' ? 0 : 1 }
}

function main() {
  const dshHome = process.argv[2] ?? process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
  const profilesNodeModules = join(dshHome, 'profiles', 'node_modules')
  const { anchor, rows, exitCode } = assess(profilesNodeModules)

  console.log(`dsh-vl-gateway compatibility check`)
  console.log(`  anchor (built against): dsh ${anchor}`)
  console.log(`  checked via:            ${profilesNodeModules}`)
  console.log('')
  let missing = false
  for (const row of rows) {
    const mark = row.verdict === 'match' ? 'OK ' : row.verdict === 'adjacent' ? '~  ' : row.verdict === 'missing' ? '?? ' : 'XX '
    console.log(`  ${mark} ${row.label.padEnd(28)} ${row.actual ?? '(not found)'}`)
    if (row.verdict === 'missing') missing = true
  }
  console.log('')

  if (missing) {
    console.log('The healed fallback has no entry for one or more packages. Boot `dsh web` once on this machine (the launcher maintains that directory), then re-run this check.')
    process.exit(exitCode)
  }
  if (exitCode === 0) {
    console.log('Installed dsh matches the anchor. The committed lib/ is expected to work as-is.')
  } else if (exitCode === 1) {
    console.log('Same version line, different prerelease — the public APIs this plugin uses are very likely unchanged, but rc releases make no compatibility promise. Paste an image once as a smoke test; if it fails, rebuild (see README “版本对齐”).')
  } else {
    console.log('Installed dsh diverges from the anchor. Rebuild the plugin against the target dsh before installing (see README “版本对齐”).')
  }
  process.exit(exitCode)
}

const invoked = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url
if (invoked) main()
