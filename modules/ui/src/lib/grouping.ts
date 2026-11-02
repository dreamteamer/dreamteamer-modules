/**
 * Pure derivations for the kanban list. Extracted so lanes and columns can be pinned by a fixture
 * (test/unit/grouping.test.ts) — the previous computed lived inside ListKanban.vue where only
 * a rendered mount could reach it. Vue keeps the reactive glue; this file owns "what goes where".
 *
 * Two axes, one shape: a lane and a column are both `{ value, label, records }`. A board with no
 * lane axis renders as one implicit lane containing every column — the same picture the operator
 * has been looking at since the kanban shipped, so the presence of this file changes nothing on a
 * ui-view that never asked for lanes.
 */
import type { FieldRow, ItemRecord } from '../api/types';

/** Column key for "no value" — not a legal field value, so it can never collide with a real one.
 *  Also used for a lane whose records have no lane-field value. */
export const UNGROUPED = '__ungrouped__';

/** What a group header may DRAW, beyond the label — the field's enum map (descriptor v2 §3.4.1),
 *  authored per enum value and projected onto its choice rows, carried here verbatim. Every key is optional and a value that
 *  declares none is byte-identical to what it was before the keyword existed.
 *
 *  ⚠ DECORATION, NEVER STRUCTURE. Nothing here can add a bucket, remove one, or change the order;
 *  the enum owns that, which is what `bucketize` pins. */
export interface Decoration {
	description?: string;
	/** A codicon name, OR a reference to a record of a `storage.format: binary` collection. The renderer
	 *  decides which by asking `fileRecordRef` — a codicon name never contains a slash and a record
	 *  reference always does, so no second keyword is needed and no collection name is hard-coded. */
	icon?: string;
	/** Theme colour ids, not hex: a hex is authored against one theme and wrong in the other. */
	color?: string;
	background?: string;
}

/** `2026-09-08--dana-o` — a dated slug id, whose date must survive de-slugging intact. */
const DATED_SLUG = /^(\d{4}-\d{2}-\d{2})--(.+)$/;

/** `asset-management` → `Asset management`. Existing capitals are kept: `TrustAI-chat` is a name,
 *  not a sentence to be re-cased. */
function deslug(segment: string): string {
	const words = segment.replace(/[-_]+/g, ' ').trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : segment;
}

/**
 * A bucket label for a value the enum did not declare.
 *
 * ⚠ ONLY a value that LOOKS LIKE A REFERENCE is touched — one containing a slash. A plain enum
 * value the schema never declared (`todo`, `wontfix`, a bare date) is passed through byte for byte,
 * because those are already the words the author chose and re-casing them would change every
 * kanban column heading in the product to fix a problem that only references have.
 *
 * A reference prints its LAST segment, de-slugged: the lane in
 * `introspection/topics/2026-09-08--dana-o/asset-management` is "Asset management", not the
 * 58 characters of provenance in front of it. The `value` keeps its full shape, so equality tests,
 * drops and round-trips are unaffected — this is a display name and nothing else reads it.
 *
 * ⚠ COLLISIONS ARE DISAMBIGUATED, NOT ACCEPTED. Two different references can share a last segment
 * (`…/topics/…/api` and `…/concepts/…/api`), and two lanes reading "Api" that hold different records
 * is worse than the long name it replaced. `disambiguate` below walks the labels back out toward the
 * full reference until each is unique again — so the shortening is lossless in the only sense that
 * matters: no two lanes ever read the same.
 */
export function referenceLabel(value: string): string {
	const bare = value.startsWith('/') ? value.slice(1) : value;
	if (!bare.includes('/')) return bare;
	const last = bare.slice(bare.lastIndexOf('/') + 1);
	const dated = DATED_SLUG.exec(last);
	return dated ? `${dated[1]} ${deslug(dated[2]!)}` : deslug(last);
}

/**
 * Give every bucket a label no other bucket shares, by re-adding path segments to the ones that
 * clash. Only the clashing labels grow; a unique one is never lengthened to match its neighbour.
 */
