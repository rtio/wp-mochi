/**
 * Mochi — inspector panel component (settings page).
 *
 * Settings:
 *   - Personality picker (auto-saves on change — affects live pet rendering)
 *   - AI provider picker (Anthropic / OpenAI / Ollama / OpenRouter)
 *   - Credentials per provider:
 *       - Anthropic API key (password, write-only)
 *       - OpenAI API key (password, write-only)
 *       - OpenRouter API key (password, write-only)
 *       - Ollama base URL (plain text — not a secret)
 *   - Show pet / Reset pet buttons
 *
 * Model selection is deliberately absent. The server always uses the
 * cheapest-tier model per provider (see includes/ai.php MODELS constant).
 * For 120-token speech bubbles there's no realistic gain from paying more.
 *
 * Credential inputs are password fields for keys (write-only — only a
 * boolean "configured" status is returned from the server, never the key
 * itself) and a plain text field for the Ollama base URL (it's a URL,
 * not a secret, and users benefit from seeing the current value).
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

type Provider = 'anthropic' | 'openai' | 'ollama' | 'openrouter';

/**
 * Displayed in the dropdown and used for the dynamic model-in-use note
 * under it. Models mirror includes/ai.php MODELS — if you change the
 * server-side default, change the label here too (there's no runtime
 * wire from the server to keep these honest; it's a note for the user,
 * and a discrepancy is a cosmetic bug at worst).
 */
const PROVIDERS: Array< { id: Provider; label: string; model: string } > = [
	{ id: 'anthropic',  label: 'Anthropic (Claude)', model: 'claude-haiku-4-5' },
	{ id: 'openai',     label: 'OpenAI (GPT)',       model: 'gpt-4o-mini' },
	{ id: 'ollama',     label: 'Ollama (local)',     model: 'llama3.2:1b' },
	{ id: 'openrouter', label: 'OpenRouter',         model: 'deepseek/deepseek-chat' },
];

interface StateResponse {
	state: { personality: Personality };
	provider: Provider;
	anthropic_key_configured: boolean;
	openai_key_configured: boolean;
	openrouter_key_configured: boolean;
	ollama_base_url: string;
}

interface SettingsResponse {
	personality: Personality;
	provider: Provider;
	anthropic_key_configured: boolean;
	openai_key_configured: boolean;
	openrouter_key_configured: boolean;
	ollama_base_url: string;
}

export function InspectorPanel() {
	const [ personality, setPersonality ] = useState< Personality >( 'grumpy' );
	const [ provider, setProvider ] = useState< Provider >( 'anthropic' );

	// Server-reported "configured" flags (read-only view of which providers
	// already have keys stored). These drive the placeholder text on the
	// corresponding inputs.
	const [ anthropicKeyConfigured, setAnthropicKeyConfigured ] =
		useState< boolean >( false );
	const [ openaiKeyConfigured, setOpenaiKeyConfigured ] =
		useState< boolean >( false );
	const [ openrouterKeyConfigured, setOpenrouterKeyConfigured ] =
		useState< boolean >( false );
	const [ ollamaBaseUrl, setOllamaBaseUrl ] = useState< string >( '' );

	// Local drafts — what the user has typed but not yet saved.
	const [ anthropicKeyDraft, setAnthropicKeyDraft ] = useState< string >( '' );
	const [ openaiKeyDraft, setOpenaiKeyDraft ] = useState< string >( '' );
	const [ openrouterKeyDraft, setOpenrouterKeyDraft ] = useState< string >( '' );

	const [ status, setStatus ] = useState< string >( '' );

	useEffect( () => {
		apiFetch< StateResponse >( { path: '/mochi/v1/state' } ).then(
			( res ) => {
				setPersonality( res.state.personality );
				setProvider( res.provider );
				setAnthropicKeyConfigured( res.anthropic_key_configured );
				setOpenaiKeyConfigured( res.openai_key_configured );
				setOpenrouterKeyConfigured( res.openrouter_key_configured );
				setOllamaBaseUrl( res.ollama_base_url );
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
		// Only send fields the user actually touched — empty drafts are
		// skipped so clicking Save after only changing the provider doesn't
		// clobber a previously-saved key with an empty string.
		const data: Record< string, string > = { provider };
		if ( anthropicKeyDraft ) data.anthropic_api_key = anthropicKeyDraft;
		if ( openaiKeyDraft ) data.openai_api_key = openaiKeyDraft;
		if ( openrouterKeyDraft ) data.openrouter_api_key = openrouterKeyDraft;
		// Ollama base URL is always sent — it's readable from the server
		// and the user might be intentionally clearing it to go back to
		// the default. Empty string means "use the default".
		data.ollama_base_url = ollamaBaseUrl;

		const res = await apiFetch< SettingsResponse >( {
			path: '/mochi/v1/settings',
			method: 'POST',
			data,
		} );

		setProvider( res.provider );
		setAnthropicKeyConfigured( res.anthropic_key_configured );
		setOpenaiKeyConfigured( res.openai_key_configured );
		setOpenrouterKeyConfigured( res.openrouter_key_configured );
		setOllamaBaseUrl( res.ollama_base_url );
		setAnthropicKeyDraft( '' );
		setOpenaiKeyDraft( '' );
		setOpenrouterKeyDraft( '' );
		setStatus( 'API settings saved.' );
	};

	const resetPet = async () => {
		if ( ! window.confirm( 'Reset your pet back to an egg?' ) ) return;
		await apiFetch( { path: '/mochi/v1/reset', method: 'POST' } );
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

		// Anthropic
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

		// OpenAI
		createElement( 'label', { style: label }, 'OpenAI API Key' ),
		createElement( 'input', {
			type: 'password',
			style: input,
			placeholder: openaiKeyConfigured ? '●●●●●●●● (configured)' : 'sk-…',
			value: openaiKeyDraft,
			onChange: ( e: React.ChangeEvent< HTMLInputElement > ) =>
				setOpenaiKeyDraft( e.target.value ),
		} ),

		// OpenRouter
		createElement( 'label', { style: label }, 'OpenRouter API Key' ),
		createElement( 'input', {
			type: 'password',
			style: input,
			placeholder: openrouterKeyConfigured
				? '●●●●●●●● (configured)'
				: 'sk-or-…',
			value: openrouterKeyDraft,
			onChange: ( e: React.ChangeEvent< HTMLInputElement > ) =>
				setOpenrouterKeyDraft( e.target.value ),
		} ),

		// Ollama — URL, not a password. Shows current saved value.
		createElement( 'label', { style: label }, 'Ollama Base URL' ),
		createElement(
			'p',
			{ style: helpText },
			'Only needed if you picked Ollama as the provider. Default: http://host.docker.internal:11434 (reaches Ollama running on your Mac host from the wp-env container).'
		),
		createElement( 'input', {
			type: 'text',
			style: input,
			placeholder: 'http://host.docker.internal:11434',
			value: ollamaBaseUrl,
			onChange: ( e: React.ChangeEvent< HTMLInputElement > ) =>
				setOllamaBaseUrl( e.target.value ),
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
const helpText: React.CSSProperties = {
	fontSize: '0.7rem',
	color: '#757575',
	margin: '0 0 0.4rem',
	lineHeight: 1.4,
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
