/**
 * Unit tests for the compatibility checker's pure logic: version grading and
 * the fallback assessment, including the missing-fallback diagnosis.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assess, baseOf, compare, installedVersion, SPOT_CHECKS,
} from '../scripts/check-compat.mjs'

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
    for (const { pkg } of SPOT_CHECKS) writeFixture(dir, pkg, '0.1.0-rc.6')
    const result = assess(dir)
    expect(result.exitCode).toBe(1)
    expect(result.rows.every(row => row.verdict === 'adjacent')).toBe(true)
  })

  it('grades a diverged machine as mismatch (exit 2)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-check-'))
    for (const { pkg } of SPOT_CHECKS) writeFixture(dir, pkg, '0.2.0-rc.1')
    const result = assess(dir)
    expect(result.exitCode).toBe(2)
    expect(result.rows.every(row => row.verdict === 'mismatch')).toBe(true)
  })
})
