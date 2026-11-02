/**
 * GROUPING: distributing records into buckets by a field's value is a pure function of
 * `(field, records, options)` and belongs in tier 1. Anything a grouped picture depends on —
 * declared enum order, off-enum placement, the ungrouped bucket, and the per-value metadata a
 * header draws — is pinned here rather than through a rendered mount, so a defect surfaces without
 * a Vue lifecycle.
 *
 * ⚠ This was `kanban-layout` until 0.12.0, when the same derivation became the ROW axis of the
 * table and cards too. Nothing about the maths changed with the rename; the file was simply named
 * after the first layout that needed it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketize, buildLanes, declaredChoicesOf, referenceLabel, UNGROUPED, ungroupedAllowed, valueOf, valuesOf } from '../../src/lib/grouping';
import type { FieldRow, ItemRecord } from '../../src/api/types';
import { enumRow, fieldRow } from './field-rows';

function field(overrides: Partial<FieldRow> & { field: string }): FieldRow {
	return fieldRow(overrides.field, overrides);
}

function enumField(name: string, choices: string[]): FieldRow {
	return enumRow(name, choices.map((value) => ({ value, label: value.toUpperCase() })));
}

test('declaredChoicesOf reads editor_options.choices in schema order', () => {
	const f = enumField('status', ['todo', 'doing', 'done']);
	assert.deepEqual(
		declaredChoicesOf(f),
		[
			{ value: 'todo', label: 'TODO' },
			{ value: 'doing', label: 'DOING' },
			{ value: 'done', label: 'DONE' },
		],
	);
});

test('declaredChoicesOf returns [] for a plain field with no choices', () => {
	assert.deepEqual(declaredChoicesOf(field({ field: 'name' })), []);
});

test('valueOf returns "" for missing/empty — the sentinel bucketize uses', () => {
	const f = field({ field: 'status' });
	assert.equal(valueOf({ status: 'todo' }, f), 'todo');
	assert.equal(valueOf({ status: '' }, f), '');
	assert.equal(valueOf({ status: null }, f), '');
	assert.equal(valueOf({}, f), '');
	assert.equal(valueOf({ status: 42 }, f), '42');
});

test('ungroupedAllowed is false for a required field (its cards can never be cleared)', () => {
	assert.equal(ungroupedAllowed(field({ field: 'status', required: true })), false);
	assert.equal(ungroupedAllowed(field({ field: 'status' })), true);
	assert.equal(ungroupedAllowed(null), false);
});

test('bucketize returns declared columns in schema order, empty for values the data does not carry', () => {
	const status = enumField('status', ['todo', 'doing', 'done']);
	const records: ItemRecord[] = [
		{ id: 'a', status: 'todo' },
		{ id: 'b', status: 'done' },
		{ id: 'c', status: 'todo' },
	];
	const columns = bucketize(status, records, { showUngrouped: false });
	assert.deepEqual(
		columns.map((c) => c.value),
		['todo', 'doing', 'done'],
		'columns keep the declared order (todo, doing, done) even though the DATA never mentions doing',
	);
	assert.equal(columns.find((c) => c.value === 'doing')!.records.length, 0);
	assert.equal(columns.find((c) => c.value === 'todo')!.records.length, 2);
});

test('bucketize appends off-enum values in alphabetic order after the declared columns', () => {
	const status = enumField('status', ['todo', 'done']);
	const records: ItemRecord[] = [
		{ id: 'a', status: 'todo' },
		{ id: 'b', status: 'zeta' },
		{ id: 'c', status: 'alpha' },
	];
	const columns = bucketize(status, records, { showUngrouped: false });
	assert.deepEqual(
		columns.map((c) => c.value),
		['todo', 'done', 'alpha', 'zeta'],
		'declared first (todo, done), then off-enum alphabetic (alpha, zeta) — the picture is stable across reloads',
	);
});

test('bucketize adds an ungrouped column only when showUngrouped is on', () => {
	const status = enumField('status', ['todo', 'done']);
	const records: ItemRecord[] = [
		{ id: 'a', status: 'todo' },
		{ id: 'b' },
		{ id: 'c', status: null },
	];
	const without = bucketize(status, records, { showUngrouped: false });
	assert.equal(without.length, 2, 'two records vanish rather than sit in a hidden column');

	const withIt = bucketize(status, records, { showUngrouped: true });
	assert.equal(withIt.length, 3);
	assert.equal(withIt[2]!.value, UNGROUPED);
	assert.equal(withIt[2]!.ungrouped, true);
	assert.equal(withIt[2]!.records.length, 2);
});

test('bucketize on a plain string field derives every column from the data alone', () => {
	const module = field({ field: 'module' });
	const records: ItemRecord[] = [
		{ id: 'a', module: 'finance' },
		{ id: 'b', module: 'family' },
		{ id: 'c', module: 'finance' },
	];
	const columns = bucketize(module, records, { showUngrouped: false });
	assert.deepEqual(columns.map((c) => c.value), ['family', 'finance']);
	assert.equal(columns[1]!.records.length, 2);
});

test('bucketize with a null field returns [] — the caller renders "no field to group by"', () => {
	assert.deepEqual(bucketize(null, [{ id: 'a' }], { showUngrouped: true }), []);
});

test('bucketize shortens a REFERENCE VALUE to its last segment for the label, keeping the raw value', () => {
	// The adapter normalizes reference values to `/collection/id` (webview/src/api/adapter.ts —
	// readRelationValue). The raw value must round-trip that shape; the LABEL is what a lane header
	// shows, and there it is the last segment de-slugged — the provenance in front of it is not a
	// name. Changed 2026-09-08: a gantt grouped by a topic reference printed 58 characters of id per
	// lane, of which only the tail differed.
	const module = field({ field: 'module' });
	const records: ItemRecord[] = [
		{ id: 'a', module: '/modules/beta-tools' },
		{ id: 'b', module: '/modules/alpha' },
	];
	const columns = bucketize(module, records, { showUngrouped: false });
	assert.deepEqual(
		columns.map((c) => ({ value: c.value, label: c.label })),
		[
			{ value: '/modules/alpha', label: 'Alpha' },
			{ value: '/modules/beta-tools', label: 'Beta tools' },
		],
		'raw value keeps the leading slash and the full path (equality tests, drops); the label is the name',
	);
});

test('referenceLabel leaves a NON-reference value byte for byte — kanban headings must not be re-cased', () => {
	// The scope line of the whole change: only a value containing a slash is a reference. A plain
	// undeclared enum value is already the word its author chose, and "fixing" it would rewrite every
	// kanban column heading in the product to solve a problem only references have.
	for (const value of ['todo', 'wontfix', 'in-progress', '2026-09-08', 'TrustAI']) {
		assert.equal(referenceLabel(value), value, `${value} is not a reference and must pass through`);
	}
});

test('referenceLabel keeps a dated slug\'s date intact and de-slugs only the name after it', () => {
	assert.equal(
		referenceLabel('introspection/topics/2026-09-08--dana-o/asset-management'),
		'Asset management',
	);
	assert.equal(
		referenceLabel('introspection/introspectives/2026-09-08--dana-o'),
		'2026-09-08 Dana o',
		'a date prefix survives de-slugging — 2026 09 08 would be unreadable',
	);
});

test('referenceLabel preserves existing capitals — a product name is not a sentence to re-case', () => {
	assert.equal(referenceLabel('x/trustai-chat-agent'), 'Trustai chat agent');
	assert.equal(referenceLabel('x/TrustAI-chat-agent'), 'TrustAI chat agent');
});

test('two references sharing a last segment are DISAMBIGUATED, never both shortened to the same lane', () => {
	// Two lanes reading "Api" holding different records is worse than the long name it replaced, so
	// the clashing labels — and only those — grow back toward the full reference.
	const topic = field({ field: 'topic' });
	const records: ItemRecord[] = [
		{ id: 'a', topic: 'introspection/topics/run-1/api' },
		{ id: 'b', topic: 'introspection/concepts/run-1/api' },
		{ id: 'c', topic: 'introspection/topics/run-1/billing' },
	];
	const labels = bucketize(topic, records, { showUngrouped: false }).map((c) => c.label);
	assert.equal(new Set(labels).size, labels.length, 'every lane label is unique');
	assert.ok(labels.includes('Billing'), 'a label that never clashed is NOT lengthened to match');
	assert.equal(labels.filter((l) => l.endsWith('Api')).length, 2, 'both clashing lanes keep the name and gain a qualifier');
});

test('buildLanes returns null when the lane field is not set — that is the "no lane axis" signal', () => {
	assert.equal(buildLanes(null, [{ id: 'a' }], { showUngrouped: false }), null);
});

test('buildLanes carves records into lanes by the same rules as bucketize', () => {
	const module = enumField('module', ['finance', 'family', 'rnd']);
	const records: ItemRecord[] = [
		{ id: 'a', module: 'finance' },
		{ id: 'b', module: 'family' },
		{ id: 'c', module: 'finance' },
		{ id: 'd', module: 'services' },
		{ id: 'e' },
	];
	const lanes = buildLanes(module, records, { showUngrouped: true });
	assert.ok(lanes);
	assert.deepEqual(
		lanes.map((l) => l.value),
		['finance', 'family', 'rnd', 'services', UNGROUPED],
		'declared first, then off-enum alphabetic, ungrouped last',
	);
	assert.equal(lanes.find((l) => l.value === 'finance')!.records.length, 2);
	assert.equal(lanes.find((l) => l.value === 'rnd')!.records.length, 0);
	assert.equal(lanes.find((l) => l.value === UNGROUPED)!.records.length, 1);
});

test('buildLanes with showUngrouped=false hides value-less records from the lane axis', () => {
	const module = enumField('module', ['finance', 'family']);
	const records: ItemRecord[] = [
		{ id: 'a', module: 'finance' },
		{ id: 'b' },
	];
	const lanes = buildLanes(module, records, { showUngrouped: false });
	assert.ok(lanes);
	assert.equal(lanes.length, 2);
	assert.equal(lanes.find((l) => l.value === UNGROUPED), undefined);
});

// ── per-value metadata (engine 0.21.0 `x-choices`) ───────────────────────────────────────────────
//
// A choice row carries `label` and `value` plus four optional decoration strings, so the whole of
// the job here is that `declaredChoicesOf` keeps them and `bucketize` carries them onto the bucket
// the header reads.
//
// ⚠ The metadata is DECORATION, never structure. It cannot add a bucket, remove one, or move one —
// those still come from the enum's own order, which is what the last test in this block pins.

/** A field whose choices carry the decoration, exactly as `presentation.js#choiceRow` emits. */
const decorated = enumRow('lane', [
	{ label: 'Alpha team', value: 'alpha', description: 'the one that ships', icon: 'rocket', color: 'charts.blue', background: 'charts.blue' },
	{ label: 'bravo', value: 'bravo', icon: 'assets/icons/lucide/anchor' },
	{ label: 'charlie', value: 'charlie' },
]);

