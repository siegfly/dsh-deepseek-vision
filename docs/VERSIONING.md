# Version Alignment Policy

How `dsh-vl-gateway` decides whether an install on an arbitrary machine may proceed,
and when the author must ship a new release.

## The core promise

The plugin's runtime `@deepseek-ai/*` imports resolve from **the target machine's own dsh
install** (the official healed fallback under `$DSH_HOME/profiles/node_modules`), and the
install script **rebuilds the plugin on the target machine, with the target machine's own
dsh types, before checking anything**. Therefore a release pins no official dsh version:
a machine running a newer (or older) official dsh can install it, and a successful build
is itself the compatibility proof. If a future official release changes an API this
plugin uses, the target build fails with a clear tsc error — only then is a new release
needed. The author never has to follow official upgrades.

## Provenance, not an install gate

- `package.json → dshCompat.anchorVersion` (currently `0.1.0-rc.5`) declares the build
  provenance of the committed `lib/`. It is **not** an install gate.
- `pnpm build` writes the actually resolved harness dsh version into the committed
  `lib/build-anchor.json`. The stamp makes provenance impossible to fake: a release whose
  `lib/` was never built simply has no stamp.

## The compatibility check

`node scripts/check-compat.mjs [dshHome]` reads the actual versions of `dsh`, `dsh-llm`,
`dsh-llm-deepseek`, and `dsh-client-ui-settings-plugins` under
`$DSH_HOME/profiles/node_modules` and grades them:

| Grade | Exit code | Meaning | Installer behavior |
| --- | --- | --- | --- |
| exact match | `0` | target dsh equals the anchor | proceed |
| any difference | `1` | different rc on the same line, or a different line | advisory, proceed |
| stamp missing | `2` | the release was never built — a broken release artifact | refuse |
| preset drift | `3` | the frozen client bundle preset replica differs from the official preset (only checkable with an official source checkout present) | refuse |

Env overrides: `DSH_VL_GATEWAY_FORCE=1` forces past grades 2/3;
`DSH_VL_GATEWAY_STRICT=1` also refuses on the advisory grade 1.

`install-profile` runs this check as its gate: exit 2/3 refuse to replace a working
install; exit 1 proceeds and keeps the advisory note.

## The frozen client preset replica

The official client bundle preset (`packages/client/tsdown.client.ts`) is unpublished, so
version numbers cannot reveal drift in it. This repo freezes a replica of that preset in
`tsdown.config.ts` (module-table external list, purity regexes, the `__ModuleLoader__`
handoff banner/footer). When an official source checkout is present (`$DSH_CHECKOUT` or
`harness-paths.json`), check-compat diffs the replica against the checkout. Drift means a
new platform module would be inlined (dual-instance risk) or a purity gate changed
(uncontrolled cross-imports) — exit 3, update the replica and rebuild first. This is the
only official change that requires author follow-up; the checkout / CI catches it early.

## When a new release is actually needed

Only two cases:

1. a new official release changes an API this plugin uses, so the target build fails —
   adapt the code, then release;
2. the official client bundle preset drifts — update the frozen replica, rebuild, release.

"Official bumped a version number" alone is never a release reason: target machines
rebuild against their own dsh automatically.

## Tagging

Tag each release `v<plugin-version>-dsh-rc<N>` (e.g. `v0.1.0-dsh-rc5`). The tag is a
frozen historical label that never needs to follow official updates. Pushing the tag
triggers the release workflow (npm publish with provenance + GitHub Release).
