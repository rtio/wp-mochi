/**
 * Unit tests for the Mochi state machine.
 *
 * This file is the canonical test suite for the game rules. Every rule
 * asserted here MUST also hold in the PHP mirror at includes/state.php
 * — the parallel test at tests/php/state-test.php runs the same scenarios
 * against the PHP implementation, so any drift between the two copies
 * fails one side or the other immediately.
 *
 * Pure unit tests — no DOM, no network, no WordPress mocks. Runs via `pnpm test:ts`.
 */

import { describe, expect, it } from 'vitest';
import {
	createPet,
	step,
	maybeEvolve,
	moodOf,
	isHungry,
	type PetState,
	type Stage,
	type Action,
} from './index';
// Shared fixtures — same file consumed by tests/php/state-test.php.
// Any drift between TS and PHP fails one side immediately.
import fixtures from '../../../tests/fixtures/state-transitions.json' with { type: 'json' };

/** Build a pet at a specific stage/stats for focused tests. */
function pet( overrides: Partial< PetState > = {} ): PetState {
	return {
		species: 'chickenoid',
		stage: 'egg',
		happiness: 60,
		hunger: 30,
		age_ticks: 0,
		cumulative_happiness: 0,
		personality: 'grumpy',
		last_interaction: 0,
		last_action: null,
		...overrides,
	};
}

describe( 'createPet', () => {
	it( 'starts as an egg with moderate stats', () => {
		const p = createPet();
		expect( p.stage ).toBe( 'egg' );
		expect( p.happiness ).toBe( 60 );
		expect( p.hunger ).toBe( 30 );
		expect( p.age_ticks ).toBe( 0 );
		expect( p.cumulative_happiness ).toBe( 0 );
		expect( p.last_action ).toBeNull();
	} );

	it( 'respects a custom personality', () => {
		expect( createPet( 'dramatic' ).personality ).toBe( 'dramatic' );
		expect( createPet( 'chipper' ).personality ).toBe( 'chipper' );
	} );
} );

describe( 'step — feed', () => {
	it( 'reduces hunger by 30 and bumps happiness by 5', () => {
		const { state } = step( pet( { hunger: 50, happiness: 60 } ), 'feed', 1 );
		expect( state.hunger ).toBe( 20 );
		expect( state.happiness ).toBe( 65 );
		expect( state.last_action ).toBe( 'feed' );
	} );

	it( 'clamps hunger at 0 (no negative hunger)', () => {
		const { state } = step( pet( { hunger: 10, happiness: 60 } ), 'feed', 1 );
		expect( state.hunger ).toBe( 0 );
	} );

	it( 'penalizes overfeeding when hunger is already 0 (or near)', () => {
		const { state } = step( pet( { hunger: 0, happiness: 70 } ), 'feed', 1 );
		expect( state.happiness ).toBe( 65 ); // -5 overfeed, not +5
	} );
} );

describe( 'step — pet', () => {
	it( 'increases happiness by 10 in the normal case', () => {
		const { state } = step( pet( { happiness: 60, hunger: 30 } ), 'pet', 1 );
		expect( state.happiness ).toBe( 70 );
		expect( state.hunger ).toBe( 32 ); // petting burns 2
	} );

	it( 'gives a +15 bonus when already ecstatic (happiness >= 90)', () => {
		const { state } = step( pet( { happiness: 90, hunger: 30 } ), 'pet', 1 );
		expect( state.happiness ).toBe( 100 );
	} );

	it( 'clamps happiness at 100', () => {
		const { state } = step( pet( { happiness: 95, hunger: 30 } ), 'pet', 1 );
		expect( state.happiness ).toBe( 100 );
	} );
} );

describe( 'step — ignore', () => {
	it( 'drops happiness by 10 and raises hunger by 10', () => {
		const { state } = step(
			pet( { happiness: 60, hunger: 30 } ),
			'ignore',
			1
		);
		expect( state.happiness ).toBe( 50 );
		expect( state.hunger ).toBe( 40 );
	} );

	it( 'clamps happiness at 0', () => {
		const { state } = step( pet( { happiness: 5, hunger: 30 } ), 'ignore', 1 );
		expect( state.happiness ).toBe( 0 );
	} );
} );

