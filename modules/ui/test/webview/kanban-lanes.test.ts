/**
 * Kanban lanes render — the picture, not the derivation (that's tier 1). Mounts ListKanban with a
 * fabricated BrowseState so a lane axis can be pinned by counting rendered bands and reading their
 * labels rather than asserting the option was CARRIED into `state.listOptions`. Passing a value into
 * an options bag is not passing it through a render, which is the same discipline the read-only
 * banner and Restore tests already keep.
 *
 * A test-only state satisfies the BrowseState surface ListKanban actually touches — the composable
 * itself pulls in a router and the host stubs, both irrelevant to the layout question the render
 * has to answer.
 *
 * Fixture names (`alpha`/`bravo`/…, `team`) are deliberately synthetic — a workspace's real module
 * or category names have no business in this repo's tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ref, computed, type Ref } from 'vue';
import { all, hasClass, render, text, type TestNode } from './render';
import type { FieldRow, ItemRecord } from '../../src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import ListKanban from '../../src/lists/ListKanban.vue';

/** A synthetic enum field — the render never asks for `type` beyond string. */
function enumField(name: string, choices: string[], overrides: Partial<FieldRow> = {}): FieldRow {
	return enumRow(name, choices.map((value) => ({ value, label: value.toUpperCase() })), overrides);
}

function stringField(name: string): FieldRow {
	return fieldRow(name);
}

interface FakeState {
	collection: string;
	fields: {
		visibleFields: Ref<FieldRow[]>;
		fields: Ref<FieldRow[]>;
	};
	items: {
		items: Ref<ItemRecord[]>;
		loading: Ref<boolean>;
		reload: () => Promise<void>;
	};
	listOptions: Ref<Record<string, Record<string, unknown>>>;
	manualOrder: Ref<boolean>;
	pkOf: (r: ItemRecord) => string;
	recordTitleOf: (r: ItemRecord) => string;
	tintOf: (r: ItemRecord) => Record<string, string> | undefined;
	openRecord: (r: ItemRecord) => void;
	createRecord: (prefill?: Record<string, unknown>) => void;
}

function fakeState(init: {
	fields: FieldRow[];
	records: ItemRecord[];
	options?: Record<string, unknown>;
}): FakeState {
	const fields = ref(init.fields) as Ref<FieldRow[]>;
	return {
		collection: 'demo',
		fields: {
			visibleFields: fields,
			fields,
		},
		items: {
			items: ref(init.records) as Ref<ItemRecord[]>,
			loading: ref(false),
			reload: async () => {},
		},
		listOptions: ref({ kanban: init.options ?? {} }) as Ref<Record<string, Record<string, unknown>>>,
		manualOrder: computed(() => false),
		pkOf: (r) => String(r['id'] ?? ''),
		// what a record is called and its tint are the collection's display — none in this fixture
		recordTitleOf: (r) => String(r['id'] ?? ''),
		tintOf: () => undefined,
		openRecord: () => {},
		createRecord: () => {},
	};
}

/** A lane BAND is a `<section>` that carries a rendered header — a lane the operator can SEE.
 *  Without `group_by`, the implicit single section carries no header, and this returns []. */
function laneBands(root: TestNode): TestNode[] {
	return all(root, (n) => hasClass(n, 'dt-kanban-core-lane')).filter((section) =>
		section.children.some((c) => typeof c !== 'string' && hasClass(c as TestNode, 'dt-kanban-core-lane-header')),
	);
}

function laneLabels(root: TestNode): string[] {
	return all(root, (n) => hasClass(n, 'dt-kanban-core-lane-label')).map((n) => text(n).trim());
}

function columnLabels(root: TestNode): string[] {
	return all(root, (n) => hasClass(n, 'dt-kanban-core-label')).map((n) => text(n).trim());
}

const STATUS = enumField('status', ['todo', 'doing', 'done']);
const TEAM = enumField('team', ['alpha', 'bravo', 'charlie']);
const RECORDS: ItemRecord[] = [
	{ id: 'a', status: 'todo', team: 'alpha' },
	{ id: 'b', status: 'doing', team: 'alpha' },
	{ id: 'c', status: 'todo', team: 'bravo' },
	{ id: 'd', status: 'done', team: 'charlie' },
];

test('without group_by, the board renders no lane bands — the historical single-strip layout', async () => {
	const state = fakeState({
		fields: [STATUS, TEAM],
		records: RECORDS,
		options: { lanes_by: 'status' },
	});
	const root = await render(ListKanban, { state });
	assert.equal(laneBands(root).length, 0, 'a board with no lane axis carries no lane band');
	assert.deepEqual(columnLabels(root), ['TODO', 'DOING', 'DONE'], 'columns are exactly what they used to be');
});

test('with group_by, one band per lane value, and each labelled by the lane', async () => {
	const state = fakeState({
		fields: [STATUS, TEAM],
		records: RECORDS,
		options: { lanes_by: 'status', group_by: 'team' },
	});
	const root = await render(ListKanban, { state });

	const bands = laneBands(root);
	assert.equal(bands.length, 3, 'three lanes, one per declared team value');
	assert.deepEqual(
		laneLabels(root),
		['ALPHA', 'BRAVO', 'CHARLIE'],
		'lane order follows the declared enum, and the label comes from the choice text',
	);
});

test('each lane draws its own copy of the columns, so the same status is shown per lane', async () => {
	const state = fakeState({
		fields: [STATUS, TEAM],
		records: RECORDS,
		options: { lanes_by: 'status', group_by: 'team' },
	});
	const root = await render(ListKanban, { state });

	const bands = laneBands(root);
	assert.equal(bands.length, 3);
	for (const band of bands) {
		const bandColumnLabels = all(band, (n) => hasClass(n, 'dt-kanban-core-label')).map((n) => text(n).trim());
		assert.deepEqual(
			bandColumnLabels,
			['TODO', 'DOING', 'DONE'],
			'every lane carries the same set of columns in the same order — so the status axis reads across lanes',
		);
	}
});

