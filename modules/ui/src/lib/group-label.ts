/**
 * WHAT A BAND IS CALLED WHEN ITS VALUE IS A REFERENCE.
 *
 * A grouped layout's band value is whatever the field holds. For an enum that is a declared choice
 * with an authored label, and `bucketize` uses it. For a REFERENCE it is a workspace path —
 * `perspective/topics/2026-09-07--acme/agent-decision-log` — and until now the band printed
 * either the whole 58 characters or `referenceLabel`'s de-slugged last segment. Both are guesses at
 * a name the referenced record already carries.
 *
 * ⚠ THE PRODUCT ALREADY ANSWERS THIS, ONCE: a record is called by its collection's `record_title`
 * (descriptor v2 §3.1), and a relation cell one row below renders exactly that through
 * `lib/record-titles.ts`. A band header showing a different name for the same reference is two
 * answers to "what is this record called". So the band resolves the field's target from the cached
 * `/relations` list, fetches the record through `lib/record-cache`, and renders the same template.
 *
 * Three sources for a band's label, in order, first non-empty wins:
 *   1. the VIEW's own `group_title` option — this view, this axis, an author's explicit choice;
 *   2. the TARGET collection's `record_title` — what a relation cell for that reference shows;
 *   3. `referenceLabel(value)` — the de-slugged last segment, which is what bands did before and is
 *      still right for a value that references nothing.
 *
 * Resolution is ASYNCHRONOUS and never blocks a paint: labels start at (3) and are replaced as
 * fetches land. That ordering matters — a band that renders empty until its name arrives reads as a
 * loading bug, and the de-slugged name is a perfectly good thing to look at in the meantime.
 */
import { ref, type Ref } from 'vue';
import type { CollectionRow, FieldRow } from '../api/types';
import { referenceLabel, UNGROUPED } from './grouping';
import { tryRenderDisplay } from './template';

/**
 * `/perspective/topics/2026-09-07--acme/agent-decision-log` + target `perspective/topics`
 * → `2026-09-07--acme/agent-decision-log`.
 *
 * ⚠ THE TARGET IS REQUIRED, and cannot be inferred from the string. A collection name may contain
 * slashes (a namespace: `perspective/topics`) and so may an id (`2026-09-07--acme/x`), so
 * there is no position in that path where "collection ends, id begins" can be read off. Every
 * caller resolves the target from the relations list first — the same way `ViewRelation` does, for
 * the same reason.
 */
export function idFor(value: string, target: string): string {
	const norm = value.startsWith('/') ? value.slice(1) : value;
	return norm.startsWith(`${target}/`) ? norm.slice(target.length + 1) : norm;
}

/**
 * The relation target of `field`, or null when it references nothing. Cached by `loadRelations`.
 *
 * ⚠ `composables/fields` and `record-cache` are imported LAZILY, inside the two functions that
 * actually talk to the host. Both reach `api/client`, which registers a `window` message listener at
 * module scope — so a top-level import here would drag the whole host transport into every consumer
 * that only wanted to format a label, and into the unit tier, which has no `window` at all.
 */
export async function targetOf(field: FieldRow, collection?: string): Promise<string | null> {
	const { loadRelations } = await import('../composables/fields');
	const rows = await loadRelations();
	// Prefer the row for THIS collection: two collections may carry a field of the same name
	// pointing at different targets, and the flat list cannot disambiguate on name alone.
	const mine = collection
		? rows.find((row) => row.collection === collection && row.field === field.field && row.related_collection)
		: undefined;
	const match = mine ?? rows.find((row) => row.field === field.field && row.related_collection);
	return match?.related_collection ?? null;
}

/** The template a band's NAME renders through: the view's own `group_title`, else the target
 *  collection's `record_title` — what a relation cell for the same reference shows — else null. */
export function bandTitleTemplate(viewTemplate: string | null, target: CollectionRow | null | undefined): string | null {
	if (viewTemplate) return viewTemplate;
	const t = target?.record_title;
	return typeof t === 'string' && t.length > 0 ? t : null;
}

export interface GroupLabelSource {
	/** The band values to resolve — full stored values, never labels. */
	values: () => string[];
	field: () => FieldRow | null;
	/** The view's own template, when the author set one. */
	template: () => string | null;
	/** A SECOND template, rendered against the same record — the band's one-line summary. Separate
	 *  from `template` because a band needs a NAME at all times and a summary only sometimes, and
	 *  cramming both into one string makes the collapsed header the only place either reads well. */
	summaryTemplate?: () => string | null;
	collection: () => string;
	/** The field on the TARGET record holding a picture, when the author named one. Blank probes
	 *  `avatar`, then `icon`, then `image` — the three names a record uses for the same idea. */
	iconField?: () => string | null;
}

