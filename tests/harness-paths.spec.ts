/**
 * Unit tests for the harness resolution seam: checkout discovery, installed
 * fallback lookup, type-entry selection, and the generated paths map.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildTsconfigPaths, harnessRootWith, harnessVersion, resolvePackageDir,
} from '../scripts/harness-paths.mjs'

/** Write one fake package manifest (checkout layout: packages/<domain>/<pkg>). */
function writeCheckoutPackage(root: string, domain: string, pkg: string, name: string): void {
  const dir = join(root, 'packages', domain, pkg)
  mkdirSync(join(dir, 'lib', 'types'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }))
  writeFileSync(join(dir, 'lib', 'types', 'index.d.ts'), 'export const anchor: string\n')
}

/** Write one fake installed package (fallback layout: @deepseek-ai/<name>). */
function writeInstalledPackage(root: string, name: string): void {
  const dir = join(root, name)
  mkdirSync(join(dir, 'lib', 'types'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.1.0-rc.6' }))
  writeFileSync(join(dir, 'lib', 'types', 'index.d.ts'), 'export const anchor: string\n')
}

describe('harness-paths seam', () => {
  const previous = {
    env: process.env.DSH_CHECKOUT,
    home: process.env.DSH_HOME,
  }
  let dirs: string[] = []

  afterEach(() => {
    if (previous.env === undefined) delete process.env.DSH_CHECKOUT
    else process.env.DSH_CHECKOUT = previous.env
    if (previous.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.home
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs = []
  })

  it('discovers scoped packages in a checkout layout, including /client subpaths', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-checkout-'))
    dirs.push(root)
    writeCheckoutPackage(root, 'llm', 'llm', '@deepseek-ai/dsh-llm')
    process.env.DSH_CHECKOUT = root
    delete process.env.DSH_HOME
    expect(resolvePackageDir('@deepseek-ai/dsh-llm')).toBe(join(root, 'packages', 'llm', 'llm'))
    // The /client subpath resolves to the same package dir.
    expect(resolvePackageDir('@deepseek-ai/dsh-llm/client')).toBe(join(root, 'packages', 'llm', 'llm'))
    expect(resolvePackageDir('@deepseek-ai/dsh-nope')).toBeUndefined()
  })

  it('falls back to the installed dsh under $DSH_HOME/profiles/node_modules', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    dirs.push(home)
    const fallback = join(home, 'profiles', 'node_modules')
    mkdirSync(fallback, { recursive: true })
    writeInstalledPackage(fallback, '@deepseek-ai/dsh-llm')
    // Injectable deps: no env, no local file — the installed fallback alone.
    const located = harnessRootWith({ envCheckout: undefined, localCheckout: undefined, installedRoot: fallback })
    expect(located).toMatchObject({ root: fallback, kind: 'installed' })
    expect(resolvePackageDir('@deepseek-ai/dsh-llm', located)).toBe(join(fallback, '@deepseek-ai/dsh-llm'))
  })

  it('resolves /client subpaths to the package root in the installed layout too', () => {
    const fallback = mkdtempSync(join(tmpdir(), 'dsh-fallback-'))
    dirs.push(fallback)
    writeInstalledPackage(fallback, '@deepseek-ai/dsh-llm')
    const located = { root: fallback, kind: 'installed' } as const
    // The installed dir has no `client/` directory; the subpath must resolve
    // to the package root, exactly like the checkout branch does.
    expect(resolvePackageDir('@deepseek-ai/dsh-llm/client', located)).toBe(join(fallback, '@deepseek-ai/dsh-llm'))
  })

  it('prefers an environment checkout over the installed fallback', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-checkout-'))
    dirs.push(root)
    writeCheckoutPackage(root, 'llm', 'llm', '@deepseek-ai/dsh-llm')
    const fallback = mkdtempSync(join(tmpdir(), 'dsh-fallback-'))
    dirs.push(fallback)
    const located = harnessRootWith({ envCheckout: root, localCheckout: undefined, installedRoot: fallback })
    expect(located).toMatchObject({ root: root, kind: 'checkout' })
  })

  it('builds a paths map with type entries for every consumed package', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-checkout-'))
    dirs.push(root)
    writeCheckoutPackage(root, 'llm', 'llm', '@deepseek-ai/dsh-llm')
    process.env.DSH_CHECKOUT = root
    delete process.env.DSH_HOME
    const { paths, missing } = buildTsconfigPaths()
    expect(missing).toBeGreaterThan(0) // only one of many packages was staged
    expect(paths['@deepseek-ai/dsh-llm']).toEqual([
      join(root, 'packages', 'llm', 'llm', 'lib', 'types', 'index.d.ts'),
    ])
  })

  it('reads the dsh version from a checkout (apps/cli) and from the installed fallback', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'dsh-checkout-'))
    dirs.push(checkout)
    mkdirSync(join(checkout, 'apps', 'cli'), { recursive: true })
    writeFileSync(
      join(checkout, 'apps', 'cli', 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.5' }),
    )
    expect(harnessVersion({ root: checkout, kind: 'checkout' }))
      .toEqual({ version: '0.1.0-rc.5', kind: 'checkout' })

    const fallback = mkdtempSync(join(tmpdir(), 'dsh-fallback-'))
    dirs.push(fallback)
    mkdirSync(join(fallback, '@deepseek-ai', 'dsh'), { recursive: true })
    writeFileSync(
      join(fallback, '@deepseek-ai', 'dsh', 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }),
    )
    expect(harnessVersion({ root: fallback, kind: 'installed' }))
      .toEqual({ version: '0.1.0-rc.6', kind: 'installed' })
  })

  it('reports no version when the harness source carries none', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-empty-'))
    dirs.push(empty)
    expect(harnessVersion({ root: empty, kind: 'checkout' })).toBeUndefined()
  })
})
