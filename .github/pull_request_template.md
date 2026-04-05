## Summary

<!-- What does this PR do and why? Link to an issue if one exists. -->

## Test plan

- [ ] `pnpm test` — both TS and PHP suites pass locally
- [ ] `pnpm run typecheck` — no type errors
- [ ] `pnpm run lint:php` — no PHP syntax errors
- [ ] `pnpm run build` — builds clean
- [ ] Manually tested in `wp-env` (only required if the PR touches UI, admin page, REST, or CLI)

## Architecture contract

Mochi's state machine lives in two places that must stay in parity — TypeScript (`packages/state/src/index.ts`, canonical spec) and PHP (`includes/state.php`, authoritative runtime). Shared parity fixtures in `tests/fixtures/state-transitions.json` enforce the contract. If you modified any game rule (evolution thresholds, happiness/hunger math, penalties, mood ranges, stage order), check the boxes below.

- [ ] Not touching game rules, OR
- [ ] I updated `packages/state/src/index.ts`
- [ ] I updated `includes/state.php`
- [ ] I updated `tests/fixtures/state-transitions.json` if a fixture scenario was affected
- [ ] `pnpm test` still passes both sides after my changes

## Screenshots (UI changes only)

<!-- Drop before/after screenshots here if the PR changes anything visible. -->

## Notes for reviewers

<!-- Anything tricky, any tradeoffs you made, any follow-ups you're deferring. -->
