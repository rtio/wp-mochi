# Draft: Gutenberg issue about `@wordpress/build` routes/ support

This is a pre-written GitHub issue ready to file on [WordPress/gutenberg](https://github.com/WordPress/gutenberg/issues) whenever you're ready. It's a condensed version of [`WP-BUILD-FEEDBACK.md`](./WP-BUILD-FEEDBACK.md), focused on the two tractable fixes inside `@wordpress/build` itself (the third layer is a WP-core coordination problem explicitly noted as out of scope).

## How to file

Review the title and body below. When satisfied, file it:

```sh
gh issue create \
  --repo WordPress/gutenberg \
  --title "@wordpress/build: Two tractable fixes for routes/ support in standalone plugins (non-monorepo)" \
  --body-file docs/WP-BUILD-GUTENBERG-ISSUE.md
```

(The command above would file this *entire* file as the body, which includes the filing instructions you're currently reading. Before filing, either extract just the `## Issue body` section into a temporary file and point `--body-file` at that, or edit this file to remove the meta sections.)

---

## Title

```
@wordpress/build: Two tractable fixes for routes/ support in standalone plugins (non-monorepo)
```

## Suggested labels

Leave labeling to maintainers rather than guess — the Gutenberg triage team has conventions you don't want to fight. If you want to suggest something, `[Package] @wordpress/build` and `[Type] Enhancement` feel right.

## Issue body

---

**Context**

I've been exploring the experimental `routes/` feature of [`@wordpress/build`](https://www.npmjs.com/package/@wordpress/build) (v0.11.0) from a standalone WordPress plugin — not inside the Gutenberg monorepo — following the call for early feedback in [the WordPress Developer News post](https://developer.wordpress.org/news/2026/04/wordpress-build-the-next-generation-of-wordpress-plugin-build-tooling/).

Repro repo: https://github.com/rtio/wp-mochi

I hit three structural blockers. Two are tractable fixes inside `@wordpress/build` itself. The third is a broader runtime issue (transitive `@wordpress/*` script-module registration in WP core) that's explicitly out of scope for this issue — I raise it only so the scope is clear.

---

**Finding 1 — Module IDs in the generated registry are hardcoded to `@{packageNamespace}/{folderName}`, ignoring `packageJson.name`.**

In `lib/build.mjs`, `bundlePackage()` derives the module registry `id` from the root plugin's `wpPlugin.packageNamespace` config and the package folder name. The inner `package.json`'s `name` field is never consulted. This means you can't ship a local workspace shim for a published `@wordpress/*` module (e.g. `@wordpress/boot` for the routes runtime), because you can't register the local module under the ID the route template hardcodes.

Reproduction:

```json
// packages/boot/package.json
{ "name": "@wordpress/boot", "wpScriptModuleExports": { ".": "./src/index.ts" } }
```

Build output: `build/modules/registry.php` contains `'id' => '@my-plugin/boot'` (derived from the root `packageNamespace`), not `'id' => '@wordpress/boot'` (the inner `name` field).

**Proposed fix:** prefer `packageJson.name` when present; fall back to the `@{namespace}/{folder}` convention when absent. Backward-compatible because Gutenberg's own packages happen to follow the convention. ~10-line change, plus a test.

---

**Finding 2 — The externals plugin unconditionally externalizes `@wordpress/*` packages that declare `wpScriptModuleExports`, with no opt-out.**

In `lib/wordpress-externals-plugin.mjs:225-261`, the `onResolve` callback returns `{ external: true }` for any import of a script-module-declaring package. This is correct for most consumer cases, but it leaves no path for the "I am deliberately shadowing this package with a local workspace module whose source I want bundled in" pattern. Combined with Finding 1, this means even an ideally-configured local `@wordpress/boot` shim produces a bundle containing only `export * from "@wordpress/boot"` — a circular self-reference that can't resolve at runtime.

**Proposed fix:** add a `wpPlugin.inlineModules: string[]` config field that the externals plugin consults before externalizing. When a package name matches an entry in this list, the plugin returns `undefined` from its `onResolve` callback, letting esbuild bundle the source normally. Additive, backward-compatible. ~20 lines plus a test.

```json
// package.json
{
  "wpPlugin": {
    "inlineModules": ["@wordpress/boot"]
  }
}
```

---

**Finding 3 (bonus — a latent runtime crash unrelated to routes/)**

A classic script (`wpScript: true`) that imports from a module-only package (`wpScriptModuleExports` only) produces a bundle that crashes in the browser. The externals plugin marks the dependency as `external: true` regardless of the consumer's build format. In `iife` format, esbuild falls back to a dynamic-`require` shim that throws `Error('Dynamic require of "..." is not supported')` at load time. The build reports success; only the browser shows the failure.

Reproduction:

```json
// packages/state/package.json
{ "wpScriptModuleExports": { ".": "./src/index.ts" } }
```

```json
// packages/ui/package.json
{ "wpScript": true, "main": "src/index.tsx" }
```

```ts
// packages/ui/src/index.tsx
import { somethingFromState } from '@my-plugin/state'; // ← crashes in browser
```

**Workaround I applied:** declare **both** `wpScript: true` and `wpScriptModuleExports` on any local package that's consumed by a classic script. The "both declared" branch at `wordpress-externals-plugin.mjs:230-234` correctly picks the iife path. The cost is emitting the package into both `build/scripts/` and `build/modules/`, one of which is unused in the current layout — harmless but wasteful.

**Proposed fix:** either emit a clear build-time error when a classic script tries to import a module-only package, or fall through to esbuild's normal resolution and let the module get bundled in place. Either is better than the current silent-then-crash behavior.

---

**Out of scope: transitive `@wordpress/*` script-module registration in WP core**

Even with Findings 1 and 2 landed, a standalone plugin using `routes/` would still fail at runtime because `@wordpress/boot@0.10.0` declares 23 `@wordpress/*` peer dependencies (`components`, `data`, `editor`, `core-data`, `commands`, `lazy-editor`, ...). Its code expects several of these to be available as registered **script modules** at runtime, and WP core currently registers only a handful as modules (notably `@wordpress/interactivity`) — the rest are still classic `wp.*` globals. This is coordination work across core and the `@wordpress/*` package tree, not a `@wordpress/build` concern. I note it here only so the scope of the tractable fixes is clear.

---

**Reproduction**

The [rtio/wp-mochi](https://github.com/rtio/wp-mochi) repo contains a working standalone plugin built on `@wordpress/build`. It currently uses the classic `add_menu_page` layout (not `routes/`) and includes [`docs/MIGRATION-TO-ROUTES.md`](https://github.com/rtio/wp-mochi/blob/main/docs/MIGRATION-TO-ROUTES.md) — the exact file-level delta that would be needed to migrate to `routes/` once these fixes land. That makes the repro also a test plan: follow the migration doc, and any failure mode below proves the corresponding fix is still needed.

Priority hint (my opinion): Finding 3 first because it's a latent crash anyone mixing script and module packages can hit today, unrelated to `routes/`. Finding 1 second because it's small and unblocks legitimate workspace patterns beyond just boot. Finding 2 third because its value is coupled to the broader `routes/` rollout.

Happy to iterate on API shape or open PRs for Findings 1, 2, and 3 if the proposed designs are acceptable.

---

## Notes on this draft

- The title leads with the package name in brackets-prefix style, which matches how Gutenberg issues are commonly titled.
- The body cites exact file paths and line numbers in `@wordpress/build` v0.11.0 so maintainers can jump straight to the relevant code.
- The "out of scope" callout is intentional — it shows that I understand the *full* story (not just the parts I can fix) while keeping the issue focused on what can actually be actioned.
- The priority hint at the end is framed as "my opinion" rather than a demand.
- The closing offer to open PRs is standard practice — it signals you're willing to do the work, which changes how maintainers triage.

## When you file it

- Consider rewording any section that sounds too sure of itself; open-source triage responds well to humility.
- If the Gutenberg team has changed the structure of `@wordpress/build` between v0.11.0 and when you file, re-verify the line numbers. The `lib/build.mjs` line references assume `@wordpress/build@0.11.0`.
- Expect the response window to be days to weeks. Experimental-feature feedback isn't usually on the critical path.
- If maintainers ask for a PR, Findings 1 and 3 are genuinely ~10-30 line changes plus tests. Finding 2 is closer to ~30 lines. All three fit into a single weekend of focused work.
