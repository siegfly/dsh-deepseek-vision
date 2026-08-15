/**
 * profile-layer.mjs — the profile-manifest edits install/uninstall perform,
 * mirroring the OFFICIAL `dsh plugin` mechanism:
 *
 * A plugin declares `dsh.bundle.patch` (see package.json) and ships its own
 * cordis.patch.yml; `dsh plugin add` links the package with pnpm and then
 * reconciles `dsh.profile.bundles` in the profile manifest
 * ($DSH_HOME/profiles/<name>/package.json) so the loader mounts the bundle's
 * patch as a layer. This module is the pure, testable core of that
 * reconciliation for THIS plugin, so install-profile.mjs works without the
 * dsh CLI on PATH.
 *
 * It also strips the LEGACY managed block this plugin used to append to the
 * profile's user patch layer (cordis.patch.yml) before the bundle mechanism
 * existed, so older installs migrate to the single official mechanism.
 */

/**
 * Markers around the legacy managed block in the profile's cordis.patch.yml.
 * The old package name stays in the markers on purpose: they identify blocks
 * written by installs from before the rename, which must still migrate away.
 */
export const PATCH_START = '# >>> dsh-vl-gateway (managed by install-profile.mjs)'
export const PATCH_END = '# <<< dsh-vl-gateway'

export const PLUGIN_PACKAGE_NAME = 'dsh-deepseek-vision'

/** Shipped profile template bundles, mirrored from the official
 * dsh-app-boot PROFILE_TEMPLATES (dsh 0.1.0-rc.5/rc.6). */
export function templateBundles(profile) {
  if (profile === 'web') return ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (profile === 'headless') return ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  return ['@deepseek-ai/dsh-base']
}

/** The official profile manifest shape for a freshly initialized profile. */
export function freshManifest(profile) {
  return {
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...templateBundles(profile)] } },
  }
}

/** The official pnpm-workspace.yaml content the launcher writes for profiles
 * (pnpm ≥10 reads settings from there, not .npmrc). */
export const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/** The official initial user patch layer content (an empty top-level list). */
export const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

/** True when the text carries patch content — at least one non-comment,
 * non-blank line — as opposed to only the template header (or nothing). */
export function hasPatchContent(text) {
  return text.split('\n').some((line) => {
    const trimmed = line.trim()
    return trimmed !== '' && !trimmed.startsWith('#')
  })
}

/** Restore the valid empty-list document when the text carries no patch
 * content. The dsh loader rejects a user patch layer that is not a
 * top-level YAML array, so a comments-only (or empty) document must end
 * with `[]`. */
export function ensureArrayDocument(text) {
  if (hasPatchContent(text)) return text
  const trimmed = text.trim()
  return trimmed.length === 0 ? '[]\n' : `${trimmed}\n[]\n`
}

/**
 * Strip this plugin's legacy managed block from the profile's user patch
 * layer. A missing end marker consumes through end-of-file (the block was
 * truncated, so the remainder is all ours to drop). An empty or
 * comments-only remainder becomes the valid empty-list document.
 * @returns the replacement text and whether a block was removed.
 */
export function stripManagedBlock(text) {
  const start = text.indexOf(PATCH_START)
  if (start === -1) return { text, removed: false }
  const end = text.indexOf(PATCH_END, start)
  const tail = end === -1 ? text.length : end + PATCH_END.length
  const rest = text.slice(0, start) + text.slice(tail)
  if (!hasPatchContent(rest)) return { text: ensureArrayDocument(rest), removed: true }
  return { text: `${rest.trim()}\n`, removed: true }
}

/**
 * Ensure a package name is listed in `dsh.profile.bundles` (appended in
 * dependency order). Mirrors the official reconcilePlugins for a dependency
 * known to declare `dsh.bundle.patch`. Returns the (possibly new) manifest
 * and whether it changed.
 */
export function ensureBundle(manifest, packageName) {
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  if (bundles.includes(packageName)) return { manifest, changed: false }
  const next = {
    ...manifest,
    dsh: { ...manifest?.dsh, profile: { ...manifest?.dsh?.profile, bundles: [...bundles, packageName] } },
  }
  return { manifest: next, changed: true }
}

/** Remove a dependency-managed package name from `dsh.profile.bundles`. */
export function removeBundle(manifest, packageName) {
  const bundles = manifest?.dsh?.profile?.bundles
  if (bundles === undefined || !bundles.includes(packageName)) return { manifest, changed: false }
  const next = {
    ...manifest,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: bundles.filter(b => b !== packageName) } },
  }
  return { manifest: next, changed: true }
}