test('a card lands in the intersection of its lane and its column', async () => {
	const state = fakeState({
		fields: [STATUS, TEAM],
		records: RECORDS,
		options: { lanes_by: 'status', group_by: 'team' },
	});
	const root = await render(ListKanban, { state });

	const bands = laneBands(root);
	const alphaBand = bands.find((band) =>
		text(band.children.find((c) => typeof c !== 'string' && hasClass(c as TestNode, 'dt-kanban-core-lane-header')) as TestNode).includes('ALPHA'),
	);
	assert.ok(alphaBand, 'the alpha lane exists');

	const alphaCards = all(alphaBand, (n) => hasClass(n, 'dt-kanban-core-card'));
	assert.equal(alphaCards.length, 2, 'the two alpha records land in the alpha lane');
});

test('a lane value the enum does not declare still gets its own band, appended after the declared ones', async () => {
	const team = enumField('team', ['alpha', 'bravo']);
	const records: ItemRecord[] = [
		{ id: 'a', status: 'todo', team: 'alpha' },
		// bravo is populated on purpose: this test is about the ORDER declared values appear in, and
		// an empty declared band is dropped by default since 0.13.0 (see `show_empty_rows`).
		{ id: 'b', status: 'todo', team: 'bravo' },
		{ id: 'c', status: 'todo', team: 'zeta' },
	];
	const state = fakeState({
		fields: [STATUS, team],
		records,
		options: { lanes_by: 'status', group_by: 'team' },
	});
	const root = await render(ListKanban, { state });

	assert.deepEqual(
		laneLabels(root),
		['ALPHA', 'BRAVO', 'zeta'],
		'declared first, then off-enum values — the same rule columns follow (label is the raw value when the enum never declared it)',
	);
});

test('empty lane values are hidden by default; opting into show_ungrouped_rows surfaces them', async () => {
	const team = enumField('team', ['alpha', 'bravo']);
	const records: ItemRecord[] = [
		{ id: 'a', status: 'todo', team: 'alpha' },
		// populated so the declared band survives the empty-band default — what this test is about is
		// the record with NO value, which is the opposite question.
		{ id: 'b', status: 'todo', team: 'bravo' },
		{ id: 'c', status: 'todo' },
	];
	const hidden = await render(ListKanban, {
		state: fakeState({
			fields: [STATUS, team],
			records,
			options: { lanes_by: 'status', group_by: 'team' },
		}),
	});
	assert.deepEqual(
		laneLabels(hidden),
		['ALPHA', 'BRAVO'],
		'a record with no lane value is not a lane by default',
	);

	const shown = await render(ListKanban, {
		state: fakeState({
			fields: [STATUS, team],
			records,
			options: { lanes_by: 'status', group_by: 'team', show_ungrouped_rows: true },
		}),
	});
	assert.equal(laneLabels(shown).length, 3, 'the ungrouped lane appears when asked for');
	assert.equal(laneLabels(shown)[2], '—');
});

test('a lane field that does not resolve on this collection falls back to the historical no-lane layout', async () => {
	// The ui-view could pin a field name that a fresh collection does not have (yet). A missing field
	// should NEVER erase the board — that would turn a mistyped option into "the kanban shows nothing".
	const state = fakeState({
		fields: [STATUS],
		records: RECORDS,
		options: { lanes_by: 'status', group_by: 'not_a_field' },
	});
	const root = await render(ListKanban, { state });
	assert.equal(laneBands(root).length, 0, 'no lane band when the named lane field does not exist');
	assert.deepEqual(columnLabels(root), ['TODO', 'DOING', 'DONE'], 'columns still render');
});

test('a lane field that is also the column field renders a lane axis (the picture still makes sense as a diagonal)', async () => {
	// It would be a strange configuration for the operator to pick, but there is nothing here to
	// refuse — the derivation is the same on both axes, and refusing would need a rule that lives
	// nowhere except in the drawer. The engine does not model "these two axes must differ". Both
	// axes preserve the enum's declared order, so the picture is a diagonal: one card per lane in
	// the matching column, and every other cell empty.
	//
	// ⚠ Every status is populated deliberately. Since 0.13.0 an empty declared BAND is dropped by
	// default, so a status with no records would simply have no lane and this would be measuring
	// that instead of the diagonal.
	const state = fakeState({
		fields: [STATUS, TEAM],
		records: [
			{ id: 'a', status: 'todo', team: 'alpha' },
			{ id: 'b', status: 'doing', team: 'bravo' },
			{ id: 'c', status: 'done', team: 'bravo' },
		],
		options: { lanes_by: 'status', group_by: 'status' },
	});
	const root = await render(ListKanban, { state });
	assert.deepEqual(laneLabels(root), ['TODO', 'DOING', 'DONE']);
});

test('with plain (non-enum) lane field values, lanes derive from the data in alphabetic order', async () => {
	const team = stringField('team');
	const records: ItemRecord[] = [
		{ id: 'a', status: 'todo', team: 'zebra' },
		{ id: 'b', status: 'doing', team: 'aardvark' },
		{ id: 'c', status: 'done', team: 'zebra' },
	];
	const state = fakeState({
		fields: [STATUS, team],
		records,
		options: { lanes_by: 'status', group_by: 'team' },
	});
	const root = await render(ListKanban, { state });

	assert.deepEqual(
		laneLabels(root),
		['aardvark', 'zebra'],
		'no declared choices, so the whole lane axis comes from the data — sorted, for a stable picture',
	);
});
