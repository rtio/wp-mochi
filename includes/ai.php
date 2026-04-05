<?php
/**
 * Anthropic API integration for Mochi.
 *
 * generate_speech() is the single entry point. It degrades gracefully:
 *   - No API key configured       → falls back to stub_speech, source=stub
 *   - Network error / WP_Error    → falls back to stub_speech, source=stub
 *   - Non-200 HTTP response       → falls back to stub_speech, source=stub
 *   - Empty / malformed response  → falls back to stub_speech, source=stub
 *   - All other cases             → returns Anthropic's reply, source=anthropic
 *
 * The API key is loaded from wp_options here (server-side only) and never
 * leaves PHP. The browser cannot see it; see `handle_settings` in rest.php
 * where the key is accepted write-only.
 *
 * @package Mochi
 */

namespace Mochi\Ai;

use function Mochi\State\stub_speech;
use function Mochi\State\mood_of;
use const Mochi\OPT_API_KEY;

/**
 * Anthropic model — Haiku 4.5 is fast, cheap, and good at quippy one-liners.
 * Pinned to a specific dated version so behavior is reproducible.
 */
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Upper bound on the speech bubble. Tokens, not characters, but 120 tokens
 * comfortably covers 100 characters of output with room for punctuation.
 */
const MAX_TOKENS = 120;

/**
 * HTTP timeout in seconds. Haiku typically responds in under 2s; 15 is a
 * safety margin for flaky networks.
 */
const HTTP_TIMEOUT = 15;

/**
 * Generate a speech-bubble line for the current pet state.
 *
 * @param array<string, mixed> $state   Pet state after the action was applied.
 * @param string               $action  Action that was just applied.
 * @param bool                 $evolved Whether an evolution triggered this tick.
 * @return array{line: string, source: 'anthropic'|'stub'}
 */
function generate_speech( array $state, string $action, bool $evolved ): array {
	$api_key = (string) get_option( OPT_API_KEY, '' );

	if ( '' === $api_key ) {
		return array(
			'line'   => stub_speech( $state, $action, $evolved ),
			'source' => 'stub',
		);
	}

	$system = build_system_prompt( $state, $action, $evolved );

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
					'model'      => MODEL,
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
		return array(
			'line'   => stub_speech( $state, $action, $evolved ),
			'source' => 'stub',
		);
	}

	$code = (int) wp_remote_retrieve_response_code( $response );
	$body = (string) wp_remote_retrieve_body( $response );

	if ( 200 !== $code ) {
		error_log( "Mochi: Anthropic returned HTTP $code — body: $body" );
		return array(
			'line'   => stub_speech( $state, $action, $evolved ),
			'source' => 'stub',
		);
	}

	$data = json_decode( $body, true );
	$text = isset( $data['content'][0]['text'] ) && is_string( $data['content'][0]['text'] )
		? trim( $data['content'][0]['text'] )
		: '';

	// Claude sometimes wraps short in-character responses in quotes despite
	// being told not to. Strip a single layer of wrapping quotes if present.
	$text = preg_replace( '/^[\x{201C}\x{201D}"\'](.*)[\x{201C}\x{201D}"\']$/u', '$1', $text ) ?? $text;
	$text = trim( $text );

	if ( '' === $text ) {
		return array(
			'line'   => stub_speech( $state, $action, $evolved ),
			'source' => 'stub',
		);
	}

	return array(
		'line'   => $text,
		'source' => 'anthropic',
	);
}

/**
 * Build the system prompt that constrains Claude to a single in-character line.
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
