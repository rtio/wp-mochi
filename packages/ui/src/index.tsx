/**
 * Mochi — classic-mode mount entry.
 *
 * Two mount responsibilities, both on DOMContentLoaded:
 *
 *   1. ALWAYS: inject a body-level floating container and render StagePanel
 *      into it. StagePanel handles its own hide/restore logic and swaps to
 *      a PeekHandle when minimized. This gives us the Clippy-style presence
 *      on every admin screen.
 *
 *   2. CONDITIONAL: if the Mochi menu page rendered an #mochi-settings
 *      div, mount InspectorPanel into it. That div only exists on the menu page,
 *      so this branch no-ops everywhere else.
 *
 * In the routes/ migration, this file is deleted; StagePanel and InspectorPanel
 * get wrapped in route exports instead. See docs/MIGRATION-TO-ROUTES.md.
 */

import { createElement, createRoot } from '@wordpress/element';
import { StagePanel } from './StagePanel';
import { InspectorPanel } from './InspectorPanel';

const FLOATING_CONTAINER_ID = 'mochi-floating-root';

function mountFloatingPet() {
	// Avoid double-mounting if this script is somehow enqueued twice.
	if ( document.getElementById( FLOATING_CONTAINER_ID ) ) {
		return;
	}

	const host = document.createElement( 'div' );
	host.id = FLOATING_CONTAINER_ID;
	host.style.cssText = [
		'position: fixed',
		'bottom: 20px',
		'right: 20px',
		'z-index: 99999',
		// Let clicks pass through the wrapper to the actual widget/peek elements;
		// each child sets pointer-events: auto explicitly.
		'pointer-events: none',
	].join( ';' );
	document.body.appendChild( host );

	createRoot( host ).render( createElement( StagePanel ) );
}

function mountSettingsPanel() {
	const settingsEl = document.getElementById( 'mochi-settings' );
	if ( settingsEl ) {
		createRoot( settingsEl ).render( createElement( InspectorPanel ) );
	}
}

function mount() {
	mountFloatingPet();
	mountSettingsPanel();
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', mount );
} else {
	mount();
}