test('declaredChoicesOf carries the four decoration keys through', () => {
	const [alpha, bravo, charlie] = declaredChoicesOf(decorated);
	assert.deepEqual(alpha, {
		value: 'alpha',
		label: 'Alpha team',
		description: 'the one that ships',
		icon: 'rocket',
		color: 'charts.blue',
		background: 'charts.blue',
	});
	assert.deepEqual(bravo, { value: 'bravo', label: 'bravo', icon: 'assets/icons/lucide/anchor' });
	assert.deepEqual(charlie, { value: 'charlie', label: 'charlie' }, 'an undecorated value gains no empty keys');
});

test('an undecorated choice row is its label and value, nothing more', () => {
	const plain = enumRow('lane', ['alpha']);
	assert.deepEqual(declaredChoicesOf(plain), [{ value: 'alpha', label: 'alpha' }]);
});

test('bucketize puts the decoration on the bucket a header reads', () => {
	const records: ItemRecord[] = [{ id: '1', lane: 'alpha' }, { id: '2', lane: 'bravo' }];
	const [alpha, bravo] = bucketize(decorated, records, { showUngrouped: false });
	assert.equal(alpha.label, 'Alpha team');
	assert.equal(alpha.icon, 'rocket');
	assert.equal(alpha.color, 'charts.blue');
	assert.equal(alpha.background, 'charts.blue');
	assert.equal(alpha.description, 'the one that ships');
	assert.equal(alpha.records.length, 1);
	assert.equal(bravo.icon, 'assets/icons/lucide/anchor');
	assert.equal(bravo.color, undefined, 'bravo declared no colour and must not inherit one');
});

