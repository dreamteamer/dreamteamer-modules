/**
 * The shared searchable-dropdown logic — filtering, keyboard index math, and where to put the panel.
 *
 * Every `<select>` in this app was the native control. Native `<select>` cannot be searched, cannot
 * be styled to match the rest of the surface, and on a long vocabulary (an analyte enum with ~100
 * values, a collection list, an icon name) it is a scrolling wall you have to hunt through. This is
 * the logic behind `DtSelect.vue`, kept framework-free so the parts that are easy to get subtly
 * wrong — wrap-around, what search matches, flipping the panel — are testable by running them.
 */

/** `{text, value}` — the dropdown's own row; `lib/choices.ts` turns an enum's choice rows into these. */
export interface Choice {
	text: string;
	value: unknown;
	/** Optional trailing hint, right-aligned and quiet (a collection path, a type). */
	hint?: string;
	/** A codicon name, from the field's enum map (its choice row's `icon`). Drawn before the label so
	 *  an enum reads the same in a dropdown as it does on a group header. A binary-record reference is NOT
	 *  resolved here — a dropdown row is not worth a fetch per option; those fall back to a glyph. */
	icon?: string;
	/** Theme colour id, tinting the glyph only. The label stays the foreground colour: a coloured
	 *  option label is unreadable against half the themes and reads as "disabled" in the other half. */
	color?: string;
}

/**
 * Above this many options the panel grows a search box.
 *
 * Below it, searching is noise: you can see every option at once, and a text input just puts a
 * keystroke between you and a two-item choice. Type-ahead still works at any size — the threshold
 * governs the visible INPUT, not the ability to filter.
 */
export const SEARCH_THRESHOLD = 7;

/**
 * Choices matching `query`, by the same rule the filter field tree uses: every whitespace-separated
 * term must appear somewhere in the text or the hint, case-insensitively.
 *
 * Deliberately not fuzzy, for the same reason as the field tree: a dropdown that guesses commits the
 * WRONG value, and a value you did not mean is worse than a list that finds nothing.
 */
export function filterChoices(choices: readonly Choice[], query: string): Choice[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return [...choices];
	return choices.filter((c) => {
		const hay = `${c.text} ${c.hint ?? ''} ${String(c.value ?? '')}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	});
}

/**
 * The next active index for an arrow key, WRAPPING at both ends.
 *
 * Wrapping because a dropdown is a ring in every implementation people have used — pressing Up on
 * the first item landing on the last is what a native `<select>` does not do and what everyone
 * expects anyway. `-1` (nothing active) enters at the first item going down, the last going up, so a
 * freshly opened panel responds to either arrow.
 */
export function moveActive(current: number, delta: number, length: number): number {
	if (length <= 0) return -1;
	if (current < 0) return delta > 0 ? 0 : length - 1;
	return (current + delta + length) % length;
}

/** Where the current value sits in a filtered list, or -1 — what the panel opens focused on. */
export function indexOfValue(choices: readonly Choice[], value: unknown): number {
	return choices.findIndex((c) => sameValue(c.value, value));
}

/**
 * Choice equality.
 *
 * ⚠ Loose on purpose across string/number. A `<select>`'s value is ALWAYS a string, so a numeric
 * enum round-tripped through the DOM came back as `"3"` and stopped matching the choice whose value
 * is `3` — the control then showed the placeholder over a field that had a perfectly good value.
 * This component never goes through the DOM, but its callers still hold values that came from one.
 */
export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a === 'object' || typeof b === 'object') return false;
	return String(a) === String(b);
}

/** A panel's vertical placement against the viewport — computed, never assumed. */
export interface Placement {
	/** Viewport coordinates for a `position: fixed` panel. */
	top: number;
	left: number;
	width: number;
	maxHeight: number;
	/** True when the panel had to open UPWARD because there was not enough room below. */
	flipped: boolean;
}

/**
 * Place a panel under (or over) its control.
 *
 * ⚠ `position: fixed`, and the reason matters: an absolutely positioned panel is CLIPPED by any
 * ancestor that scrolls, and this app puts dropdowns inside exactly that — `.dt-browse-filter-panel`
 * is `overflow-y: auto`. Fixed elements are positioned against the viewport and escape ancestor
 * overflow without a teleport, which is what lets these panels live in their component's own DOM
 * (see FilterFieldPicker's header for why teleporting is refused here). Fixed is defeated by an
 * ancestor with `transform`/`filter`/`will-change`; this app has none on a container.
 */
export function placePanel(
	anchor: { top: number; bottom: number; left: number; width: number },
	viewport: { width: number; height: number },
	desiredHeight: number,
	options: { gap?: number; margin?: number; minWidth?: number } = {},
): Placement {
	const gap = options.gap ?? 4;
	const margin = options.margin ?? 8;
	const below = viewport.height - anchor.bottom - gap - margin;
	const above = anchor.top - gap - margin;
	// Flip only when below genuinely cannot hold it AND above is roomier — never merely because
	// below is smaller, or a control near the middle of a tall page would flip for no reason.
	const flipped = below < desiredHeight && above > below;
	const maxHeight = Math.max(120, Math.min(desiredHeight, flipped ? above : below));
	const width = Math.max(options.minWidth ?? 0, anchor.width);
	// Keep the panel on screen horizontally: a control near the right edge would otherwise render a
	// wider panel off the side, where its rightmost text is unreachable.
	const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin));
	return {
		top: flipped ? anchor.top - gap - maxHeight : anchor.bottom + gap,
		left,
		width,
		maxHeight,
		flipped,
	};
}
