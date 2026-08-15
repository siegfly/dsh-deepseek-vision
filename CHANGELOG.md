# Changelog

All notable changes to dsh-vl-gateway are documented here.

The plugin follows dsh's bundle publishing conventions: each release ships the built
`lib/`, the build-anchor stamp (`lib/build-anchor.json`), and the bundle patch
(`cordis.patch.yml`, declared via `dsh.bundle.patch`). `dshCompat.anchorVersion`
records the dsh version the committed `lib/` was built against — provenance, not an
install gate: every install rebuilds the plugin against the target machine's own dsh,
so releases keep installing on newer (or older) official dsh.

## 0.1.0 (v0.1.0-dsh-rc5)

- Official bundle mechanism: `dsh.bundle.patch` + shipped `cordis.patch.yml`; install
  via `dsh plugin add` (official CLI) or `pnpm install-profile` (equivalent replica
  without the CLI), both reconciling `dsh.profile.bundles`; legacy managed patch
  blocks in the profile's own `cordis.patch.yml` are migrated away automatically
  (a comments-only patch layer left by an earlier migration is healed back to
  the valid empty list).
- Install-permissive releases: target-dsh differences from the anchor are advisory
  (check-compat exit 1, proceeds) — only an unbuilt release (missing stamp, exit 2)
  or a drifted client-preset replica (exit 3) refuses; `DSH_VL_GATEWAY_STRICT=1`
  opts conservative users into refusing on any difference.
- npm-only machine support: manifest-driven type/runtime resolution (schemastery
  `.mjs`/`.cjs`, client halves' `lib/types/client`), and client specs self-skip when
  the official client runtime has no Node-runnable form (npm publishes it
  browser-only); checkout machines run all 80 tests.
- pnpm 11 profile quirks: `remove` only when a link exists; a non-zero `add` exit
  with a linked plugin on disk is tolerated (ignored native build scripts).
- Verified end-to-end against npm `@deepseek-ai/dsh@0.1.0-rc.6` from a fresh clone
  with no source checkout: build, 68 tests (+12 designed skips), advisory
  check-compat, install.
- CI matrix (ubuntu / windows / macOS): checkout-mode drift canary plus the
  installed-mode foreign-machine path.
- Live config: provider/displayName hot re-registration, image-limit fast-fail
  (`IMAGE_TOO_LARGE`), LRU description cache with truthful provenance stamps.
