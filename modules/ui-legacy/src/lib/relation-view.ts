/**
 * A RELATION FIELD, DRAWN AS THE TARGET COLLECTION'S OWN VIEW.
 *
 * Operator ask 2026-09-11: *"allow relation fields in details view mode to show a ui view of that
 * object, default to the default view (like in directus)"*. A project with 52 activities used to
 * render as 52 comma-separated links — unreadable, and it threw away everything the `activities`
 * collection already knows about how to present itself (its columns, its sort, its layout). Now the
 * property row draws the activities TABLE, scoped to exactly those 52.
 *
 * ── WHERE THE PER-FIELD OVERRIDE IS AUTHORED ─────────────────────────────────────────────────────
 *
 * On the RECORD display that draws the page — the collection's own `display.record.options`, or a
 * `scope: record` ui-view's, which wins — under `relation_views.<field>`:
 *
 *     display:
 *       record:
 *         layout: properties
 *         options:
 *           relation_views:
 *             activities: plan-gantt   # a ui-view record id, or its /route
 *             seats: false             # keep the plain list of links
 *
 * A record layout's `options` block is open in descriptor v2 (each layout reads its own keys), so
 * the override is authored with no engine keyword. Both homes reach the page: the collection's block
 * rides on its display-contract row as `record.options` (engine 0.33.0), a view's on the view
 * record, and `composables/record-display.ts` picks one and threads it into the record-page
 * renderer (`ContentDetail` → `:options`). `dt set collections/<c>
 * display.record.options.relation_views='{"activities":"plan-gantt"}'` writes the collection's.
 *
 * An extension SETTING was the third candidate and was rejected: it is per-machine, invisible to
 * git and to agents, and decision 36 says view state belongs in a record.
 *
 * ── THE FILTER, MEASURED ─────────────────────────────────────────────────────────────────────────
 *
 * A relation value arrives UNEXPANDED — `["activities/a-00", "activities/a-01", …]`, bare
 * `<collection>/<id>` strings, never records. (Measured against a live workspace: the store hands
 * the host an `array[52] of string`, and `api/adapter.ts` states outright that `?fields=` is
 * "accepted and ignored — no relation expansion".) So the embedded view CANNOT render the value it
 * was handed; it has to re-query the target collection, scoped by `{ id: { _in: [<the ids>] } }` —
 * which the engine's `filter.js` supports on the record's own `id`, and which returns exactly the
 * members and nothing else.
 *
 * ⚠ AN EMPTY LIST MUST NEVER REACH THAT FILTER. `buildQuery` flattens a filter into bracketed
 * params by iterating the array, so `{id:{_in:[]}}` produces NO params at all — the adapter then
 * sees no filter and renders THE WHOLE COLLECTION. `embeddedRelationPlan` therefore refuses to
 * embed an empty relation (the caller falls back), and that refusal is what the test pins.
 */
import type { FieldRow } from '../api/types';
import type { UiViewRecord } from '../ui-views';
import { isRelationField, isRelationList } from './field-row';

export { isRelationField, isRelationList };

/** The option key on a record page's ui-view `options` that carries the per-field overrides. */
export const RELATION_VIEWS_OPTION = 'relation_views';

/*
 * A LIST relation (`lib/field-row.ts#isRelationList`: a key or a mirror, `many`) is the only shape
 * that embeds. A single reference (`company` on a contact) stays a link, deliberately: a whole table
 * drawn for one record is more chrome than value, and Directus draws its m2o as a display for the
 * same reason. The rule is the field's SHAPE, so it needs no per-field authoring to be right by
 * default.
 */

/**
 * The bare record ids a relation value names, in the order the field stores them.
 *
 * Handles all three forms a value reaches us in: the engine's `activities/a-00`, the adapter's
 * normalized `/activities/a-00`, and an id that is itself a slash path (`meetings/2026/07/kickoff`
 * → `2026/07/kickoff`). ⚠ Split at the END of the target's name, never at the first slash — a
 * collection name may carry a namespace (`family/travel/legs`) and an id may carry folders, so the
 * first slash is meaningless on both sides. Same rule `ViewRelation#idFor` follows.
 */
export function relationIds(value: unknown, target: string): string[] {
	const entries = value === null || value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];
	const out: string[] = [];
	for (const entry of entries) {
		if (typeof entry !== 'string' || entry === '') continue;
		const norm = entry.replace(/^\/+/, '');
		const id = norm.startsWith(`${target}/`) ? norm.slice(target.length + 1) : norm;
		if (id) out.push(id);
	}
	return out;
}

/** The server-side scope: exactly these records of the target collection, and no others. */
export function relationScopeFilter(ids: string[]): Record<string, unknown> {
	return { id: { _in: ids } };
}

