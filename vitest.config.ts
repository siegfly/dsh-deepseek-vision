/**
 * Test-only module resolution: maps every `@deepseek-ai/*` specifier onto the
 * sibling deepseek-harness checkout's workspace sources. The checkout path is
 * a dev-time reference only — at runtime the plugin resolves those packages
 * through the profile's healed module fallback (see README), never through
 * this file.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const HARNESS = fileURLToPath(new URL('../deepseek-harness', import.meta.url))

/** Package name → workspace source directory, indexed from package.json names. */
function buildPackageMap(): Map<string, string> {
  const map = new Map<string, string>()
  const visit = (dir: string, depth: number): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      const manifestPath = join(full, 'package.json')
      if (existsSync(manifestPath)) {
        try {
          const name = JSON.parse(readFileSync(manifestPath, 'utf8')).name as unknown
          if (typeof name === 'string' && !map.has(name)) map.set(name, full)
        } catch {
          // Not a readable manifest — keep walking.
        }
      }
      if (depth > 0) visit(full, depth - 1)
    }
  }
  visit(join(HARNESS, 'packages'), 2)
  visit(join(HARNESS, 'vendor'), 1)
  return map
}

const packages = buildPackageMap()

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deepseek-ai\/([a-z0-9-]+)$/,
        replacement: (specifier: string): string => {
          const dir = packages.get(specifier)
          if (dir === undefined) {
            throw new Error(`dsh-vl-gateway vitest: no workspace package for ${specifier}`)
          }
          const index = join(dir, 'src', 'index.ts')
          return existsSync(index) ? index : dir
        },
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
