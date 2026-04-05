# Migration back to `routes/` (when `@wordpress/build` supports it)

This document captures the exact file-level delta needed to migrate Mochi from the current classic `add_menu_page` layout back to the experimental `routes/` layout of `@wordpress/build`, once the two blockers identified in [`docs/WP-BUILD-FEEDBACK.md`](./WP-BUILD-FEEDBACK.md) are resolved upstream.

The code has been deliberately structured so that this migration is mechanical: the panel *components* (`StagePanel`, `InspectorPanel`) are pure and live in files that do not move. Only the thin wrappers around them (the mount entry, the route exports, the PHP menu registration) change.

## Prerequisite

Upstream `@wordpress/build` must support at least:
- Using `packageJson.name` (not `@{packageNamespace}/{folderName}`) as the script-module ID for local packages, OR an explicit config override for module IDs.
- Inlining a node-modules dependency into a local package bundle instead of externalizing it — e.g. a `wpPlugin.inlineModules` list that the externals plugin consults before deciding whether to externalize.

Without both, there is no path to registering `@wordpress/boot` as a script module under the ID the generated `page-wp-admin.php` template hardcodes, and `initSinglePage` cannot resolve. See feedback doc for details.

There is also a layer-2 prerequisite out of our hands: WordPress core (or Gutenberg as a plugin) must register `@wordpress/boot`'s transitive `@wordpress/*` dependencies (`components`, `data`, `editor`, `core-data`, `commands`, `lazy-editor`, ...) as script modules. Until then, even a working boot bundle will fail at runtime trying to resolve those imports.

## File-by-file delta

### Files to **delete**

```
packages/ui/package.json
packages/ui/src/index.tsx
includes/admin.php
```

These three files are the entire classic-layout contribution. `StagePanel.tsx` and `InspectorPanel.tsx` do **not** get deleted — they move.

### Files to **move**

```
packages/ui/src/StagePanel.tsx     →  routes/mochi/StagePanel.tsx
packages/ui/src/InspectorPanel.tsx →  routes/mochi/InspectorPanel.tsx
```

The component bodies are unchanged. The existing `import type { PetState, Stage, Mood } from '@mochi/state'` and `import { moodOf } from '@mochi/state'` continue to work — `@mochi/state` is still a valid script module after migration, because it already declares `wpScriptModuleExports` today (we set it alongside `wpScript` for the current build; nothing needs to change in `packages/state/`).

### Files to **create**

Four tiny wrapper files + one local `packages/boot/` shim:

**`routes/mochi/package.json`**
```json
{
  "name": "@mochi/route-mochi",
  "version": "0.1.0",
  "private": true,
  "route": {
    "path": "/",
    "page": "mochi"
  }
}
```

**`routes/mochi/stage.tsx`**
```tsx
import { createElement } from '@wordpress/element';
import { StagePanel } from './StagePanel';

export function stage() {
	return createElement( StagePanel );
}
```

**`routes/mochi/inspector.tsx`**
```tsx
import { createElement } from '@wordpress/element';
import { InspectorPanel } from './InspectorPanel';

export function inspector() {
	return createElement( InspectorPanel );
}
```

**`packages/boot/package.json`** (assumes upstream Fix A — `packageJson.name` honored for module IDs)
```json
{
  "name": "@wordpress/boot",
  "version": "0.0.0-local-shim",
  "private": true,
  "wpScriptModuleExports": { ".": "./src/index.ts" }
}
```

**`packages/boot/src/index.ts`** (assumes upstream Fix B — `wpPlugin.inlineModules` list honored)
```ts
export * from '@wordpress/boot';
```

### Files to **edit**

**`package.json`** — add page declaration, add `@wordpress/boot` dep, add inline-modules list (Fix B):
```diff
 "wpPlugin": {
   "name": "mochiPlugin",
   "scriptGlobal": "mochiPlugin",
   "packageNamespace": "demo",
-  "handlePrefix": "demo"
+  "handlePrefix": "demo",
+  "pages": [
+    { "id": "mochi", "title": "Mochi" }
+  ],
+  "inlineModules": [ "@wordpress/boot" ]
 },
 "devDependencies": {
   "@mochi/state": "workspace:*",
   "@wordpress/api-fetch": "^7.43.0",
+  "@wordpress/boot": "^0.10.0",
   "@wordpress/build": "^0.11.0",
   "@wordpress/element": "^6.43.0",
   "@wordpress/env": "^11.3.0"
 },
```

**`mochi.php`** — drop the `admin.php` include, because the generated `build/pages/mochi/page-wp-admin.php` now owns the menu page:
```diff
 require_once PLUGIN_DIR . '/includes/state.php';
 require_once PLUGIN_DIR . '/includes/rest.php';
-require_once PLUGIN_DIR . '/includes/admin.php';
```

Everything else in `mochi.php`, `includes/state.php`, `includes/rest.php`, and `includes/cli.php` stays exactly as-is. The REST API shape and the PHP state machine are layout-agnostic.

## Estimated effort once upstream lands

Roughly 15–20 minutes of mechanical work, in this order:

1. Bump `@wordpress/build` to the version that includes Fix A and Fix B, update pinned version.
2. `pnpm add -Dw @wordpress/boot`.
3. Edit `package.json` as shown above (pages + inlineModules).
4. `mv packages/ui/src/{StagePanel,InspectorPanel}.tsx routes/mochi/`.
5. Create the four wrapper files listed above.
6. `rm -rf packages/ui includes/admin.php`.
7. Edit `mochi.php` to drop the `includes/admin.php` include.
8. `pnpm install && pnpm run build` — expect the routes phase to show `✔ Built route mochi` AND `build/modules/boot/index.min.js` to actually contain `@wordpress/boot`'s code (not a proxy re-export).
9. `pnpm start`, visit `/wp-admin/admin.php?page=mochi` — should render the SPA shell with stage and inspector in their boot-layout containers.

If step 8 produces a proxy file again, Fix B is missing or misconfigured upstream. If the registry lists `@mochi/boot` instead of `@wordpress/boot`, Fix A is missing.

## Why this migration is worth keeping an eye on

The `routes/` layout gives us three things the classic layout doesn't:
1. **First-class client-side routing** — multiple routes/pages per plugin, navigated without a full reload.
2. **Wp-admin chrome opt-out** — the boot shell replaces the admin content area entirely, giving us a Gutenberg-style canvas for complex UIs.
3. **Free integration with the rest of Gutenberg's admin UI primitives** — commands, notices, component library.

None of that is necessary for Mochi, but we'd want it for anything more ambitious.