function disambiguate(rows: { value: string; label: string }[]): void {
	for (let depth = 2; depth <= 6; depth++) {
		const seen = new Map<string, number>();
		for (const row of rows) seen.set(row.label, (seen.get(row.label) ?? 0) + 1);
		const clashing = rows.filter((r) => (seen.get(r.label) ?? 0) > 1 && r.value.includes('/'));
		if (!clashing.length) return;
		let grew = false;
		for (const row of clashing) {
			const bare = row.value.startsWith('/') ? row.value.slice(1) : row.value;
			const parts = bare.split('/');
			if (parts.length < depth) continue;
			const tail = parts.slice(-depth);
			const next = `${tail.slice(0, -1).join('/')} / ${referenceLabel(bare)}`;
			if (next !== row.label) { row.label = next; grew = true; }
		}
		if (!grew) return; // nothing left to lengthen — identical values, which cannot happen twice
	}
}

export interface Bucket extends Decoration {
	value: string;
	label: string;
	records: ItemRecord[];
	/** The ungrouped bucket accepts drops too — it just writes `null` instead of a value. */
	ungrouped?: boolean;
}

export interface Choice extends Decoration {
	value: string;
	label: string;
}

/** The decoration keys, by name. A choice row is engine output, so this copies what it recognises
 *  rather than spreading the row — the same discipline `presentation.js#choiceRow` applies on the
 *  way out, for the same reason: a closed vocabulary is one a reader can hold. */
const DECORATION_KEYS = ['description', 'icon', 'color', 'background'] as const;

function decorationOf(entry: Record<string, unknown>): Decoration {
	const out: Decoration = {};
	for (const k of DECORATION_KEYS) {
		const v = entry[k];
		if (typeof v === 'string' && v) out[k] = v;
	}
	return out;
}

/** '' for a missing/empty value — the sentinel `bucketize` maps to the ungrouped bucket. */
export function valueOf(record: ItemRecord, field: FieldRow | null): string {
	if (!field) return '';
	const value = record[field.field];
	return value === null || value === undefined || value === '' ? '' : String(value);
}

/**
 * Every value a record carries on `field`, for the layouts that group by a LIST field — tags, the
 * several lanes one piece of work belongs to. `[]` means "no value at all", the same thing `''`
 * means to `valueOf`, so an EMPTY LIST is ungrouped rather than a band named after nothing.
 *
 * ⚠ It exists because `valueOf` cannot answer this and must not learn to: its `String(value)` turns
 * `['alpha','bravo']` into `alpha,bravo` — one band nobody declared, named after a join — and every
 * current caller (table, cards, kanban) is single-value and depends on the picture it has. So the
 * multi path is opted INTO (`bucketize`'s `multi`), never inferred from the value's shape.
 */
export function valuesOf(record: ItemRecord, field: FieldRow | null): string[] {
	if (!field) return [];
	const raw = record[field.field];
	if (!Array.isArray(raw)) {
		const single = valueOf(record, field);
		return single === '' ? [] : [single];
	}
	const out: string[] = [];
	for (const entry of raw) {
		if (entry === null || entry === undefined || entry === '') continue;
		const value = String(entry);
		// A record listing the same value twice belongs in that band ONCE — otherwise it draws twice
		// in one band, which reads as two records.
		if (!out.includes(value)) out.push(value);
	}
	return out;
}

/** Only meaningful when the field can actually hold no value — a required field's cards can never
 *  be cleared, so offering the column (and a drop that would fail validation) would be a lie. */
export function ungroupedAllowed(field: FieldRow | null): boolean {
	if (!field) return false;
	return field.nullable;
}

/** Declared choices, in schema order. Empty when the field declares none — the board still works,
 *  it just derives columns from the data. */
export function declaredChoicesOf(field: FieldRow | null): Choice[] {
	if (!field) return [];
	return (field.editor_options?.choices ?? []).map((choice) => ({
		value: String(choice.value),
		label: choice.label,
		...decorationOf(choice as unknown as Record<string, unknown>),
	}));
}

