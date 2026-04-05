/**
 * Mochi — floating pet component (Clippy mode).
 *
 * This is the component that lives in the bottom-right corner of every admin
 * page. It has three visual states controlled entirely by internal state:
 *
 *   1. Loading skeleton — brief, until `GET /state` resolves.
 *   2. Full widget — compact card with sprite, bubble, stats, action buttons,
 *      and a close X that collapses to the peek handle.
 *   3. Peek handle — tiny clickable sprite button that restores the full widget.
 *
 * Hidden state is persisted in localStorage (`mochi_hidden`). Restoration
 * can come from either the peek handle click or the `mochi:show` event
 * which InspectorPanel dispatches from its "Show pet" button on the menu page.
 *
 * The component is deliberately self-contained so the routes/ migration remains
 * cheap: only the caller changes (body-level mount vs route stage export).
 * See docs/MIGRATION-TO-ROUTES.md.
 */

import {
	createElement,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import type { PetState, Personality, Stage, Mood } from '@mochi/state';
import { moodOf, pickGreeting } from '@mochi/state';

/**
 * Pixel-art sprite grids. 12×12 each. Salmon-pink robots on a dark backdrop,
 * deliberately goofy. Art-style reference matched: chunky squares, limited
 * palette, rectangular black eye slots, stubby legs. Characters:
 *   .  transparent
 *   p  pink body
 *   e  eye / screen / mouth dark
 *   a  antenna stem (same as body — hook for future shading)
 *   r  red LED accent (power light)
 */
const SPRITE_GRIDS: Record< Stage, string[] > = {
	// Sealed pod. Dormant robot. One tiny red power light at the bottom.
	egg: [
		'............',
		'............',
		'...pppppp...',
		'..pppppppp..',
		'.pppppppppp.',
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'.pppppppppp.',
		'.pppppppppp.',
		'..ppprppp...',
		'...pppppp...',
	],
	// Pod cracking open — faint eye slot glimmers through.
	hatchling: [
		'............',
		'............',
		'...pppppp...',
		'..pppppppp..',
		'.pppppppppp.',
		'pppppppppppp',
		'pppp.ee.pppp',
		'pppp.ee.pppp',
		'pppppppppppp',
		'.pppppppppp.',
		'..pppppppp..',
		'...pppppp...',
	],
	// First fully-booted robot. Stub antenna, classic eye slots, stubby legs.
	chick: [
		'............',
		'.....pp.....',
		'.....pp.....',
		'..pppppppp..',
		'.pppppppppp.',
		'pppppppppppp',
		'.peeppppeep.',
		'.peeppppeep.',
		'.pppppppppp.',
		'.pppppppppp.',
		'..pp....pp..',
		'..pp....pp..',
	],
	// Bigger robot. Taller antenna, wider eye slots, wider stance.
	chonk: [
		'.....pp.....',
		'.....pp.....',
		'.....pp.....',
		'.pppppppppp.',
		'pppppppppppp',
		'peeeppppeeep',
		'peeeppppeeep',
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'.pp......pp.',
	],
	// Generic final form — only used as a type-safety fallback. Real final
	// forms are in FINAL_FORMS (personality-branched). Matches dramatic
	// so the fallback at least looks intentional.
	final_form: [
		'.p..p..p..p.',
		'.pppppppppp.',
		'pppppppppppp',
		'pppppppppppp',
		'peeeppppeeep',
		'peeeppppeeep',
		'pppppppppppp',
		'.pppeeeeppp.',
		'pppppppppppp',
		'pppppppppppp',
		'p..pppppp..p',
		'pp........pp',
	],
};

/**
 * Personality-branched final forms. Each one has its own silhouette and
 * signature feature, not just "chick body with accessories". Selected at
 * render time based on pet.personality when pet.stage === 'final_form'.
 *
 * Design notes (so future sessions understand the intent):
 *   grumpy   — squat, angry-brow spikes, extra-wide leg stance, heavy-set
 *   chipper  — floating sparkles above head, round eyes, smile mouth
 *   deadpan  — single horizontal eye slit across the face, flat mouth, minimal
 *   dramatic — crown of four spikes, body with cape flare at the bottom
 */
const FINAL_FORMS: Record< Personality, string[] > = {
	grumpy: [
		'............',
		'............',
		'..ee....ee..', // eyebrow spikes
		'.pppppppppp.',
		'pppppppppppp',
		'peeeppppeeep',
		'peeeppppeeep',
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'pp........pp', // very wide stance
	],
	chipper: [
		'..p..pp..p..', // sparkles above
		'............',
		'.pppppppppp.',
		'pppppppppppp',
		'peeppppppeep',
		'peeppppppeep',
		'pppppppppppp',
		'.pppeeeeppp.', // smile mouth
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'..pp....pp..',
	],
	deadpan: [
		'............',
		'............',
		'.pppppppppp.',
		'pppppppppppp',
		'pppppppppppp',
		'peeeeeeeeeep', // single long eye slit (HAL 9000 vibe)
		'pppppppppppp',
		'ppppeeeepppp', // flat mouth line
		'pppppppppppp',
		'pppppppppppp',
		'pppppppppppp',
		'..pp....pp..',
	],
	dramatic: [
		'.p..p..p..p.', // crown of 4 spikes
		'.pppppppppp.',
		'pppppppppppp',
		'pppppppppppp',
		'peeeppppeeep',
		'peeeppppeeep',
		'pppppppppppp',
		'.pppeeeeppp.',
		'pppppppppppp',
		'pppppppppppp',
		'p..pppppp..p', // cape flare
		'pp........pp', // cape bottom
	],
};

/**
 * Resolve the sprite grid for the current pet state. Branches on personality
 * only at the final_form stage; earlier stages are shared across all personalities.
 */
function getSpriteGrid( stage: Stage, personality: Personality ): string[] {
	if ( stage === 'final_form' && FINAL_FORMS[ personality ] ) {
		return FINAL_FORMS[ personality ];
	}
	return SPRITE_GRIDS[ stage ];
}

/** Character → hex color. `.` is intentionally absent (transparent). */
const PALETTE: Record< string, string > = {
	p: '#D97B7B', // salmon pink body
	e: '#1E232D', // eye slot / screen dark
	a: '#D97B7B', // antenna stem (matches body)
	r: '#FF4444', // red LED accent (egg power light)
};

/**
 * Render a 12×12 sprite grid as an inline SVG. One <rect> per colored pixel,
 * crispEdges rendering so pixels stay sharp at any display scale.
 */
function renderSprite( grid: string[], size: number = 160 ) {
	const rects: ReturnType< typeof createElement >[] = [];
	grid.forEach( ( row, y ) => {
		for ( let x = 0; x < row.length; x++ ) {
			const ch = row[ x ];
			const color = PALETTE[ ch ];
			if ( ! color ) continue;
			rects.push(
				createElement( 'rect', {
					key: `${ x }-${ y }`,
					x,
					y,
					width: 1,
					height: 1,
					fill: color,
				} )
			);
		}
	} );
	return createElement(
		'svg',
		{
			viewBox: '0 0 12 12',
			width: size,
			height: size,
			style: { shapeRendering: 'crispEdges', display: 'block' },
		},
		...rects
	);
}

const MOOD_FACE: Record< Mood, string > = {
	miserable: '(╥﹏╥)',
	sad: '(◞‸◟)',
	neutral: '(・_・)',
	content: '(^‿^)',
	ecstatic: '(✿◠‿◠)',
};

// PAGE_QUIPS + pickGreeting live in @mochi/state/greetings.ts so they're
// pure (no DOM access) and unit-testable. We just supply the current body
// classes at the call site below.

/**
 * Client-side idle quips. These fire after ~25s of inactivity and cycle
 * indefinitely. Stub-only by design — driving these from Anthropic would
 * mean an API call every 25s per open tab, which is absurd.
 */
const IDLE_LINES: Record< Personality, string[] > = {
	grumpy: [
		'…staring.',
		'I could be anywhere. Anywhere. But here I am.',
		'Are we going to do something or what.',
		'The silence is suffocating. Just say it.',
	],
	chipper: [
		'Just vibing!! So fun!!',
		'Today is going GREAT and I havent even done anything!!',
		'I love the wait!! Its part of the journey!!',
		'*happy humming*',
	],
	deadpan: [
		'...',
		'Waiting. Its a skill.',
		'I contain multitudes. None of them are doing anything.',
		'This moment will never come again. Shame.',
	],
	dramatic: [
		'THE WAITING. It CONSUMES me.',
		'A thousand lifetimes have passed in these seconds.',
		'Is this my FATE? To languish in this admin panel?',
		'I shall endure. I must. For destiny demands it.',
	],
};

const IDLE_INTERVAL_MS = 25_000;

const HIDDEN_STORAGE_KEY = 'mochi_hidden';

/**
 * Inline <style> block. We can't define @keyframes in inline style objects,
 * so we inject once at the top of the component tree. Scoped via specific
 * class names to avoid colliding with wp-admin styles.
 */
const ANIMATIONS_CSS = `
@keyframes mochi-bob {
	0%   { transform: translateY(0) scale(1); }
	35%  { transform: translateY(-14px) scale(1.06); }
	70%  { transform: translateY(0) scale(0.96); }
	100% { transform: translateY(0) scale(1); }
}
@keyframes mochi-fade {
	from { opacity: 0; transform: translateY(6px); }
	to   { opacity: 1; transform: translateY(0); }
}
@keyframes mochi-pulse {
	0%, 100% { box-shadow: 0 0 0 0 rgba(255, 217, 102, 0.55); }
	50%      { box-shadow: 0 0 0 10px rgba(255, 217, 102, 0); }
}
.mochi-sprite {
	transition: transform 0.2s ease;
}
.mochi-sprite.bob  { animation: mochi-bob 0.45s ease-out; }
.mochi-sprite.glow { animation: mochi-pulse 1.8s ease-in-out infinite; border-radius: 8px; }
.mochi-bubble      { animation: mochi-fade 0.35s ease-out; }
.mochi-flash       { animation: mochi-fade 0.4s ease-out; }
@keyframes mochi-skeleton {
	0%, 100% { background-color: #eceef0; }
	50%      { background-color: #f6f7f7; }
}
.mochi-skeleton {
	animation: mochi-skeleton 1.2s ease-in-out infinite;
	border-radius: 8px;
}
.mochi-peek:hover {
	transform: scale(1.08);
}
`;

interface InteractResponse {
	state: PetState;
	evolved: boolean;
	previous_stage: Stage | null;
	line: string;
	source: 'stub' | 'anthropic' | 'openai';
}

interface StateResponse {
	state: PetState;
	provider: 'anthropic' | 'openai';
	anthropic_key_configured: boolean;
	openai_key_configured: boolean;
}

export function StagePanel() {
	const [ pet, setPet ] = useState< PetState | null >( null );
	const [ line, setLine ] = useState< string >( 'Loading…' );
	const [ lineKey, setLineKey ] = useState< number >( 0 );
	const [ busy, setBusy ] = useState< boolean >( false );
	const [ flash, setFlash ] = useState< string | null >( null );
	const [ bobTick, setBobTick ] = useState< number >( 0 );
	const [ hidden, setHidden ] = useState< boolean >( () => {
		try {
			return localStorage.getItem( HIDDEN_STORAGE_KEY ) === '1';
		} catch {
			return false;
		}
	} );

	const updateLine = ( next: string ) => {
		setLine( next );
		setLineKey( ( k ) => k + 1 );
	};

	const fetchState = async () => {
		try {
			const res = await apiFetch< StateResponse >( {
				path: '/mochi/v1/state',
			} );
			setPet( res.state );
			const bodyClasses = document.body.className.split( /\s+/ );
			updateLine( pickGreeting( res.state, bodyClasses ) );
		} catch ( e ) {
			updateLine( `Error: ${ ( e as Error ).message }` );
		}
	};

	useEffect( () => {
		fetchState();
	}, [] );

	// Cross-panel refresh: InspectorPanel dispatches this after reset so we
	// don't need shared state management for a one-off sync point.
	useEffect( () => {
		const refreshHandler = () => fetchState();
		window.addEventListener( 'mochi:refresh', refreshHandler );
		return () =>
			window.removeEventListener( 'mochi:refresh', refreshHandler );
	}, [] );

	// Restore from the "Show pet" button on the settings page.
	useEffect( () => {
		const showHandler = () => {
			try {
				localStorage.removeItem( HIDDEN_STORAGE_KEY );
			} catch {
				/* ignore */
			}
			setHidden( false );
		};
		window.addEventListener( 'mochi:show', showHandler );
		return () => window.removeEventListener( 'mochi:show', showHandler );
	}, [] );

	// Idle quip cycling. Resets every time `line` changes (including when a
	// real interaction sets it), so the timer only fires after genuine inactivity.
	const idleTimer = useRef< number | null >( null );
	useEffect( () => {
		if ( ! pet || hidden ) return;
		if ( idleTimer.current ) {
			window.clearTimeout( idleTimer.current );
		}
		idleTimer.current = window.setTimeout( () => {
			const lines = IDLE_LINES[ pet.personality ] ?? IDLE_LINES.grumpy;
			const next = lines[ Math.floor( Math.random() * lines.length ) ];
			updateLine( next );
		}, IDLE_INTERVAL_MS );
		return () => {
			if ( idleTimer.current ) {
				window.clearTimeout( idleTimer.current );
			}
		};
	}, [ line, pet?.personality, hidden ] );

	const interact = async ( action: 'feed' | 'pet' | 'ignore' ) => {
		if ( busy ) return;
		setBusy( true );
		setFlash( null );
		setBobTick( ( t ) => t + 1 );
		try {
			const res = await apiFetch< InteractResponse >( {
				path: '/mochi/v1/interact',
				method: 'POST',
				data: { action },
			} );
			setPet( res.state );
			updateLine( res.line );
			if ( res.evolved && res.previous_stage ) {
				setFlash( `${ res.previous_stage } → ${ res.state.stage }!` );
			}
		} catch ( e ) {
			updateLine( `Something went wrong: ${ ( e as Error ).message }` );
		} finally {
			setBusy( false );
		}
	};

	const hide = () => {
		try {
			localStorage.setItem( HIDDEN_STORAGE_KEY, '1' );
		} catch {
			/* ignore */
		}
		setHidden( true );
	};

	const show = () => {
		try {
			localStorage.removeItem( HIDDEN_STORAGE_KEY );
		} catch {
			/* ignore */
		}
		setHidden( false );
	};

	const style_tag = createElement( 'style', null, ANIMATIONS_CSS );

	// --- Hidden: render the peek handle ---
	if ( hidden ) {
		return createElement(
			'div',
			{ style: { pointerEvents: 'none' } },
			style_tag,
			createElement(
				'button',
				{
					className: 'mochi-peek',
					onClick: show,
					title: 'Show Mochi',
					style: peekButton,
				},
				pet
					? renderSprite( getSpriteGrid( pet.stage, pet.personality ), 40 )
					: createElement( 'span', { style: peekFallback }, '🤖' )
			)
		);
	}

	// --- Loading skeleton (pet still fetching) ---
	if ( ! pet ) {
		return createElement(
			'div',
			{ style: card },
			style_tag,
			createElement( 'div', {
				style: skeletonSprite,
				className: 'mochi-skeleton',
			} ),
			createElement( 'div', {
				style: skeletonBubble,
				className: 'mochi-skeleton',
			} )
		);
	}

	// --- Full floating widget ---
	const mood = moodOf( pet );
	const spriteClass =
		'mochi-sprite' +
		( bobTick > 0 ? ' bob' : '' ) +
		( mood === 'ecstatic' ? ' glow' : '' );

	return createElement(
		'div',
		{ style: card },
		style_tag,
		createElement(
			'button',
			{
				onClick: hide,
				title: 'Minimize',
				style: closeButton,
				'aria-label': 'Minimize Mochi',
			},
			'\u2212' // Unicode minus sign — classic minimize glyph.
		),
		flash &&
			createElement(
				'div',
				{
					style: flashStyle,
					className: 'mochi-flash',
					key: `flash-${ flash }`,
				},
				`✨ ${ flash }`
			),
		createElement(
			'div',
			{ style: spriteWrap },
			createElement(
				'div',
				{
					style: spriteStage,
					className: spriteClass,
					key: `sprite-${ bobTick }-${ mood }`,
				},
				renderSprite( getSpriteGrid( pet.stage, pet.personality ), 144 ),
				createElement( 'div', { style: moodFace }, MOOD_FACE[ mood ] )
			)
		),
		createElement(
			'div',
			{
				style: bubble,
				className: 'mochi-bubble',
				key: `bubble-${ lineKey }`,
			},
			createElement( 'span', null, '“' + line + '”' )
		),
		createElement(
			'div',
			{ style: miniStats },
			miniStat( 'STAGE', pet.stage ),
			miniStat( 'HAPPY', `${ pet.happiness }` ),
			miniStat( 'FOOD', `${ 100 - pet.hunger }` )
		),
		createElement(
			'div',
			{ style: buttons },
			btn( '🍖', 'Feed', () => interact( 'feed' ), busy ),
			btn( '🫳', 'Pet', () => interact( 'pet' ), busy ),
			btn( '🙄', 'Ignore', () => interact( 'ignore' ), busy )
		)
	);
}

function miniStat( label: string, value: string ) {
	return createElement(
		'div',
		{ style: statBox, key: label },
		createElement( 'div', { style: statLabel }, label ),
		createElement( 'div', { style: statValue }, value )
	);
}

function btn(
	icon: string,
	label: string,
	onClick: () => void,
	disabled: boolean
) {
	return createElement(
		'button',
		{
			key: label,
			style: { ...button, opacity: disabled ? 0.5 : 1 },
			onClick,
			disabled,
			title: label,
		},
		icon
	);
}

const card: React.CSSProperties = {
	position: 'relative',
	width: 280,
	background: '#fff',
	border: '1px solid #c3c4c7',
	borderRadius: 12,
	boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
	padding: '1rem 1rem 0.9rem',
	fontFamily:
		'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
	color: '#1e1e1e',
	pointerEvents: 'auto',
};
const closeButton: React.CSSProperties = {
	position: 'absolute',
	top: 6,
	right: 8,
	width: 22,
	height: 22,
	padding: 0,
	border: 'none',
	background: 'transparent',
	color: '#757575',
	fontSize: 22,
	lineHeight: '18px',
	cursor: 'pointer',
	fontFamily: 'inherit',
	fontWeight: 600,
};
const spriteWrap: React.CSSProperties = {
	textAlign: 'center',
	margin: '0.25rem 0 0.5rem',
};
const spriteStage: React.CSSProperties = {
	display: 'inline-block',
};
const moodFace: React.CSSProperties = {
	color: '#50575e',
	fontFamily:
		'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
	fontSize: '0.85rem',
	marginTop: '0.1rem',
	letterSpacing: '0.02em',
};
const bubble: React.CSSProperties = {
	background: '#f6f7f7',
	border: '1px solid #dcdcde',
	borderRadius: 10,
	padding: '0.6rem 0.8rem',
	fontStyle: 'italic',
	textAlign: 'center',
	fontSize: '0.85rem',
	minHeight: '2.2em',
	marginBottom: '0.75rem',
};
const miniStats: React.CSSProperties = {
	display: 'grid',
	gridTemplateColumns: 'repeat(3, 1fr)',
	gap: '0.4rem',
	marginBottom: '0.75rem',
};
const statBox: React.CSSProperties = {
	background: '#f6f7f7',
	borderRadius: 6,
	padding: '0.35rem 0.25rem',
	textAlign: 'center',
};
const statLabel: React.CSSProperties = {
	fontSize: '0.6rem',
	color: '#757575',
	letterSpacing: '0.06em',
	fontWeight: 600,
};
const statValue: React.CSSProperties = {
	fontSize: '0.85rem',
	fontWeight: 600,
	marginTop: '0.15rem',
};
const buttons: React.CSSProperties = {
	display: 'flex',
	gap: '0.5rem',
	justifyContent: 'center',
};
const button: React.CSSProperties = {
	padding: '0.4rem 0.7rem',
	borderRadius: 6,
	border: '1px solid #1e1e1e',
	background: '#1e1e1e',
	color: '#fff',
	fontSize: '1.05rem',
	cursor: 'pointer',
	lineHeight: 1,
};
const flashStyle: React.CSSProperties = {
	background: '#fffbe6',
	border: '1px solid #f1d982',
	borderRadius: 6,
	padding: '0.4rem',
	textAlign: 'center',
	marginBottom: '0.6rem',
	fontWeight: 600,
	fontSize: '0.8rem',
};
const skeletonSprite: React.CSSProperties = {
	width: 144,
	height: 144,
	margin: '0.5rem auto',
};
const skeletonBubble: React.CSSProperties = {
	height: 36,
	margin: '0 0 0.75rem',
};
const peekButton: React.CSSProperties = {
	pointerEvents: 'auto',
	width: 56,
	height: 56,
	borderRadius: 12,
	background: '#fff',
	border: '1px solid #c3c4c7',
	boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
	cursor: 'pointer',
	padding: 8,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	transition: 'transform 0.15s ease',
};
const peekFallback: React.CSSProperties = {
	fontSize: 28,
};
