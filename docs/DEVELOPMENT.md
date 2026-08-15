# Development Guide

## Commands

```powershell
pnpm test      # vitest; @deepseek-ai/* resolved via vitest.config.ts + scripts/harness-paths.mjs (tests only)
pnpm build     # harness-paths --write + tsc (host face + client face) + tsdown (lib/client.js browser factory bundle)
```

`pnpm build` ends by stamping the resolved harness dsh version into the committed
`lib/build-anchor.json` (see [VERSIONING.md](VERSIONING.md)).

## Where harness types come from

`scripts/harness-paths.mjs` is the repository's only resolution seam; it hardcodes no
paths and resolves in order:

1. `$DSH_CHECKOUT` env var pointing at an official source checkout;
2. the repo-root `harness-paths.json` (`{"checkout": "<path>"}`, gitignored,
   machine-private);
3. the **installed dsh** on this machine (`$DSH_HOME/profiles/node_modules` healed
   fallback — every machine where `dsh web` ran at least once has it).

With none of the three, build/test prints guidance and stops.

## Runtime module resolution

Built artifacts keep bare `@deepseek-ai/*` import specifiers; at runtime they resolve
through the profile's healed fallback to the **same** dsh install the profile uses — one
shared cordis instance, no dual-instance problems. The type-resolution seam above affects
development only, never an installed plugin.

## Test surface on npm-only machines

The npm-published official client packages ship the client runtime only inside browser
bundles (`lib/types/client` is declarations only; there is no runnable client JS in
Node). Node cannot execute the official client runtime — official client tests need the
source checkout too. On such machines the 2 client test suites self-skip
(`tests/support/client-runtime.ts` decides); the remaining suites always run. Machines
with the official source checkout (dev machines / CI) run the full suite.

## The tsdown client preset replica

`tsdown.config.ts` replicates the behavior of the unpublished official
`packages/client/tsdown.client.ts` preset: a `window.__ModuleLoader__.load({id, factory})`
closure factory, platform modules (react / slots / runtime / client…) external so the
module table resolves them, everything else inlined. It never imports build files from
the official repo. check-compat diffs this replica against a present official checkout —
see [VERSIONING.md](VERSIONING.md).

## The rebuild loop

After code changes: `pnpm build && pnpm install-profile` (pnpm's `file:` install picks up
the new content). New or changed `dsh.client` declarations need a `dsh web` restart
(client module scanning is cached by package name).
