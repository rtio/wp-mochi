/**
 * Mochi pet state machine.
 *
 * Pure functions only — no DOM, no network, no WordPress globals.
 * Every action returns a fresh state object (no mutation) so it is
 * trivial to test, serialize to wp_options, and reason about.
 */

export type Stage = 'egg' | 'hatchling' | 'chick' | 'chonk' | 'final_form';

export type Personality = 'grumpy' | 'chipper' | 'deadpan' | 'dramatic';

export type Action = 'feed' | 'pet' | 'ignore';

export interface PetState {
	species: string;
	stage: Stage;
	/** 0 (miserable) – 100 (ecstatic) */
	happiness: number;
	/** 0 (full) – 100 (starving) */
	hunger: number;
	/** Ticks since hatching — one per action, regardless of type. */
	age_ticks: number;
	/** Sum of happiness at each tick. Used for average-happiness evolution gates. */
	cumulative_happiness: number;
	personality: Personality;
	/** Unix ms of the last interaction. */
	last_interaction: number;
	/** Last action applied, or null for a fresh pet. */
	last_action: Action | null;
}

export interface StepOutcome {
	state: PetState;
	/** True if this step crossed an evolution threshold. UI can celebrate. */
	evolved: boolean;
	/** Previous stage, if evolved — convenient for UI messaging. */
	previous_stage: Stage | null;
}

const STAGE_ORDER: Stage[] = [
	'egg',
	'hatchling',
	'chick',
	'chonk',
	'final_form',
];

/**
 * Evolution gates (action-based, tuned for a 5–10 minute demo session).
 * Each gate requires BOTH enough ticks AND a minimum average happiness,
 * so neglect alone cannot evolve the pet.
 */
const EVOLUTION_GATES: Record<
	Exclude<Stage, 'final_form'>,
	{ min_ticks: number; min_avg_happiness: number }
> = {
	egg: { min_ticks: 2, min_avg_happiness: 0 },
	hatchling: { min_ticks: 5, min_avg_happiness: 50 },
	chick: { min_ticks: 10, min_avg_happiness: 60 },
	chonk: { min_ticks: 18, min_avg_happiness: 70 },
};

const clamp = ( n: number, min = 0, max = 100 ): number =>
	Math.max( min, Math.min( max, n ) );

/**
 * Create a fresh pet. Starts as an egg with moderate stats so the
 * first interaction is neither immediate game-over nor trivially happy.
 */
export function createPet(
	personality: Personality = 'grumpy',
	species = 'chickenoid',
	now: number = Date.now()
): PetState {
	return {
		species,
		stage: 'egg',
		happiness: 60,
		hunger: 30,
		age_ticks: 0,
		cumulative_happiness: 0,
		personality,
		last_interaction: now,
		last_action: null,
	};
}

/**
 * Apply an action to a pet, returning the new state and whether an
 * evolution was triggered. Does not mutate the input.
 */
export function step(
	state: PetState,
	action: Action,
	now: number = Date.now()
): StepOutcome {
	let { happiness, hunger } = state;

	switch ( action ) {
		case 'feed':
			// Feeding a full pet makes it grumpy — overfeeding is rude.
			if ( hunger <= 5 ) {
				happiness = clamp( happiness - 5 );
			} else {
				happiness = clamp( happiness + 5 );
			}
			hunger = clamp( hunger - 30 );
			break;

		case 'pet':
			// Extra bonus when already happy — petting a happy pet is pure joy.
			happiness = clamp( happiness + ( happiness >= 90 ? 15 : 10 ) );
			hunger = clamp( hunger + 2 ); // petting burns a tiny bit of energy
			break;

		case 'ignore':
			happiness = clamp( happiness - 10 );
			hunger = clamp( hunger + 10 );
			break;
	}

	// Starving pets are miserable on top of whatever the action did.
	if ( hunger >= 90 ) {
		happiness = clamp( happiness - 5 );
	}

	const age_ticks = state.age_ticks + 1;
	const cumulative_happiness = state.cumulative_happiness + happiness;

	const intermediate: PetState = {
		...state,
		happiness,
		hunger,
		age_ticks,
		cumulative_happiness,
		last_interaction: now,
		last_action: action,
	};

	return maybeEvolve( intermediate );
}

/**
 * Check whether the pet has crossed its next evolution threshold and,
 * if so, advance a single stage. Only advances by one stage per call,
 * even if multiple gates are simultaneously satisfied — one celebration
 * per tick keeps the UI legible.
 */
export function maybeEvolve( state: PetState ): StepOutcome {
	if ( state.stage === 'final_form' ) {
		return { state, evolved: false, previous_stage: null };
	}

	const gate = EVOLUTION_GATES[ state.stage ];
	const avg_happiness =
		state.age_ticks > 0
			? state.cumulative_happiness / state.age_ticks
			: 0;

	const eligible =
		state.age_ticks >= gate.min_ticks &&
		avg_happiness >= gate.min_avg_happiness;

	if ( ! eligible ) {
		return { state, evolved: false, previous_stage: null };
	}

	const next_stage = STAGE_ORDER[ STAGE_ORDER.indexOf( state.stage ) + 1 ];

	return {
		state: { ...state, stage: next_stage },
		evolved: true,
		previous_stage: state.stage,
	};
}

/**
 * Derived mood label from raw happiness. Used by the UI and passed to
 * the AI as context so speech-bubble lines match the pet's face.
 */
export type Mood = 'miserable' | 'sad' | 'neutral' | 'content' | 'ecstatic';

export function moodOf( state: PetState ): Mood {
	const h = state.happiness;
	if ( h < 20 ) return 'miserable';
	if ( h < 40 ) return 'sad';
	if ( h < 65 ) return 'neutral';
	if ( h < 90 ) return 'content';
	return 'ecstatic';
}

/**
 * Whether the pet is hungry enough to complain about it.
 * UI hint — not a gate on any action.
 */
export function isHungry( state: PetState ): boolean {
	return state.hunger >= 70;
}

// Re-export page-context greetings so consumers get one entry point.
export { PAGE_QUIPS, pickGreeting } from './greetings';
