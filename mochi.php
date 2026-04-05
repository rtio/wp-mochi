<?php
/**
 * Plugin Name: Mochi
 * Description: A Tamagotchi-style AI pet that lives in wp-admin. Built to exercise @wordpress/build tooling.
 * Version:     0.1.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 */

namespace Mochi;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const PLUGIN_FILE    = __FILE__;
const PLUGIN_DIR     = __DIR__;
const REST_NAMESPACE = 'mochi/v1';

// Option keys.
const OPT_PET_STATE          = 'mochi_pet_state';
const OPT_PERSONALITY        = 'mochi_personality';
const OPT_PROVIDER           = 'mochi_provider';          // 'anthropic' | 'openai'
const OPT_ANTHROPIC_API_KEY  = 'mochi_anthropic_api_key';
const OPT_OPENAI_API_KEY     = 'mochi_openai_api_key';

require_once PLUGIN_DIR . '/includes/state.php';
require_once PLUGIN_DIR . '/includes/ai.php';
require_once PLUGIN_DIR . '/includes/rest.php';
require_once PLUGIN_DIR . '/includes/admin.php';

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	require_once PLUGIN_DIR . '/includes/cli.php';
}

// Load the auto-generated @wordpress/build registry (script modules, scripts, styles, routes).
$build_bootstrap = PLUGIN_DIR . '/build/build.php';
if ( file_exists( $build_bootstrap ) ) {
	require_once $build_bootstrap;
}

add_action( 'rest_api_init', __NAMESPACE__ . '\\Rest\\register_routes' );
