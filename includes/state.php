<?php
/**
 * Mochi state machine (PHP mirror of packages/state/src/index.ts).
 *
 * The TypeScript version is the canonical spec — this PHP port must track
 * its evolution thresholds and action effects exactly. If they drift, the
 * optimistic UI layer and the authoritative server will disagree.
 *
 * Authoritative: this module. The UI displays whatever POST /interact returns.
 *
 * @package Mochi
 */

namespace Mochi\State;

const STAGES = array( 'egg', 'hatchling', 'chick', 'chonk', 'final_form' );

const EVOLUTION_GATES = array(
	'egg'       => array(
		'min_ticks'          => 2,
		'min_avg_happiness'  => 0,
	),
	'hatchling' => array(
		'min_ticks'          => 5,
		'min_avg_happiness'  => 50,
	),
	'chick'     => array(
		'min_ticks'          => 10,
		'min_avg_happiness'  => 60,
	),
	'chonk'     => array(
		'min_ticks'          => 18,
		'min_avg_happiness'  => 70,
	),
);

const PERSONALITIES = array( 'grumpy', 'chipper', 'deadpan', 'dramatic' );
const ACTIONS       = array( 'feed', 'pet', 'ignore' );

/**
 * Fresh pet. Matches TS createPet defaults.
 *
 * @param string $personality One of PERSONALITIES.
 * @return array<string, mixed>
 */
function create_pet( string $personality = 'grumpy' ): array {
	if ( ! in_array( $personality, PERSONALITIES, true ) ) {
		$personality = 'grumpy';
	}

	return array(
		'species'              => 'chickenoid',
		'stage'                => 'egg',
		'happiness'            => 60,
		'hunger'               => 30,
		'age_ticks'            => 0,
		'cumulative_happiness' => 0,
		'personality'          => $personality,
		'last_interaction'     => (int) ( microtime( true ) * 1000 ),
		'last_action'          => null,
	);
}

/**
 * Load the persisted pet, creating a default one if missing.
 *
 * @return array<string, mixed>
 */
function load_pet(): array {
	$state = get_option( \Mochi\OPT_PET_STATE, null );
	if ( ! is_array( $state ) || empty( $state['stage'] ) ) {
		$personality = get_option( \Mochi\OPT_PERSONALITY, 'grumpy' );
		$state       = create_pet( $personality );
		save_pet( $state );
	}
	return $state;
}

/**
 * Persist pet state.
 *
 * @param array<string, mixed> $state Pet state.
 */
function save_pet( array $state ): void {
	update_option( \Mochi\OPT_PET_STATE, $state, false );
}

/**
 * Clamp a number to [min, max].
 */
function clamp( int|float $n, int $min = 0, int $max = 100 ): int {
	return (int) max( $min, min( $max, $n ) );
}

/**
 * Apply an action. Returns the new state and whether an evolution triggered.
 *
 * @param array<string, mixed> $state  Current state.
 * @param string               $action One of ACTIONS.
 * @return array{state: array<string, mixed>, evolved: bool, previous_stage: ?string}
 */
function step( array $state, string $action ): array {
	if ( ! in_array( $action, ACTIONS, true ) ) {
		return array(
			'state'          => $state,
			'evolved'        => false,
			'previous_stage' => null,
		);
	}

	$happiness = (int) $state['happiness'];
	$hunger    = (int) $state['hunger'];

	switch ( $action ) {
		case 'feed':
			// Overfeeding a full pet makes it grumpy.
			if ( $hunger <= 5 ) {
				$happiness = clamp( $happiness - 5 );
			} else {
				$happiness = clamp( $happiness + 5 );
			}
			$hunger = clamp( $hunger - 30 );
			break;

		case 'pet':
			$bonus     = $happiness >= 90 ? 15 : 10;
			$happiness = clamp( $happiness + $bonus );
			$hunger    = clamp( $hunger + 2 );
			break;

		case 'ignore':
			$happiness = clamp( $happiness - 10 );
			$hunger    = clamp( $hunger + 10 );
			break;
	}

	// Starving is miserable on top of whatever just happened.
	if ( $hunger >= 90 ) {
		$happiness = clamp( $happiness - 5 );
	}

	$age_ticks            = (int) $state['age_ticks'] + 1;
	$cumulative_happiness = (int) $state['cumulative_happiness'] + $happiness;

	$next = array_merge(
		$state,
		array(
			'happiness'            => $happiness,
			'hunger'               => $hunger,
			'age_ticks'            => $age_ticks,
			'cumulative_happiness' => $cumulative_happiness,
			'last_interaction'     => (int) ( microtime( true ) * 1000 ),
			'last_action'          => $action,
		)
	);

	return maybe_evolve( $next );
}

