/**
 * Mochi — inspector panel component.
 *
 * Settings: personality picker, Anthropic API key entry (write-only from
 * the client's POV), reset button. The API key is never read back through
 * the REST API; only a boolean `api_key_configured` is exposed.
 *
 * See docs/MIGRATION-TO-ROUTES.md — this component is unchanged between
 * classic and routes/ layouts.
 */

import { createElement, useEffect, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import type { Personality } from '@mochi/state';

const PERSONALITIES: Personality[] = [
	'grumpy',
	'chipper',
	'deadpan',
	'dramatic',
];

interface StateResponse {
	state: { personality: Personality };
	api_key_configured: boolean;
}

interface SettingsResponse {
	personality: Personality;
	api_key_configured: boolean;
}

export function InspectorPanel() {
	const [ personality, setPersonality ] =
		useState< Personality >( 'grumpy' );
	const [ keyConfigured, setKeyConfigured ] = useState< boolean >( false );
	const [ keyDraft, setKeyDraft ] = useState< string >( '' );
	const [ status, setStatus ] = useState< string >( '' );

	useEffect( () => {
		apiFetch< StateResponse >( { path: '/mochi/v1/state' } ).then(
			( res ) => {
				setPersonality( res.state.personality );
				setKeyConfigured( res.api_key_configured );
			}
		);
	}, [] );

	const savePersonality = async ( next: Personality ) => {
		setPersonality( next );
		await apiFetch< SettingsResponse >( {
			path: '/mochi/v1/settings',
			method: 'POST',
			data: { personality: next },
		} );
		setStatus( 'Personality saved.' );
	};

	const saveKey = async () => {
		if ( ! keyDraft ) return;
		const res = await apiFetch< SettingsResponse >( {
			path: '/mochi/v1/settings',
			method: 'POST',
			data: { api_key: keyDraft },
		} );
		setKeyConfigured( res.api_key_configured );
		setKeyDraft( '' );
		setStatus( 'API key saved.' );
	};

	const resetPet = async () => {
		if ( ! window.confirm( 'Reset your pet back to an egg?' ) ) return;
		await apiFetch( {
			path: '/mochi/v1/reset',
			method: 'POST',
		} );
		// Tell the floating widget to refetch.
		window.dispatchEvent( new CustomEvent( 'mochi:refresh' ) );
		setStatus( 'Pet reset. Fresh egg incoming.' );
	};

	const showPet = () => {
		// Whether or not it's currently hidden, dispatching show is a no-op
		// if the widget is already visible. Safer than reading localStorage here.
		window.dispatchEvent( new CustomEvent( 'mochi:show' ) );
		setStatus( 'Pet is visible in the bottom-right corner.' );
	};

	return createElement(
		'div',
		{ style: panel },
		createElement( 'h2', { style: h2 }, 'Settings' ),

		createElement( 'label', { style: label }, 'Personality' ),
		createElement(
			'select',
			{
				style: select,
				value: personality,
				onChange: ( e: React.ChangeEvent< HTMLSelectElement > ) =>
					savePersonality( e.target.value as Personality ),
			},
			PERSONALITIES.map( ( p ) =>
				createElement( 'option', { key: p, value: p }, p )
			)
		),

		createElement( 'label', { style: label }, 'Anthropic API Key' ),
		createElement(
			'p',
			{ style: warning },
			'⚠️ Stored in wp_options as plaintext. Fine for this local demo. Do not use in production.'
		),
		createElement(
			'div',
			{ style: row },
			createElement( 'input', {
				key: 'input',
				type: 'password',
				style: input,
				placeholder: keyConfigured
					? '●●●●●●●● (configured)'
					: 'sk-ant-…',
				value: keyDraft,
				onChange: ( e: React.ChangeEvent< HTMLInputElement > ) =>
					setKeyDraft( e.target.value ),
			} ),
			createElement(
				'button',
				{ key: 'save', style: button, onClick: saveKey },
				'Save'
			)
		),

		createElement( 'hr', { style: hr } ),

		createElement(
			'button',
			{ style: secondary, onClick: showPet },
			'Show pet 👀'
		),

		createElement(
			'button',
			{
				style: { ...danger, marginTop: '0.5rem' },
				onClick: resetPet,
			},
			'Reset pet 🥚'
		),

		status && createElement( 'p', { style: statusStyle }, status )
	);
}

const panel: React.CSSProperties = {
	padding: '1.5rem',
	fontFamily:
		'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	color: '#1e1e1e',
	width: 280,
};
const h2: React.CSSProperties = { margin: '0 0 1rem', fontSize: '1.1rem' };
const label: React.CSSProperties = {
	display: 'block',
	fontSize: '0.8rem',
	fontWeight: 600,
	textTransform: 'uppercase',
	letterSpacing: '0.04em',
	marginBottom: '0.4rem',
	marginTop: '0.8rem',
};
const select: React.CSSProperties = {
	width: '100%',
	padding: '0.5rem',
	borderRadius: 6,
	border: '1px solid #dcdcde',
};
const input: React.CSSProperties = {
	flex: 1,
	padding: '0.5rem',
	borderRadius: 6,
	border: '1px solid #dcdcde',
	fontFamily: 'monospace',
};
const row: React.CSSProperties = {
	display: 'flex',
	gap: '0.5rem',
	alignItems: 'center',
};
const button: React.CSSProperties = {
	padding: '0.5rem 0.9rem',
	borderRadius: 6,
	border: '1px solid #1e1e1e',
	background: '#1e1e1e',
	color: '#fff',
	cursor: 'pointer',
};
const secondary: React.CSSProperties = {
	...button,
	background: '#fff',
	color: '#1e1e1e',
	width: '100%',
};
const danger: React.CSSProperties = {
	...button,
	background: '#8a0000',
	borderColor: '#8a0000',
	width: '100%',
};
const warning: React.CSSProperties = {
	fontSize: '0.75rem',
	color: '#b07000',
	background: '#fff8e1',
	border: '1px solid #f1d982',
	borderRadius: 6,
	padding: '0.5rem 0.75rem',
	margin: '0 0 0.5rem',
};
const hr: React.CSSProperties = {
	border: 0,
	borderTop: '1px solid #dcdcde',
	margin: '1.5rem 0',
};
const statusStyle: React.CSSProperties = {
	fontSize: '0.8rem',
	color: '#487558',
	marginTop: '0.75rem',
};
