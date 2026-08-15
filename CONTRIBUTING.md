# Contributing

Thanks for helping make dsh-deepseek-vision better. The plugin is small and the
conventions are simple.

## Setup

1. `pnpm install` — devDeps only; `@deepseek-ai/*` is never installed here.
2. Provide ONE harness source for types and tests (see `scripts/harness-paths.mjs`):
   - `$DSH_CHECKOUT` pointing at an official dsh source checkout, or
   - a repo-root `harness-paths.json` (`{"checkout": "<path>"}`, gitignored), or
   - boot `dsh web` once on this machine (the installed healed fallback).
3. `pnpm test` — the full suite (101 tests, needs a harness source);
   `pnpm test:coverage` — the line-coverage report (97%, `src/` excluding the
   presentational `card.tsx` shell).

## Conventions

- Commits follow the existing history: `type: summary — detail`
  (`feat` / `fix` / `test` / `docs` / `ci` / `chore` / `release`).
- Behavior changes need tests — the suite is 97% line-covered; keep it there.
- The client bundle purity gate forbids cross-plugin VALUE imports
  (`tsdown.config.ts`); collaborate through cordis services only.
- User-facing copy ships in both `README.md` (中文, default) and `README.en.md`;
  card copy lives in `src/client/locales.ts` with zh/en parity enforced by the
  `Record<VlGatewayLocaleKey, string>` types.

## Layout

| Path | What |
| --- | --- |
| `src/index.ts` | plugin glue: config schema, registries, credentials, hot reload |
| `src/bridge.ts` | image→text rewrite pipeline (cache, policies, limits) |
| `src/gateway.ts` | the DeepSeek provider adapter |
| `src/vl.ts` | the VL chat-completions client |
| `src/client/*` | settings card: controller/form logic, `card.tsx` shell, locales |
| `scripts/*` | install/uninstall replicas, harness resolution, compat check |
| `tests/*` | vitest suites; `smoke-boot.spec.ts` boots the real launcher |

## Before opening a PR

- `pnpm test` and `pnpm test:coverage` green locally.
- No gitignored machine files added, no secrets — the suite only uses the
  fake `sk-*` keys under `tests/`.
