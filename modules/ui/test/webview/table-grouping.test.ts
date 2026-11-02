/**
 * A grouped TABLE: the Monday shape — one collapsible band per value, each with a header carrying
 * the glyph, the label and a count, and its own rows beneath.
 *
 * Rendered rather than derived, because the derivation is already tier 1 (`grouping.test.ts`) and
 * what this tier is for is the thing tier 1 cannot see: that a band is a real `<tbody>` with a real
 * header row and the right rows inside it. A table that computed perfect buckets and drew one flat
 * list would pass every pure test there is.
 *
 * ⚠ The ungrouped picture is the one that must not move. A table with no `group_by` has
 * to render exactly the single `<tbody>` it always did — every existing view is one of those, and
 * none of them were touched.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, text, type TestNode } from './render';
import type { FieldChoice, FieldRow, ItemRecord } from '../../src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { views } from '../../src/registry/index';
import DataTable from '../../src/components/DataTable.vue';

// The ONE view a table cell needs to resolve. Registered here rather than by importing
// `register-defaults`, which reaches ListMap and therefore leaflet's CSS — png urls this tier has
// no loader for. What a cell renders is not what this file is testing; that it renders AT ALL is.
views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});

// DataTable listens for window focus to refetch (agents edit the same files outside the editor), and
// this tier has no DOM. A listener sink is enough — nothing here fires a focus event.
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

function enumField(name: string, choices: FieldChoice[]): FieldRow {
	return enumRow(name, choices);
}
const plainField = (name: string): FieldRow => fieldRow(name);

/** Only what DataTable actually reaches for — the composable itself drags a router and the host. */
function fakeState(init: { fields: FieldRow[]; records: ItemRecord[]; options?: Record<string, unknown> }) {
	const fields = ref(init.fields) as Ref<FieldRow[]>;
	return {
		collection: 'demo',
		columns: fields,
		fields: { visibleFields: fields, fields },
		items: {
			items: ref(init.records) as Ref<ItemRecord[]>,
			loading: ref(false),
			reload: async () => {},
			setSort: () => {},
		},
		listOptions: ref({ table: init.options ?? {} }) as Ref<Record<string, Record<string, unknown>>>,
		selectedIds: computed(() => [] as string[]),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		// what a record is called and its tint are the collection's display — none in this fixture
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? r['id'] ?? ''),
		tintOf: () => undefined,
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

const LANE = enumField('lane', [
	{ label: 'Alpha', value: 'alpha', icon: 'rocket', color: 'charts.blue', description: 'the one that ships' },
	{ label: 'Bravo', value: 'bravo' },
]);

const RECORDS: ItemRecord[] = [
	{ id: '1', name: 'one', lane: 'alpha' },
	{ id: '2', name: 'two', lane: 'alpha' },
	{ id: '3', name: 'three', lane: 'bravo' },
];

const bodies = (root: TestNode) => all(root, (n) => n.tag === 'tbody');
const headers = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-group-header'));
const dataRows = (n: TestNode) => all(n, (x) => hasClass(x, 'dt-row'));

test('with no group_by the table is the single tbody it always was', async () => {
	const root = await render(DataTable, { state: fakeState({ fields: [plainField('name'), LANE], records: RECORDS }) });
	assert.equal(bodies(root).length, 1, 'one body, exactly as before grouping existed');
	assert.equal(headers(root).length, 0, 'and no band header anywhere');
	assert.equal(dataRows(root).length, 3);
});

test('a group field makes one tbody per value, in the enum’s declared order', async () => {
	const state = fakeState({ fields: [plainField('name'), LANE], records: RECORDS, options: { group_by: 'lane' } });
	const root = await render(DataTable, { state });
	assert.equal(bodies(root).length, 2);
	// The LABEL element, not the header's whole text — a header also carries the count and the
	// description, and `text()` concatenates without separators.
	const labels = headers(root).map((h) => text(find(h, (n) => hasClass(n, 'dt-group-header__label'))!));
	assert.deepEqual(labels, ['Alpha', 'Bravo']);
});

test('each band holds its own rows, and the header counts them', async () => {
	const state = fakeState({ fields: [plainField('name'), LANE], records: RECORDS, options: { group_by: 'lane' } });
	const root = await render(DataTable, { state });
	const [alpha, bravo] = bodies(root);
	assert.equal(dataRows(alpha!).length, 2);
	assert.equal(dataRows(bravo!).length, 1);
	assert.match(text(headers(root)[0]!), /2/);
	assert.match(text(headers(root)[1]!), /1/);
});

test('the header carries the decoration the engine projected', async () => {
	const state = fakeState({ fields: [plainField('name'), LANE], records: RECORDS, options: { group_by: 'lane' } });
	const root = await render(DataTable, { state });
	const alpha = headers(root)[0]!;
	assert.match(text(alpha), /the one that ships/, 'the description');
	assert.ok(
		all(alpha, (n) => hasClass(n, 'codicon')).some((g) => String(g.props['class']).includes('codicon-rocket')),
		'the glyph',
	);
});

// ⚠ THIS DEFAULT REVERSED IN 0.13.0, on the operator's report. It used to read "a value with no
// records still gets its band — an empty lane is information", and on a filtered board that meant
// every declared lane drew whether or not it held anything: four empty columns under a lane name,
// above the one lane being looked at. A band is not a drop target, so an empty one buys nothing.
// A COLUMN keeps the opposite default, and for a reason — see `show_empty_columns`.
test('an empty declared band is dropped by default — a band is not a drop target', async () => {
	const state = fakeState({ fields: [plainField('name'), LANE], records: [RECORDS[0]!], options: { group_by: 'lane' } });
	const root = await render(DataTable, { state });
	assert.equal(bodies(root).length, 1, 'Bravo is declared but holds nothing, so Bravo is not drawn');
	const labels = headers(root).map((h) => text(find(h, (n) => hasClass(n, 'dt-group-header__label'))!));
	assert.deepEqual(labels, ['Alpha']);
});

test('show_empty_rows brings it back, count and all', async () => {
	const state = fakeState({
		fields: [plainField('name'), LANE],
		records: [RECORDS[0]!],
		options: { group_by: 'lane', show_empty_rows: true },
	});
	const root = await render(DataTable, { state });
	assert.equal(bodies(root).length, 2);
	assert.match(text(headers(root)[1]!), /0/, 'and it says it is empty rather than looking broken');
});

test('records with no value are hidden until show_ungrouped_rows asks for them', async () => {
	const records = [...RECORDS, { id: '4', name: 'four', lane: '' }];
	const hidden = await render(DataTable, {
		state: fakeState({ fields: [plainField('name'), LANE], records, options: { group_by: 'lane' } }),
	});
	assert.equal(dataRows(hidden).length, 3, 'the value-less record is not drawn');

	const shown = await render(DataTable, {
		state: fakeState({ fields: [plainField('name'), LANE], records, options: { group_by: 'lane', show_ungrouped_rows: true } }),
	});
	assert.equal(dataRows(shown).length, 4);
	assert.equal(bodies(shown).length, 3);
});

test('a group_by naming a field the collection does not carry degrades to ungrouped', async () => {
	// A typo in a ui-view must never erase the table — the same posture the kanban already takes.
	const state = fakeState({ fields: [plainField('name'), LANE], records: RECORDS, options: { group_by: 'not_a_field' } });
	const root = await render(DataTable, { state });
	assert.equal(bodies(root).length, 1);
	assert.equal(dataRows(root).length, 3);
});

test('a band collapses, and collapsing hides its rows without losing the header', async () => {
	const state = fakeState({ fields: [plainField('name'), LANE], records: RECORDS, options: { group_by: 'lane' } });
	const root = await render(DataTable, { state });
	const toggle = find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-group-toggle'));
	assert.ok(toggle, 'each band header has a collapse control');

	await (toggle.props['onClick'] as () => void)();
	const { flush } = await import('./render');
	await flush();

	assert.equal(headers(root).length, 2, 'both headers stay');
	assert.equal(dataRows(root).length, 1, 'only the collapsed band’s rows went');
});
