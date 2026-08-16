# Changelog

All notable changes to dsh-deepseek-vision are documented here.

The plugin follows dsh's bundle publishing conventions: each release ships the built
`lib/`, the build-anchor stamp (`lib/build-anchor.json`), and the bundle patch
(`cordis.patch.yml`, declared via `dsh.bundle.patch`). `dshCompat.anchorVersion`
records the dsh version the committed `lib/` was built against — provenance, not an
install gate: every install rebuilds the plugin against the target machine's own dsh,
so releases keep installing on newer (or older) official dsh.

## 0.1.4

- Credential fallback chain: both legs now fall through to the launching
  environment when the credentials service is mounted but has no entry for the
  referenced key (previously the environment was consulted only when no
  credentials service existed at all). Headless profiles and CI launches can now
  serve both routes from ambient keys; GUI-written credentials keep precedence.
- Tests: one new credentials-seam case covers the mounted-but-missing fallback
  (102 tests collected: 90 passing + 12 designed skips).
- Release hygiene: CHANGELOG gains the missing 0.1.3 entry; README badges follow
  the new test count and version; the `files` list ships only the docs that
  exist.

## 0.1.3

- README beautification and the coverage badge (97% lines, six new edge-path
  tests). No behavior changes. (Entry restored retroactively in 0.1.4 — the
  0.1.3 release shipped without one.)

## 0.1.2

- Docs-only refresh: the npm page now renders the Chinese-default README with the
  three-step install/deploy/uninstall quick start and all three screenshots; the Node
  prerequisite moved to the no-CLI replica path (ordinary `dsh plugin add` users do
  not need it); LICENSE year fixed. No code changes.

## 0.1.1

- Docs & discoverability: screenshots of the provider picker and the plugin settings
  card in both READMEs (rendered on the npm page too); npm keywords for search
  (`deepseek-harness`, `vision-language`, `coding-agent`); GitHub topics and repo
  description set. No code changes.

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
  browser-only); checkout machines run all 101 tests.
- pnpm 11 profile quirks: `remove` only when a link exists; a non-zero `add` exit
  with a linked plugin on disk is tolerated (ignored native build scripts).
- Real-boot smoke + seam coverage: the suite boots the official dsh launcher
  (temp `DSH_HOME`, mock DeepSeek/VL endpoints) and completes a headless task
  turn through the gateway route — installation, bundle mounting, settings
  resolution, and the wire, end to end — and boots the web profile (plugin
  bundle + client scan) until the browser UI serves HTTP. New tests cover the
  credentials service path (`MISSING_CREDENTIAL`/`INVALID_CREDENTIAL`),
  live-settings keep-last-good and directory-collision route rollback,
  config-schema rejections, and SSE streaming passthrough.
- Verified end-to-end against npm `@deepseek-ai/dsh@0.1.0-rc.6` from a fresh clone
  with no source checkout: build, 89 tests (+12 designed skips), advisory
  check-compat, install.
- CI matrix (ubuntu / windows / macOS): checkout-mode drift canary plus the
  installed-mode foreign-machine path, including an official-CLI round-trip
  (`dsh plugin --profile headless add/remove` against the real npm registry)
  and an install→uninstall→boot round-trip through the profile scripts.
- Live config: provider/displayName hot re-registration, image-limit fast-fail
  (`IMAGE_TOO_LARGE`), LRU description cache with truthful provenance stamps.
