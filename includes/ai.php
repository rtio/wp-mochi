<?php
/**
 * AI provider integration for Mochi — supports Anthropic + OpenAI.
 *
 * generate_speech() is the single entry point. It reads the configured
 * provider from wp_options, dispatches to the corresponding call_*
 * function, and degrades gracefully on every failure path:
 *
 *   - No key configured for selected provider  → stub fallback
 *   - Unknown provider value in wp_options     → stub fallback (with log)
 *   - Network error / WP_Error                 → stub fallback
 *   - Non-200 HTTP response                    → stub fallback
 *   - Empty / malformed response               → stub fallback
 *   - Happy path                               → provider's reply, source=<provider>
 *
 * Model selection is deliberately NOT exposed to users. For our use case
 * (120-token in-character speech bubbles) the cheapest model at each
 * provider is more than sufficient and there's no realistic gain from
 * paying 5-10x more for a frontier model. The hardcoded choices below
 * may need updating when providers release newer cheap tiers (e.g. a
 * future Haiku, a GPT-4o-nano equivalent); that's a 1-line edit here.
 *
 * API keys are loaded from wp_options here (server-side only) and never
 * leave PHP. See handle_settings in rest.php — the browser submits keys
 * but never reads them back; only boolean "configured" status is exposed.
 *
 * @package Mochi
 */

namespace Mochi\Ai;

use function Mochi\State\stub_speech;
use function Mochi\State\mood_of;
use const Mochi\OPT_PROVIDER;
use const Mochi\OPT_ANTHROPIC_API_KEY;
use const Mochi\OPT_OPENAI_API_KEY;

/** Supported provider IDs. Stored as the value of OPT_PROVIDER in wp_options. */
const PROVIDERS = array( 'anthropic', 'openai' );

/** Default provider when OPT_PROVIDER is unset or invalid. */
const DEFAULT_PROVIDER = 'anthropic';

/**
 * Cheapest-tier model per provider, hardcoded. Update these if providers
 * release cheaper models for similarly-quippy output.
 *
 * Anthropic Haiku 4.5 — $1/MTok input, $5/MTok output.
 * OpenAI gpt-4o-mini  — $0.15/MTok input, $0.60/MTok output.
 *
 * Our speech bubbles are ~120 output tokens per interaction, so a typical
 * action costs fractions of a cent on either provider.
 */
const MODELS = array(
	'anthropic' => 'claude-haiku-4-5-20251001',
	'openai'    => 'gpt-4o-mini',
);

/** Tokens cap for the response. ~100 chars + punctuation + safety. */
const MAX_TOKENS = 120;

/** HTTP timeout in seconds. Both providers typically respond in < 3s. */
const HTTP_TIMEOUT = 15;

/**
 * Return the currently-configured provider, falling back to the default
 * if the option is unset or contains an unknown value.
 */
function current_provider(): string {
	$provider = (string) get_option( OPT_PROVIDER, DEFAULT_PROVIDER );
	return in_array( $provider, PROVIDERS, true ) ? $provider : DEFAULT_PROVIDER;
}

/**
 * Look up the stored API key for a given provider.
 */
function provider_api_key( string $provider ): string {
	return match ( $provider ) {
		'anthropic' => (string) get_option( OPT_ANTHROPIC_API_KEY, '' ),
		'openai'    => (string) get_option( OPT_OPENAI_API_KEY, '' ),
		default     => '',
	};
}

/**
 * Return the hardcoded model ID for a provider.
 */
function default_model_for( string $provider ): string {
	return MODELS[ $provider ] ?? MODELS[ DEFAULT_PROVIDER ];
}

/**
 * Generate a speech-bubble line for the current pet state.
 *
 * @param array<string, mixed> $state   Pet state after the action was applied.
 * @param string               $action  Action that was just applied.
 * @param bool                 $evolved Whether an evolution triggered this tick.
 * @return array{line: string, source: 'anthropic'|'openai'|'stub'}
 */
function generate_speech( array $state, string $action, bool $evolved ): array {
	$provider = current_provider();
	$api_key  = provider_api_key( $provider );

	if ( '' === $api_key ) {
		return array(
			'line'   => stub_speech( $state, $action, $evolved ),
			'source' => 'stub',
		);
	}

	$system = build_system_prompt( $state, $action, $evolved );
	$model  = default_model_for( $provider );

	$text = match ( $provider ) {
		'anthropic' => call_anthropic( $system, $api_key, $model ),
		'openai'    => call_openai( $system, $api_key, $model ),
		default     => null,
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
 * Call Anthropic's Messages API. Returns the reply text or null on any
 * failure (the caller handles the stub fallback).
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

/**
 * Call OpenAI's Chat Completions API. Returns the reply text or null on
 * any failure (the caller handles the stub fallback).
 */
function call_openai( string $system, string $api_key, string $model ): ?string {
	$response = wp_remote_post(
		'https://api.openai.com/v1/chat/completions',
		array(
			'timeout' => HTTP_TIMEOUT,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $api_key,
			),
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
		error_log( 'Mochi: OpenAI request failed: ' . $response->get_error_message() );
		return null;
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	$body = (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code ) {
		error_log( "Mochi: OpenAI returned HTTP $code — body: $body" );
		return null;
	}

	$data = json_decode( $body, true );
	$text = isset( $data['choices'][0]['message']['content'] ) && is_string( $data['choices'][0]['message']['content'] )
		? $data['choices'][0]['message']['content']
		: '';

	return clean_line( $text );
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
 * in-character line. Provider-agnostic — both Anthropic and OpenAI
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
