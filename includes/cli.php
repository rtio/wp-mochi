<?php
/**
 * WP-CLI commands for Mochi.
 *
 * Usage (inside wp-env):
 *   pnpm run env:cli -- mochi show
 *   pnpm run env:cli -- mochi feed
 *   pnpm run env:cli -- mochi pet
 *   pnpm run env:cli -- mochi ignore
 *   pnpm run env:cli -- mochi reset
 *   pnpm run env:cli -- mochi personality grumpy
 *
 * @package Mochi
 */

namespace Mochi\Cli;

use function Mochi\State\load_pet;
use function Mochi\State\save_pet;
use function Mochi\State\step;
use function Mochi\State\create_pet;
use function Mochi\Ai\generate_speech;
use const Mochi\State\ACTIONS;
use const Mochi\State\PERSONALITIES;
use const Mochi\State\STAGES;
use const Mochi\OPT_PERSONALITY;

class Mochi_Command {
	/**
	 * Show the current pet state.
	 *
	 * ## EXAMPLES
	 *
	 *     wp mochi show
	 */
	public function show(): void {
		$state = load_pet();
		\WP_CLI::log( wp_json_encode( $state, JSON_PRETTY_PRINT ) );
	}

	/**
	 * Feed the pet.
	 */
	public function feed(): void {
		$this->run_action( 'feed' );
	}

	/**
	 * Pet the pet.
	 */
	public function pet(): void {
		$this->run_action( 'pet' );
	}

	/**
	 * Ignore the pet (cruel, but valid).
	 */
	public function ignore(): void {
		$this->run_action( 'ignore' );
	}

	/**
	 * Reset to a fresh egg, keeping the configured personality.
	 */
	public function reset(): void {
		$personality = get_option( OPT_PERSONALITY, 'grumpy' );
		$fresh       = create_pet( $personality );
		save_pet( $fresh );
		\WP_CLI::success( 'Pet reset. Fresh egg incoming.' );
	}

	/**
	 * Set the pet's personality.
	 *
	 * ## OPTIONS
	 *
	 * <personality>
	 * : One of: grumpy, chipper, deadpan, dramatic.
	 *
	 * ## EXAMPLES
	 *
	 *     wp mochi personality dramatic
	 *
	 * @param array<int, string> $args Positional args.
	 */
	public function personality( array $args ): void {
		$value = $args[0] ?? '';
		if ( ! in_array( $value, PERSONALITIES, true ) ) {
			\WP_CLI::error( 'Personality must be one of: ' . implode( ', ', PERSONALITIES ) );
		}
		update_option( OPT_PERSONALITY, $value, false );

		// Apply to the currently-living pet too, not just the default-for-next-reset.
		$pet                = load_pet();
		$pet['personality'] = $value;
		save_pet( $pet );

		\WP_CLI::success( "Personality set to: $value (applied to current pet)." );
	}

	/**
	 * Jump the current pet to a specific stage. Testing / demo aid only —
	 * normal play goes through the interaction-driven evolution gates.
	 *
	 * ## OPTIONS
	 *
	 * <stage>
	 * : One of: egg, hatchling, chick, chonk, final_form.
	 *
	 * ## EXAMPLES
	 *
	 *     wp mochi set-stage final_form
	 *     wp mochi set-stage hatchling
	 *
	 * @param array<int, string> $args Positional args.
	 */
	public function set_stage( array $args ): void {
		$value = $args[0] ?? '';
		if ( ! in_array( $value, STAGES, true ) ) {
			\WP_CLI::error( 'Stage must be one of: ' . implode( ', ', STAGES ) );
		}
		$pet          = load_pet();
		$pet['stage'] = $value;
		save_pet( $pet );
		\WP_CLI::success( "Stage set to: $value" );
	}

	private function run_action( string $action ): void {
		if ( ! in_array( $action, ACTIONS, true ) ) {
			\WP_CLI::error( "Unknown action: $action" );
		}
		$state  = load_pet();
		$result = step( $state, $action );
		save_pet( $result['state'] );

		$speech = generate_speech( $result['state'], $action, $result['evolved'] );

		\WP_CLI::log( "🐾 {$speech['line']}" );
		\WP_CLI::log(
			sprintf(
				'stage=%s happiness=%d hunger=%d age=%d source=%s%s',
				$result['state']['stage'],
				$result['state']['happiness'],
				$result['state']['hunger'],
				$result['state']['age_ticks'],
				$speech['source'],
				$result['evolved'] ? ' [EVOLVED!]' : ''
			)
		);
	}
}

\WP_CLI::add_command( 'mochi', __NAMESPACE__ . '\\Mochi_Command' );
