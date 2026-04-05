<?php
/**
 * Mochi admin page registration.
 *
 * Classic-style menu page + script enqueue. This file is the server-side
 * counterpart to packages/ui/src/index.tsx — they're the only two files
 * that differ from the experimental routes/ layout. See docs/MIGRATION-TO-ROUTES.md.
 *
 * @package Mochi
 */

namespace Mochi\Admin;

const PAGE_SLUG = 'mochi';

function register_menu(): void {
	add_menu_page(
		'Mochi',
		'Mochi',
		'manage_options',
		PAGE_SLUG,
		__NAMESPACE__ . '\\render_page',
		'dashicons-pets',
		80
	);
}
add_action( 'admin_menu', __NAMESPACE__ . '\\register_menu' );

/**
 * Enqueue the UI bundle on EVERY admin page. The floating pet (Clippy-style)
 * lives in a body-level container it injects itself — see packages/ui/src/index.tsx.
 * The settings panel on the Mochi menu page is the same bundle, mounting
 * into the #mochi-settings div rendered by render_page() below when present.
 *
 * Previously this gated on `hook === 'toplevel_page_mochi'`; dropping the
 * gate is the core of the Clippy pivot.
 */
function enqueue_assets(): void {
	wp_enqueue_script( 'mochi-ui' );
}
add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_assets' );

/**
 * Settings / configuration page for Mochi.
 *
 * The pet itself lives in the corner of every admin screen; this page is
 * where you set your Anthropic API key, pick a personality, and reset.
 * React mounts InspectorPanel into #mochi-settings.
 */
function render_page(): void {
	?>
	<div class="wrap">
		<h1 style="margin-bottom: 0.25rem;">Mochi</h1>
		<p style="color: #50575e; max-width: 560px;">
			Your pet lives in the bottom-right corner of every admin page. If you hide it,
			the “Show pet” button below brings it back. Set your Anthropic API key here to
			get in-character speech lines from Claude instead of the fallback stub lines.
		</p>
		<div id="mochi-settings" style="max-width: 360px; margin-top: 1.5rem; background: #fff; border: 1px solid #dcdcde; border-radius: 8px;"></div>
	</div>
	<?php
}
