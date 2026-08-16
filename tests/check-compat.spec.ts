/**
 * Unit tests for the compatibility checker's pure logic: version grading and
 * the fallback assessment, including the missing-fallback diagnosis.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assess, baseOf, buildAnchorStamp, compare, extractRegexSource, gradeBuildAnchor,
  installedVersion, officialExternals, presetDrift, replicaValues, SPOT_CHECKS,
} from '../scripts/check-compat.mjs'

/** The declared anchor, so fallback-assessment fixtures track releases instead of hardcoding an rc. */
const ANCHOR = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { dshCompat: { anchorVersion: string } }).dshCompat.anchorVersion
/** One rc ahead of the anchor (its pre-release number + 1). */
const AHEAD = ANCHOR.replace(/-rc\.(\d+)$/, (_, n: string) => `-rc.${Number(n) + 1}`)

/** Write one fixture package manifest into a fake fallback directory. */
function writeFixture(root: string, pkg: string, version: string): void {
  const dir = join(root, pkg)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }))
}

describe('version grading', () => {
  it('splits the release base from the prerelease', () => {
    expect(baseOf('0.1.0-rc.5')).toBe('0.1.0')
    expect(baseOf('0.1.0')).toBe('0.1.0')
    expect(baseOf(undefined)).toBe('')
  })

  it('grades exact, adjacent, and diverged versions', () => {
    expect(compare('0.1.0-rc.5', '0.1.0-rc.5')).toBe('match')
    expect(compare('0.1.0-rc.5', '0.1.0-rc.6')).toBe('adjacent')
    expect(compare('0.1.0-rc.5', '0.1.0')).toBe('adjacent')
    expect(compare('0.1.0-rc.5', '0.2.0-rc.1')).toBe('mismatch')
    expect(compare('0.1.0-rc.5', '0.0.9-rc.9')).toBe('mismatch')
  })
})

describe('fallback assessment', () => {
  let dir: string

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it('reads installed versions from the healed fallback', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-check-'))
    writeFixture(dir, '@deepseek-ai/dsh', '0.1.0-rc.6')
    expect(installedVersion(dir, '@deepseek-ai/dsh')).toBe('0.1.0-rc.6')
    expect(installedVersion(dir, '@deepseek-ai/dsh-llm')).toBeUndefined()
  })

  it('reports missing fallback packages with a non-zero exit code', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-check-'))
    const result = assess(dir)
    expect(result.exitCode).toBeGreaterThan(0)
    expect(result.rows.every(row => row.verdict === 'missing')).toBe(true)
    expect(SPOT_CHECKS.length).toBeGreaterThanOrEqual(4)
  })

  it('grades a machine one rc ahead as adjacent (exit 1)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-check-'))
    for (const { pkg } of SPOT_CHECKS) writeFixture(dir, pkg, AHEAD)
    const result = assess(dir)
    expect(result.exitCode).toBe(1)
    expect(result.rows.every(row => row.verdict === 'adjacent')).toBe(true)
  })

  it('grades a machine on a different base as advisory, not a refusal (exit 1)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-check-'))
    for (const { pkg } of SPOT_CHECKS) writeFixture(dir, pkg, '0.2.0-rc.1')
    const result = assess(dir)
    expect(result.exitCode).toBe(1)
    expect(result.rows.every(row => row.verdict === 'mismatch')).toBe(true)
  })

  it('grades a machine exactly on the anchor as a clean match (exit 0)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-check-'))
    for (const { pkg } of SPOT_CHECKS) writeFixture(dir, pkg, ANCHOR)
    const result = assess(dir)
    expect(result.exitCode).toBe(0)
    expect(result.rows.every(row => row.verdict === 'match')).toBe(true)
  })
})

describe('build anchor stamp', () => {
  let dir: string

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it('reads the committed stamp file', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-stamp-'))
    const stampPath = join(dir, 'stamp.json')
    writeFileSync(stampPath, JSON.stringify({ version: '0.1.0-rc.5', kind: 'checkout' }))
    expect(buildAnchorStamp(stampPath)).toEqual({ version: '0.1.0-rc.5', kind: 'checkout' })
    expect(buildAnchorStamp(join(dir, 'absent.json'))).toBeUndefined()
  })

  it('grades the stamp against the declared anchor: ok, diverged, missing', () => {
    expect(gradeBuildAnchor({ version: '0.1.0-rc.5', kind: 'checkout' }, '0.1.0-rc.5')).toBe('ok')
    expect(gradeBuildAnchor({ version: '0.1.0-rc.6', kind: 'checkout' }, '0.1.0-rc.5')).toBe('diverged')
    expect(gradeBuildAnchor(undefined, '0.1.0-rc.5')).toBe('missing')
  })

  it('treats an unreadable stamp as missing rather than failing', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-stamp-'))
    const stampPath = join(dir, 'stamp.json')
    writeFileSync(stampPath, '{not json')
    expect(buildAnchorStamp(stampPath)).toBeUndefined()
  })
})