describe( 'step — starving penalty', () => {
	it( 'deducts an extra 5 happiness when hunger ends up >= 90', () => {
		// Start with hunger 85 and ignore → hunger becomes 95, triggers starving.
		// happiness 60 - 10 (ignore) - 5 (starving) = 45.
		const { state } = step(
			pet( { happiness: 60, hunger: 85 } ),
			'ignore',
			1
		);
		expect( state.hunger ).toBe( 95 );
		expect( state.happiness ).toBe( 45 );
	} );

	it( 'does not apply when hunger stays below 90', () => {
		const { state } = step(
			pet( { happiness: 60, hunger: 70 } ),
			'ignore',
			1
		);
		expect( state.hunger ).toBe( 80 );
		expect( state.happiness ).toBe( 50 ); // no extra penalty
	} );
} );

describe( 'step — bookkeeping', () => {
	it( 'increments age_ticks on every action', () => {
		let p = pet( { age_ticks: 0 } );
		p = step( p, 'feed', 1 ).state;
		expect( p.age_ticks ).toBe( 1 );
		p = step( p, 'pet', 1 ).state;
		expect( p.age_ticks ).toBe( 2 );
		p = step( p, 'ignore', 1 ).state;
		expect( p.age_ticks ).toBe( 3 );
	} );

	it( 'accumulates happiness into cumulative_happiness', () => {
		const p1 = step(
			pet( { happiness: 60, hunger: 30 } ),
			'feed',
			1
		).state;
		expect( p1.cumulative_happiness ).toBe( 65 ); // new happiness after feed

		const p2 = step( p1, 'pet', 1 ).state;
		expect( p2.cumulative_happiness ).toBe( 65 + 75 );
	} );
} );

describe( 'maybeEvolve', () => {
	it( 'advances egg → hatchling at age 2 regardless of happiness', () => {
		const { state, evolved, previous_stage } = maybeEvolve(
			pet( { stage: 'egg', age_ticks: 2, cumulative_happiness: 0 } )
		);
		expect( evolved ).toBe( true );
		expect( previous_stage ).toBe( 'egg' );
		expect( state.stage ).toBe( 'hatchling' );
	} );

	it( 'does not advance egg before age 2', () => {
		const { evolved } = maybeEvolve(
			pet( { stage: 'egg', age_ticks: 1, cumulative_happiness: 100 } )
		);
		expect( evolved ).toBe( false );
	} );

	it( 'requires average happiness >= 50 for hatchling → chick', () => {
		// age 5, avg 40 → no evolution
		const low = maybeEvolve(
			pet( {
				stage: 'hatchling',
				age_ticks: 5,
				cumulative_happiness: 200,
			} )
		);
		expect( low.evolved ).toBe( false );

		// age 5, avg 60 → evolution
		const high = maybeEvolve(
			pet( {
				stage: 'hatchling',
				age_ticks: 5,
				cumulative_happiness: 300,
			} )
		);
		expect( high.evolved ).toBe( true );
		expect( high.state.stage ).toBe( 'chick' );
	} );

	it( 'requires age >= 10 AND avg happiness >= 60 for chick → chonk', () => {
		// enough happiness but not enough age
		const tooYoung = maybeEvolve(
			pet( {
				stage: 'chick',
				age_ticks: 8,
				cumulative_happiness: 800, // avg 100
			} )
		);
		expect( tooYoung.evolved ).toBe( false );

		// enough age but not enough happiness
		const tooSad = maybeEvolve(
			pet( {
				stage: 'chick',
				age_ticks: 10,
				cumulative_happiness: 400, // avg 40
			} )
		);
		expect( tooSad.evolved ).toBe( false );

		// both thresholds met
		const ok = maybeEvolve(
			pet( {
				stage: 'chick',
				age_ticks: 10,
				cumulative_happiness: 700, // avg 70
			} )
		);
		expect( ok.evolved ).toBe( true );
		expect( ok.state.stage ).toBe( 'chonk' );
	} );

	it( 'is a no-op at final_form', () => {
		const r = maybeEvolve(
			pet( {
				stage: 'final_form',
				age_ticks: 100,
				cumulative_happiness: 100000,
			} )
		);
		expect( r.evolved ).toBe( false );
		expect( r.state.stage ).toBe( 'final_form' );
	} );
} );

