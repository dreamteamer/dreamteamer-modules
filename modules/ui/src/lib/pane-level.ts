/**
 * The pane's level, in words (cr-modules-017 §4). A page can LOWER its own level (`POST /_dt/level`); a raise is
 * the chat's (`dt web open --edit|--admin`), so the chip's menu lists only the levels below and sends a person to the
 * chat for anything higher. While a raise holds, the bar says since when.
 */
export type PaneLevel = 'read' | 'edit' | 'admin';

const ORDER: PaneLevel[] = ['read', 'edit', 'admin'];
const WORDS = { read: 'Read', edit: 'Edit', admin: 'Admin' } as const;

export function levelWord(l: PaneLevel): 'Read' | 'Edit' | 'Admin' {
	return WORDS[l] ?? 'Read';
}

/** The levels below `l`, highest first: admin → [edit, read]; edit → [read]; read → []. */
export function lowerChoices(l: PaneLevel): PaneLevel[] {
	const i = ORDER.indexOf(l);
	return i <= 0 ? [] : ORDER.slice(0, i).reverse();
}

/** "Admin since 02:41 — opened from the chat" while a raise holds; null with none (or a date that does not parse). */
export function raiseNotice(h: { level: PaneLevel; raisedAt?: string }, locale?: string): string | null {
	if (!h.raisedAt) return null;
	const at = new Date(h.raisedAt);
	if (Number.isNaN(at.getTime())) return null;
	const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
	return `${levelWord(h.level)} since ${time} — opened from the chat`;
}
