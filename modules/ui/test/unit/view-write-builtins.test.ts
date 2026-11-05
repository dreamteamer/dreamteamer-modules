// What Save and Save as… write names the built-in the way the engine does (cr-vscode-011): whatever
// the browse held — the legacy `last-modified` included — every column and the sort leave the three
// writers as `last_modified`, and every seed reads it back the same way. Pure; the real engine's verdict is api-save-last-modified.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionListWrite, namedViewWrite, newViewWrite, type ListPresentation } from '../../src/lib/view-write';
import type { UiViewRecord } from '../../src/ui-views';
import { listSeed } from '../../src/lib/list-seed';
import { DEFAULT_SORT } from '../../src/lib/builtin-fields';

const LEGACY: ListPresentation = { layout: 'table', columns: ['name', 'last-modified'], sort: '-last-modified', options: {} };
const EXISTING: UiViewRecord = { id: 'gadgets-recent', route: '/gadgets/recent', scope: 'collection', collection: 'collections/gadgets', display: { nav: { title: 'Recent' }, list: { layout: 'table', columns: ['name'], sort: 'name' } } };

test('a named view\'s Save writes last_modified, descending and ascending', () => {
	const down = namedViewWrite(EXISTING, 'gadgets', LEGACY, undefined).display.list!;
	assert.deepEqual(down.columns, ['name', 'last_modified']);
	assert.equal(down.sort, '-last_modified');
	assert.equal(namedViewWrite(EXISTING, 'gadgets', { ...LEGACY, sort: 'last-modified' }, undefined).display.list!.sort, 'last_modified');
});

test('Save as… writes last_modified', () => {
	const list = newViewWrite('/gadgets/recent', 'gadgets', { title: 'Recent' }, LEGACY, undefined).display.list!;
	assert.deepEqual(list.columns, ['name', 'last_modified']);
	assert.equal(list.sort, '-last_modified');
});

test('Save to the collection\'s own display writes last_modified', () => {
	const { changes } = collectionListWrite({ layout: 'table' }, LEGACY, undefined);
	assert.deepEqual(changes['display.list.columns'], ['name', 'last_modified']);
	assert.equal(changes['display.list.sort'], '-last_modified');
	assert.equal(collectionListWrite({ layout: 'table' }, { ...LEGACY, sort: 'last-modified' }, undefined).changes['display.list.sort'], 'last_modified');
});

test('every other name is written exactly as it came — created, id, a computed column, unsorted', () => {
	const p: ListPresentation = { layout: 'table', columns: ['id', 'created', '$last-modified-by'], sort: '-created', options: {} };
	const list = newViewWrite('/gadgets/x', 'gadgets', { title: 'X' }, p, undefined).display.list!;
	assert.deepEqual(list.columns, ['id', 'created', '$last-modified-by']);
	assert.equal(list.sort, '-created');
	assert.equal(collectionListWrite({ layout: 'table' }, { ...p, sort: '' }, undefined).changes['display.list.sort'], '');
});

test('the browse\'s built-in order is the engine\'s field, newest first', () => {
	assert.equal(DEFAULT_SORT, '-last_modified');
});

test('a seed reads the legacy key as last_modified, from a view and from the collection', () => {
	const fromView = listSeed({ columns: ['name', 'last-modified'], sort: '-last-modified' }, { layout: 'table' } as never);
	assert.deepEqual(fromView.columns, ['name', 'last_modified']);
	assert.equal(fromView.sort, '-last_modified');
	const fromCollection = listSeed(undefined, { layout: 'table', columns: ['name', 'last-modified'], sort: 'last-modified' } as never);
	assert.deepEqual(fromCollection.columns, ['name', 'last_modified']);
	assert.equal(fromCollection.sort, 'last_modified');
});

test('a seed already saying last_modified, or naming no sort, is unchanged', () => {
	const same = listSeed({ columns: ['name', 'last_modified'], sort: '-last_modified' }, undefined);
	assert.deepEqual(same.columns, ['name', 'last_modified']);
	assert.equal(same.sort, '-last_modified');
	const none = listSeed(undefined, { layout: 'table' } as never);
	assert.equal(none.sort, undefined);
	assert.equal(none.columns, null);
	assert.equal(listSeed({ sort: '' }, undefined).sort, '', 'Unsorted stays unsorted');
});
