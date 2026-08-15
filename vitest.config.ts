/**
 * Test-only module resolution: every `@deepseek-ai/*` specifier maps onto the
 * harness sources/types through scripts/harness-paths.mjs — the single
 * resolution seam. Nothing in this repo hardcodes a checkout path: the seam
 * resolves $DSH_CHECKOUT > a local (gitignored) harness-paths.json > the
 * machine's installed dsh (its healed module fallback).
 */

import { existsSync } from 'node:fs'
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

/** Package specifier → runtime entry file (dev source when available, else built lib). */
function runtimeEntry(specifier) {
  const dir = resolvePackageDir(specifier)
  if (dir === undefined) {
    throw new Error(`dsh-vl-gateway vitest: no workspace package for ${specifier}`)
  }
  const isClient = specifier.endsWith('/client')
  if (located.kind === 'checkout') {
    const dev = isClient ? join(dir, 'src', 'client', 'index.ts') : join(dir, 'src', 'index.ts')
    if (existsSync(dev)) return dev
  }
  if (isClient) {
    for (const candidate of ['lib/types/client/index.js', 'lib/client.js']) {
      const entry = join(dir, candidate)
      if (existsSync(entry)) return entry
    }
  }
  return join(dir, 'lib', 'index.js')
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
