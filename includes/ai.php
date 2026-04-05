<?php
/**
 * AI provider integration for Mochi — supports Anthropic, OpenAI, Ollama,
 * and OpenRouter.
 *
 * generate_speech() is the single entry point. It reads the configured
 * provider from wp_options, dispatches to the corresponding call_*
 * function, and degrades gracefully on every failure path:
 *
 *   - Provider requires key but none configured  → stub fallback
 *   - Unknown provider value in wp_options       → stub fallback
 *   - Network error / WP_Error                   → stub fallback
 *   - Non-200 HTTP response                      → stub fallback
 *   - Empty / malformed response                 → stub fallback
 *   - Happy path                                 → provider reply, source=<provider>
 *
 * Three of the four providers (OpenAI, Ollama, OpenRouter) share the
 * OpenAI-compatible Chat Completions API, so call_openai(), call_ollama(),
 * and call_openrouter() are all thin wrappers around call_openai_compatible().
 * Only Anthropic uses a distinct request/response shape (Messages API).
 *
 * Model selection is deliberately NOT exposed in the UI. For 120-token
 * in-character speech bubbles the cheapest tier at each provider is more
 * than sufficient, and the absence of a "which model?" picker means one
 * less thing to type wrong. Update the MODELS constant below if a
 * provider releases a cheaper tier.
 *
 * API keys are loaded from wp_options here (server-side only) and never
 * leave PHP. See handle_settings in rest.php — the browser submits keys
 * but only boolean "configured" status is exposed on reads.
 *
 * @package Mochi
 */

namespace Mochi\Ai;

use function Mochi\State\stub_speech;
use function Mochi\State\mood_of;
use const Mochi\OPT_PROVIDER;
use const Mochi\OPT_ANTHROPIC_API_KEY;
use const Mochi\OPT_OPENAI_API_KEY;
use const Mochi\OPT_OPENROUTER_API_KEY;
use const Mochi\OPT_OLLAMA_BASE_URL;

/** Supported provider IDs. Stored as the value of OPT_PROVIDER in wp_options. */
const PROVIDERS = array( 'anthropic', 'openai', 'ollama', 'openrouter' );

/** Default provider when OPT_PROVIDER is unset or invalid. */
const DEFAULT_PROVIDER = 'anthropic';

/**
 * Cheapest-tier model per provider, hardcoded. Update these if providers
 * release cheaper models for similarly-quippy output.
 *
 *   anthropic  — claude-haiku-4-5 ($1/MTok in, $5/MTok out)
 *   openai     — gpt-4o-mini ($0.15/MTok in, $0.60/MTok out)
 *   ollama     — llama3.2:3b (free, local, ~2 GB of RAM)
 *   openrouter — deepseek/deepseek-chat (~$0.14/MTok in, $0.28/MTok out)
 *
 * For speech bubbles, a typical interaction is ~400 input tokens
 * (system prompt + state) and ~120 output tokens. Cost per interaction
 * is fractions of a cent on any provider; free on Ollama.
 *
 * OpenRouter also has free-tier models (look for ":free" suffix in
 * their catalog). If you want a free-for-free setup, change the
 * openrouter default to something like
 * "meta-llama/llama-3.3-70b-instruct:free".
 */
const MODELS = array(
	'anthropic'  => 'claude-haiku-4-5-20251001',
	'openai'     => 'gpt-4o-mini',
	'ollama'     => 'llama3.2:3b',
	'openrouter' => 'deepseek/deepseek-chat',
);

/**
 * Providers that require an API key. Ollama is local and auth-less by
 * default; any other provider must have a key configured before the
 * real API path is taken (stub fallback otherwise).
 */
const PROVIDERS_REQUIRING_KEY = array( 'anthropic', 'openai', 'openrouter' );

/** Default Ollama base URL. Uses host.docker.internal so wp-env containers
 *  reach an Ollama instance running on the Mac/Linux host. Users can
 *  override via OPT_OLLAMA_BASE_URL if Ollama lives elsewhere. */
const OLLAMA_DEFAULT_BASE_URL = 'http://host.docker.internal:11434';

/** OpenRouter uses a fixed base URL — no reason to parameterize. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Tokens cap for the response. ~100 chars + punctuation + safety. */
const MAX_TOKENS = 120;

/** HTTP timeout for cloud providers. Both usually respond in < 3s. */
const HTTP_TIMEOUT = 15;

/** Shorter timeout for Ollama — local server should respond in < 1s,
 *  and when it's not running we want the stub fallback to fire fast
 *  rather than block the UI for 15 full seconds. */
const OLLAMA_HTTP_TIMEOUT = 5;

/**
 * Return the currently-configured provider, falling back to the default
 * if the option is unset or contains an unknown value.
 */
function current_provider(): string {
	$provider = (string) get_option( OPT_PROVIDER, DEFAULT_PROVIDER );
	return in_array( $provider, PROVIDERS, true ) ? $provider : DEFAULT_PROVIDER;
}

/**
 * Whether a provider needs an API key before we attempt the real call.
 * Pure function — exposed for testing and for the UI's "configured"
 * status computation.
 */
