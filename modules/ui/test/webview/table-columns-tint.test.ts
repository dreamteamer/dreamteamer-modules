/**
 * The TABLE draws the collection's display (descriptor v2, §3.5): the column set and order its
 * `display.list.columns` names, and each row tinted by its `color_by` value's choice colour.
 *
 * Tier 1 pins the decisions (`list-seed.test.ts`, `collection-display.test.ts`); this pins that the
 * table DRAWS them — a seed that computes the right columns over a table that renders its own, or a
 * tint computed for a row that never carries it, would pass every pure test there is.
 *
 * Every fixture is a v2 contract row. The rows render with NO data cells (an empty column set for the
 * tint, no records for the header), because a cell renders a field through its View — and the
 * form's consumption of v2 field rows is its own wave.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, hasClass, render, text, type TestNode } from './render';
import type { CollectionRow, FieldRow, ItemRecord } from '../../webview/src/api/types';
import { enumRow, fieldRow } from '../unit/field-rows';
import { listSeed } from '../../webview/src/lib/list-seed';
import { colorByFor, tintOf, tintStyle } from '../../webview/src/lib/collection-display';
import DataTable from '../../webview/src/components/DataTable.vue';
import ListCards from '../../webview/src/lists/ListCards.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const VISITS: CollectionRow = {
	collection: 'health/visits',
	title: 'Visits',
	nav: {},
	list: { layout: 'table', columns: ['reason', 'date', 'kind'], sort: '-date' },
	record: { layout: 'page', color_by: 'kind' },
	form: { sections: [] },
	record_title: '{{ reason }}',
	record_type: 'visit',
	runtime: false,
	internal: false,
};

const FIELDS: FieldRow[] = [
	enumRow('kind', [
		{ label: 'Intake', value: 'intake', color: 'charts.blue' },
		{ label: 'Urgent', value: 'urgent', color: 'charts.red', background: 'charts.orange' },
		{ label: 'Remote', value: 'remote' },
	], { description: 'What sort of visit.' }),
	fieldRow('paid', { type: 'boolean' }),
	fieldRow('date', { type: 'date' }),
	fieldRow('reason', { description: 'In the patient\'s own words.' }),
];

const RECORDS: ItemRecord[] = [
	{ id: 'v1', reason: 'Headache', kind: 'intake' },
	{ id: 'v2', reason: 'Fracture', kind: 'urgent' },
	{ id: 'v3', reason: 'Follow-up call', kind: 'remote' },
];

/** What DataTable and ListCards reach for, with the collection display wired as browse-state wires it. */
function fakeState(columns: string[], records: ItemRecord[], layout = 'table', options: Record<string, unknown> = {}) {
	const byName = (n: string) => FIELDS.find((f) => f.field === n)!;
	const cols = ref(columns.map(byName)) as unknown as Ref<FieldRow[]>;
	const fields = ref(FIELDS) as unknown as Ref<FieldRow[]>;
	const listOptions = ref({ [layout]: options }) as Ref<Record<string, Record<string, unknown>>>;
	const colorBy = computed(() => colorByFor(VISITS, listOptions.value[layout]));
	return {
		collection: VISITS.collection,
		columns: cols,
		fields: { visibleFields: fields, fields },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {}, setSort: () => {} },
		listOptions,
		imageField: computed(() => null),
		subtitleFields: computed(() => []),
		selectedIds: computed(() => [] as string[]),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['reason'] ?? r['id']),
		tintOf: (r: ItemRecord) => tintStyle(tintOf(colorBy.value, FIELDS, r)),
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

const headerCells = (root: TestNode) => all(root, (n) => n.tag === 'th' && hasClass(n, 'dt-th'));
const rows = (root: TestNode) => all(root, (n) => n.tag === 'tr' && hasClass(n, 'dt-row'));

test('the table draws the column set and order the collection\'s display.list names', async () => {
	const seed = listSeed(undefined, VISITS.list);
	const root = await render(DataTable, { state: fakeState(seed.columns ?? [], []) });
	assert.deepEqual(headerCells(root).map((th) => text(th).trim()), ['Reason', 'Date', 'Kind'], 'list.columns, in its order — not the fields\' order');
	assert.deepEqual(
		headerCells(root).map((th) => th.props['title']),
		["In the patient's own words.", undefined, 'What sort of visit.'],
		"each header's tooltip is the field row's own description",
	);
});

test('a row whose color_by value authored a colour is tinted with it; one that did not is not', async () => {
	const root = await render(DataTable, { state: fakeState([], RECORDS) });
	const [intake, urgent, remote] = rows(root);
	assert.ok(hasClass(intake!, 'dt-tinted'));
	assert.deepEqual(intake!.props['style'], { '--dt-tint': 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))', '--dt-tint-bg': 'var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)))' });
	assert.deepEqual(urgent!.props['style'], { '--dt-tint': 'var(--vscode-charts-red, var(--dt-color-charts-red, var(--dt-unknown-color)))', '--dt-tint-bg': 'var(--vscode-charts-orange, var(--dt-color-charts-orange, var(--dt-unknown-color)))' });
	assert.equal(hasClass(remote!, 'dt-tinted'), false, 'no colour authored, no tint');
	assert.equal(remote!.props['style'], undefined);
});

test('the layout\'s own color_by option wins over the collection\'s', async () => {
	const root = await render(DataTable, { state: fakeState([], RECORDS, 'table', { color_by: 'paid' }) });
	assert.equal(rows(root).filter((r) => hasClass(r, 'dt-tinted')).length, 0, '`paid` declares no choices, so nothing tints');
});

test('a card is tinted the same way, and titled by the collection\'s record_title', async () => {
	const root = await render(ListCards, { state: fakeState([], RECORDS, 'cards') });
	const cards = all(root, (n) => hasClass(n, 'dt-cards-card'));
	assert.deepEqual(cards.map((c) => hasClass(c, 'dt-tinted')), [true, true, false]);
	assert.deepEqual(all(root, (n) => hasClass(n, 'dt-card-title')).map((t) => text(t)), ['Headache', 'Fracture', 'Follow-up call']);
});