/** The fields probed for a band's picture when the view names none, in order of specificity. */
const ICON_FIELDS = ['avatar', 'icon', 'image'] as const;

/** The picture a resolved record offers, or null. A value is taken verbatim: `GroupHeader` already
 *  knows how to tell a codicon name from a reference into a `codec: file` collection, and teaching a
 *  second place that distinction is how the two come to disagree. */
function iconOf(record: Record<string, unknown>, named: string | null): string | null {
	for (const key of named ? [named] : ICON_FIELDS) {
		const v = record[key];
		if (typeof v === 'string' && v) return v;
	}
	return null;
}

/**
 * A reactive `value → label` map, filled in as records arrive. A value absent from the map means
 * "no better name than the fallback", which every caller already knows how to draw.
 *
 * Returns the map plus a `resolve()` the caller runs from a `watchEffect`. Keeping the trigger out
 * here is deliberate: the composable is then testable without a component, and a caller that wants
 * to resolve once (a static export) can call `resolve()` directly.
 */
export function useGroupLabels(source: GroupLabelSource): {
	labels: Ref<Record<string, string>>;
	icons: Ref<Record<string, string>>;
	summaries: Ref<Record<string, string>>;
	resolve: () => void;
} {
	const labels = ref<Record<string, string>>({});
	/** The band's one-line summary, rendered from the same record as its label. */
	const summaries = ref<Record<string, string>>({});
	// The band's picture, from the record the band points AT — a collaborator's face, a company's
	// mark. Separate from `labels` because a record may have one and not the other, and a band with
	// a face and no resolved name should still show the face.
	const icons = ref<Record<string, string>>({});
	// Values already asked for, so a re-render (or a sibling band gaining a record) does not re-issue
	// a fetch that `record-cache` would dedupe anyway but whose `.then` would still churn the map.
	const asked = new Set<string>();

	function resolve(): void {
		const field = source.field();
		if (!field) return;
		const viewTemplate = source.template();
		const iconField = source.iconField?.() ?? null;
		const summaryTemplate = source.summaryTemplate?.() ?? null;
		// ⚠ NO EARLY RETURN ON A MISSING TEMPLATE. The fetch used to be skipped when nothing wanted a
		// rendered name, which silently took the PICTURE with it — a band grouped by a reference whose
		// records carry avatars showed none, for want of a template it did not need.
		// ⚠ THE UNGROUPED BAND IS A SENTINEL, NOT A REFERENCE. `bucketize` appends a bucket whose value
		// is `__ungrouped__` when `show_ungrouped_rows` is on, and feeding that to the resolver fired a
		// guaranteed-404 fetch for a record id that cannot exist — once per mount, on every grouped
		// view with the option turned on.
		const values = source.values().filter((v) => v && v !== UNGROUPED && !asked.has(v));
		if (!values.length) return;
		for (const v of values) asked.add(v);
		void targetOf(field, source.collection()).then(async (target) => {
			if (!target) return; // not a reference after all — fallback stands
			const { fetchRecord } = await import('./record-cache');
			// The collections overview the rest of the page already loaded (same lazy-import reason).
			const { useCollections } = await import('../composables/collections');
			const { tree } = useCollections();
			for (const value of values) {
				void fetchRecord(target, idFor(value, target)).then((record) => {
					if (!record) return; // a dangling or unreadable reference keeps its de-slugged name
					const template = bandTitleTemplate(viewTemplate, tree.value.find((r) => r.collection === target));
					if (template) {
						const rendered = (tryRenderDisplay(template, record) ?? '').trim();
						if (rendered) labels.value = { ...labels.value, [value]: rendered };
					}
					const icon = iconOf(record, iconField);
					if (icon) icons.value = { ...icons.value, [value]: icon };
					if (summaryTemplate) {
						// Whitespace-collapsed and plain: this rides on ONE line of a header, so a template
						// spanning three lines has to come out as one or the header grows and the collapsed
						// list stops being scannable, which is the whole point of collapsing it.
						const summary = (tryRenderDisplay(summaryTemplate, record) ?? '').replace(/\s+/g, ' ').trim();
						if (summary) summaries.value = { ...summaries.value, [value]: summary };
					}
				});
			}
		});
	}

	return { labels, icons, summaries, resolve };
}

/**
 * The label to DRAW: the resolved one when it has landed, else what `bucketize` already computed,
 * else the de-slugged path.
 *
 * ⚠ EMPTY is a miss, not a value — `??` would accept `''` and print a nameless band, which is how a
 * caller with no bucket label (or a template that rendered to nothing) ends up drawing a blank
 * header instead of the name it was standing in for.
 */
export function labelFor(value: string, fallback: string, resolved: Record<string, string>): string {
	return resolved[value] || fallback || referenceLabel(value);
}
