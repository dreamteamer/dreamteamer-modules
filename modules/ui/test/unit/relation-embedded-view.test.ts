/**
 * A relation field drawn as the TARGET COLLECTION'S OWN VIEW — the decision, in isolation.
 *
 * Every fixture here is invented on the spot: two made-up collections (`widgets`, `parts`) and
 * made-up view records. Nothing is copied or adapted from any workspace.
 *
 * The rendered half is `test/webview/relation-field.test.ts`; what this tier pins is the rule —
 * WHICH view, WHICH records, and every case that must fall back to the links the property row has
 * always drawn.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FieldRow } from '../../src/api/types';
import { fieldRow, mirrorRow, referenceRow } from './field-rows';
import type { UiViewRecord } from '../../src/ui-views';
import {
	embeddedRelationPlan,
	isRelationField,
	isRelationList,
	pickRelationView,
	relationIds,
	relationScopeFilter,
	relationViewOption,
} from '../../src/lib/relation-view';

// ---- synthetic fixtures ------------------------------------------------------------------------

const listRelation = (field: string): FieldRow => referenceRow(field, true);

const singleRelation = (field: string): FieldRow => referenceRow(field);

const plainField = (field: string): FieldRow => fieldRow(field);

/** A collection-scope NAMED view — a collection's default view is its own display, never a view. */
const view = (over: Partial<UiViewRecord> & { id: string }): UiViewRecord => ({
	route: `/views/${over.id}`,
	scope: 'collection',
	display: { list: { layout: 'table' } },
	...over,
});

const partsBoard = view({ id: 'parts-board', route: '/parts/board', collection: 'collections/parts', display: { list: { layout: 'kanban' } } });
const widgetsRecent = view({ id: 'widgets-recent', route: '/widgets/recent', collection: 'collections/widgets' });
const ALL_VIEWS = [partsBoard, widgetsRecent];

/** Silence the "fix the record" warnings a tolerate-and-complain path emits. */
function quiet<T>(fn: () => T): T {
	const original = console.warn;
	console.warn = () => {};
	try {
		return fn();
	} finally {
		console.warn = original;
	}
}

// ---- which fields are relations at all ---------------------------------------------------------

test('a list relation is the shape that embeds; a single reference and a plain field are not', () => {
	assert.equal(isRelationField(listRelation('parts')), true);
	assert.equal(isRelationField(singleRelation('owner')), true);
	assert.equal(isRelationField(plainField('name')), false);

	assert.equal(isRelationList(listRelation('parts')), true);
	assert.equal(isRelationList(singleRelation('owner')), false, 'one record is a link, not a table');
	assert.equal(isRelationList(plainField('name')), false);
});

test('a GENERATED MIRROR embeds too — it is the case the ask was actually about', () => {
	assert.equal(isRelationList(mirrorRow('parts', 'assembly')), true);
	assert.equal(isRelationList(mirrorRow('summary', 'meeting', false)), false, 'a scalar mirror is one record');
});

// ---- which records ------------------------------------------------------------------------------

test('ids come out of the stored refs, in the relation’s own order, in all three spellings', () => {
	// the engine's form, the adapter's normalized form, and a bare id
	assert.deepEqual(relationIds(['parts/p-02', '/parts/p-00', 'p-01'], 'parts'), ['p-02', 'p-00', 'p-01']);
});

test('the split is at the END of the target name — a namespaced collection and a foldered id both survive', () => {
	assert.deepEqual(relationIds(['depot/crates/2026/07/blue'], 'depot/crates'), ['2026/07/blue']);
});

test('a single value, and the empty spellings', () => {
	assert.deepEqual(relationIds('parts/p-00', 'parts'), ['p-00']);
	assert.deepEqual(relationIds([], 'parts'), []);
	assert.deepEqual(relationIds(null, 'parts'), []);
	assert.deepEqual(relationIds('', 'parts'), []);
	assert.deepEqual(relationIds(['', null, 'parts/p-00'], 'parts'), ['p-00'], 'holes are dropped, not turned into ids');
});

test('the scope filter is an `_in` over the record ids — not a re-render of a resolved value', () => {
	// MEASURED against a live workspace: a relation arrives as bare `<collection>/<id>` strings, never
	// as expanded records (`api/adapter.ts`: "?fields= accepted and ignored — no relation expansion"),
	// so the embedded view has to re-query the collection scoped to exactly these ids.
	assert.deepEqual(relationScopeFilter(['p-00', 'p-01']), { id: { _in: ['p-00', 'p-01'] } });
});

// ---- which view ---------------------------------------------------------------------------------

test('with nothing authored, the target collection’s OWN display draws — Directus parity', () => {
	assert.equal(pickRelationView(ALL_VIEWS, 'parts', undefined, 'parts'), null, 'null is the collection\'s own display, not "no view"');
});