/**
 * Advance one stage if the current gate is satisfied.
 *
 * @param array<string, mixed> $state State after an action was applied.
 * @return array{state: array<string, mixed>, evolved: bool, previous_stage: ?string}
 */
function maybe_evolve( array $state ): array {
	if ( 'final_form' === $state['stage'] ) {
		return array(
			'state'          => $state,
			'evolved'        => false,
			'previous_stage' => null,
		);
	}

	$gate           = EVOLUTION_GATES[ $state['stage'] ];
	$age_ticks      = (int) $state['age_ticks'];
	$avg_happiness  = $age_ticks > 0 ? $state['cumulative_happiness'] / $age_ticks : 0;

	$eligible =
		$age_ticks >= $gate['min_ticks'] &&
		$avg_happiness >= $gate['min_avg_happiness'];

	if ( ! $eligible ) {
		return array(
			'state'          => $state,
			'evolved'        => false,
			'previous_stage' => null,
		);
	}

	$current_index = array_search( $state['stage'], STAGES, true );
	$next_stage    = STAGES[ $current_index + 1 ];

	return array(
		'state'          => array_merge( $state, array( 'stage' => $next_stage ) ),
		'evolved'        => true,
		'previous_stage' => $state['stage'],
	);
}

/**
 * Derive a mood label from raw happiness. Mirrors TS moodOf.
 */
function mood_of( array $state ): string {
	$h = (int) $state['happiness'];
	if ( $h < 20 ) return 'miserable';
	if ( $h < 40 ) return 'sad';
	if ( $h < 65 ) return 'neutral';
	if ( $h < 90 ) return 'content';
	return 'ecstatic';
}

/**
 * Stubbed "AI" speech — deterministic, personality- and mood-aware.
 * Replaced with an Anthropic API call in step 4.
 *
 * @param array<string, mixed> $state    New pet state.
 * @param string               $action   Action that was applied.
 * @param bool                 $evolved  Whether an evolution triggered this tick.
 * @return string Speech-bubble line.
 */
function stub_speech( array $state, string $action, bool $evolved ): string {
	$personality = $state['personality'];
	$mood        = mood_of( $state );

	if ( $evolved ) {
		$evolution_lines = array(
			'grumpy'   => 'Hmph. I suppose I grew. Do not make it weird.',
			'chipper'  => 'Look at me!! I evolved!! This is the best day!!',
			'deadpan'  => 'I am now a different shape. Noted.',
			'dramatic' => 'Behold — I have TRANSCENDED my former self!',
		);
		return $evolution_lines[ $personality ] ?? 'I evolved.';
	}

	$prefix = array(
		'feed'   => 'You fed me. ',
		'pet'    => 'You pet me. ',
		'ignore' => 'You ignored me. ',
	)[ $action ] ?? '';

	$lines = array(
		'grumpy'   => array(
			'miserable' => 'I hate this. I hate you. Goodbye.',
			'sad'       => 'Took you long enough.',
			'neutral'   => 'Fine. Whatever.',
			'content'   => 'This is… acceptable. Do not tell anyone I said that.',
			'ecstatic'  => 'Okay fine, I am having a good time. Are you happy now?',
		),
		'chipper'  => array(
			'miserable' => 'Its ok!! Im sure things will get better!!',
			'sad'       => 'A little sad but still smiling!!',
			'neutral'   => 'Every day is a gift!!',
			'content'   => 'This is so nice, thank you friend!!',
			'ecstatic'  => 'BEST. DAY. EVER!!! I love everything!!!',
		),
		'deadpan'  => array(
			'miserable' => 'Oh. Despair. Cool.',
			'sad'       => 'Things are happening. Not great things.',
			'neutral'   => 'Neutral. Yes.',
			'content'   => 'This is fine. I am fine. Truly.',
			'ecstatic'  => 'Joy. Unbridled. I can barely contain it. See?',
		),
		'dramatic' => array(
			'miserable' => 'The void consumes me! ALL IS LOST!',
			'sad'       => 'Why must life be so CRUEL??',
			'neutral'   => 'A moment of calm… before the STORM.',
			'content'   => 'My heart soars like a thousand eagles at dawn!',
			'ecstatic'  => 'I AM ALIVE! I HAVE NEVER BEEN MORE ALIVE!!',
		),
	);

	$line = $lines[ $personality ][ $mood ] ?? 'Hm.';
	return $prefix . $line;
}
