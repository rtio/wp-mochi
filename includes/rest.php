<?php
/**
 * REST API routes for Mochi.
 *
 * All routes require `manage_options` — this is a WP admin toy, not public.
 *
 * @package Mochi
 */

namespace Mochi\Rest;

use function Mochi\State\load_pet;
use function Mochi\State\save_pet;
use function Mochi\State\step;
use function Mochi\State\create_pet;
use function Mochi\Ai\generate_speech;
use const Mochi\State\ACTIONS;
use const Mochi\State\PERSONALITIES;
use const Mochi\Ai\PROVIDERS;
use const Mochi\OPT_PROVIDER;
use const Mochi\OPT_ANTHROPIC_API_KEY;
use const Mochi\OPT_OPENAI_API_KEY;
use const Mochi\OPT_PERSONALITY;
use const Mochi\OPT_PET_STATE;
use const Mochi\REST_NAMESPACE;

/**
 * Capability check — every route gates on this.
 */
function can_manage(): bool {
	return current_user_can( 'manage_options' );
}

function register_routes(): void {
	register_rest_route(
		REST_NAMESPACE,
		'/state',
		array(
			'methods'             => 'GET',
			'permission_callback' => __NAMESPACE__ . '\\can_manage',
			'callback'            => __NAMESPACE__ . '\\handle_get_state',
		)
	);

	register_rest_route(
		REST_NAMESPACE,
		'/interact',
		array(
			'methods'             => 'POST',
			'permission_callback' => __NAMESPACE__ . '\\can_manage',
			'callback'            => __NAMESPACE__ . '\\handle_interact',
			'args'                => array(
				'action' => array(
					'required' => true,
					'type'     => 'string',
					'enum'     => ACTIONS,
				),
			),
		)
	);

	register_rest_route(
		REST_NAMESPACE,
		'/reset',
		array(
			'methods'             => 'POST',
			'permission_callback' => __NAMESPACE__ . '\\can_manage',
			'callback'            => __NAMESPACE__ . '\\handle_reset',
		)
	);

	register_rest_route(
		REST_NAMESPACE,
		'/settings',
		array(
			'methods'             => 'POST',
			'permission_callback' => __NAMESPACE__ . '\\can_manage',
			'callback'            => __NAMESPACE__ . '\\handle_settings',
			'args'                => array(
				'personality'       => array(
					'required' => false,
					'type'     => 'string',
					'enum'     => PERSONALITIES,
				),
				'provider'          => array(
					'required' => false,
					'type'     => 'string',
					'enum'     => PROVIDERS,
				),
				'anthropic_api_key' => array(
					'required' => false,
					'type'     => 'string',
				),
				'openai_api_key'    => array(
					'required' => false,
					'type'     => 'string',
				),
			),
		)
	);
}

function handle_get_state( \WP_REST_Request $request ): \WP_REST_Response {
	$state = load_pet();

	return new \WP_REST_Response(
		array(
			'state'                    => $state,
			'provider'                 => (string) get_option( OPT_PROVIDER, 'anthropic' ),
			'anthropic_key_configured' => (bool) get_option( OPT_ANTHROPIC_API_KEY, '' ),
			'openai_key_configured'    => (bool) get_option( OPT_OPENAI_API_KEY, '' ),
		)
	);
}

function handle_interact( \WP_REST_Request $request ): \WP_REST_Response {
	$action = (string) $request->get_param( 'action' );

	$state  = load_pet();
	$result = step( $state, $action );

	save_pet( $result['state'] );

	$speech = generate_speech( $result['state'], $action, $result['evolved'] );

	return new \WP_REST_Response(
		array(
			'state'          => $result['state'],
			'evolved'        => $result['evolved'],
			'previous_stage' => $result['previous_stage'],
			'line'           => $speech['line'],
			'source'         => $speech['source'],
		)
	);
}

function handle_reset( \WP_REST_Request $request ): \WP_REST_Response {
	$personality = get_option( OPT_PERSONALITY, 'grumpy' );
	$fresh       = create_pet( $personality );
	save_pet( $fresh );

	return new \WP_REST_Response( array( 'state' => $fresh ) );
}

function handle_settings( \WP_REST_Request $request ): \WP_REST_Response {
	$personality       = $request->get_param( 'personality' );
	$provider          = $request->get_param( 'provider' );
	$anthropic_api_key = $request->get_param( 'anthropic_api_key' );
	$openai_api_key    = $request->get_param( 'openai_api_key' );

	if ( null !== $personality ) {
		update_option( OPT_PERSONALITY, $personality, false );
		// Also apply to the currently-living pet. Otherwise the sidebar
		// personality dropdown has a confusing "next reset only" behavior
		// and the immediate UI doesn't reflect the change.
		$pet                = load_pet();
		$pet['personality'] = $personality;
		save_pet( $pet );
	}

	if ( null !== $provider ) {
		update_option( OPT_PROVIDER, $provider, false );
	}

	// Plaintext in wp_options — fine for local demo, NOT production.
	// See AGENTS.md and the settings UI for the user-facing warning.
	if ( null !== $anthropic_api_key ) {
		update_option( OPT_ANTHROPIC_API_KEY, $anthropic_api_key, false );
	}
	if ( null !== $openai_api_key ) {
		update_option( OPT_OPENAI_API_KEY, $openai_api_key, false );
	}

	return new \WP_REST_Response(
		array(
			'personality'              => get_option( OPT_PERSONALITY, 'grumpy' ),
			'provider'                 => (string) get_option( OPT_PROVIDER, 'anthropic' ),
			'anthropic_key_configured' => (bool) get_option( OPT_ANTHROPIC_API_KEY, '' ),
			'openai_key_configured'    => (bool) get_option( OPT_OPENAI_API_KEY, '' ),
		)
	);
}
