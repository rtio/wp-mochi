<?php
/**
 * Unit tests for the PHP state machine mirror.
 *
 * Runs the same scenarios as packages/state/src/index.test.ts against the
 * PHP implementation in includes/state.php. If any test here passes while
 * its TS counterpart fails (or vice versa), the two copies have drifted —
 * that is the whole point of this file.
 *
 * No Composer, no PHPUnit, no WordPress test suite. Just `php tests/php/state-test.php`.
 * This deliberately stays dependency-free so the test runner never breaks
 * because of an unrelated package bump.
 *
 * Only the PURE functions are exercised (step, maybe_evolve, mood_of, stub_speech,
 * create_pet, clamp). load_pet/save_pet are skipped — they require WP's
 * get_option/update_option and are thin wrappers that don't need unit tests.
 */

declare( strict_types = 1 );

// Include the state machine. Safe to include without WP because we never
// call the functions that touch get_option/update_option.
require __DIR__ . '/../../includes/state.php';

// ────────────────────────────────────────────────────────────────────────
// Tiny assertion helper (no PHPUnit dependency).
// ────────────────────────────────────────────────────────────────────────

$test_passed = 0;
$test_failed = 0;
$current_group = '';

function group( string $name ): void {
	global $current_group;
	$current_group = $name;
	echo "\n\033[1m$name\033[0m\n";
}

function check( string $message, bool $condition, $expected = null, $actual = null ): void {
	global $test_passed, $test_failed;
	if ( $condition ) {
		$test_passed++;
		echo "  \033[32m✓\033[0m $message\n";
	} else {
		$test_failed++;
		echo "  \033[31m✗\033[0m $message\n";
		if ( null !== $expected || null !== $actual ) {
			echo '    expected: ' . var_export( $expected, true ) . "\n";
			echo '    actual:   ' . var_export( $actual, true ) . "\n";
		}
	}
}

function eq( string $message, $expected, $actual ): void {
	check( $message, $expected === $actual, $expected, $actual );
}

// Shortcut: build a pet state with overrides.
function pet( array $overrides = array() ): array {
	return array_merge(
		array(
			'species'              => 'chickenoid',
			'stage'                => 'egg',
			'happiness'            => 60,
			'hunger'               => 30,
			'age_ticks'            => 0,
			'cumulative_happiness' => 0,
			'personality'          => 'grumpy',
			'last_interaction'     => 0,
			'last_action'          => null,
		),
		$overrides
	);
}

// Namespaced function shortcuts.
use function Mochi\State\create_pet;
use function Mochi\State\step;
use function Mochi\State\maybe_evolve;
use function Mochi\State\mood_of;
use function Mochi\State\clamp;
use function Mochi\State\stub_speech;

// ────────────────────────────────────────────────────────────────────────
// create_pet
// ────────────────────────────────────────────────────────────────────────

group( 'create_pet' );

$p = create_pet();
eq( 'starts as egg', 'egg', $p['stage'] );
eq( 'starts at happiness 60', 60, $p['happiness'] );
eq( 'starts at hunger 30', 30, $p['hunger'] );
eq( 'starts at age_ticks 0', 0, $p['age_ticks'] );
eq( 'starts with cumulative_happiness 0', 0, $p['cumulative_happiness'] );
eq( 'last_action is null', null, $p['last_action'] );
eq( 'respects custom personality (dramatic)', 'dramatic', create_pet( 'dramatic' )['personality'] );
eq( 'respects custom personality (chipper)', 'chipper', create_pet( 'chipper' )['personality'] );

// ────────────────────────────────────────────────────────────────────────
// step — feed
// ────────────────────────────────────────────────────────────────────────

group( 'step — feed' );

$out = step( pet( array( 'hunger' => 50, 'happiness' => 60 ) ), 'feed' );
eq( 'hunger reduced by 30', 20, $out['state']['hunger'] );
eq( 'happiness +5 on normal feed', 65, $out['state']['happiness'] );
eq( 'last_action is feed', 'feed', $out['state']['last_action'] );

$out = step( pet( array( 'hunger' => 10, 'happiness' => 60 ) ), 'feed' );
eq( 'hunger clamps at 0', 0, $out['state']['hunger'] );

