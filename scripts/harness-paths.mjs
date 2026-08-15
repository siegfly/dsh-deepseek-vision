/**
 * harness-paths.mjs — the ONE place that knows where the dsh package types
 * and sources come from during development, WITHOUT hardcoding any checkout
 * path in the repository.
 *
 * Resolution order:
 *   1. $DSH_CHECKOUT — absolute path of a dsh source checkout (packages/** and
 *      vendor/** layout);
 *   2. ./harness-paths.json — a LOCAL, gitignored file carrying the same
 *      `{ "checkout": "<path>" }` payload (machine-specific, never committed);
 *   3. the machine's INSTALLED dsh: `$DSH_HOME/profiles/node_modules`, the
 *      launcher-maintained healed fallback, whose package dirs ship committed
 *      `lib/types/*.d.ts` (works on `npx @deepseek-ai/dsh web` machines too).
 *
 * `node scripts/harness-paths.mjs --write` regenerates tsconfig.paths.json
 * (gitignored) that tsconfig.json extends; `--write-anchor` stamps the
 * resolved dsh version into the committed lib/build-anchor.json (the
 * mechanical proof of what lib/ was built against). vitest.config.ts imports
 * this module directly and resolves aliases through resolvePackageDir().
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

/** Package names (including `/client` subpaths) whose types this repo consumes. */
export const PACKAGE_NAMES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-anonymous-user-id',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-settings-plugins/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-api-remotes/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Read the machine-local checkout override, if the user created one. */
function localOverride() {
  const file = join(repoRoot, 'harness-paths.json')
  if (!existsSync(file)) return undefined
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')).checkout
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** The installed-dsh fallback root: $DSH_HOME/profiles/node_modules. */
function installedFallbackRoot() {
  const dshHome = process.env.DSH_HOME ?? join(os.homedir(), '.dsh')
  const root = join(dshHome, 'profiles', 'node_modules')
  return existsSync(root) ? root : undefined
}

/** Which of the three sources is in force, or undefined when none exists. */
export function harnessRoot() {
  return harnessRootWith({
    envCheckout: process.env.DSH_CHECKOUT,
    localCheckout: localOverride(),
    installedRoot: installedFallbackRoot(),
  })
}

/** Injectable resolution for tests: the three sources, in precedence order. */
export function harnessRootWith({ envCheckout, localCheckout, installedRoot }) {
  if (envCheckout !== undefined && envCheckout.length > 0) {
    return { root: resolve(envCheckout), kind: 'checkout' }
  }
  if (localCheckout !== undefined) {
    return {
      root: isAbsolute(localCheckout) ? localCheckout : resolve(repoRoot, localCheckout),
      kind: 'checkout',
    }
  }
  if (installedRoot !== undefined) return { root: installedRoot, kind: 'installed' }
  return undefined
}

const manifestCache = new Map()

/** Discover one package directory by package.json name under a checkout root. */
function discoverInCheckout(root, name) {
  const walk = (dir, depth) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return undefined
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      const manifestPath = join(full, 'package.json')
      if (existsSync(manifestPath)) {
        try {
          const found = JSON.parse(readFileSync(manifestPath, 'utf8')).name
          if (found === name) return full
        } catch {
          // Keep walking.
        }
      }
      if (depth > 0) {
        const hit = walk(full, depth - 1)
        if (hit !== undefined) return hit
      }
    }
    return undefined
  }
  return walk(join(root, 'packages'), 2) ?? walk(join(root, 'vendor'), 1)
}

/** Resolve one package name (or `<name>/client` subpath) to its directory. */
export function resolvePackageDir(name, located = harnessRoot()) {
  if (located === undefined) return undefined
  const cacheKey = `${located.kind}\u0000${located.root}\u0000${name}`
  if (manifestCache.has(cacheKey)) return manifestCache.get(cacheKey)
  let dir
  if (located.kind === 'installed') {
    dir = join(located.root, name)
  } else {
    // `/client` is a dual-face subpath; the manifest name is the package root.
    const base = name.endsWith('/client') ? name.slice(0, -'/client'.length) : name
    dir = discoverInCheckout(located.root, base)
  }
  const result = dir !== undefined && existsSync(dir) ? dir : undefined
  manifestCache.set(cacheKey, result)
  return result
}

