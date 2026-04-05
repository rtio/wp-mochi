# Feedback on `@wordpress/build` experimental `routes/` in standalone plugins

**Scope:** This document reports findings from attempting to use the experimental `routes/` feature of [`@wordpress/build`](https://www.npmjs.com/package/@wordpress/build) (v0.11.0) in a standalone WordPress plugin — not inside the Gutenberg monorepo. The [recent developer post](https://developer.wordpress.org/news/2026/04/wordpress-build-the-next-generation-of-wordpress-plugin-build-tooling/) explicitly asked for early feedback from plugin developers outside the monorepo, so this is an attempt to provide that.

**TL;DR.** `routes/` currently cannot work in a standalone plugin. Two of the blockers are tractable fixes inside `@wordpress/build` itself. The third is a broader runtime issue owned by WordPress core / the rest of the `@wordpress/*` package tree and is explicitly out of scope for this document.

**Repro environment:** Node 22.22.2, pnpm 10, macOS, `@wordpress/build@0.11.0`, `@wordpress/boot@0.10.0`, `@wordpress/env@11.3.0`. All file paths and line numbers below refer to the `0.11.0` tarball as installed into `node_modules/@wordpress/build/`.

---

## Finding 1 — The experimental `routes/` feature has no working path for non-monorepo plugins

Not a code bug, but a documentation/design gap: a plain reading of the README suggests `routes/` is a usable feature for plugin developers, but building one outside Gutenberg hits a hard runtime blocker (Finding 3) whose workaround is blocked by Findings 2a and 2b.

**Suggested mitigation:** Until Findings 2a and 2b land, the `routes/` section of the README should carry an explicit note that the feature currently depends on infrastructure only present in the Gutenberg monorepo, and is not intended for third-party plugins yet.

---

## Finding 2a — Script-module IDs are hardcoded to `@{packageNamespace}/{folderName}` instead of `packageJson.name`

### Reproduction

Create a package inside a plugin whose root `package.json` has `"wpPlugin": { "packageNamespace": "demo" }`:

```
packages/
  boot/
    package.json       # { "name": "@wordpress/boot", ... }
    src/index.ts
```

Run `pnpm run build`. Inspect `build/modules/registry.php`:

```php
return array(
  array(
    'id'    => '@mochi/boot',          // ← folder name + root namespace
    'path'  => 'boot/index',
    'asset' => 'boot/index.min.asset.php',
  ),
);
```

Expected (or at least: expressible): the `id` should be `@wordpress/boot`, matching the `name` field in the inner `package.json`.

### Code pointers

- `lib/build.mjs` around the `bundlePackage` definition (`~L481-645`) uses the folder name as `packageName` and derives the final module identifier from that plus the root plugin's `packageNamespace`.
- `lib/package-utils.mjs` (`getPackageInfoFromFile`) already reads the inner `package.json`, so the `name` field is available at the point the registry is generated.

### Why it matters

The `routes/` feature's runtime template (`templates/page-wp-admin.php.template:160`) contains a hardcoded `import("@wordpress/boot")`. A plugin author who needs to ship their own copy of `@wordpress/boot` (because `@wordpress/build` does not build it from `node_modules` — see Finding 2b) cannot register a local module under that ID through normal tooling. The folder could be renamed to `boot`, but the resulting ID is `@{namespace}/boot`, which does not match.

### Proposed fix

Prefer `packageJson.name` when present, falling back to the current `@{namespace}/{folder}` convention when it's absent. This is backward-compatible for Gutenberg's own packages, since their folder names match their package names by convention. Alternatively, a more conservative version: only use `packageJson.name` when the inner package explicitly declares it (which is effectively always true for published packages).

Estimated change: <15 lines in `build.mjs`, plus a test.

---

## Finding 2b — The externals plugin unconditionally externalizes `@wordpress/*` packages that declare `wpScriptModuleExports`, with no opt-out

### Reproduction

In the same plugin as Finding 2a, make `packages/boot/src/index.ts` a thin re-export shim:

```ts
export * from '@wordpress/boot';
```

Run `pnpm run build`. Inspect the built bundle at `build/modules/boot/index.min.js`:

```js
export*from"@wordpress/boot";
```

The entire build output is the re-export statement. `@wordpress/boot`'s source was not inlined, because the externals plugin in `lib/wordpress-externals-plugin.mjs:225-261` inspects the upstream package's `wpScriptModuleExports` field and returns `{ external: true }` — which is correct for most consumer cases but leaves no escape hatch for the "I am deliberately shadowing this package with a local workspace module" case.

Consequence: even if Finding 2a is fixed and the module registers under the correct ID `@wordpress/boot`, the bundled file contains nothing but a re-export of a module that is itself `@wordpress/boot`, creating a circular self-import that no module loader can resolve.

### Code pointers

- `lib/wordpress-externals-plugin.mjs:225-261` — the `onResolve` callback that externalizes script modules.
- The "both declared" special case at `lib/wordpress-externals-plugin.mjs:230-234` handles packages that are both `wpScript` and `wpScriptModuleExports`, but it does not handle the "consumer wants to inline this" case.

### Why it matters

This is the structural blocker for the routes feature outside Gutenberg. The Gutenberg monorepo doesn't hit it because its `packages/boot/` is a first-class source package — esbuild walks into its source tree and bundles it normally, never triggering the `@wordpress/*` externalization filter because the package resolves as a workspace sibling rather than via `node_modules`.

### Proposed fix

Add a `wpPlugin.inlineModules` array in the root `package.json` that the externals plugin consults before externalizing:

```json
{
  "wpPlugin": {
    "inlineModules": [ "@wordpress/boot" ]
  }
}
```

When a package name matches an entry in this list, the externals plugin returns `undefined` from its `onResolve` callback instead of the current externalization short-circuit, causing esbuild to resolve and bundle normally from `node_modules`. This is additive and backward-compatible.

Estimated change: ~20 lines in `wordpress-externals-plugin.mjs` plus a config plumb-through in `build.mjs` plus a test.

---

## Finding 2c (bonus) — A classic script (`wpScript: true`) that depends on a module-only package (`wpScriptModuleExports` only) produces a broken bundle

### Reproduction

```
packages/state/package.json   →  { "wpScriptModuleExports": { ".": "./src/index.ts" } }
packages/ui/package.json      →  { "wpScript": true, "main": "src/index.tsx" }
packages/ui/src/index.tsx     →  import { moodOf } from '@mochi/state';
```

Run `pnpm run build`. Inspect `build/scripts/ui/index.min.js`:

```js
var $ = (e => typeof require < "u" ? require : ... throw Error('Dynamic require of "'+e+'" is not supported') ...)(...);
var E = $("@mochi/state"), /* ... */;
```

The esbuild-injected `require` shim throws at runtime in the browser — the script cannot load. The externals plugin in `onResolve` returns `{ path, external: true }` for `@mochi/state` without considering that the current build's `buildFormat` is `iife`, which cannot contain ESM `import` statements. Esbuild falls back to its dynamic-`require` shim, which is a browser-runtime crash.

**The bug is in the externals plugin's branch selection logic at `lib/wordpress-externals-plugin.mjs:225-261`.** When a dependency declares only `wpScriptModuleExports` (not `wpScript`), the plugin marks it as a script module and externalizes it regardless of whether the *consumer* is a script or a module. For consumers building in `iife` format, this is unsafe.

### Workaround we applied

Make `packages/state/` declare **both** `wpScript: true` **and** `wpScriptModuleExports`. The "both declared" branch (`L230-234`) then correctly selects based on `buildFormat` and the iife consumer gets a proper window-global external. The side effect is that `@mochi/state` is emitted into both `build/scripts/` and `build/modules/`, one of which is unused in the current layout — harmless but wasteful.

### Proposed fix

When the externals plugin is asked to externalize a script-module-only dependency inside an `iife` build, it should either:

a) Refuse the import and emit a build error with a clear message ("classic scripts cannot consume script-module-only packages, declare `wpScript: true` on [package] or change the consumer to `wpScriptModuleExports`"), or

