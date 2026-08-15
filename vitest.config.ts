/**
 * Test-only module resolution: every `@deepseek-ai/*` specifier maps onto the
 * harness sources/types through scripts/harness-paths.mjs — the single
 * resolution seam. Nothing in this repo hardcodes a checkout path: the seam
 * resolves $DSH_CHECKOUT > a local (gitignored) harness-paths.json > the
 * machine's installed dsh (its healed module fallback).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
import { harnessRoot, resolvePackageDir } from './scripts/harness-paths.mjs'

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
    // Installed fallback: the tsc-emitted `lib/types/client/index.js` is
    // Node-runnable (the published `lib/client.js` is the browser closure
    // factory and references `window.__ModuleLoader__` at top level), so it
    // is the right runtime entry for tests.
    const nodeEntry = join(dir, 'lib', 'types', 'client', 'index.js')
    if (existsSync(nodeEntry)) return nodeEntry
    const manifest = manifestEntry(dir, './client')
    if (manifest !== undefined) return manifest
    const legacy = join(dir, 'lib', 'client.js')
    if (existsSync(legacy)) return legacy
    throw new Error(`dsh-vl-gateway vitest: no client runtime entry for ${specifier} in ${dir}`)
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