$out = step( pet( array( 'hunger' => 0, 'happiness' => 70 ) ), 'feed' );
eq( 'overfeeding at hunger 0 penalizes happiness -5', 65, $out['state']['happiness'] );

// ────────────────────────────────────────────────────────────────────────
// step — pet
// ────────────────────────────────────────────────────────────────────────

group( 'step — pet' );

$out = step( pet( array( 'happiness' => 60, 'hunger' => 30 ) ), 'pet' );
eq( 'happiness +10 normal', 70, $out['state']['happiness'] );
eq( 'hunger +2 from petting', 32, $out['state']['hunger'] );

$out = step( pet( array( 'happiness' => 90, 'hunger' => 30 ) ), 'pet' );
eq( 'ecstatic bonus +15 at happiness 90', 100, $out['state']['happiness'] );

$out = step( pet( array( 'happiness' => 95, 'hunger' => 30 ) ), 'pet' );
eq( 'happiness clamps at 100', 100, $out['state']['happiness'] );

// ────────────────────────────────────────────────────────────────────────
// step — ignore
// ────────────────────────────────────────────────────────────────────────

group( 'step — ignore' );

$out = step( pet( array( 'happiness' => 60, 'hunger' => 30 ) ), 'ignore' );
eq( 'happiness -10 on ignore', 50, $out['state']['happiness'] );
eq( 'hunger +10 on ignore', 40, $out['state']['hunger'] );

$out = step( pet( array( 'happiness' => 5, 'hunger' => 30 ) ), 'ignore' );
eq( 'happiness clamps at 0', 0, $out['state']['happiness'] );

// ────────────────────────────────────────────────────────────────────────
// step — starving penalty
// ────────────────────────────────────────────────────────────────────────

group( 'step — starving penalty' );

$out = step( pet( array( 'happiness' => 60, 'hunger' => 85 ) ), 'ignore' );
eq( 'hunger 85 + ignore = 95', 95, $out['state']['hunger'] );
eq( 'starving penalty applies (60-10-5 = 45)', 45, $out['state']['happiness'] );

$out = step( pet( array( 'happiness' => 60, 'hunger' => 70 ) ), 'ignore' );
eq( 'hunger below 90 does not trigger starving', 50, $out['state']['happiness'] );

// ────────────────────────────────────────────────────────────────────────
// step — bookkeeping
// ────────────────────────────────────────────────────────────────────────

group( 'step — bookkeeping' );

$p = pet( array( 'age_ticks' => 0 ) );
$p = step( $p, 'feed' )['state'];
eq( 'age_ticks increments to 1', 1, $p['age_ticks'] );
$p = step( $p, 'pet' )['state'];
eq( 'age_ticks increments to 2', 2, $p['age_ticks'] );
$p = step( $p, 'ignore' )['state'];
eq( 'age_ticks increments to 3', 3, $p['age_ticks'] );

$p1 = step( pet( array( 'happiness' => 60, 'hunger' => 30 ) ), 'feed' )['state'];
eq( 'cumulative_happiness accumulates new happiness', 65, $p1['cumulative_happiness'] );
$p2 = step( $p1, 'pet' )['state'];
eq( 'cumulative_happiness accumulates over steps', 65 + 75, $p2['cumulative_happiness'] );

// ────────────────────────────────────────────────────────────────────────
// maybe_evolve
// ────────────────────────────────────────────────────────────────────────

group( 'maybe_evolve' );

$r = maybe_evolve(
	pet( array( 'stage' => 'egg', 'age_ticks' => 2, 'cumulative_happiness' => 0 ) )
);
check( 'egg → hatchling at age 2', $r['evolved'] === true && $r['state']['stage'] === 'hatchling' );
eq( 'previous_stage is egg', 'egg', $r['previous_stage'] );

$r = maybe_evolve(
	pet( array( 'stage' => 'egg', 'age_ticks' => 1, 'cumulative_happiness' => 100 ) )
);
check( 'egg does not evolve before age 2', $r['evolved'] === false );

$low = maybe_evolve(
	pet( array( 'stage' => 'hatchling', 'age_ticks' => 5, 'cumulative_happiness' => 200 ) )
);
check( 'hatchling stalls at avg happiness 40', $low['evolved'] === false );

