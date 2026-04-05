/**
 * Mochi — inspector panel component (settings page).
 *
 * Settings:
 *   - Personality picker (auto-saves on change — affects live pet rendering)
 *   - AI provider picker (Anthropic / OpenAI)
 *   - API key entry per provider — write-only from the client's POV;
 *     the REST API exposes only a boolean "configured" status, never the key
 *   - Show pet / Reset pet buttons
 *
 * Model selection is deliberately absent: the server always uses the
 * cheapest-tier model per provider (Haiku 4.5 for Anthropic, gpt-4o-mini
 * for OpenAI). For 120-token speech bubbles there's no realistic gain
 * from paying more. See includes/ai.php for the hardcoded model IDs.
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

type Provider = 'anthropic' | 'openai';

const PROVIDERS: Array< { id: Provider; label: string; model: string } > = [
	{
		id: 'anthropic',
		label: 'Anthropic (Claude)',
		model: 'claude-haiku-4-5',
	},
	{
		id: 'openai',
		label: 'OpenAI (GPT)',
		model: 'gpt-4o-mini',
	},
];

interface StateResponse {
	state: { personality: Personality };
	provider: Provider;
	anthropic_key_configured: boolean;
	openai_key_configured: boolean;
}

interface SettingsResponse {
	personality: Personality;
	provider: Provider;
	anthropic_key_configured: boolean;
	openai_key_configured: boolean;
}

export function InspectorPanel() {
	const [ personality, setPersonality ] =
		useState< Personality >( 'grumpy' );
	const [ provider, setProvider ] = useState< Provider >( 'anthropic' );
	const [ anthropicKeyConfigured, setAnthropicKeyConfigured ] =
		useState< boolean >( false );
	const [ openaiKeyConfigured, setOpenaiKeyConfigured ] =
		useState< boolean >( false );
	const [ anthropicKeyDraft, setAnthropicKeyDraft ] = useState< string >( '' );
	const [ openaiKeyDraft, setOpenaiKeyDraft ] = useState< string >( '' );
	const [ status, setStatus ] = useState< string >( '' );

	useEffect( () => {
		apiFetch< StateResponse >( { path: '/mochi/v1/state' } ).then(
			( res ) => {
				setPersonality( res.state.personality );
				setProvider( res.provider );
				setAnthropicKeyConfigured( res.anthropic_key_configured );
				setOpenaiKeyConfigured( res.openai_key_configured );
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

	const saveApiSettings = async () => {
		// Only send fields the user actually touched. Empty key drafts are
		// ignored so clicking Save after only changing the provider doesn't
		// clobber a previously-saved key with an empty string.
		const data: Record< string, string > = { provider };
		if ( anthropicKeyDraft ) data.anthropic_api_key = anthropicKeyDraft;
		if ( openaiKeyDraft ) data.openai_api_key = openaiKeyDraft;

		const res = await apiFetch< SettingsResponse >( {
			path: '/mochi/v1/settings',
			method: 'POST',
			data,
		} );

		setProvider( res.provider );
		setAnthropicKeyConfigured( res.anthropic_key_configured );
		setOpenaiKeyConfigured( res.openai_key_configured );
		setAnthropicKeyDraft( '' );
		setOpenaiKeyDraft( '' );
		setStatus( 'API settings saved.' );
	};

	const resetPet = async () => {
		if ( ! window.confirm( 'Reset your pet back to an egg?' ) ) return;
		await apiFetch( {
			path: '/mochi/v1/reset',
			method: 'POST',
		} );
		window.dispatchEvent( new CustomEvent( 'mochi:refresh' ) );
		setStatus( 'Pet reset. Fresh egg incoming.' );
	};

	const showPet = () => {
		window.dispatchEvent( new CustomEvent( 'mochi:show' ) );
		setStatus( 'Pet is visible in the bottom-right corner.' );
	};

	const activeModel =
		PROVIDERS.find( ( p ) => p.id === provider )?.model ?? '';

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

		createElement( 'hr', { style: hr } ),

		createElement( 'label', { style: label }, 'AI Provider' ),
		createElement(
			'select',
			{
				style: select,
				value: provider,
				onChange: ( e: React.ChangeEvent< HTMLSelectElement > ) =>
					setProvider( e.target.value as Provider ),
			},
			PROVIDERS.map( ( p ) =>
				createElement( 'option', { key: p.id, value: p.id }, p.label )
			)
		),
		createElement(
			'p',
			{ style: modelNote },
			`Using ${ activeModel } (cheapest tier — we don't need more for 120-token speech bubbles).`
		),

		createElement(
			'p',
			{ style: warning },
			'⚠️ API keys are stored in wp_options as plaintext. Fine for this local demo. Do not use in production.'
		),

		createElement( 'label', { style: label }, 'Anthropic API Key' ),
		createElement( 'input', {
			type: 'password',
			style: input,
			placeholder: anthropicKeyConfigured
				? '●●●●●●●● (configured)'
				: 'sk-ant-…',
			value: anthropicKeyDraft,
			onChange: ( e: React.ChangeEvent< HTMLInputElement > ) =>
				setAnthropicKeyDraft( e.target.value ),
		} ),

		createElement( 'label', { style: label }, 'OpenAI API Key' ),
		createElement( 'input', {
			type: 'password',
			style: input,
			placeholder: openaiKeyConfigured ? '●●●●●●●● (configured)' : 'sk-…',
			value: openaiKeyDraft,
			onChange: ( e: React.ChangeEvent< HTMLInputElement > ) =>
				setOpenaiKeyDraft( e.target.value ),
		} ),

		createElement(
			'button',
			{ style: saveButton, onClick: saveApiSettings },
			'Save API settings'
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
	width: '100%',
	padding: '0.5rem',
	borderRadius: 6,
	border: '1px solid #dcdcde',
	fontFamily: 'monospace',
	boxSizing: 'border-box',
};
const button: React.CSSProperties = {
	padding: '0.5rem 0.9rem',
	borderRadius: 6,
	border: '1px solid #1e1e1e',
	background: '#1e1e1e',
	color: '#fff',
	cursor: 'pointer',
};
const saveButton: React.CSSProperties = {
	...button,
	width: '100%',
	marginTop: '1rem',
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
	margin: '0.8rem 0 0.5rem',
};
const modelNote: React.CSSProperties = {
	fontSize: '0.72rem',
	color: '#757575',
	margin: '0.4rem 0 0',
	fontStyle: 'italic',
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