function provider_requires_api_key( string $provider ): bool {
	return in_array( $provider, PROVIDERS_REQUIRING_KEY, true );
}

/**
 * Look up the stored API key for a given provider. Ollama always returns
 * an empty string because it doesn't need one; callers should check
 * provider_requires_api_key() before interpreting the empty return.
 */
function provider_api_key( string $provider ): string {
	return match ( $provider ) {
		'anthropic'  => (string) get_option( OPT_ANTHROPIC_API_KEY, '' ),
		'openai'     => (string) get_option( OPT_OPENAI_API_KEY, '' ),
		'openrouter' => (string) get_option( OPT_OPENROUTER_API_KEY, '' ),
		'ollama'     => '',
		default      => '',
	};
}

/**
 * Return the hardcoded model ID for a provider, falling back to the
 * default provider's model for unknown inputs.
 */
function default_model_for( string $provider ): string {
	return MODELS[ $provider ] ?? MODELS[ DEFAULT_PROVIDER ];
}

/**
 * Return the configured Ollama base URL (the root — no /v1 suffix),
 * falling back to the default host.docker.internal location.
 */
function ollama_base_url(): string {
	$configured = (string) get_option( OPT_OLLAMA_BASE_URL, '' );
	return '' !== $configured ? rtrim( $configured, '/' ) : OLLAMA_DEFAULT_BASE_URL;
}

/**
 * Generate a speech-bubble line for the current pet state.
 *
 * @param array<string, mixed> $state   Pet state after the action was applied.
 * @param string               $action  Action that was just applied.
 * @param bool                 $evolved Whether an evolution triggered this tick.
 * @return array{line: string, source: 'anthropic'|'openai'|'ollama'|'openrouter'|'stub'}
 */
function generate_speech( array $state, string $action, bool $evolved ): array {
	$provider = current_provider();

	if ( provider_requires_api_key( $provider ) ) {
		$api_key = provider_api_key( $provider );
		if ( '' === $api_key ) {
			return array(
				'line'   => stub_speech( $state, $action, $evolved ),
				'source' => 'stub',
			);
		}
	} else {
		$api_key = '';
	}

	$system = build_system_prompt( $state, $action, $evolved );
	$model  = default_model_for( $provider );

	$text = match ( $provider ) {
		'anthropic'  => call_anthropic( $system, $api_key, $model ),
		'openai'     => call_openai( $system, $api_key, $model ),
		'ollama'     => call_ollama( $system, $model ),
		'openrouter' => call_openrouter( $system, $api_key, $model ),
		default      => null,
	};

	if ( null === $text || '' === $text ) {
		return array(
			'line'   => stub_speech( $state, $action, $evolved ),
			'source' => 'stub',
		);
	}

	return array(
		'line'   => $text,
		'source' => $provider,
	);
}

/**
 * Shared implementation for OpenAI-compatible Chat Completions endpoints.
 * OpenAI, Ollama, and OpenRouter all speak this protocol. Only the base
 * URL, auth header, and request timeout vary.
 *
 * @param string      $base_url Root URL (e.g. "https://api.openai.com/v1").
 * @param string|null $api_key  Bearer token, or null for no auth (Ollama).
 * @param string      $system   System prompt.
 * @param string      $model    Model ID.
 * @param int         $timeout  Request timeout in seconds.
 * @param string      $label    Log-prefix string (e.g. "OpenAI", "Ollama").
 */