/**
 * What `options.relation_views` says about ONE field.
 *
 * `undefined` — nothing authored, use the target collection's own display.
 * `false`      — explicitly opted out; keep the plain list of links.
 * a string     — the ui-view to draw, by record id or by its `/route`.
 *
 * Tolerate and complain, the same posture `collection-views.ts#stringArray` takes: an unusable
 * shape warns and reads as unset, because the RECORD is what wants fixing and a silent fallback
 * makes the source rot invisibly.
 */
export function relationViewOption(options: Record<string, unknown> | undefined, field: string): string | false | undefined {
	const raw = options?.[RELATION_VIEWS_OPTION];
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		console.warn(`[relation-view] options.${RELATION_VIEWS_OPTION} is a ${typeof raw}, not a map of field → view — ignoring it. Fix the record.`);
		return undefined;
	}
	const entry = (raw as Record<string, unknown>)[field];
	if (entry === undefined || entry === null) return undefined;
	if (entry === false || entry === 'false' || entry === 'links') return false;
	if (typeof entry === 'string' && entry.length > 0) return entry;
	console.warn(`[relation-view] options.${RELATION_VIEWS_OPTION}.${field} is neither a view name nor false — ignoring it. Fix the record.`);
	return undefined;
}

/** A ui-view's collection ref (`collections/activities`) as a bare collection name. */
function collectionOf(view: UiViewRecord): string {
	return (view.collection ?? '').replace(/^collections\//, '');
}

/**
 * The view to draw a relation with: the named one when the record page asked for one, else NULL —
 * the target collection's OWN display, which is its default view (descriptor v2: a view is always
 * a named variant). "Like in Directus", and the reason a workspace needs no authoring at all.
 *
 * A named view that does not exist, is not a `collection`-scope view, or belongs to another
 * collection is a mis-authored record: it warns and falls through to the collection's own display
 * rather than drawing the wrong collection's rows, which is the one outcome worse than a list of links.
 */
export function pickRelationView(views: UiViewRecord[], target: string, named: string | undefined, field: string): UiViewRecord | null {
	if (!named) return null;
	const hit = views.find((v) => v.id === named) ?? views.find((v) => v.route === named);
	if (!hit) {
		console.warn(`[relation-view] field '${field}': no ui-view '${named}' — falling back to ${target}'s own display.`);
	} else if (hit.scope !== 'collection') {
		console.warn(`[relation-view] field '${field}': ui-view '${named}' is a '${hit.scope}' view, not a collection view — falling back to ${target}'s own display.`);
	} else if (collectionOf(hit) !== target) {
		console.warn(`[relation-view] field '${field}': ui-view '${named}' is of '${collectionOf(hit)}', not '${target}' — falling back to ${target}'s own display.`);
	} else {
		return hit;
	}
	return null;
}

export interface EmbeddedRelationPlan {
	/** The collection whose view is drawn. */
	collection: string;
	/** The named view that supplies layout, columns, sort and layout options — or null for the
	 *  target collection's own `display.list`, which the embedded browse seeds itself from. */
	view: UiViewRecord | null;
	/** The ids the embedded view is scoped to — in the relation's own order. */
	ids: string[];
	/** The server filter that scopes it. Never empty, never absent. */
	filter: Record<string, unknown>;
}

/**
 * The whole decision, in one pure function — so the rule is a test, not a component.
 *
 * ⚠ THE VIEW'S OWN `filter` IS DELIBERATELY DROPPED, and this is the one genuinely ambiguous fork.
 * A view's filter exists to narrow a WHOLE-COLLECTION browse ("active only"); the relation is
 * already the narrowing, and anding the two would hide related records with no explanation on
 * screen — the exact "filtered-but-wrong subset" this feature must not produce. Everything else the
 * view says — layout, columns, order, grouping, page size — is carried verbatim. So: the view
 * decides how the rows LOOK, the relation decides WHICH rows.
 *
 * Answers `null` — meaning "draw it as a list of links" — for every case that is not unambiguously
 * better as a view: a non-list relation, an unresolved target, an empty relation, or an explicit
 * `false` override. Every other list relation embeds, through a named view or the target's own
 * display.
 */
export function embeddedRelationPlan(args: {
	field: FieldRow;
	value: unknown;
	target: string | undefined;
	views: UiViewRecord[];
	/** The record display's `options` — where `relation_views` is authored. */
	pageOptions?: Record<string, unknown>;
}): EmbeddedRelationPlan | null {
	const { field, value, target, views, pageOptions } = args;
	if (!target) return null;
	if (!isRelationList(field)) return null;

	const named = relationViewOption(pageOptions, field.field);
	if (named === false) return null;

	const ids = relationIds(value, target);
	// ⚠ Not a stylistic guard. An empty `_in` flattens to no query params at all, and the browse
	// would render the ENTIRE target collection under a field that names none of it.
	if (ids.length === 0) return null;

	return { collection: target, view: pickRelationView(views, target, named, field.field), ids, filter: relationScopeFilter(ids) };
}