$high = maybe_evolve(
	pet( array( 'stage' => 'hatchling', 'age_ticks' => 5, 'cumulative_happiness' => 300 ) )
);
check( 'hatchling → chick at avg happiness 60', $high['evolved'] === true && $high['state']['stage'] === 'chick' );

$too_young = maybe_evolve(
	pet( array( 'stage' => 'chick', 'age_ticks' => 8, 'cumulative_happiness' => 800 ) )
);
check( 'chick → chonk fails when too young (age 8)', $too_young['evolved'] === false );

$too_sad = maybe_evolve(
	pet( array( 'stage' => 'chick', 'age_ticks' => 10, 'cumulative_happiness' => 400 ) )
);
check( 'chick → chonk fails when too sad (avg 40)', $too_sad['evolved'] === false );

$ok = maybe_evolve(
	pet( array( 'stage' => 'chick', 'age_ticks' => 10, 'cumulative_happiness' => 700 ) )
);
check( 'chick → chonk when age 10 AND avg 70', $ok['evolved'] === true && $ok['state']['stage'] === 'chonk' );

$final = maybe_evolve(
	pet( array( 'stage' => 'final_form', 'age_ticks' => 100, 'cumulative_happiness' => 100000 ) )
);
check( 'final_form never evolves further', $final['evolved'] === false && $final['state']['stage'] === 'final_form' );

// ────────────────────────────────────────────────────────────────────────
// mood_of
// ────────────────────────────────────────────────────────────────────────

group( 'mood_of' );

eq( 'happiness 0 → miserable', 'miserable', mood_of( pet( array( 'happiness' => 0 ) ) ) );
eq( 'happiness 19 → miserable', 'miserable', mood_of( pet( array( 'happiness' => 19 ) ) ) );
eq( 'happiness 20 → sad', 'sad', mood_of( pet( array( 'happiness' => 20 ) ) ) );
eq( 'happiness 39 → sad', 'sad', mood_of( pet( array( 'happiness' => 39 ) ) ) );
eq( 'happiness 40 → neutral', 'neutral', mood_of( pet( array( 'happiness' => 40 ) ) ) );
eq( 'happiness 64 → neutral', 'neutral', mood_of( pet( array( 'happiness' => 64 ) ) ) );
eq( 'happiness 65 → content', 'content', mood_of( pet( array( 'happiness' => 65 ) ) ) );
eq( 'happiness 89 → content', 'content', mood_of( pet( array( 'happiness' => 89 ) ) ) );
eq( 'happiness 90 → ecstatic', 'ecstatic', mood_of( pet( array( 'happiness' => 90 ) ) ) );
eq( 'happiness 100 → ecstatic', 'ecstatic', mood_of( pet( array( 'happiness' => 100 ) ) ) );

// ────────────────────────────────────────────────────────────────────────
// integration — full evolution path
// ────────────────────────────────────────────────────────────────────────

group( 'integration — full evolution path' );

$p = create_pet();
$stages_seen = array( 'egg' );
for ( $i = 0; $i < 20; $i++ ) {
	$action = $i % 2 === 0 ? 'feed' : 'pet';
	$out = step( $p, $action );
	$p = $out['state'];
	if ( $out['evolved'] ) {
		$stages_seen[] = $p['stage'];
	}
}
check(
	'alternating feed/pet reaches final_form in 20 ticks',
	$stages_seen === array( 'egg', 'hatchling', 'chick', 'chonk', 'final_form' )
);

$p = create_pet();
for ( $i = 0; $i < 20; $i++ ) {
	$p = step( $p, 'ignore' )['state'];
}
eq( 'pure neglect stalls at hatchling (no happiness for chick gate)', 'hatchling', $p['stage'] );

// ────────────────────────────────────────────────────────────────────────
// shared fixtures — parity with TS
// ────────────────────────────────────────────────────────────────────────
//
// Loads tests/fixtures/state-transitions.json — the SAME file consumed by
// packages/state/src/index.test.ts. Any drift between the TS and PHP
// implementations fails one of the two suites immediately.

group( 'shared fixtures — parity with TS' );

