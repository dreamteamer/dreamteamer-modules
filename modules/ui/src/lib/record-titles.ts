/**
 * WHAT A RECORD IS CALLED — its collection's `record_title` (descriptor v2, §3.1), rendered with the
 * one grammar (`lib/template.ts`), and the RESOLVER that makes a reference in a display template read
 * as the target's name rather than its id (§3.7).
 *
 * ⚠ The resolver is SYNCHRONOUS, because `renderDisplay`'s is: it answers what it already knows and
 * fetches the rest. A reference it has not seen renders as the bare reference for one paint, then as
 * the target's title once `record-cache` lands it — the answer lives in a module-level reactive map,
 * so every computed that rendered through it re-renders, and a page of forty rows naming six doctors
 * fetches six records once, for the life of the webview.
 *
 * ⚠ ONE HOP. The target's own `record_title` renders with no resolver: a title naming another
 * reference spells that reference's value rather than fetching a chain nobody bounded.
 *
 * ⚠ A REFERENCE IS SPLIT AT THE LONGEST COLLECTION NAME IT STARTS WITH, never at its first slash —
 * a collection name may carry a namespace (`health/patients`) and an id may carry folders, so only
 * the registered names can say where one ends and the other begins (CLAUDE.md, namespaces).
 */
import { ref } from 'vue';
import type { CollectionRow } from '../api/types';
import { tryRenderDisplay, type RenderOptions } from './template';

/** A reference split into the collection it names and the id inside it, or null for neither. */
export function splitReference(reference: string, collections: readonly string[]): { collection: string; id: string } | null {
	const ref = reference.startsWith('/') ? reference.slice(1) : reference;
	let best: string | null = null;
	for (const c of collections) {
		if (ref.startsWith(`${c}/`) && (!best || c.length > best.length)) best = c;
	}
	return best ? { collection: best, id: ref.slice(best.length + 1) } : null;
}

/**
 * A record's title under its collection's `record_title`. `fallback` (the id, usually) when the
 * template renders to nothing — a nameless header reads as a loading bug.
 */
export function recordTitle(row: CollectionRow | null | undefined, record: Record<string, unknown> | null | undefined, fallback: string, opts: RenderOptions = {}): string {
	if (!row || !record) return fallback;
	const rendered = (tryRenderDisplay(row.record_title, record, opts) ?? '').trim();
	return rendered || fallback;
}

/** reference → the target's rendered title, once fetched. Module-level: one answer per webview. */
const titles = ref<Record<string, string>>({});
/** reference → the generation it was last asked in. */
const asked = new Map<string, number>();
/**
 * Bumped by the refresh button (`resetReferenceTitles`). REACTIVE, and read by every
 * `knownReferenceTitle` call, so every computed and render that resolved a title through it depends
 * on it and runs again — that re-run is what asks again. A plain counter would answer correctly when
 * asked while telling no relation cell to ask, and the cell would keep the old name.
 */
const generation = ref(0);

async function load(reference: string, parts: { collection: string; id: string }, row: CollectionRow | undefined): Promise<void> {
	const asOf = generation.value;
	// lazily: record-cache reaches api/client, which registers a window listener at module scope
	const { fetchRecord } = await import('./record-cache');
	const record = await fetchRecord(parts.collection, parts.id);
	// a load started before a refresh answers what the disk said THEN — never write it over the new one
	if (asOf !== generation.value) return;
	if (!record) {
		// a dangling reference keeps the value it holds — and one whose target was REMOVED since its title
		// was drawn loses that title, so a refresh agrees with the disk as a fresh window would
		if (reference in titles.value) {
			const { [reference]: _gone, ...rest } = titles.value;
			titles.value = rest;
		}
		return;
	}
	titles.value = { ...titles.value, [reference]: recordTitle(row, { ...record, id: parts.id }, parts.id) };
}

/**
 * The refresh button: every reference is asked again on its next render. STALE-WHILE-REVALIDATE —
 * the known titles stay drawn until the new ones land, so no cell flashes to its bare reference.
 */
export function resetReferenceTitles(): void {
	generation.value++;
}

/**
 * A reference → its target's title under the target's `record_title`, or null while that title is
 * in flight (the fetch is started here) and for a reference that names no registered collection or a
 * record that does not exist. The caller chooses what to draw meanwhile — a template keeps the bare
 * reference, a relation cell its de-slugged stem.
 */
export function knownReferenceTitle(raw: string, rows: readonly CollectionRow[]): string | null {
	const reference = raw.startsWith('/') ? raw.slice(1) : raw;
	const current = generation.value; // read on EVERY call: this is the dependency a refresh re-runs
	const known = titles.value[reference];
	if (asked.get(reference) !== current) {
		const parts = splitReference(reference, rows.map((r) => r.collection));
		if (parts) {
			asked.set(reference, current);
			void load(reference, parts, rows.find((r) => r.collection === parts.collection));
		}
	}
	return known ?? null;
}

/**
 * The `resolve` a display template passes to `renderDisplay`: a reference → its target's title,
 * or the bare reference (no leading slash) while that title is in flight.
 *
 * ⚠ The rows are read at CALL time, inside whatever computed is rendering, so a reference met before
 * the collections overview landed is asked again when it lands — rather than being marked asked
 * against an empty list and never resolved.
 */
export function referenceTitles(rows: () => readonly CollectionRow[]): (reference: string) => string {
	return (raw) => knownReferenceTitle(raw, rows()) ?? (raw.startsWith('/') ? raw.slice(1) : raw);
}