/** The type entry for one package, preferring committed lib/types output. */
function typeEntry(dir, name) {
  const subpath = name.includes('/client') ? 'client' : undefined
  const candidates = subpath === undefined
    ? ['lib/types/index.d.ts', 'lib/index.d.ts']
    : ['lib/types/client/index.d.ts', 'lib/client/index.d.ts', 'lib/client.d.ts']
  for (const candidate of candidates) {
    if (existsSync(join(dir, candidate))) return join(dir, candidate)
  }
  return undefined
}

/** Build the tsconfig paths map for the current harness source. */
export function buildTsconfigPaths() {
  const paths = {}
  let missing = 0
  for (const name of PACKAGE_NAMES) {
    const dir = resolvePackageDir(name)
    const entry = dir === undefined ? undefined : typeEntry(dir, name)
    if (entry === undefined) {
      missing += 1
      continue
    }
    paths[name] = [entry]
  }
  return { paths, missing }
}

/** Regenerate the gitignored tsconfig.paths.json that tsconfig.json extends. */
export function writeTsconfigPaths() {
  const { paths, missing } = buildTsconfigPaths()
  const target = join(repoRoot, 'tsconfig.paths.json')
  const content = JSON.stringify({ compilerOptions: { paths } }, undefined, 2) + '\n'
  writeFileSync(target, content)
  return { target, entries: Object.keys(paths).length, missing }
}

/**
 * The dsh version the harness source actually carries. This is the BUILD
 * ANCHOR in the strict sense: the version the committed lib/ was compiled
 * against, read from the same resolution seam the build itself used — the
 * checkout's `apps/cli` manifest for a source checkout, the installed
 * launcher manifest for the healed fallback.
 * @param located - a resolved harness source ({root, kind}).
 * @returns `{ version, kind }`, or undefined when the source carries no
 *   readable dsh version.
 */
export function harnessVersion(located) {
  const manifestPath = located.kind === 'checkout'
    ? join(located.root, 'apps', 'cli', 'package.json')
    : join(located.root, '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(manifestPath)) return undefined
  try {
    const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    return typeof version === 'string' && version.length > 0
      ? { version, kind: located.kind }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Stamp the resolved harness version into the committed `lib/build-anchor.json`.
 * The stamp is the one mechanical proof of what the committed lib/ was REALLY
 * built against: check-compat.mjs compares it with the hand-declared
 * `dshCompat.anchorVersion`, so a rebuild against a newer checkout without an
 * anchor update is caught instead of shipping a tag that lies.
 * @returns the stamp ({version, kind, path}), or undefined when unresolvable.
 */
export function writeBuildAnchor() {
  const located = harnessRoot()
  if (located === undefined) {
    printGuidance()
    process.exit(1)
  }
  const facts = harnessVersion(located)
  if (facts === undefined) {
    console.log(`dsh-vl-gateway: WARNING — no dsh version readable from ${located.root}; lib/build-anchor.json not written`)
    return undefined
  }
  const target = join(repoRoot, 'lib', 'build-anchor.json')
  writeFileSync(target, JSON.stringify(facts, undefined, 2) + '\n')
  return { ...facts, path: target }
}

function printGuidance() {
  console.log('dsh-vl-gateway: no harness types found. Provide ONE of:')
  console.log('  1. $DSH_CHECKOUT pointing at a dsh source checkout;')
  console.log('  2. a local harness-paths.json in this repo: {"checkout": "<path>"} (gitignored);')
  console.log('  3. boot `dsh web` once on this machine (its healed fallback ships the types).')
}

function main() {
  if (process.argv.includes('--write')) {
    const located = harnessRoot()
    if (located === undefined) {
      printGuidance()
      process.exit(1)
    }
    const { target, entries, missing } = writeTsconfigPaths()
    console.log(`dsh-vl-gateway: wrote ${entries} path entries to ${target}`)
    if (missing > 0) {
      console.log(`dsh-vl-gateway: WARNING — ${missing} package type entries could not be resolved; the build will fail on their imports.`)
      process.exit(1)
    }
    return
  }
  if (process.argv.includes('--write-anchor')) {
    const stamp = writeBuildAnchor()
    if (stamp !== undefined) {
      console.log(`dsh-vl-gateway: build anchor stamped: ${stamp.version} (${stamp.kind}) → ${stamp.path}`)
    }
    return
  }
  const located = harnessRoot()
  if (located === undefined) {
    printGuidance()
    process.exit(1)
  }
  console.log(`harness source: ${located.root} (${located.kind})`)
}

const invoked = process.argv[1] !== undefined
  && new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href === import.meta.url
if (invoked) main()