test('an off-enum value gets a bucket with no decoration, never another value’s', () => {
	const records: ItemRecord[] = [{ id: '1', lane: 'delta' }];
	const [delta] = bucketize(decorated, records, { showUngrouped: false }).filter((b) => b.value === 'delta');
	assert.deepEqual(delta, { value: 'delta', label: 'delta', records: [{ id: '1', lane: 'delta' }] });
});

test('the ungrouped bucket carries no decoration either', () => {
	const records: ItemRecord[] = [{ id: '1', lane: '' }];
	const ungrouped = bucketize(decorated, records, { showUngrouped: true }).find((b) => b.value === UNGROUPED)!;
	assert.equal(ungrouped.icon, undefined);
	assert.equal(ungrouped.color, undefined);
	assert.equal(ungrouped.label, '—');
});

test('decoration is never structure — the enum still decides which buckets exist and their order', () => {
	const buckets = bucketize(decorated, [], { showUngrouped: false });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha', 'bravo', 'charlie']);
});

// ── empty buckets (0.13.0) ───────────────────────────────────────────────────────────────────────
//
// A declared value with no records is a real question with two right answers, and which one is right
// depends on the AXIS — which is why this is two options rather than one.
//
// A COLUMN is a drop target. An empty "Blocked" column is where you drag the thing you just got
// blocked on, so hiding it takes away the gesture. Columns therefore default to SHOWING empty.
//
// A BAND is not a drop target — dragging a card patches the column field alone (`buildLanes`'s own
// header). An empty band is six rows of nothing between you and the work, and the operator hit
// exactly that: a filtered board still drew every declared lane, one of them with four empty
// columns above the lane being looked at. Bands therefore default to HIDING empty.
//
// ⚠ `showEmpty` is about DECLARED values with no records. It has nothing to do with `showUngrouped`,
// which is about records with no value — the opposite direction, and the two are independent.