test('a named override wins, by record id or by route', () => {
	assert.equal(pickRelationView(ALL_VIEWS, 'parts', 'parts-board', 'parts')?.id, 'parts-board');
	assert.equal(pickRelationView(ALL_VIEWS, 'parts', '/parts/board', 'parts')?.id, 'parts-board');
});

test('a mis-authored override falls back to the collection’s own display rather than drawing the wrong rows', () => {
	assert.equal(quiet(() => pickRelationView(ALL_VIEWS, 'parts', 'no-such-view', 'parts')), null);
	assert.equal(quiet(() => pickRelationView(ALL_VIEWS, 'parts', 'widgets-recent', 'parts')), null, 'a view of another collection');
	const recordView = view({ id: 'parts-page', scope: 'record', collection: 'collections/parts', display: { record: { layout: 'properties' } } });
	assert.equal(quiet(() => pickRelationView([...ALL_VIEWS, recordView], 'parts', 'parts-page', 'parts')), null, 'a record view draws no rows');
});

// ---- reading the per-field override -------------------------------------------------------------

test('options.relation_views.<field> names the view; anything unauthored reads as unset', () => {
	const options = { relation_views: { parts: 'parts-board' } };
	assert.equal(relationViewOption(options, 'parts'), 'parts-board');
	assert.equal(relationViewOption(options, 'other'), undefined);
	assert.equal(relationViewOption(undefined, 'parts'), undefined);
	assert.equal(relationViewOption({}, 'parts'), undefined);
});

test('`false` is the opt-out — keep the plain list of links on this one field', () => {
	assert.equal(relationViewOption({ relation_views: { parts: false } }, 'parts'), false);
	assert.equal(relationViewOption({ relation_views: { parts: 'false' } }, 'parts'), false, 'a YAML string that means false');
	assert.equal(relationViewOption({ relation_views: { parts: 'links' } }, 'parts'), false);
});

test('an unusable shape complains and reads as unset — it never crashes the record page', () => {
	assert.equal(quiet(() => relationViewOption({ relation_views: 'parts-board' }, 'parts')), undefined);
	assert.equal(quiet(() => relationViewOption({ relation_views: ['parts-board'] }, 'parts')), undefined);
	assert.equal(quiet(() => relationViewOption({ relation_views: { parts: 42 } }, 'parts')), undefined);
});

// ---- the whole plan -----------------------------------------------------------------------------

const plan = (over: Partial<Parameters<typeof embeddedRelationPlan>[0]> = {}) =>
	embeddedRelationPlan({
		field: listRelation('parts'),
		value: ['parts/p-00', 'parts/p-01'],
		target: 'parts',
		views: ALL_VIEWS,
		...over,
	});

test('the happy path: the target’s own display, scoped to exactly the related records', () => {
	const result = plan();
	assert.ok(result);
	assert.equal(result.collection, 'parts');
	assert.equal(result.view, null, 'no named view: the embedded browse seeds itself from the collection\'s display.list');
	assert.deepEqual(result.ids, ['p-00', 'p-01']);
	assert.deepEqual(result.filter, { id: { _in: ['p-00', 'p-01'] } });
});

test('the per-field override picks a named view for the same field', () => {
	assert.equal(plan({ pageOptions: { relation_views: { parts: 'parts-board' } } })?.view?.id, 'parts-board');
});

// ---- everything that must fall back to links -----------------------------------------------------
//
// `null` means "draw it as a list of links"; every one of these must keep answering `null`.

test('a workspace with no named views still embeds — every collection has its own display', () => {
	assert.ok(plan({ views: [] }));
});

test('a single reference keeps its link — a table drawn for one record is worse than the link', () => {
	assert.equal(plan({ field: singleRelation('owner'), value: 'parts/p-00' }), null);
});

test('an unresolved target collection keeps its links rather than guessing one', () => {
	assert.equal(plan({ target: undefined }), null);
});

test('`false` on the field keeps its links', () => {
	assert.equal(plan({ pageOptions: { relation_views: { parts: false } } }), null);
});

test('AN EMPTY RELATION NEVER EMBEDS — an empty `_in` would render the WHOLE collection', () => {
	// `buildQuery` flattens a filter by ITERATING its arrays, so `{id:{_in:[]}}` emits no params at
	// all; the adapter then sees no filter and lists everything. The guard is what stands between a
	// field that names nothing and a table of every record in the target collection.
	// (`test/webview/relation-field.test.ts` runs `buildQuery` itself to prove that claim.)
	assert.equal(plan({ value: [] }), null);
	assert.equal(plan({ value: null }), null);
	assert.equal(plan({ value: '' }), null);
});
