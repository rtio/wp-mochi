# Mochi

A Clippy-style Tamagotchi pet for the WordPress admin. Lives in the bottom-right corner of every admin screen, reacts to what you're doing, comments on your posts, and evolves through five pixel-art stages. Speech can be either canned (four hand-written personality tables) or live from the Anthropic API if you paste a key in the settings.

Built primarily as a sandbox for the new [`@wordpress/build`](https://www.npmjs.com/package/@wordpress/build) plugin tooling. Most of the interesting engineering in this repo is the tooling exploration, not the pet itself — see [`docs/WP-BUILD-FEEDBACK.md`](docs/WP-BUILD-FEEDBACK.md) for three structural findings about the tool that were encountered and documented along the way.

## Highlights

- **Pink pixel-art robot** with five evolution stages (`egg → hatchling → chick → chonk → final_form`) — the final form is personality-branched, four distinct silhouettes.
- **Four personalities** — grumpy, chipper, deadpan, dramatic — that drive speech, idle quips, and page-context reactions.
- **Clippy-style presence** — floats on every admin screen, minimizable to a peek handle, persistent across navigation via `localStorage`.
- **Graceful AI fallback** — if no Anthropic key is configured, or the key fails, or the network is down, the pet falls back to hand-written stub speech and the UI never blocks.
- **WP-CLI commands** — `wp mochi {show|feed|pet|ignore|reset|personality|set_stage}` for dev and scripted play.
- **REST API under `mochi/v1`** — all routes gate on `manage_options`; the API key is write-only over REST.
- **254 tests** covering both the TypeScript state machine and its PHP mirror, including shared JSON fixtures that enforce drift-free parity across the two implementations.

## Status

Pre-v1, experimental. Don't run this on a production WordPress site — the Anthropic API key is stored in `wp_options` as plaintext (documented in the settings UI), and there are gaps that would need filling before anything resembling a wordpress.org release. See [AGENTS.md](AGENTS.md) for the full architecture contract and the known-gaps list.

## Screenshots

<!-- Screenshots pending — see docs/screenshots/README.md for instructions
     on capturing them from a working dev environment. Once captured,
     reference them here:

     ![Mochi in the admin corner](docs/screenshots/stage.png)
     ![Settings page](docs/screenshots/settings.png)
     ![Final form variants](docs/screenshots/final-forms.png)
-->

For now, imagine a pink pixel robot squatting in the bottom-right corner of your wp-admin, judging your drafts.

## Install (end user)

Download the latest `mochi-vX.Y.Z.zip` from the [Releases page](../../releases/latest), then in `wp-admin`:

1. **Plugins → Add New → Upload Plugin**, choose the zip, install, activate.
2. The pink robot appears in the bottom-right corner of every admin page.
3. Click **Mochi** in the sidebar → paste an Anthropic API key if you want in-character lines from Claude. Without a key, Mochi uses hand-written stub speech and still works fully.

## Develop

Requirements:

- **Node 22** (pinned via `.nvmrc` and `package.json` `volta.node`)
- **pnpm 10** (pinned via `packageManager`)
- **Docker Desktop** (for `wp-env` — only needed to actually run the plugin in WordPress)
- **PHP 8.1+** (for local test runner — tests run without wp-env)

```sh
git clone https://github.com/rtio/wp-mochi.git
cd wp-mochi
pnpm install
pnpm run build
pnpm start             # builds and boots WordPress at http://localhost:8888
                       # admin / password
```

If the Mochi menu doesn't show up after `pnpm start`, the `.wp-env.json` lifecycle hook should auto-activate it — if it didn't, activate manually:

```sh
pnpm run env:cli -- plugin activate demo
```

(The plugin slug inside WordPress is `demo`, derived from the directory name. The human-facing name is Mochi.)

See [AGENTS.md](AGENTS.md) for the full project structure, architecture contract, and non-obvious gotchas about `@wordpress/build` and `@wordpress/env` that this repo has uncovered.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install deps |
| `pnpm run build` | One-shot production build into `build/` |
| `pnpm dev` | `wp-build --watch` for incremental rebuilds during development |
| `pnpm start` | Build, then boot WordPress at http://localhost:8888 |
| `pnpm run env:stop` | Stop containers |
| `pnpm run env:destroy` | Remove containers, volumes, networks |
| `pnpm run env:cli -- <args>` | Pass-through to WP-CLI, e.g. `pnpm run env:cli -- mochi feed` |
| `pnpm test` | Full test suite — both TS and PHP parity tests |
| `pnpm run typecheck` | `tsc --noEmit` across all source |
| `pnpm run lint:php` | `php -l` on every PHP file |

## Tests

```sh
pnpm test
```

Runs in under a second. Two suites:

- **TypeScript** via Vitest (`packages/state/src/*.test.ts`) — state machine unit tests, greeting/quip table tests, shared-fixture parity tests.
- **PHP** via a dependency-free standalone script (`tests/php/state-test.php`) — mirrors every TS test against the PHP implementation of the state machine, loads the same JSON fixtures from `tests/fixtures/state-transitions.json`.

The shared fixtures mean any drift between the TS canonical spec and the PHP runtime implementation fails one side immediately. If you're modifying game rules, update the TS first, the PHP mirror second, the fixture file third. `pnpm test` will tell you loudly if any step is skipped.

## Project structure

```
mochi.php                       # Plugin bootstrap
includes/
  state.php                     # PHP state machine (runtime-authoritative)
  ai.php                        # Anthropic API integration with graceful fallback
  rest.php                      # /wp-json/mochi/v1/{state,interact,reset,settings}
  admin.php                     # Menu page + site-wide script enqueue
  cli.php                       # wp mochi commands

packages/
  state/                        # TS state machine (canonical spec) + greetings
    src/
      index.ts
      greetings.ts
      index.test.ts
      greetings.test.ts
  ui/                           # React floating pet + settings panel
    src/
      index.tsx                 # Mount entry (body-level floating container)
      StagePanel.tsx            # The floating Clippy-style pet
      InspectorPanel.tsx        # Settings: personality, API key, reset, show-pet

tests/
  fixtures/state-transitions.json   # Shared parity fixtures (TS + PHP both consume)
  php/state-test.php                # PHP test runner

docs/
  MIGRATION-TO-ROUTES.md        # Exact delta to migrate to the experimental routes/ layout
  WP-BUILD-FEEDBACK.md          # Findings to feed back to the @wordpress/build team

.github/workflows/
  ci.yml                        # Build, typecheck, lint, test on every push + PR
  release.yml                   # Build zip artifact on v*.*.* tags
```

## Contributing

Issues and PRs welcome. Run `pnpm test && pnpm run typecheck && pnpm run lint:php` before submitting. CI runs the same checks on every push.

If you're touching game rules (evolution gates, happiness/hunger math, personality tables), you'll need to update all three of:

1. `packages/state/src/index.ts` — canonical spec
2. `includes/state.php` — authoritative runtime
3. `tests/fixtures/state-transitions.json` — shared parity fixtures

The test suite enforces drift protection. See [AGENTS.md](AGENTS.md) for the full architecture contract.

## License

[GPL-2.0-or-later](LICENSE) — in keeping with WordPress itself.

## Acknowledgements

- Built with [`@wordpress/build`](https://www.npmjs.com/package/@wordpress/build) and [`@wordpress/env`](https://www.npmjs.com/package/@wordpress/env).
- Speech generation via the [Anthropic API](https://www.anthropic.com/api) (optional — falls back to stub speech if unconfigured).
- Inspired equally by Tamagotchi, Clippy, and every other desktop companion that ever lovingly bothered you while you worked.