test('bucketize keeps empty declared buckets by default — the column behaviour', () => {
	const buckets = bucketize(decorated, [{ id: '1', lane: 'alpha' }], { showUngrouped: false });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha', 'bravo', 'charlie']);
});

test('showEmpty:false drops the declared buckets that hold nothing', () => {
	const buckets = bucketize(decorated, [{ id: '1', lane: 'alpha' }], { showUngrouped: false, showEmpty: false });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha']);
});

test('showEmpty:false keeps a bucket that HAS records, decoration and all', () => {
	const records: ItemRecord[] = [{ id: '1', lane: 'alpha' }, { id: '2', lane: 'charlie' }];
	const buckets = bucketize(decorated, records, { showUngrouped: false, showEmpty: false });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha', 'charlie']);
	assert.equal(buckets[0]!.icon, 'rocket', 'a surviving bucket keeps everything it had');
});

test('an off-enum bucket is never empty by construction, so showEmpty cannot drop it', () => {
	const buckets = bucketize(decorated, [{ id: '1', lane: 'delta' }], { showUngrouped: false, showEmpty: false });
	assert.deepEqual(buckets.map((b) => b.value), ['delta']);
});

test('showEmpty:false with nothing at all leaves no buckets, not a wall of empties', () => {
	assert.deepEqual(bucketize(decorated, [], { showUngrouped: false, showEmpty: false }), []);
});

test('showEmpty and showUngrouped are independent — an empty ungrouped bucket still obeys showUngrouped', () => {
	// `showUngrouped` is about records with NO VALUE; `showEmpty` is about declared values with NO
	// RECORDS. Conflating them is the obvious bug, so it is pinned.
	const both = bucketize(decorated, [{ id: '1', lane: 'alpha' }], { showUngrouped: true, showEmpty: false });
	assert.deepEqual(both.map((b) => b.value), ['alpha', UNGROUPED], 'the ungrouped bucket is asked for, so it stays');
});

// ── multi-value grouping (the gantt's band axis) ─────────────────────────────────────────────────
//
// A record's group field can hold a LIST — tags, attendees, the several lanes one piece of work
// belongs to. The single-value path answers that with `String(value)`, which turns `['a','b']` into
// the string `a,b`: one band nobody declared, named after a join. So `bucketize` grew a `multi`
// mode that fans the record into one bucket per value, and `valuesOf` is the reader.
//
// ⚠ `valueOf` is deliberately UNCHANGED and every existing caller stays on it. The table, the cards
// and the kanban are all single-value today and must keep the picture they have; opting in is a
// flag on the call, not a new default.

