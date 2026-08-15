/**
 * Unit tests for the profile-layer edits that mirror the official
 * `dsh plugin` bundle reconciliation (dsh.profile.bundles) and the legacy
 * managed-block migration out of the profile's own patch layer.
 */

import { describe, expect, it } from 'vitest'
import {
  ensureBundle, freshManifest, PATCH_END, PATCH_START, PLUGIN_PACKAGE_NAME,
  removeBundle, stripManagedBlock, templateBundles,
} from '../scripts/profile-layer.mjs'

describe('template bundles', () => {
  it('mirrors the official PROFILE_TEMPLATES', () => {
    expect(templateBundles('web')).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(templateBundles('headless')).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])
    expect(templateBundles('other')).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('builds a fresh manifest in the official shape', () => {
    const manifest = freshManifest('web')
    expect(manifest.name).toBe('dsh-profile-web')
    expect(manifest.private).toBe(true)
    expect(manifest.dependencies).toEqual({})
    expect(manifest.dsh.profile.bundles).toEqual(templateBundles('web'))
  })
})

describe('bundle reconcile', () => {
  it('creates dsh.profile.bundles when it is missing entirely', () => {
    const { manifest, changed } = ensureBundle({ name: 'p', private: true, dependencies: {} }, PLUGIN_PACKAGE_NAME)
    expect(changed).toBe(true)
    expect(manifest.dsh.profile.bundles).toEqual([PLUGIN_PACKAGE_NAME])
  })

  it('appends after the template bundles and keeps every other field', () => {
    const original = freshManifest('web')
    const { manifest, changed } = ensureBundle(original, PLUGIN_PACKAGE_NAME)
    expect(changed).toBe(true)
    expect(manifest.dsh.profile.bundles).toEqual([...templateBundles('web'), PLUGIN_PACKAGE_NAME])
    expect(manifest.name).toBe('dsh-profile-web')
  })

  it('is idempotent when the name is already listed', () => {
    const once = ensureBundle(freshManifest('web'), PLUGIN_PACKAGE_NAME)
    const twice = ensureBundle(once.manifest, PLUGIN_PACKAGE_NAME)
    expect(twice.changed).toBe(false)
    expect(twice.manifest).toBe(once.manifest)
  })

  it('removes a listed name and leaves the template bundles alone', () => {
    const withPlugin = ensureBundle(freshManifest('web'), PLUGIN_PACKAGE_NAME).manifest
    const { manifest, changed } = removeBundle(withPlugin, PLUGIN_PACKAGE_NAME)
    expect(changed).toBe(true)
    expect(manifest.dsh.profile.bundles).toEqual(templateBundles('web'))
    const again = removeBundle(manifest, PLUGIN_PACKAGE_NAME)
    expect(again.changed).toBe(false)
  })
})

describe('legacy managed block migration', () => {
  const block = `${PATCH_START}
- insert:
    - id: llm-vl-gateway
      name: dsh-vl-gateway
${PATCH_END}`

  it('strips the block from a file that held only the block', () => {
    const { text, removed } = stripManagedBlock(`${block}\n`)
    expect(removed).toBe(true)
    expect(text).toBe('[]\n')
  })

  it('strips the block and keeps surrounding user content', () => {
    const { text, removed } = stripManagedBlock(`# user layer\n${block}\n- id: other\n`)
    expect(removed).toBe(true)
    expect(text).toBe('# user layer\n\n- id: other\n')
  })

  it('leaves a patch file without the block untouched', () => {
    const { text, removed } = stripManagedBlock('[]\n')
    expect(removed).toBe(false)
    expect(text).toBe('[]\n')
  })

  it('consumes through end-of-file when the end marker is missing', () => {
    const { text, removed } = stripManagedBlock(`keep: me\n${PATCH_START}\n- insert: []`)
    expect(removed).toBe(true)
    expect(text).toBe('keep: me\n')
  })
})