/**
 * Write a fake source checkout whose official preset files mirror this repo's
 * replica (plus optional mutations), so presetDrift compares the real
 * tsdown.config.ts against a controllable "official" side.
 */
function writeCheckoutFixture(root: string, mutate?: (preset: string[], platform: string[]) => void): void {
  const replica = replicaValues()
  const externals = replica.externals
  if (externals === undefined) throw new Error('fixture: replica externals unreadable')
  // officialExternals = PLATFORM_MODULES + RUNTIME_STORE_EXEMPTION, and the
  // exemption is the replica list's last member by construction.
  const platform = externals.slice(0, -1)
  const exemption = externals.at(-1) ?? ''
  const preset: string[] = []
  const regex = (name: string, value: string | undefined) => {
    if (value === undefined) throw new Error(`fixture: replica ${name} unreadable`)
    // The captured value is the verbatim regex-literal body; write it back
    // exactly so the extractor reads what the real source would carry.
    preset.push(`export const ${name} = /${value}/`)
  }
  regex('INLINE_SAFE', replica.inlineSafe)
  preset.push(`const VENDORED_LIBRARY = /${replica.vendoredLibrary ?? ''}/`)
  preset.push(`const GENERATED_REMOTE = /${replica.generatedRemote ?? ''}/`)
  preset.push(`const RUNTIME_STORE_EXEMPTION = '${exemption}'`)
  preset.push('banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,')
  preset.push("footer: 'return module.exports; } });',")
  preset.push("intro: 'var module = { exports: {} }; var exports = module.exports;',")
  mutate?.(preset, platform)
  const packages = join(root, 'packages', 'client')
  mkdirSync(join(packages, 'web', 'src'), { recursive: true })
  writeFileSync(join(packages, 'web', 'src', 'platform.ts'), `export const PLATFORM_MODULES = ${JSON.stringify(platform)} as const\n`)
  writeFileSync(join(packages, 'tsdown.client.ts'), preset.join('\n') + '\n')
}

describe('client preset drift', () => {
  let dir: string

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it('parses the official externals from a checkout (platform modules + runtime exemption)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-preset-'))
    writeCheckoutFixture(dir)
    const replica = replicaValues()
    expect(replica.externals?.at(-1)).toBe('@deepseek-ai/dsh-client-runtime/client')
    expect(officialExternals(dir)).toEqual(replica.externals)
  })

  it('reports ok when the checkout preset mirrors the replica', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-preset-'))
    writeCheckoutFixture(dir)
    const rows = presetDrift(dir)
    expect(rows.length).toBe(7)
    expect(rows.every(row => row.verdict === 'ok')).toBe(true)
  })

  it('flags drifted externals and a drifted purity regex', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-preset-'))
    writeCheckoutFixture(dir, (preset, platform) => {
      platform.push('@deepseek-ai/dsh-client-future-ui')
      preset[1] = 'const VENDORED_LIBRARY = /^@deepseek-ai\\/(cosmokit|schemastery|mylib)(\\/|$)/'
    })
    const rows = presetDrift(dir)
    expect(rows.find(row => row.item.startsWith('client externals'))?.verdict).toBe('drift')
    expect(rows.find(row => row.item.startsWith('purity: VENDORED_LIBRARY'))?.verdict).toBe('drift')
    // The untouched items still pass.
    expect(rows.find(row => row.item.startsWith('purity: INLINE_SAFE'))?.verdict).toBe('ok')
  })

  it('tolerates CRLF checkout endings when extracting regex-literal sources', () => {
    const lf = extractRegexSource('export const INLINE_SAFE = /^abc$/\n', 'INLINE_SAFE')
    const crlf = extractRegexSource('export const INLINE_SAFE = /^abc$/\r\n', 'INLINE_SAFE')
    expect(lf).toBe('^abc$')
    expect(crlf).toBe(lf)
  })
})
