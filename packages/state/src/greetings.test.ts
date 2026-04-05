/**
 * Tests for pickGreeting + PAGE_QUIPS.
 *
 * Pure logic — no DOM, no browser APIs. The UI layer is responsible for
 * passing `document.body.className.split(/\s+/)` at the call site; these
 * tests exercise pickGreeting with fixture arrays.
 *
 * The "all personalities cover the same keys" test is the most valuable:
 * it catches adding a new page quip to one personality and forgetting the
 * other three, which is exactly the kind of edit that's easy to make.
 */

import { describe, expect, it } from 'vitest';
import { pickGreeting, PAGE_QUIPS } from './greetings';
import type { PetState, Personality } from './index';

function petWith( overrides: Partial< PetState > ): PetState {
	return {
		species: 'chickenoid',
		stage: 'chick',
		happiness: 60,
		hunger: 30,
		age_ticks: 5,
		cumulative_happiness: 300,
		personality: 'grumpy',
		last_interaction: 0,
		last_action: 'feed',
		...overrides,
	};
}

describe( 'pickGreeting', () => {
	it( 'returns the page-specific line when body class matches', () => {
		const state = petWith( { personality: 'grumpy' } );
		expect( pickGreeting( state, [ 'wp-admin', 'edit-php' ] ) ).toBe(
			PAGE_QUIPS.grumpy[ 'edit-php' ]
		);
	} );

	it( 'matches on any class in the array, not just the first', () => {
		const state = petWith( { personality: 'chipper' } );
		expect(
			pickGreeting( state, [ 'wp-admin', 'wp-core-ui', 'plugins-php' ] )
		).toBe( PAGE_QUIPS.chipper[ 'plugins-php' ] );
	} );

	it( 'returns _firstBoot when last_action is null (new pet)', () => {
		const state = petWith( { personality: 'grumpy', last_action: null } );
		expect( pickGreeting( state, [ 'wp-admin', 'some-unknown-page' ] ) ).toBe(
			PAGE_QUIPS.grumpy._firstBoot
		);
	} );

	it( 'returns _default when no class matches and pet has history', () => {
		const state = petWith( { personality: 'grumpy', last_action: 'feed' } );
		expect(
			pickGreeting( state, [ 'wp-admin', 'some-totally-unknown-page' ] )
		).toBe( PAGE_QUIPS.grumpy._default );
	} );

	it( 'prefers page match even when last_action is null', () => {
		// page-specific quip wins over _firstBoot
		const state = petWith( { personality: 'dramatic', last_action: null } );
		expect( pickGreeting( state, [ 'edit-php' ] ) ).toBe(
			PAGE_QUIPS.dramatic[ 'edit-php' ]
		);
	} );

	it( 'uses the first matching class when multiple match', () => {
		const state = petWith( { personality: 'grumpy' } );
		// Both 'edit-php' and 'post-new-php' are valid keys; iteration order
		// of the bodyClasses array decides.
		expect(
			pickGreeting( state, [ 'edit-php', 'post-new-php' ] )
		).toBe( PAGE_QUIPS.grumpy[ 'edit-php' ] );
		expect(
			pickGreeting( state, [ 'post-new-php', 'edit-php' ] )
		).toBe( PAGE_QUIPS.grumpy[ 'post-new-php' ] );
	} );

	it( 'falls back to grumpy for unknown personality', () => {
		const state = petWith( {
			personality: 'invalid' as unknown as Personality,
		} );
		expect( pickGreeting( state, [ 'edit-php' ] ) ).toBe(
			PAGE_QUIPS.grumpy[ 'edit-php' ]
		);
	} );

	it( 'handles an empty bodyClasses array (no DOM classes set)', () => {
		const state = petWith( { personality: 'deadpan', last_action: 'pet' } );
		expect( pickGreeting( state, [] ) ).toBe( PAGE_QUIPS.deadpan._default );
	} );
} );

describe( 'PAGE_QUIPS — structural invariants', () => {
	const personalities: Personality[] = [
		'grumpy',
		'chipper',
		'deadpan',
		'dramatic',
	];

	it( 'has all 4 personalities', () => {
		for ( const p of personalities ) {
			expect( PAGE_QUIPS[ p ] ).toBeDefined();
		}
	} );

	it( 'every personality has _firstBoot and _default', () => {
		for ( const p of personalities ) {
			expect( PAGE_QUIPS[ p ]._firstBoot ).toBeTruthy();
			expect( PAGE_QUIPS[ p ]._default ).toBeTruthy();
		}
	} );

	it( 'every personality covers the same set of page keys', () => {
		const reference = Object.keys( PAGE_QUIPS.grumpy ).sort();
		for ( const p of personalities ) {
			expect( Object.keys( PAGE_QUIPS[ p ] ).sort() ).toEqual( reference );
		}
	} );

	it( 'no quip is empty', () => {
		for ( const p of personalities ) {
			for ( const [ key, line ] of Object.entries( PAGE_QUIPS[ p ] ) ) {
				expect(
					line,
					`${ p }/${ key } should be non-empty`
				).toBeTruthy();
				expect(
					typeof line,
					`${ p }/${ key } should be a string`
				).toBe( 'string' );
			}
		}
	} );

	it( 'no quip is absurdly long (speech bubble fits)', () => {
		for ( const p of personalities ) {
			for ( const [ key, line ] of Object.entries( PAGE_QUIPS[ p ] ) ) {
				expect(
					line.length,
					`${ p }/${ key } is ${ line.length } chars (max 100)`
				).toBeLessThan( 100 );
			}
		}
	} );
} );