/**
 * Distribute `records` across buckets keyed by `field`'s value. Declared choices come first in
 * their declared order; off-enum values append in alphabetic order (a stable column layout across
 * reloads). The ungrouped bucket is appended when `showUngrouped` is true — leaving it off hides
 * the value-less records, which the caller reports as a hidden-count hint rather than losing them
 * silently.
 *
 * `multi` fans a record with a LIST value into ONE BUCKET PER VALUE (see `valuesOf`) — the same
 * record, in several bands, which is what a tags-shaped axis means. It is opt-in per caller and
 * changes nothing for a scalar field.
 */
export function bucketize(
	field: FieldRow | null,
	records: ItemRecord[],
	options: { showUngrouped: boolean; ungroupedLabel?: string; showEmpty?: boolean; multi?: boolean },
): Bucket[] {
	if (!field) return [];
	const declared = declaredChoicesOf(field);

	const buckets = new Map<string, ItemRecord[]>();
	for (const choice of declared) buckets.set(choice.value, []);

	const ungrouped: ItemRecord[] = [];
	const offEnum = new Map<string, ItemRecord[]>();

	for (const record of records) {
		// Single-value is the historical path, byte for byte: one value or none. `multi` is the only
		// way a record reaches more than one bucket.
		const values = options.multi
			? valuesOf(record, field)
			: ((v) => (v === '' ? [] : [v]))(valueOf(record, field));
		if (!values.length) {
			ungrouped.push(record);
			continue;
		}
		for (const value of values) {
			if (buckets.has(value)) buckets.get(value)!.push(record);
			else {
				if (!offEnum.has(value)) offEnum.set(value, []);
				offEnum.get(value)!.push(record);
			}
		}
	}

	// ⚠ `showEmpty` is about a DECLARED value holding no records. It is NOT `showUngrouped`, which is
	// about records holding no value — the opposite direction, and the two are independent.
	//
	// Defaults differ per axis, and that is the whole reason there are two options rather than one:
	// a COLUMN is a drop target, so an empty "Blocked" is where you drag the thing you just got
	// blocked on and hiding it removes the gesture; a BAND is not a drop target, so an empty band is
	// just rows of nothing between the reader and the work. Callers pass the default for their axis.
	const showEmpty = options.showEmpty !== false;
	const out: Bucket[] = declared
		.filter((choice) => showEmpty || (buckets.get(choice.value)?.length ?? 0) > 0)
		.map(({ value, label, ...decoration }) => ({
			value,
			label,
			...decoration,
			records: buckets.get(value) ?? [],
		}));

	for (const value of [...offEnum.keys()].sort()) {
		// A stored reference is normalized to `/collection/id` by the adapter (`readRelationValue`);
		// the leading slash is a round-trip detail, not something a lane header should carry. The
		// LABEL is shortened to the reference's last segment, de-slugged (`referenceLabel`) — the
		// value keeps its full shape so equality tests and drops still match.
		out.push({ value, label: referenceLabel(value), records: offEnum.get(value) ?? [] });
	}
	// Undeclared values only: a declared choice's label is authored and must never be rewritten here.
	disambiguate(out.filter((b) => !declared.some((d) => d.value === b.value)));

	if (options.showUngrouped) {
		out.push({
			value: UNGROUPED,
			label: options.ungroupedLabel ?? '—',
			records: ungrouped,
			ungrouped: true,
		});
	}

	return out;
}

export interface Lane extends Bucket {}

/**
 * Records grouped along the LANE axis (horizontal rows), same shape as columns. Returns null when
 * no lane field is set — that is the caller's cue to render the historical single-band layout.
 * When the lane field carries no declared choices (a reference field, a plain string), lanes fall
 * out of the data.
 */
export function buildLanes(
	field: FieldRow | null,
	records: ItemRecord[],
	options: { showUngrouped: boolean; ungroupedLabel?: string; showEmpty?: boolean; multi?: boolean },
): Lane[] | null {
	if (!field) return null;
	return bucketize(field, records, options);
}
