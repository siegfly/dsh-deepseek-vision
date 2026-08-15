/**
 * Test-only module resolution: every `@deepseek-ai/*` specifier maps onto the
 * harness sources/types through scripts/harness-paths.mjs — the single
 * resolution seam. Nothing in this repo hardcodes a checkout path: the seam
 * resolves $DSH_CHECKOUT > a local (gitignored) harness-paths.json > the
 * machine's installed dsh (its healed module fallback).
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { harnessRoot, resolvePackageDir } from './scripts/harness-paths.mjs'

// This config file sits at the repo ROOT (unlike scripts/harness-paths.mjs,
// which needs two dirname hops from scripts/), so one dirname gives the root.
const repoRoot = dirname(fileURLToPath(import.meta.url))

const located = harnessRoot()
if (located === undefined) {
  throw new Error(
    'dsh-vl-gateway vitest: no harness types found — set $DSH_CHECKOUT, create a local '
    + 'harness-paths.json, or boot `dsh web` once on this machine (see README).',
  )
}
console.log(`dsh-vl-gateway vitest: harness source ${located.root} (${located.kind})`)

/** Read one conditional export (or `main`/`module`) from a package manifest. */
function manifestEntry(dir: string, subpath: string): string | undefined {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  let manifest: { exports?: Record<string, unknown>; main?: unknown; module?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return undefined
  }
  const conditional = (value: unknown): unknown => {
    if (typeof value === 'string') return value
    if (typeof value === 'object' && value !== null) {
      const conditions = value as Record<string, unknown>
      return conditions.import ?? conditions.default ?? conditions.require
    }
    return undefined
  }
  let entry = conditional(manifest.exports?.[subpath])
  if (entry === undefined && subpath === '.') entry = manifest.main ?? manifest.module
  if (typeof entry !== 'string' || entry.length === 0) return undefined
  const resolved = join(dir, entry)
  return existsSync(resolved) ? resolved : undefined
}

/** Package specifier → runtime entry file (dev source when available, else the manifest entry). */
function runtimeEntry(specifier) {
  const dir = resolvePackageDir(specifier)
  if (dir === undefined) {
    throw new Error(`dsh-vl-gateway vitest: no workspace package for ${specifier}`)
  }
  const isClient = specifier.endsWith('/client')
  if (located.kind === 'checkout') {
    const dev = isClient ? join(dir, 'src', 'client', 'index.ts') : join(dir, 'src', 'index.ts')
    if (existsSync(dev)) return dev
    // Fall through to the manifest entry: a checkout package without a
    // src/index.ts (or a built-only vendor) mirrors the published layout.
  }
  if (isClient) {
    // Installed fallback: the tsc-emitted `lib/types/client/index.js` (present
    // in checkout-built layouts, e.g. this machine's healed junction) is
    // Node-runnable. The npm-published layout carries declarations only — its
    // sole runnable JS is the browser closure (`lib/client.js`, references
    // `window.__ModuleLoader__` at top level), which must never be loaded
    // into Node. Map those specifiers to an import-safe stand-in instead; the
    // client specs detect the same situation and skip themselves
    // (tests/support/client-runtime.ts).
    const nodeEntry = join(dir, 'lib', 'types', 'client', 'index.js')
    if (existsSync(nodeEntry)) return nodeEntry
    return join(repoRoot, 'tests', 'support', 'browser-only-client.js')
  }
  // Installed fallback, host half: the published layout is manifest-driven —
  // schemastery ships lib/index.mjs/.cjs, not lib/index.js — so hardcoded
  // entries break.
  const entry = manifestEntry(dir, '.')
  if (entry !== undefined) return entry
  const legacy = join(dir, 'lib', 'index.js')
  if (existsSync(legacy)) return legacy
  throw new Error(`dsh-vl-gateway vitest: no runtime entry for ${specifier} in ${dir}`)
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deepseek-ai\/([a-z0-9-]+(?:\/client)?)$/,
        replacement: (specifier) => runtimeEntry(specifier),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
