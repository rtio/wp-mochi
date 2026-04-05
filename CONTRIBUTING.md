# Contributing to Mochi

Thanks for wanting to improve Mochi. This document covers the practical bits. For the deep architecture story — why files are where they are, which decisions are load-bearing, non-obvious gotchas about `@wordpress/build` and `@wordpress/env` — read **[AGENTS.md](AGENTS.md)** first. It's written for AI coding agents but humans benefit too.

## Development setup

```sh
git clone https://github.com/rtio/wp-mochi.git
cd wp-mochi
pnpm install
pnpm run build
```

Requirements: **Node 22** (pinned via `.nvmrc` + `package.json` `volta.node`), **pnpm 10** (pinned via `packageManager`), **PHP 8.1+** (for running tests locally), **Docker Desktop** (only if you want to run the plugin live in WordPress via `pnpm start`).

## Before submitting a PR

Run the full check suite:

```sh
pnpm test            # Both TS and PHP test suites (254 tests total)
pnpm run typecheck   # tsc --noEmit across all TS/TSX source
pnpm run lint:php    # php -l on every PHP file
pnpm run build       # Verify wp-build produces a clean output
```

CI runs exactly these checks on every push and PR. If they pass locally, they'll pass in CI.

## The architecture contract (read this)

Mochi has one architectural rule that's load-bearing: **the TypeScript state machine and its PHP mirror must stay in exact parity.** See [AGENTS.md](AGENTS.md) for the full contract, but the short version:

- `packages/state/src/index.ts` is the **canonical spec** — it's the source of truth for game rules.
- `includes/state.php` is the **authoritative runtime** — it's what actually runs on the server when users interact with the pet.
- `tests/fixtures/state-transitions.json` is the **shared parity fixture** — both test suites load it and assert the same expected outputs.

**If you change a game rule** (evolution thresholds, happiness/hunger math, overfeeding penalty, stage order, mood ranges, personality behavior), you must update all three. `pnpm test` enforces the contract — it fails loudly if TS and PHP disagree on any scenario in the shared fixtures.

**If you add a rule-agnostic feature** (new UI panel, new sprite, new personality quip, new admin page), you only need to touch the relevant files; no parity concern.

## What belongs where

| Kind of change | Where |
| --- | --- |
| Game rules / state machine | `packages/state/src/index.ts` + `includes/state.php` + `tests/fixtures/state-transitions.json` |
| Pure helpers (no DOM, no network) | `packages/state/src/` |
| React components | `packages/ui/src/` |
| REST endpoints | `includes/rest.php` |
| WP-CLI commands | `includes/cli.php` |
| Admin page / enqueue | `includes/admin.php` |
| Anthropic integration | `includes/ai.php` |
| Personality speech tables | `includes/state.php` (stub) + `includes/ai.php` (live prompt) |
| Page-context quips | `packages/state/src/greetings.ts` |
| Pixel-art sprites | `packages/ui/src/StagePanel.tsx` (`SPRITE_GRIDS`, `FINAL_FORMS`) |

## Style and conventions

- **No linter for JS/TS style** today (no eslint, no prettier). Match the existing code's indentation (tabs for PHP/TS, aligned by current files) and readability. Don't introduce a new style dialect in the middle of a file.
- **PHP uses WordPress coding standards** loosely (tab indentation, Yoda conditions in existing code — match surrounding style).
- **Comments should explain *why*, not *what*.** If a line is doing something non-obvious, say why. If it's obvious, don't clutter.
- **No emoji in code unless they're part of user-facing output** (sprite characters, button labels, speech bubble content).

## Non-obvious things to know

These contradict the `@wordpress/build` README and will trip up future contributors:

1. **`packages/` must be flat.** `@wordpress/build` globs `packages/*/package.json` — strictly one level. Nested scoped folders are silently skipped.
2. **Module IDs are `@{packageNamespace}/{folderName}`**, not `packageJson.name`. The inner package name is ignored for ID generation.
3. **Classic scripts (`wpScript: true`) that depend on module-only packages (`wpScriptModuleExports` only) crash at runtime.** `packages/state/` declares **both** to avoid this. Don't remove either.
4. **`@wordpress/env` doesn't auto-activate plugins reliably** — we use `lifecycleScripts.afterStart` in `.wp-env.json` to do it manually.
5. **Docker Desktop for Mac has flaky nested bind mounts.** If your plugin "disappears" after running `pnpm start`, the fix is `wp-env stop && wp-env start`. See [AGENTS.md](AGENTS.md) for the full diagnosis.

Memory of these and more is maintained in the project's agent memory system — AI sessions working in this repo inherit this knowledge automatically.

## Reporting bugs

Use the Bug Report issue template. Include WordPress version, PHP version, browser (if it's a UI bug), and the exact steps to reproduce. Browser console errors and PHP error log excerpts help a lot.

## Suggesting features

Use the Feature Request issue template. Say what problem it would solve before proposing a solution — sometimes there's a simpler fix than the one you're thinking of.

## License

By contributing you agree that your contributions will be licensed under [GPL-2.0-or-later](LICENSE), the same license as the rest of the project and WordPress itself.
