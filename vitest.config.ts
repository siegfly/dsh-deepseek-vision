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
          if (typeof name === 'string' && !map.has(name)) {
            map.set(name, full)
            // Client dual-face packages also serve their browser half under
            // `<name>/client` — map that specifier onto src/client/index.ts.
            const clientIndex = join(full, 'src', 'client', 'index.ts')
            if (existsSync(clientIndex)) map.set(`${name}/client`, full)
          }
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
        find: /^@deepseek-ai\/([a-z0-9-]+(?:\/client)?)$/,
        replacement: (specifier: string): string => {
          const isClient = specifier.endsWith('/client')
          const dir = packages.get(isClient ? specifier : specifier)
          if (dir === undefined) {
            throw new Error(`dsh-vl-gateway vitest: no workspace package for ${specifier}`)
          }
          const index = join(dir, 'src', isClient ? 'client' : '', 'index.ts')
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
