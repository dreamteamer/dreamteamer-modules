/**
 * A NEW RECORD STAYS VISIBLE IN THE LIST IT WAS CREATED FROM (design 2026-10-30, Q3-B).
 *
 * `add` writes the write root (or a module-owned list's clone). Since cr-vscode-004 a new record can be
 * added INTO a compiled layer too (the target choice, `dt add -w <layer>`'s act), but a list narrowed to
 * a layer that takes no new record still saves elsewhere — and such a record used to be INVISIBLE in
 * the list it came from.
 *
 * Two halves. BEFORE the save, the create form says where it saves (`SaveTarget.vue`, from the
 * selection the browse hands the create route as `?sources=`). AFTER it, the list WIDENS its
 * selection to include that root, and says so — picked over a notice with a "show it" button because
 * it is the simpler of the two: one state change through the picker's own rule (`withSourceSelection`),
 * no control to add, and the picker already shows the widened selection, so nothing is hidden from the
 * operator about what the list is now showing.
 *
 * The hand-off between the create page and the list is one module-level note, consumed once.
 */
import type { FilterGroup } from './filter-query';
import type { SourceEntry } from '../api/types';
import { keepsSource, ownSource, selectedSources, withSourceSelection } from './sources';

/** The create route's query key carrying the browse's source selection. */
export const SOURCES_QUERY = 'sources';
/** The create route's query key naming the root the record saves to — the target choice's answer
 *  (cr-vscode-004), carried to the save as `POST …/records?target=`. */
export const TARGET_QUERY = 'target';

export interface CreatedNote {
	collection: string;
	id: string;
	/** The root it was saved to — its `$source`. */
	source: string;
}

let note: CreatedNote | null = null;

/** Said by the create page after a successful save. */
export function noteCreated(created: CreatedNote): void {
	note = created;
}

/** The note for this collection, consumed — a list reads it once, on the mount it was meant for. */
export function takeCreated(collection: string): CreatedNote | null {
	if (!note || note.collection !== collection) return null;
	const out = note;
	note = null;
	return out;
}

/** The selection widened to show a record read from `source`, or null when it already shows it. */
export function widenedFor(group: FilterGroup, source: string): FilterGroup | null {
	if (keepsSource(group, source)) return null;
	return withSourceSelection(group, [...selectedSources(group), source]);
}

/** Where a NEW record of the collection is saved: the workspace's own root, else (a module-owned list,
 *  which has none) the module's — the one root `dt add` writes. */
export function saveRoot(sources: readonly SourceEntry[] | undefined): SourceEntry | undefined {
	return ownSource(sources) ?? sources?.find((s) => s.kind === 'module');
}

/** Where a new record saves when the create route NAMES a target the collection reads; else the one
 *  root `dt add` writes (`saveRoot`). */
export function saveRootFor(sources: readonly SourceEntry[] | undefined, target: string | null | undefined): SourceEntry | undefined {
	return (target ? sources?.find((s) => s.name === target) : undefined) ?? saveRoot(sources);
}

/** The selected sources a new record saved to `root` will NOT be in — what the form warns about. */
export function excludedBy(selection: readonly string[], root: string | undefined): string[] {
	return root && selection.length && !selection.includes(root) ? [...selection] : [];
}

/** The create route's `?sources=` value, parsed. */
export function selectionFromQuery(raw: unknown): string[] {
	return typeof raw === 'string' && raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
