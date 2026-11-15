// The pane scope (cr-modules-017 §4): a browser pane is at one level — read, edit or admin — and the gate answers
// a route only when the route's level is at or below it. A record WRITE on a collection the engine reports
// internal or runtime (and every system collection) needs admin; reads stay read, so a Read pane still draws.
import { SYSTEM_COLLECTIONS } from './gate.js';

export const LEVELS = ['read', 'edit', 'admin'];
/** The level's place in LEVELS; -1 for anything else, which no route is at or below. */
export const levelRank = (level) => LEVELS.indexOf(level);
/** The lower of two levels (an unknown level is lower than any). */
export const lowerLevel = (a, b) => (levelRank(a) <= levelRank(b) ? a : b);
export const RECORD_WRITE_ROUTES = new Set(['records-create', 'record-update', 'record-remove', 'position', 'file-import']);

const word = (level) => (typeof level === 'string' && level ? level[0].toUpperCase() + level.slice(1) : String(level));

/**
 * Every collection whose record writes count as admin: the system collections, plus each descriptor the engine
 * reports internal or runtime.
 * @param {Iterable<{name: string}>} descriptors
 * @param {{ isInternal?: (d: any) => boolean, isRuntime?: (d: any) => boolean }} engine
 */
export function internalCollections(descriptors, { isInternal, isRuntime } = {}) {
	const out = new Set(SYSTEM_COLLECTIONS);
	for (const d of descriptors ?? []) {
		if (!d?.name) continue;
		if (d.runtime === true || isInternal?.(d) || isRuntime?.(d)) out.add(d.name);
	}
	return out;
}

/**
 * @param {{ level: 'read'|'edit'|'admin', internal: Set<string>, label?: string }} input
 */
export function paneScope({ level, internal, label = 'this pane' }) {
	return {
		kind: 'pane', level, internal: internal ?? new Set(SYSTEM_COLLECTIONS), label,
		sentences: {
			level: (s, d) => `${s.label} is at ${word(s.level)}: ${d.method} ${d.pattern} needs ${word(d.need)} — ask in the chat to open it with --${d.need}`,
		},
	};
}
