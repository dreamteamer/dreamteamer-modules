/**
 * THE ONE MENU KEYBOARD (DtMenu.vue): every dropdown and context menu moves the same way.
 *
 *   ArrowDown / ArrowUp   the next / previous item, wrapping at both ends
 *   Tab / Shift+Tab       the same — focus never leaves an open menu by Tab
 *   Home / End            the first / last item
 *   a printable key       type-ahead: the next item whose label starts with what was typed (a pause of
 *                         TYPEAHEAD_MS starts a new word), as reka-ui's menus did before they were folded in
 *   Escape                closes, and focus goes back to the trigger (DtMenu)
 *   Enter / Space         the item's own click (every item is a <button>)
 *
 * On open, focus moves to the first item (or the menu itself when it has none). Disabled items are skipped: they are
 * not in the list this is handed. Pure functions, so the moves are testable without a document.
 */

/** What counts as an item of a menu: the ARIA item roles, and a listbox's options (the source picker). */
export const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';

/** A pause longer than this starts a new type-ahead word. */
export const TYPEAHEAD_MS = 500;

/**
 * The item to focus after `key`, from `cursor` (−1: none yet) among `count` items — or null when the key is not a
 * move. With no items every move is −1 (the menu itself keeps focus).
 */
export function menuMove(key: string, cursor: number, count: number, shift = false): number | null {
	const back = key === 'ArrowUp' || (key === 'Tab' && shift);
	const forward = key === 'ArrowDown' || (key === 'Tab' && !shift);
	if (!back && !forward && key !== 'Home' && key !== 'End') return null;
	if (count <= 0) return -1;
	if (key === 'Home') return 0;
	if (key === 'End') return count - 1;
	if (cursor < 0) return back ? count - 1 : 0;
	return (((cursor + (back ? -1 : 1)) % count) + count) % count;
}

/** A single printable character a key press types (no modifier held), or null. */
export function typedChar(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	return typeof e.key === 'string' && e.key.length === 1 && e.key !== ' ' ? e.key.toLowerCase() : null;
}

/**
 * The item type-ahead lands on: the first label after `cursor` (wrapping) that starts with `word` — or, for a word of
 * one repeated letter, the next one starting with that letter, so pressing `m` twice walks the M items. −1: none.
 */
export function typeaheadIndex(labels: readonly string[], word: string, cursor: number): number {
	if (!word || !labels.length) return -1;
	const norm = labels.map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase());
	const repeated = word.length > 1 && [...word].every((c) => c === word[0]);
	const needle = repeated ? word[0]! : word;
	// a fresh one-letter word (or a repeated letter) moves past the current item; a longer word may stay on it
	const start = needle.length === 1 ? cursor + 1 : Math.max(cursor, 0);
	for (let k = 0; k < norm.length; k++) {
		const i = (((start + k) % norm.length) + norm.length) % norm.length;
		if (norm[i]!.startsWith(needle)) return i;
	}
	return -1;
}

/** The running type-ahead word: a character within TYPEAHEAD_MS of the last extends it, a later one starts anew. */
export function typeahead(now: () => number = () => Date.now()): (char: string) => string {
	let word = '';
	let at = Number.NEGATIVE_INFINITY;
	return (char) => {
		const t = now();
		word = t - at > TYPEAHEAD_MS ? char : word + char;
		at = t;
		return word;
	};
}
