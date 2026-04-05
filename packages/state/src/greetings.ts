/**
 * Page-context greetings for the Mochi floating widget.
 *
 * Lives in the state package rather than next to the UI because the logic is
 * pure (takes a body-class array as input, returns a string) and therefore
 * trivially unit-testable in a Node environment without a DOM. The UI layer
 * passes `document.body.className.split(/\s+/)` at the call site.
 *
 * PAGE_QUIPS is keyed on the body classes WordPress sets for each admin
 * page, e.g. `index-php`, `edit-php`, `post-new-php`. Stub-only — we don't
 * burn Anthropic tokens on ambient page commentary.
 *
 * Invariants enforced by tests:
 *   - Every personality has a `_firstBoot` and `_default` entry.
 *   - All personalities cover the exact same set of page keys (so adding
 *     a new page to one personality without adding it to the others fails).
 */

import type { Personality, PetState } from './index';

export const PAGE_QUIPS: Record< Personality, Record< string, string > > = {
	grumpy: {
		'index-php': 'Oh. The dashboard. Riveting.',
		'edit-php': 'Posts. You ever actually finish one?',
		'post-new-php': 'New post. I assume this one will die in drafts too.',
		'post-php': 'Editing. Again. Commit already.',
		'plugins-php': 'Installing more plugins. What could go wrong.',
		'upload-php': 'Media library. Digital hoarder.',
		'themes-php': 'Changing themes again. Commit to nothing.',
		'options-general-php': 'Settings. The procrastinators playground.',
		'users-php': 'Users. Name one you actually like.',
		'tools-php': 'Tools. As if you know what any of these do.',
		_default: 'Hm. This page. Fine.',
		_firstBoot: 'A dormant pod. I suppose you will want to poke it.',
	},
	chipper: {
		'index-php': 'The dashboard!! So much to DO today!!',
		'edit-php': 'Your posts!! So many ideas!! So much to share!!',
		'post-new-php': 'A NEW post!! This one will be your best yet!!',
		'post-php': 'Editing is where the MAGIC happens!!',
		'plugins-php': 'Ooh!! New plugins!! Gadgets!!',
		'upload-php': 'Look at all your lovely media!! So pretty!!',
		'themes-php': 'Themes!! So many possibilities!!',
		'options-general-php': 'Tweaking settings is so SATISFYING!!',
		'users-php': 'Look at all these friends!! Hi friends!!',
		'tools-php': 'TOOLS!! I love tools!! What do they DO!!',
		_default: 'Every page is an adventure!!',
		_firstBoot: 'A mysterious pod!! Lets see whats inside!!',
	},
	deadpan: {
		'index-php': 'The dashboard. Yes.',
		'edit-php': 'Posts. Words in boxes.',
		'post-new-php': 'You are creating a new post. Noted.',
		'post-php': 'Editing existing content. Bold.',
		'plugins-php': 'Plugin management. I have no strong feelings.',
		'upload-php': 'Media. Files that are visual.',
		'themes-php': 'You are considering aesthetics. Unusual.',
		'options-general-php': 'Configuration. This is the configuration page.',
		'users-php': 'People. On the internet.',
		'tools-php': 'Tools. Objects with purposes.',
		_default: 'A page. We are on it.',
		_firstBoot: 'An egg. It contains something. Probably.',
	},
	dramatic: {
		'index-php': 'THE DASHBOARD. Where warriors are FORGED!',
		'edit-php': 'The Hall of Posts. Each one a MEMORIAL.',
		'post-new-php': 'A NEW post?! Do you grasp the GRAVITY of creation??',
		'post-php': 'EDITING. The scalpel of genius.',
		'plugins-php': 'The sacred plugin archive. Choose with HONOR.',
		'upload-php': 'BEHOLD, the treasures of your media vault!',
		'themes-php': 'The robes of IDENTITY. Choose wisely!',
		'options-general-php': 'The LEVERS of your domain. Tread lightly!',
		'users-php': 'The assembly of souls who serve your cause.',
		'tools-php': 'IMPLEMENTS of will. USE THEM.',
		_default: 'Another chapter in our ETERNAL saga...',
		_firstBoot: 'An egg! Within it, destiny stirs!',
	},
};

/**
 * Pick a greeting line based on pet state and the current page's body classes.
 * Pure function — no DOM access. Caller passes `document.body.className.split(/\s+/)`.
 *
 * Selection order:
 *   1. First body class that exists as a key in the personality's PAGE_QUIPS.
 *   2. `_firstBoot` if the pet has never been interacted with (last_action === null).
 *   3. `_default` otherwise.
 *
 * Unknown personalities fall back to `grumpy` — defensive for hand-crafted state.
 */
export function pickGreeting( state: PetState, bodyClasses: string[] ): string {
	const table = PAGE_QUIPS[ state.personality ] ?? PAGE_QUIPS.grumpy;
	for ( const cls of bodyClasses ) {
		if ( table[ cls ] ) return table[ cls ];
	}
	if ( ! state.last_action ) return table._firstBoot;
	return table._default;
}
