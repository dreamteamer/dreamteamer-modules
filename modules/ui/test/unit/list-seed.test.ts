// Tier 1 — what a browse starts from: the governing view over the collection's own `display.list`
// (descriptor v2, §3.5). "The collection's display IS what a bare route renders"; a view is a named
// variant merged over it key by key — a key the view sets wins, a key it omits is the collection's.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { listSeed } from '../../src/lib/list-seed';
import type { CollectionRow } from '../../src/api/types';

const LIST: CollectionRow['list'] = {
	layout: 'kanban',
	columns: ['reason', 'patient', 'date'],
	sort: '-date',
	options: { lanes_by: 'status', page_size: 50 },
};

describe('listSeed', () => {
	test('with no view, the collection display IS the browse', () => {
		assert.deepEqual(listSeed(undefined, LIST), {
			layout: 'kanban',
			columns: ['reason', 'patient', 'date'],
			sort: '-date',
			listOptions: { kanban: { lanes_by: 'status', page_size: 50 } },
		});
	});

	test('a key the view sets wins; a key it omits is the collection\'s', () => {
		const seed = listSeed({ columns: ['date', 'reason'] }, LIST);
		assert.deepEqual(seed.columns, ['date', 'reason'], 'the view named columns');
		assert.equal(seed.layout, 'kanban', 'the view named no layout');
		assert.equal(seed.sort, '-date', 'the view named no sort');
	});

	test('an explicit unsorted view beats the collection\'s sort', () => {
		assert.equal(listSeed({ sort: '' }, LIST).sort, '');
	});

	test('layout options merge key by key, the view on top', () => {
		const seed = listSeed({ listOptions: { kanban: { lanes_by: 'kind' } } }, LIST);
		assert.deepEqual(seed.listOptions, { kanban: { lanes_by: 'kind', page_size: 50 } });
	});

	test('a view on another layout keeps its own options beside the collection\'s', () => {
		const seed = listSeed({ layout: 'table', listOptions: { table: { group_by: 'status' } } }, LIST);
		assert.equal(seed.layout, 'table');
		assert.deepEqual(seed.listOptions, { kanban: { lanes_by: 'status', page_size: 50 }, table: { group_by: 'status' } });
	});

	test('neither naming columns leaves the heuristic to decide', () => {
		assert.equal(listSeed(undefined, { layout: 'table' }).columns, null);
		assert.equal(listSeed({ columns: [] }, { layout: 'table', columns: [] }).columns, null);
	});

	test('no collection row yet: a table with nothing seeded', () => {
		assert.deepEqual(listSeed(undefined, undefined), { layout: 'table', columns: null, sort: undefined, listOptions: {} });
	});
});
