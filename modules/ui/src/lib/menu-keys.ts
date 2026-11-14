/**
 * The keyboard of a menu that hangs from a button (the pane's switcher and level menus): on open, focus moves to its
 * first item (or the menu itself when it has none); Tab and Shift+Tab, ArrowDown and ArrowUp cycle the items and never
 * leave the menu; Escape — and a pick that does not navigate away — closes it and gives focus back to its button.
 */
import { nextTick, toRaw } from 'vue';

type Focusable = { focus?: () => void } | null | undefined;

export interface MenuKeys {
	/** Call once the menu's items are drawn: focus goes to the first. */
	opened(): void;
	/** The menu's focusin: a click or a programmatic focus moves the cursor with it. */
	focusin(e: { target?: unknown }): void;
	/** The menu's keydown. */
	keydown(e: { key: string; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }): void;
	/** A pick that leaves the person on this page: close the menu and give focus back to its button. */
	done(): void;
}

export function menuKeys(opts: { items: () => Focusable[]; menu: () => Focusable; button: () => Focusable; close: () => void }): MenuKeys {
	let cursor = -1;
	// a template ref may hand back a reactive proxy; focus the element itself
	const focus = (el: Focusable) => (el ? (toRaw(el as object) as Focusable)?.focus?.() : undefined);
	const list = () => opts.items().filter((x): x is NonNullable<Focusable> => Boolean(x));
	const focusAt = (i: number) => {
		const items = list();
		if (!items.length) { cursor = -1; focus(opts.menu()); return; }
		cursor = ((i % items.length) + items.length) % items.length;
		focus(items[cursor]);
	};
	return {
		opened() { void nextTick(() => focusAt(0)); },
		done() {
			opts.close();
			focus(opts.button());
		},
		focusin(e) {
			const i = list().findIndex((x) => toRaw(x as object) === e.target || x === e.target);
			if (i >= 0) cursor = i;
		},
		keydown(e) {
			if (e.key === 'Escape') {
				e.preventDefault?.();
				e.stopPropagation?.();
				opts.close();
				focus(opts.button());
				return;
			}
			if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault?.();
				focusAt(cursor + (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1));
			}
		},
	};
}