const tagsField = (name: string, choices?: string[]): FieldRow =>
	choices
		? enumRow(name, choices.map((value) => ({ value, label: value.toUpperCase() })), { many: true })
		: fieldRow(name, { many: true });

test('valuesOf splits a list value and leaves a scalar alone', () => {
	const tags = tagsField('tags');
	assert.deepEqual(valuesOf({ tags: ['alpha', 'bravo'] }, tags), ['alpha', 'bravo']);
	assert.deepEqual(valuesOf({ tags: 'alpha' }, tags), ['alpha']);
	assert.deepEqual(valuesOf({ tags: [] }, tags), [], 'an empty list is no value at all');
	assert.deepEqual(valuesOf({}, tags), []);
	assert.deepEqual(valuesOf({ tags: ['alpha', '', null, 'alpha'] }, tags), ['alpha'], 'blanks dropped, duplicates collapsed');
	assert.deepEqual(valuesOf({ tags: ['alpha'] }, null), []);
});

test('valueOf is unchanged, array trap and all — that is why valuesOf exists', () => {
	const tags = tagsField('tags');
	assert.equal(valueOf({ tags: ['alpha', 'bravo'] }, tags), 'alpha,bravo');
	assert.equal(valueOf({ tags: [] }, tags), '', 'an empty array stringifies to "" and reads as ungrouped');
	assert.equal(valueOf({ tags: 'alpha' }, tags), 'alpha');
});

test('multi: a record whose field is an array lands in EVERY value’s bucket', () => {
	const tags = tagsField('tags', ['alpha', 'bravo', 'charlie']);
	const records: ItemRecord[] = [
		{ id: 'a', tags: ['alpha', 'bravo'] },
		{ id: 'b', tags: ['bravo'] },
	];
	const buckets = bucketize(tags, records, { showUngrouped: false, showEmpty: false, multi: true });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha', 'bravo']);
	assert.deepEqual(buckets[0]!.records.map((r) => r['id']), ['a']);
	assert.deepEqual(buckets[1]!.records.map((r) => r['id']), ['a', 'b'], 'the same record, in a second band');
});

test('multi: an off-enum member still gets its own bucket, after the declared ones', () => {
	const tags = tagsField('tags', ['alpha']);
	const buckets = bucketize(tags, [{ id: 'a', tags: ['alpha', 'delta'] }], { showUngrouped: false, multi: true });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha', 'delta']);
	assert.equal(buckets[1]!.records.length, 1);
});

test('multi: an EMPTY array is ungrouped, not a band called ""', () => {
	const tags = tagsField('tags', ['alpha']);
	const records: ItemRecord[] = [{ id: 'a', tags: ['alpha'] }, { id: 'b', tags: [] }];
	const hidden = bucketize(tags, records, { showUngrouped: false, multi: true });
	assert.deepEqual(hidden.map((b) => b.value), ['alpha'], 'the empty-list record is hidden, like any value-less one');

	const shown = bucketize(tags, records, { showUngrouped: true, multi: true });
	assert.deepEqual(shown.map((b) => b.value), ['alpha', UNGROUPED]);
	assert.deepEqual(shown[1]!.records.map((r) => r['id']), ['b']);
});

test('without multi, an array is the single joined value it always was', () => {
	const tags = tagsField('tags', ['alpha']);
	const buckets = bucketize(tags, [{ id: 'a', tags: ['alpha', 'bravo'] }], { showUngrouped: false, showEmpty: false });
	assert.deepEqual(buckets.map((b) => b.value), ['alpha,bravo'], 'unchanged for every existing caller');
});

test('multi changes nothing for a scalar field', () => {
	const status = enumField('status', ['todo', 'done']);
	const records: ItemRecord[] = [{ id: 'a', status: 'todo' }, { id: 'b', status: 'done' }, { id: 'c' }];
	const plain = bucketize(status, records, { showUngrouped: true });
	const multi = bucketize(status, records, { showUngrouped: true, multi: true });
	assert.deepEqual(multi, plain);
});