$fixture_path = __DIR__ . '/../fixtures/state-transitions.json';
$fixture_json = file_get_contents( $fixture_path );
check( 'fixture file loads', false !== $fixture_json );
$fixtures = json_decode( $fixture_json, true );
check( 'fixture file is valid JSON', is_array( $fixtures ) );

foreach ( $fixtures as $fixture ) {
	$result = step( $fixture['input'], $fixture['action'] );

	check(
		"{$fixture['name']} — evolved",
		$result['evolved'] === $fixture['expected_evolved']
	);
	check(
		"{$fixture['name']} — previous_stage",
		$result['previous_stage'] === $fixture['expected_previous_stage']
	);

	foreach ( $fixture['expected_state'] as $key => $expected_value ) {
		check(
			"{$fixture['name']} — state.$key",
			$result['state'][ $key ] === $expected_value,
			$expected_value,
			$result['state'][ $key ] ?? null
		);
	}
}

// ────────────────────────────────────────────────────────────────────────
// stub_speech — full coverage matrix
// ────────────────────────────────────────────────────────────────────────
//
// Every cell of (personality × mood × action) must return a non-empty string,
// plus the evolution branch for each personality. Catches typos or missing
// keys in the $lines / $evolution_lines tables inside stub_speech.

group( 'stub_speech — coverage matrix' );

$personalities = array( 'grumpy', 'chipper', 'deadpan', 'dramatic' );
// Happiness values that fall cleanly inside each mood band. Mirrors the
// ranges in State\mood_of — see the mood_of tests above for the boundaries.
$happiness_by_mood = array(
	'miserable' => 10,
	'sad'       => 30,
	'neutral'   => 50,
	'content'   => 75,
	'ecstatic'  => 95,
);
$actions       = array( 'feed', 'pet', 'ignore' );
$seen_lines    = array();

foreach ( $personalities as $personality ) {
	foreach ( $happiness_by_mood as $mood => $happiness ) {
		// Pre-verify our happiness-to-mood mapping so a test failure below
		// is clearly a stub_speech bug, not a fixture mistake.
		eq(
			"happiness $happiness → $mood (fixture sanity)",
			$mood,
			mood_of( pet( array( 'happiness' => $happiness ) ) )
		);

		foreach ( $actions as $action ) {
			$state = pet(
				array(
					'personality' => $personality,
					'happiness'   => $happiness,
				)
			);
			$line = stub_speech( $state, $action, false );

			check(
				"$personality / $mood / $action → non-empty string under 200 chars",
				is_string( $line ) && strlen( $line ) > 0 && strlen( $line ) < 200
			);

			$seen_lines[] = $line;
		}
	}

	// Evolution line per personality.
	$state  = pet( array( 'personality' => $personality, 'happiness' => 75, 'stage' => 'chick' ) );
	$e_line = stub_speech( $state, 'feed', true );
	check(
		"$personality evolution line → non-empty string under 200 chars",
		is_string( $e_line ) && strlen( $e_line ) > 0 && strlen( $e_line ) < 200
	);
}

// Cross-personality divergence — same mood+action must NOT produce identical
// lines across all four personalities (catches someone accidentally sharing
// content across tables).
$shared = array(
	stub_speech( pet( array( 'personality' => 'grumpy',   'happiness' => 75 ) ), 'feed', false ),
	stub_speech( pet( array( 'personality' => 'chipper',  'happiness' => 75 ) ), 'feed', false ),
	stub_speech( pet( array( 'personality' => 'deadpan',  'happiness' => 75 ) ), 'feed', false ),
	stub_speech( pet( array( 'personality' => 'dramatic', 'happiness' => 75 ) ), 'feed', false ),
);
check(
	'same mood+action produces distinct lines per personality',
	count( array_unique( $shared ) ) === 4
);

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────

echo "\n";
echo "──────────────────────────────────────────\n";
echo " \033[32m{$test_passed} passed\033[0m, " . ( $test_failed > 0 ? "\033[31m{$test_failed} failed\033[0m" : "{$test_failed} failed" ) . "\n";
echo "──────────────────────────────────────────\n";

exit( $test_failed > 0 ? 1 : 0 );
