# Changelog

All notable changes to dsh-deepseek-vision are documented here.

The plugin follows dsh's bundle publishing conventions: each release ships the built
`lib/`, the build-anchor stamp (`lib/build-anchor.json`), and the bundle patch
(`cordis.patch.yml`, declared via `dsh.bundle.patch`). `dshCompat.anchorVersion`
records the dsh version the committed `lib/` was built against — provenance, not an
install gate: every install rebuilds the plugin against the target machine's own dsh,
so releases keep installing on newer (or older) official dsh.

## 0.1.6

- dsh 0.1.1-rc.1 anchor: the forwarded credential event was renamed upstream
  (`credentials/updated` → `credentials/reference-updated`); the client card now
  subscribes to the new name, so key writes on other surfaces refresh the card
  again on rc.1 hosts.
- Native vision passthrough: a model the DeepSeek catalog declares image-capable
  (the official default now advertises `deepseek-v4-flash-vision-exp`) keeps its
  images and streams through the parent adapter's native image serialization —
  higher fidelity and no VL call. The description bridge still serves text-only
  and uncatalogued models, which official dsh rejects for image input.
- Client preset replica: the frozen EXTERNALS list now mirrors the official
  `PLATFORM_MODULES` + `PRELOADED_CLIENT_EXTERNALS` (three specifiers the
  official module table no longer answers were dropped), and the drift check
  reads both arrays from `platform.ts` instead of the retired
  `RUNTIME_STORE_EXEMPTION` constant — the externals comparison is checkable
  again instead of silently unreadable.
- Tests: passthrough coverage for catalog-declared image models and the
  uncatalogued bridge fallback. (Prepared against dsh 0.1.1-rc.1; shipped as
  part of 0.1.7, whose committed `lib/` is rebuilt against rc.2 — see below.)

## 0.1.7

- Re-anchored to dsh 0.1.1-rc.2: `dshCompat.anchorVersion` → `0.1.1-rc.2` and
  the committed `lib/` rebuilt against the installed rc.2 types (`build-anchor`
  stamp: `0.1.1-rc.2`, kind `installed` — the rc.1 source checkout on this
  machine predates the rc.2 npm upgrade, so the installed profile fallback is
  the build source). check-compat now grades the target an exact match again
  (previously an advisory rc.1→rc.2 difference).
- **rc.2 generation-binding fix**: `DeepSeekAdapter.prepareCall` changed BOTH
  of its seams in 0.1.1-rc.2, and each silently broke the gateway route if
  left inherited. It now (1) resolves the call generation through
  `modelInfoFor()` directly instead of the virtual `resolveModel` — and the
  llm runtime projects images to placeholder text for any call-prep result
  whose `inputModalities` exclude image, so the route's image claim made in
  `resolveModel`/`listModels` was bypassed and images never reached the
  bridge; and (2) binds the dispatch to the parent's `streamWithConnection`
  instead of the virtual `stream()`, so the bridge/passthrough decision never
  ran and a text-only model's image died in the parent's
  `UNSUPPORTED_CONTENT` admission gate. `VisionGatewayAdapter.prepareCall`
  now re-asserts `GATEWAY_INPUT_MODALITIES` on the prepared model and rebinds
  the virtual dispatch (the rc.1 base-class behavior the plugin was built
  against): passthrough-vs-description still reads the parent catalog, and
  live connection facts still reach the wire.
- Native wire under rc.2: the parent's image serialization now resolves the
  request version through the attachment store's new `readImageRequest(ref,
  policy, signal)` seam (Files-API upload first, inline-base64 fallback); the
  plugin injects the durable `ctx.attachments`, so passthrough works on rc.2
  hosts unchanged. The official rc.2 catalog still advertises
  `deepseek-v4-flash-vision-exp`, so the passthrough path is unchanged.
- Tests: the runtime-level bridge tests (index/credentials) now pass against
  rc.2's dispatch path, the adapter mocks implement the rc.2
  `readImageRequest` shape, the streaming DeepSeek mock answers the Files-API
  leg deterministically, and one new regression test streams a
  catalog-declared image model through the RUNTIME dispatch to prove the
  `prepareCall` claim reaches the native wire with the VL leg untouched
  (111 tests: 99 passing + 12 designed skips).
- Docs: README badges/version mentions and the Version-Alignment anchor text
  follow the new release and anchor.

## 0.1.5

- Credentials: align both gateway legs with the official rc.8 boundary. A mounted
  `credentials` service is authoritative, including when it resolves no value;
  only a profile without that service reads the launch environment directly.
  `credentials-local` retains its official precedence: read-only process environment
  first, GUI-managed `.credentials.yaml` second, then `.env` fallback.
- dsh 0.1.0-rc.7 compatibility: `settings.plugin.item` became a keyed slot (keyed by
  the settings namespace) in rc.7, whereas rc.6 declared it as a `list` (id + order).
  The card now registers once with BOTH shapes — `key` for rc.7, `id` + `order` for
  rc.6 — so the same built bundle installs on either official version (the loader
  validates only the field matching its declared kind and stores the rest). Anchor
  bumped to `dsh@0.1.0-rc.7`; the committed `lib/` was rebuilt against it.
- Docs: READMEs now explain how to install the `dsh` CLI itself on a new machine
  (global `npm install -g @deepseek-ai/dsh` vs. the `npx @deepseek-ai/dsh web`
  one-liner), warn that the npx form does **not** put `dsh` on PATH (fresh terminals
  fail with "command not found" unless commands are prefixed with
  `npx @deepseek-ai/dsh`), and gain a FAQ entry covering it.

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
