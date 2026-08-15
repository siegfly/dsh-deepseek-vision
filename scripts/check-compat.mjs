/**
 * check-compat.mjs — compare the target machine's installed dsh version
 * against the anchor version this release's committed lib/ was built against,
 * and — when a dsh source checkout is available — diff the frozen client
 * bundle preset replica (externals / purity regexes / handoff) against the
 * official preset.
 *
 * The plugin resolves `@deepseek-ai/*` at RUNTIME from the target's own dsh
 * installation (the profile healed fallback), and install-profile rebuilds
 * the plugin against the target's own dsh before this check runs — so a
 * released plugin must stay installable on newer (or older) official dsh.
 * This script reads the installed versions from
 * $DSH_HOME/profiles/node_modules (the launcher-maintained fallback), grades
 * each against the anchor for the advisory report, and hard-fails only on
 * release-integrity defects (unbuilt lib/, drifted client preset).
 *
 * Usage:
 *   node scripts/check-compat.mjs [dshHome]
 *
 * Exit codes: 0 = every spot-check matches the anchor and the stamp is intact;
 * 1 = ADVISORY difference (target dsh differs from the release anchor — any
 * size, newer or older; installs proceed because install-profile rebuilt the
 * plugin against the target's own dsh before this check ran); 2 = the release
 * is unbuilt (no build-anchor stamp — a packaging defect, not a version
 * issue); 3 = client preset replica drift (update tsdown.config.ts to the
 * checkout's preset, then rebuild).
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
 *
 * Version differences of ANY size are advisory here (exit 1), never a
 * refusal: install-profile rebuilds the plugin against the target machine's
 * own dsh before this check runs, so a successful build is already the
 * compatibility proof. A released plugin does not force its users onto the
 * anchor version — they may run newer (or older) official dsh.
 *
 * @returns the per-package rows and the process exit code
 *   (0 = all match, 1 = any difference).
 */
export function assess(profilesNodeModules) {
  const anchor = anchorVersion()
  const rows = SPOT_CHECKS.map(({ pkg, label }) => {
    const actual = installedVersion(profilesNodeModules, pkg)
    return { pkg, label, actual, verdict: actual === undefined ? 'missing' : compare(anchor, actual) }
  })
  const exitCode = rows.every(row => row.verdict === 'match') ? 0 : 1
  return { anchor, rows, exitCode }
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
  // A Windows checkout working tree is CRLF: the capture runs to end-of-line,
  // so trim line-ending whitespace before stripping the closing slash —
  // otherwise the same literal compares unequal across platforms.
  return match[1].replace(/\s+$/, '').replace(/\/$/, '')
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
 * Read the committed build-anchor stamp (`lib/build-anchor.json`) — the
 * mechanical record of which dsh version the committed lib/ was built
 * against, written by `pnpm build` through harness-paths.mjs --write-anchor.
 * @param stampPath - override for tests.
 * @returns the stamp `{version, kind}`, or undefined when the committed lib
 *   predates the stamp (build once to write it).
 */
export function buildAnchorStamp(stampPath = join(repo, 'lib', 'build-anchor.json')) {
  if (!existsSync(stampPath)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(stampPath, 'utf8'))
    const version = typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : undefined
    const kind = parsed.kind === 'checkout' || parsed.kind === 'installed' ? parsed.kind : undefined
    if (version === undefined || kind === undefined) return undefined
    return { version, kind }
  } catch {
    return undefined
  }
}

/**
 * Grade the committed build stamp against the declared anchor.
 *
 * `dshCompat.anchorVersion` is hand-written metadata; the stamp is the
 * mechanical record of what lib/ was really built against.
 * @returns verdict `ok` (stamp and anchor agree), `diverged` (they differ —
 *   EXPECTED on a target machine after install-profile's rebuild, which
 *   restamps against the target's own dsh, so it is advisory, not a lie), or
 *   `missing` (no stamp at all — the lib/ was never built, a release defect).
 */
export function gradeBuildAnchor(stamp, anchor) {
  if (stamp === undefined) return 'missing'
  if (stamp.version === anchor) return 'ok'
  return 'diverged'
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
  console.log(`  release anchor (committed lib/ built against): dsh ${anchor}`)
  console.log(`  target profile:                               ${profilesNodeModules}`)
  console.log('')
  for (const row of rows) {
    const mark = row.verdict === 'match' ? 'OK ' : row.verdict === 'missing' ? '?? ' : '~  '
    console.log(`  ${mark} ${row.label.padEnd(28)} ${row.actual ?? '(not found)'}`)
  }
  if (rows.some(row => row.verdict === 'missing')) {
    console.log('One or more spot-check packages are absent from the fallback — boot `dsh web` once on this machine (the launcher maintains that directory).')
  }

  // Stamp: missing = the release was never built (packaging defect, refuse);
  // diverged = the target rebuild restamped against this machine's own dsh —
  // expected whenever the target differs from the anchor, so advisory.
  const stamp = buildAnchorStamp()
  const stampVerdict = gradeBuildAnchor(stamp, anchor)
  {
    const label = 'build anchor stamp (lib/)'
    const mark = stampVerdict === 'ok' ? 'OK ' : stampVerdict === 'missing' ? 'XX ' : '~  '
    console.log(`  ${mark} ${label.padEnd(28)} ${stamp === undefined ? '(missing — run `pnpm build` once)' : `${stamp.version} (${stamp.kind})`}`)
  }
  console.log('')

  if (stampVerdict === 'missing') {
    console.log('The committed lib/ carries no build-anchor stamp — the release was never built. Run `pnpm build` once (install-profile builds automatically before this check).')
    process.exit(2)
  }

  let code = exitCode
  if (code === 0 && stampVerdict === 'diverged') code = 1
  if (code === 0) {
    console.log('Target dsh matches the release anchor exactly.')
  } else {
    console.log('The target dsh differs from the release anchor. This is expected and allowed:')
    console.log("install-profile rebuilt the plugin against this machine's own dsh before checking,")
    console.log('so the installed artifact is native to it — no need to re-release or re-anchor for')
    console.log('every official upgrade. Smoke-test once after install (paste an image).')
    console.log('Conservative mode: DSH_VL_GATEWAY_STRICT=1 refuses installation on any difference.')
  }

  // Client preset drift: only a source checkout can answer this (the preset
  // is unpublished), so an installed-dsh-only machine skips it with a note.
  const located = harnessRoot()
  if (located === undefined || located.kind !== 'checkout') {
    console.log('')
    console.log('Client preset drift: skipped — no dsh source checkout ($DSH_CHECKOUT or harness-paths.json).')
    process.exit(code)
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
  process.exit(code)
}

const invoked = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url
if (invoked) main()