function call_openai_compatible(
	string $base_url,
	?string $api_key,
	string $system,
	string $model,
	int $timeout,
	string $label
): ?string {
	$headers = array( 'Content-Type' => 'application/json' );
	if ( null !== $api_key && '' !== $api_key ) {
		$headers['Authorization'] = 'Bearer ' . $api_key;
	}

	$response = wp_remote_post(
		rtrim( $base_url, '/' ) . '/chat/completions',
		array(
			'timeout' => $timeout,
			'headers' => $headers,
			'body'    => wp_json_encode(
				array(
					'model'      => $model,
					'max_tokens' => MAX_TOKENS,
					'messages'   => array(
						array( 'role' => 'system', 'content' => $system ),
						array( 'role' => 'user', 'content' => 'Speak.' ),
					),
				)
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		error_log( "Mochi: $label request failed: " . $response->get_error_message() );
		return null;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	$body = (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code ) {
		error_log( "Mochi: $label returned HTTP $code — body: $body" );
		return null;
	}

	$data = json_decode( $body, true );
	$text = isset( $data['choices'][0]['message']['content'] ) && is_string( $data['choices'][0]['message']['content'] )
		? $data['choices'][0]['message']['content']
		: '';

	return clean_line( $text );
}

/**
 * Call Anthropic's Messages API — the one provider with a distinct
 * request/response shape (everything else is OpenAI-compatible).
 */
function call_anthropic( string $system, string $api_key, string $model ): ?string {
	$response = wp_remote_post(
		'https://api.anthropic.com/v1/messages',
		array(
			'timeout' => HTTP_TIMEOUT,
			'headers' => array(
				'Content-Type'      => 'application/json',
				'x-api-key'         => $api_key,
				'anthropic-version' => '2023-06-01',
			),
			'body'    => wp_json_encode(
				array(
					'model'      => $model,
					'max_tokens' => MAX_TOKENS,
					'system'     => $system,
					'messages'   => array(
						array(
							'role'    => 'user',
							'content' => 'Speak.',
						),
					),
				)
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		error_log( 'Mochi: Anthropic request failed: ' . $response->get_error_message() );
		return null;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	$body = (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code ) {
		error_log( "Mochi: Anthropic returned HTTP $code — body: $body" );
		return null;
	}

	$data = json_decode( $body, true );
	$text = isset( $data['content'][0]['text'] ) && is_string( $data['content'][0]['text'] )
		? $data['content'][0]['text']
		: '';

	return clean_line( $text );
}

/** Thin wrapper around call_openai_compatible() for OpenAI proper. */
function call_openai( string $system, string $api_key, string $model ): ?string {
	return call_openai_compatible(
		'https://api.openai.com/v1',
		$api_key,
		$system,
		$model,
		HTTP_TIMEOUT,
		'OpenAI'
	);
}

/**
 * Thin wrapper around call_openai_compatible() for Ollama. Uses a shorter
 * timeout because a local Ollama server should respond in under a second
 * and we'd rather fall back to stub quickly when it's not running.
 */
function call_ollama( string $system, string $model ): ?string {
	return call_openai_compatible(
		ollama_base_url() . '/v1',
		null, // Ollama's OpenAI-compatible endpoint doesn't require auth.
		$system,
		$model,
		OLLAMA_HTTP_TIMEOUT,
		'Ollama'
	);
}

/** Thin wrapper around call_openai_compatible() for OpenRouter. */
function call_openrouter( string $system, string $api_key, string $model ): ?string {
	return call_openai_compatible(
		OPENROUTER_BASE_URL,
		$api_key,
		$system,
		$model,
		HTTP_TIMEOUT,
		'OpenRouter'
	);
}

/**
 * Trim whitespace, strip a single layer of wrapping quotes (both straight
 * and curly — models love to wrap short in-character responses in quotes
 * despite the system prompt telling them not to), and return null for
 * empty strings so the caller can fall back to stub.
 */
function clean_line( string $text ): ?string {
	$text = trim( $text );
	$text = preg_replace( '/^[\x{201C}\x{201D}"\'](.*)[\x{201C}\x{201D}"\']$/u', '$1', $text ) ?? $text;
	$text = trim( $text );
	return '' === $text ? null : $text;
}

/**
 * Build the system prompt that constrains the model to a single
 * in-character line. Provider-agnostic — all supported providers
 * accept a system message in the request.
 *
 * @param array<string, mixed> $state   Pet state.
 * @param string               $action  Action that was applied.
 * @param bool                 $evolved Whether an evolution triggered.
 */
function build_system_prompt( array $state, string $action, bool $evolved ): string {
	$mood = mood_of( $state );

	$personality_guidance = array(
		'grumpy'   => 'You complain constantly, begrudge compliments, and pretend to hate affection even when you secretly love it. Fundamentally good-hearted beneath the prickliness. Short-tempered wording.',
		'chipper'  => 'You are RELENTLESSLY optimistic. Multiple exclamation points. Find the bright side of everything. No cynicism ever. Cheerful even when things are bad.',
		'deadpan'  => 'You speak in flat, matter-of-fact statements. Dry observations. Understate all emotions. Occasional long-suffering sighs. Never enthusiastic.',
		'dramatic' => 'You treat every small event as a life-altering saga. Shakespearean flourishes. Frequent references to fate, destiny, oblivion, and triumph. Use CAPS for emphasis. Everything is EPIC.',
	);

	$personality = $state['personality'] ?? 'grumpy';
	$guidance    = $personality_guidance[ $personality ] ?? $personality_guidance['grumpy'];

	$evolution_note = $evolved
		? "IMPORTANT: You JUST evolved to the {$state['stage']} stage. React to your new form in this line."
		: '';

	return sprintf(
		"You are a Tamagotchi-style virtual pet named \"%s\" at the \"%s\" stage of growth. " .
		"Your personality: %s " .
		"Current mood: %s (happiness %d/100, hunger %d/100 where higher means hungrier). " .
		"Your caretaker just chose the action: %s. " .
		"Age in interactions: %d. " .
		"%s " .
		"\n\nRespond with ONE short line (under 100 characters) — the kind of thing a speech bubble would hold. " .
		"Stay completely in character. Do NOT wrap your response in quotes. Do NOT add explanations or meta-commentary. " .
		"Do NOT break the fourth wall. Just say the line your pet would say, nothing else.",
		$state['species'] ?? 'chickenoid',
		$state['stage'] ?? 'egg',
		$guidance,
		$mood,
		(int) ( $state['happiness'] ?? 0 ),
		(int) ( $state['hunger'] ?? 0 ),
		$action,
		(int) ( $state['age_ticks'] ?? 0 ),
		$evolution_note
	);
}
