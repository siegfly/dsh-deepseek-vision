/**
 * check-compat.mjs — compare the target machine's installed dsh version
 * against the anchor version this release's committed lib/ was built against,
 * and — when a dsh source checkout is available — diff the frozen client
 * bundle preset replica (externals / purity regexes / handoff) against the
 * official preset.
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
 * Exit codes: 0 = every spot-check matches the anchor (and the preset replica
 * matches the checkout, when one is available); 1 = adjacent prerelease (same
 * base, different rc — probably compatible, smoke-test it); 2 = version
 * mismatch (rebuild against the target dsh); 3 = client preset replica drift
 * (update tsdown.config.ts to the checkout's preset, then rebuild).
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import { harnessRoot } from './harness-paths.mjs'

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

/* ------------------------------------------------------------------ *
 * Client preset drift check.                                          *
 *                                                                     *
 * The client bundle replicates the official (unpublished)             *
 * `packages/client/tsdown.client.ts` preset: the module-table         *
 * externals, the bundle purity regexes, and the closure handoff.      *
 * These are FROZEN COPIES in this repo's tsdown.config.ts — a future  *
 * official change to PLATFORM_MODULES or the purity gate would        *
 * silently diverge (a new platform module would be inlined = dual     *
 * runtime instance; a loosened gate would reject nothing). Version    *
 * comparison cannot see that, so when a source checkout is available  *
 * ($DSH_CHECKOUT or harness-paths.json) the frozen values are diffed  *
 * against the official files.                                         *
 * ------------------------------------------------------------------ */

/** Every string literal inside one array declaration (`const NAME = [...]`). */
export function extractStringArray(source, name) {
  const match = new RegExp(`(?:const|export const) ${name} = \\[([\\s\\S]*?)\\]`).exec(source)
  if (match === null) return undefined
  const values = []
  for (const quoted of match[1].matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const value = quoted[1] ?? quoted[2]
    if (value !== undefined) values.push(value)
  }
  return values
}

/** The source of one single-line regex literal (`const NAME = /…/`). */
export function extractRegexSource(source, name) {
  const match = new RegExp(`(?:const|export const) ${name} = /([^\\n]*)`).exec(source)
  if (match === null) return undefined
  return match[1].replace(/\/$/, '')
}

/** The content of one single-quoted literal (`const NAME = '…'`). */
function extractStringLiteral(source, name) {
  const match = new RegExp(`(?:const|export const) ${name} = '([^']*)'`).exec(source)
  return match === null ? undefined : match[1]
}

/** The content of one assigned literal (`banner: `…`,` or `footer: '…',`). */
function extractAssignedLiteral(source, name) {
  const backtick = new RegExp(`${name}: \`([^\\n]*)\``).exec(source)
  if (backtick !== null) return backtick[1]
  const single = new RegExp(`${name}: '([^']*)'`).exec(source)
  return single === null ? undefined : single[1]
}

/** The official CLIENT_EXTERNALS: PLATFORM_MODULES plus the runtime-store exemption. */
export function officialExternals(checkoutRoot) {
  const platform = readFileSync(join(checkoutRoot, 'packages', 'client', 'web', 'src', 'platform.ts'), 'utf8')
  const preset = readFileSync(join(checkoutRoot, 'packages', 'client', 'tsdown.client.ts'), 'utf8')
  const modules = extractStringArray(platform, 'PLATFORM_MODULES')
  const exemption = extractStringLiteral(preset, 'RUNTIME_STORE_EXEMPTION')
  if (modules === undefined || exemption === undefined) return undefined
  return [...modules, exemption]
}

/** Read this repo's frozen tsdown replica into comparable values. */
export function replicaValues() {
  const config = readFileSync(join(repo, 'tsdown.config.ts'), 'utf8')
  return {
    externals: extractStringArray(config, 'EXTERNALS'),
    inlineSafe: extractRegexSource(config, 'INLINE_SAFE'),
    vendoredLibrary: extractRegexSource(config, 'VENDORED_LIBRARY'),
    generatedRemote: extractRegexSource(config, 'GENERATED_REMOTE'),
    banner: extractAssignedLiteral(config, 'banner'),
    footer: extractAssignedLiteral(config, 'footer'),
    intro: extractAssignedLiteral(config, 'intro'),
  }
}