b) Fall through to esbuild's normal resolution so the module is bundled in place.

Option (a) is safer and more informative. Either is better than the current behavior, which produces a bundle that looks successful at build time and crashes on load.

Estimated change: ~10 lines in `wordpress-externals-plugin.mjs` plus a test.

---

## Finding 3 — Out of scope for `@wordpress/build`: transitive `@wordpress/*` module dependencies are not registered by WordPress core

Even if Findings 2a, 2b, and 2c are fixed, the `routes/` feature would still not work in a standalone plugin. `@wordpress/boot@0.10.0` declares 23 `@wordpress/*` peer dependencies: `components`, `data`, `editor`, `core-data`, `commands`, `lazy-editor`, `route`, `admin-ui`, `element`, `a11y`, `block-editor`, `compose`, `dataviews`, `dom`, `html-entities`, `i18n`, `icons`, `keyboard-shortcuts`, `keycodes`, `notices`, `primitives`, `private-apis`, `theme`. At runtime, its code expects several of these to be available as registered **script modules** in the browser, not classic `window.wp.*` globals.

WordPress core currently registers only a small subset of `@wordpress/*` packages as script modules (notably `@wordpress/interactivity`). Gutenberg-the-plugin registers more. Neither registers all 23.

This is a coordination problem between `@wordpress/boot`, `@wordpress/*` package maintainers, and WordPress core — **not** a `@wordpress/build` problem. We raise it here only so the scope of the tooling fixes is clear: Findings 2a/2b/2c unblock the *tooling* story for standalone plugins; Finding 3 remains the runtime blocker until core and/or the rest of the `@wordpress/*` tree catch up.

**Suggested direction** (not a concrete proposal, just a note for the WP team's consideration): `@wordpress/boot` could ship an optional "standalone bundle" build target that inlines its transitive module dependencies into a single pre-built module, trading bundle size for portability. Each plugin that uses it would register this single module instead of depending on 23 unregistered siblings.

---

## How to reproduce everything above

The minimal reproduction is available in this repository at the commit that introduced `docs/WP-BUILD-FEEDBACK.md`. To re-run it against a hypothetical fixed version of `@wordpress/build`:

```bash
pnpm install
pnpm run build
```

Then consult [`docs/MIGRATION-TO-ROUTES.md`](./MIGRATION-TO-ROUTES.md) for the exact file-level deltas to turn the current classic layout back into a `routes/` layout. That document is also a test plan: once the fixes land, follow its steps, and if any of them produce the failure modes described above, the fix is incomplete.

---

## Priority hint (entirely our opinion)

1. **Finding 2c** first — it's a latent crash in the current release that any plugin mixing `wpScript` and `wpScriptModuleExports` packages can hit accidentally, unrelated to `routes/`. The workaround is non-obvious and the failure mode is "works in build, crashes in browser."
2. **Finding 2a** second — small, purely additive, unblocks legitimate workspace shadowing patterns even outside the `routes/` use case.
3. **Finding 2b** third — the `routes/` unblock, but only useful to a small audience until Finding 3 is addressed.
