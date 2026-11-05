/**
 * The TABLE at each density — rendered, because a density is a class on the table and two classes
 * on its cells, and a resolver that returned the right word while the table never carried it would
 * pass every pure test there is.
 *
 * ⚠ The default picture is the one that must not move: a table with no `row_size` carries
 * `dt-table--cozy`, whose rules restate today's row height — every existing view is one of those.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, text } from './render';
import type { FieldRow, ItemRecord } from '../../webview/src/api/types';
import { fieldRow, referenceRow } from '../unit/field-rows';
import { views } from '../../webview/src/registry/index';
import DataTable from '../../webview/src/components/DataTable.vue';

views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value', 'field', 'options'], render(this: { value: unknown }) { return String(this.value ?? '—'); } },
});
// A reference cell resolves to the relation View; this tier draws it as its raw value — what the
// cell renders is not under test, that the CELL is classed and the fallback replaces it is.
views.register({
	id: 'relation',
	name: 'Relation',
	types: [],
	component: { props: ['value', 'field', 'options'], render(this: { value: unknown }) { return this.value == null || this.value === '' ? '—' : String(this.value); } },
});

// DataTable listens for window focus; the file-codec list rides on `window` too (lib/file-record.ts).
const win = ((globalThis as { window?: Record<string, unknown> }).window ??= { addEventListener() {}, removeEventListener() {} });

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	delete win['__DT_FILE_BASES__'];
});

function fakeState(init: {
	fields: FieldRow[];
	records: ItemRecord[];
	options?: Record<string, unknown>;
	titleField?: string | null;
	relationTargets?: Record<string, string>;
}) {
	const fields = ref(init.fields) as Ref<FieldRow[]>;
	return {
		collection: 'demo',
		columns: fields,
		fields: { visibleFields: fields, fields, relationTargets: ref(new Map(Object.entries(init.relationTargets ?? {}))) },
		items: { items: ref(init.records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {}, setSort: () => {} },
		listOptions: ref({ table: init.options ?? {} }) as Ref<Record<string, Record<string, unknown>>>,
		selectedIds: computed(() => new Set<string>()),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? r['id']),
		titleField: ref(init.titleField === undefined ? 'name' : init.titleField),
		tintOf: () => undefined,
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

const FIELDS = [referenceRow('picture'), fieldRow('name'), fieldRow('team')];
const ROWS: ItemRecord[] = [
	{ id: 'dana-levi', picture: 'pictures/faces/dana-levi', name: 'Dana Levi', team: 'Platform' },
	{ id: 'omer-cohen', picture: '', name: 'Omer Cohen', team: 'Design' },
];

const tableOf = (root: ReturnType<typeof find> extends infer T ? Exclude<T, null> : never) => find(root, (n) => n.tag === 'table');
const dataRows = (root: Parameters<typeof all>[0]) => all(root, (n) => n.tag === 'tr' && hasClass(n, 'dt-row'));
const cellsOf = (row: Parameters<typeof all>[0]) => all(row, (n) => n.tag === 'td' && !hasClass(n, 'dt-table__checkbox-col'));

test('no row_size → the table is cozy, which is today\'s table', async () => {
	const root = await render(DataTable, { state: fakeState({ fields: FIELDS, records: ROWS }) });
	const table = tableOf(root);
	assert.ok(table && hasClass(table, 'dt-table') && hasClass(table, 'dt-table--cozy'), `classes: ${table?.props['class']}`);
	assert.ok(!hasClass(table, 'dt-table--comfortable') && !hasClass(table, 'dt-table--compact'));
});

test('row_size: compact and comfortable each put their one class on the table', async () => {
	for (const size of ['compact', 'comfortable']) {
		const root = await render(DataTable, { state: fakeState({ fields: FIELDS, records: ROWS, options: { row_size: size } }) });
		const table = tableOf(root);
		assert.ok(table && hasClass(table, `dt-table--${size}`), `${size}: ${table?.props['class']}`);
		assert.ok(!hasClass(table, 'dt-table--cozy'), `${size} is not also cozy`);
	}
});

test('an unknown row_size draws the default rather than an unstyled table', async () => {
	const root = await render(DataTable, { state: fakeState({ fields: FIELDS, records: ROWS, options: { row_size: 'roomy' } }) });
	assert.ok(hasClass(tableOf(root)!, 'dt-table--cozy'));
});

test('the first column is the lead and the record_title column is the title, in every density', async () => {
	const root = await render(DataTable, { state: fakeState({ fields: FIELDS, records: ROWS }) });
	const [picture, name, team] = cellsOf(dataRows(root)[0]!);
	assert.ok(hasClass(picture!, 'dt-td--lead'), 'column 0 leads');
	assert.ok(!hasClass(name!, 'dt-td--lead') && !hasClass(team!, 'dt-td--lead'));
	assert.ok(hasClass(name!, 'dt-td--title'), 'the record_title field is the title column');
	assert.ok(!hasClass(picture!, 'dt-td--title') && !hasClass(team!, 'dt-td--title'));
});

test('no title field resolved → no column is weighted', async () => {
	const root = await render(DataTable, { state: fakeState({ fields: FIELDS, records: ROWS, titleField: null }) });
	assert.equal(all(root, (n) => n.tag === 'td' && hasClass(n, 'dt-td--title')).length, 0);
});

test('comfortable: an EMPTY leading picture draws the record\'s initials — only when the column is a picture column', async () => {
	// the host says `pictures` is a file-codec collection; the field targets it
	win['__DT_FILE_BASES__'] = [{ collection: 'pictures', path: 'data/pictures', suffix: 'asset' }];
	const root = await render(DataTable, {
		state: fakeState({ fields: FIELDS, records: ROWS, options: { row_size: 'comfortable' }, relationTargets: { picture: 'pictures' } }),
	});
	const [withPicture, without] = dataRows(root);
	assert.equal(all(withPicture!, (n) => hasClass(n, 'dt-avatar-fallback')).length, 0, 'a record WITH a picture draws it');
	const fallback = find(without!, (n) => hasClass(n, 'dt-avatar-fallback'));
	assert.ok(fallback, 'a record without one draws the fallback');
	assert.equal(text(fallback).trim(), 'OC', 'two initials from the record title');
	assert.equal(fallback.props['title'], 'Omer Cohen');
});

test('the initials disc is NOT drawn when the lead column is not a picture, nor outside comfortable', async () => {
	win['__DT_FILE_BASES__'] = [{ collection: 'pictures', path: 'data/pictures', suffix: 'asset' }];
	// same shape, but the field targets a collection that is not file-codec
	const notPictures = await render(DataTable, {
		state: fakeState({ fields: FIELDS, records: ROWS, options: { row_size: 'comfortable' }, relationTargets: { picture: 'companies' } }),
	});
	assert.equal(all(notPictures, (n) => hasClass(n, 'dt-avatar-fallback')).length, 0, 'a reference to a non-file collection keeps its dash');
	assert.match(text(dataRows(notPictures)[1]!), /—/, 'the dash is what the empty cell shows');

	const cozy = await render(DataTable, {
		state: fakeState({ fields: FIELDS, records: ROWS, relationTargets: { picture: 'pictures' } }),
	});
	assert.equal(all(cozy, (n) => hasClass(n, 'dt-avatar-fallback')).length, 0, 'cozy is untouched');

	const compact = await render(DataTable, {
		state: fakeState({ fields: FIELDS, records: ROWS, options: { row_size: 'compact' }, relationTargets: { picture: 'pictures' } }),
	});
	assert.equal(all(compact, (n) => hasClass(n, 'dt-avatar-fallback')).length, 0, 'compact is one line, no disc');
});

test('comfortable with a picture column that is NOT first draws no disc — the lead rule is positional', async () => {
	win['__DT_FILE_BASES__'] = [{ collection: 'pictures', path: 'data/pictures', suffix: 'asset' }];
	const root = await render(DataTable, {
		state: fakeState({
			fields: [fieldRow('name'), referenceRow('picture'), fieldRow('team')],
			records: ROWS,
			options: { row_size: 'comfortable' },
			relationTargets: { picture: 'pictures' },
		}),
	});
	assert.equal(all(root, (n) => hasClass(n, 'dt-avatar-fallback')).length, 0);
	assert.ok(hasClass(cellsOf(dataRows(root)[0]!)[0]!, 'dt-td--lead'), 'the name column leads instead');
});