/** Read the official preset's comparable values from a source checkout. */
export function officialPresetValues(checkoutRoot) {
  const preset = readFileSync(join(checkoutRoot, 'packages', 'client', 'tsdown.client.ts'), 'utf8')
  return {
    externals: officialExternals(checkoutRoot),
    inlineSafe: extractRegexSource(preset, 'INLINE_SAFE'),
    vendoredLibrary: extractRegexSource(preset, 'VENDORED_LIBRARY'),
    generatedRemote: extractRegexSource(preset, 'GENERATED_REMOTE'),
    banner: extractAssignedLiteral(preset, 'banner'),
    footer: extractAssignedLiteral(preset, 'footer'),
    intro: extractAssignedLiteral(preset, 'intro'),
  }
}

/**
 * Diff the frozen client-preset replica against an official source checkout.
 * @returns per-item rows; verdict `ok`, `drift`, or `unreadable` (an extraction
 *   failed — a false alarm would be worse than silence, so it is a note, not
 *   a failure).
 */
export function presetDrift(checkoutRoot) {
  const replica = replicaValues()
  const official = officialPresetValues(checkoutRoot)
  const rows = []
  const same = (name, left, right, normalize) => {
    if (left === undefined || right === undefined) {
      rows.push({ item: name, verdict: 'unreadable', detail: 'an extraction failed; re-check the source shapes manually' })
      return
    }
    if (normalize(left) === normalize(right)) {
      rows.push({ item: name, verdict: 'ok' })
      return
    }
    rows.push({ item: name, verdict: 'drift', detail: `replica: ${JSON.stringify(left)} ≠ official: ${JSON.stringify(right)}` })
  }
  same('client externals (module table)', replica.externals, official.externals, values => [...values].sort().join('\u0000'))
  same('purity: INLINE_SAFE', replica.inlineSafe, official.inlineSafe, value => value)
  same('purity: VENDORED_LIBRARY', replica.vendoredLibrary, official.vendoredLibrary, value => value)
  same('purity: GENERATED_REMOTE', replica.generatedRemote, official.generatedRemote, value => value)
  // The id stamp differs by design (this plugin's own package name), so the
  // handoff templates are compared with that token normalized away.
  const normalizeHandoff = value => value.replaceAll('JSON.stringify(id)', 'JSON.stringify(ID)')
  same('bundle handoff banner', replica.banner, official.banner, normalizeHandoff)
  same('bundle handoff footer', replica.footer, official.footer, value => value)
  same('bundle handoff intro', replica.intro, official.intro, value => value)
  return rows
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
    process.exit(exitCode)
  }

  // Client preset drift: only a source checkout can answer this (the preset
  // is unpublished), so an installed-dsh-only machine skips it with a note.
  const located = harnessRoot()
  if (located === undefined || located.kind !== 'checkout') {
    console.log('')
    console.log('Client preset drift: skipped — no dsh source checkout ($DSH_CHECKOUT or harness-paths.json). The version check above is all an installed-dsh machine can verify.')
    process.exit(exitCode)
  }
  console.log('')
  console.log(`Client preset drift: ${located.root}`)
  let drift = false
  for (const row of presetDrift(located.root)) {
    const mark = row.verdict === 'ok' ? 'OK ' : row.verdict === 'drift' ? 'XX ' : '?? '
    console.log(`  ${mark} ${row.item.padEnd(28)}${row.verdict === 'ok' ? 'identical' : row.detail ?? ''}`)
    if (row.verdict === 'drift') drift = true
  }
  if (drift) {
    console.log('The frozen client-preset replica in tsdown.config.ts diverges from the official preset. Update the replica to match the checkout, then rebuild (a drifted externals list inlines or re-shared module-table entries, and a drifted purity gate mis-policed cross-plugin imports).')
    process.exit(3)
  }
  console.log('The frozen client-preset replica matches the checkout.')
  process.exit(exitCode)
}

const invoked = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url
if (invoked) main()