describe( 'moodOf', () => {
	it( 'maps happiness ranges correctly', () => {
		expect( moodOf( pet( { happiness: 0 } ) ) ).toBe( 'miserable' );
		expect( moodOf( pet( { happiness: 19 } ) ) ).toBe( 'miserable' );
		expect( moodOf( pet( { happiness: 20 } ) ) ).toBe( 'sad' );
		expect( moodOf( pet( { happiness: 39 } ) ) ).toBe( 'sad' );
		expect( moodOf( pet( { happiness: 40 } ) ) ).toBe( 'neutral' );
		expect( moodOf( pet( { happiness: 64 } ) ) ).toBe( 'neutral' );
		expect( moodOf( pet( { happiness: 65 } ) ) ).toBe( 'content' );
		expect( moodOf( pet( { happiness: 89 } ) ) ).toBe( 'content' );
		expect( moodOf( pet( { happiness: 90 } ) ) ).toBe( 'ecstatic' );
		expect( moodOf( pet( { happiness: 100 } ) ) ).toBe( 'ecstatic' );
	} );
} );

describe( 'isHungry', () => {
	it( 'returns true when hunger >= 70', () => {
		expect( isHungry( pet( { hunger: 70 } ) ) ).toBe( true );
		expect( isHungry( pet( { hunger: 99 } ) ) ).toBe( true );
	} );

	it( 'returns false below 70', () => {
		expect( isHungry( pet( { hunger: 69 } ) ) ).toBe( false );
		expect( isHungry( pet( { hunger: 0 } ) ) ).toBe( false );
	} );
} );

describe( 'shared fixtures — parity with PHP', () => {
	// Each fixture is a single step() call with expected outputs. The SAME
	// JSON file is loaded by tests/php/state-test.php — any drift between
	// the TS and PHP implementations causes one side to fail.
	for ( const fixture of fixtures ) {
		it( fixture.name, () => {
			const result = step(
				fixture.input as PetState,
				fixture.action as Action,
				1
			);
			expect( result.evolved ).toBe( fixture.expected_evolved );
			expect( result.previous_stage ).toBe( fixture.expected_previous_stage );
			// Partial-match: only the keys listed in expected_state are
			// asserted, so adding new state fields doesn't require fixture updates.
			for ( const [ key, value ] of Object.entries( fixture.expected_state ) ) {
				expect(
					result.state[ key as keyof PetState ],
					`state.${ key } should equal ${ value }`
				).toBe( value );
			}
		} );
	}
} );

describe( 'integration — full evolution path', () => {
	it( 'evolves egg all the way to final_form with good care', () => {
		let p = createPet();
		const stages: Stage[] = [ 'egg' ];

		// Feed + pet loop. 20 ticks of alternating care should comfortably
		// satisfy every evolution gate.
		for ( let i = 0; i < 20; i++ ) {
			const action = i % 2 === 0 ? 'feed' : 'pet';
			const out = step( p, action, 1 );
			p = out.state;
			if ( out.evolved ) {
				stages.push( p.stage );
			}
		}

		expect( stages ).toEqual( [
			'egg',
			'hatchling',
			'chick',
			'chonk',
			'final_form',
		] );
	} );

	it( 'stalls at hatchling if we only ignore it', () => {
		let p = createPet();
		for ( let i = 0; i < 20; i++ ) {
			p = step( p, 'ignore', 1 ).state;
		}
		// Hatchling gate has no happiness requirement (min_avg_happiness: 0),
		// so we WILL reach it. But chick requires avg >= 50 which ignoring
		// alone cannot sustain — happiness decays toward 0.
		expect( p.stage ).toBe( 'hatchling' );
	} );
} );
