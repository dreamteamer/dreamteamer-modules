/**
 * A field's `width` (descriptor v2 §3.4.2) is a LIST COLUMN HINT, in characters — and only that: the
 * record form ignores it. Rendered, because "the column carries the hint" is a fact about the header
 * cell a reader sees, not about a row the table was handed.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { computed, ref, type Ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, render, text } from './render';
import type { FieldRow, ItemRecord } from '../../src/api/types';
import { fieldRow } from '../unit/field-rows';
import { views } from '../../src/registry/index';
import DataTable from '../../src/components/DataTable.vue';

views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };

beforeEach(() => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

function fakeState(fields: FieldRow[], records: ItemRecord[]) {
	const f = ref(fields) as Ref<FieldRow[]>;
	return {
		collection: 'demo',
		columns: f,
		fields: { visibleFields: f, fields: f },
		items: { items: ref(records) as Ref<ItemRecord[]>, loading: ref(false), reload: async () => {}, setSort: () => {} },
		listOptions: ref({ table: {} }) as Ref<Record<string, Record<string, unknown>>>,
		selectedIds: computed(() => [] as string[]),
		allVisibleSelected: computed(() => false),
		hasActiveQuery: computed(() => false),
		sortIndicator: () => null,
		pkOf: (r: ItemRecord) => String(r['id'] ?? ''),
		recordTitleOf: (r: ItemRecord) => String(r['name'] ?? r['id']),
		// no `color_by` here: an untinted row, which is what this test is not about
		tintOf: () => undefined,
		isSelected: () => false,
		toggleSelect: () => {},
		toggleSelectAllVisible: () => {},
		openRecord: () => {},
		createRecord: () => {},
	};
}

test('a field with a width hint draws a column at least that many characters wide; one without is content-sized', async () => {
	const state = fakeState([fieldRow('code', { width: 12 }), fieldRow('name')], [{ id: '1', code: 'NW-17', name: 'Northwind' }]);
	const root = await render(DataTable, { state });
	const ths = all(root, (n) => n.tag === 'th' && String(n.props['class'] ?? '').includes('dt-th'));
	const byLabel = new Map(ths.map((th) => [text(th).trim(), th]));
	assert.deepEqual(byLabel.get('Code')?.props['style'], { minWidth: '12ch' });
	assert.equal(byLabel.get('Name')?.props['style'], undefined);
});
