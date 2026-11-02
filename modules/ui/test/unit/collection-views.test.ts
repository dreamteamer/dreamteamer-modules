// Tier 1 — how a ui-view record's `display.list` reaches the browse page (descriptor v2, §3.5). What
// a view draws is `compiled.display` — compile's merge of the view's display over its collection's
// — so that is what these records carry; the authored `display` is what a write sends back.
//
// ⚠ THE BUG THIS FILE EXISTS FOR is a silence, not a crash. `columns` written as a comma STRING —
// which is what `dt set ui-views/<id> display.list.columns=a,b` once produced — used to read
// back as `undefined`, and `undefined` is what an UNCONFIGURED view answers too. So the page drew
// the heuristic column set, the record's own answer was thrown away, and nothing anywhere said so:
// the operator's only signal was "my columns did nothing". Hence both halves are asserted here —
// the VALUE that comes out, and the fact that a warning was emitted at all.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The composable's module graph reaches `ui-views.ts` → `api/transport.ts`, which registers a
// `message` listener on `window` when it loads. One shim, then a DYNAMIC import so the shim is in
// place first — a static import is hoisted above every statement in this file.
(globalThis as unknown as { window?: unknown }).window ??= { addEventListener() {} };
const { viewToConfig } = await import('../../src/composables/collection-views');
type UiViewRecord = import('../../src/ui-views').UiViewRecord;

/** A collection-scope view whose drawn `display.list` is `table` plus the given keys. */
const view = (list: Record<string, unknown>): UiViewRecord =>
	({ id: 'views/tasks-open', route: '/views/tasks-open', scope: 'collection', collection: 'collections/tasks', compiled: { display: { list: { layout: 'table', ...list } } } });

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
	warnings = [];
	console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
});
afterEach(() => { console.warn = realWarn; });

describe('columns — a LIST is the shape, and it passes through untouched', () => {
	test('an array of strings is the columns, in order, silently', () => {
		assert.deepEqual(viewToConfig(view({ columns: ['title', 'status'] })).columns, ['title', 'status']);
		assert.deepEqual(warnings, []);
	});

	test('a non-string entry is dropped — and SAYS so', () => {
		assert.deepEqual(viewToConfig(view({ columns: ['title', 7, null] })).columns, ['title']);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!, /views\/tasks-open.*display\.list\.columns/);
	});
});

describe('⚠ columns as a comma STRING — tolerated AND complained about', () => {
	test('it is split, trimmed, and used', () => {
		assert.deepEqual(viewToConfig(view({ columns: 'title, status ,due' })).columns, ['title', 'status', 'due']);
	});

	test('empty segments are dropped rather than becoming blank columns', () => {
		assert.deepEqual(viewToConfig(view({ columns: 'title,,status,' })).columns, ['title', 'status']);
	});

	test('a single name with no comma at all is one column, not a wasted string', () => {
		assert.deepEqual(viewToConfig(view({ columns: 'title' })).columns, ['title']);
	});

	test('the warning names the VIEW and the OPTION, so the record can be fixed', () => {
		viewToConfig(view({ columns: 'title,status' }));
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!, /views\/tasks-open/);
		assert.match(warnings[0]!, /display\.list\.columns/);
	});

	test('a string of nothing but separators falls back — there is no column in it', () => {
		assert.equal(viewToConfig(view({ columns: ' , ' })).columns, undefined);
		assert.equal(warnings.length, 1, 'still complains — the record asked for something unusable');
	});
});

describe('every other shape still falls back — loudly if a value is actually there', () => {
	test('a number is ignored, with a warning', () => {
		assert.equal(viewToConfig(view({ columns: 7 })).columns, undefined);
		assert.equal(warnings.length, 1);
	});

	test('null is silent — "unset" is not a defect', () => {
		assert.equal(viewToConfig(view({ columns: null })).columns, undefined);
		assert.deepEqual(warnings, []);
	});

	test('no columns key at all is silent', () => {
		assert.equal(viewToConfig(view({})).columns, undefined);
		assert.deepEqual(warnings, []);
	});
});

describe('sort — the same silent case one type over', () => {
	test("'' survives: a view that says UNSORTED must beat the fallback", () => {
		assert.equal(viewToConfig(view({ sort: '' })).sort, '');
		assert.deepEqual(warnings, []);
	});

	test('a non-string sort is ignored, and says so', () => {
		assert.equal(viewToConfig(view({ sort: ['-due'] })).sort, undefined);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!, /display\.list\.sort/);
	});
});

describe('the layout\'s options ride through under the layout id', () => {
	test('columns and sort are keys of the block; `options` is the pinned layout\'s', () => {
		const config = viewToConfig(view({ columns: 'title', sort: '-due', options: { group_by: 'status' } }));
		assert.deepEqual(config.listOptions, { table: { group_by: 'status' } });
		assert.equal(config.viewId, 'views/tasks-open');
		assert.equal(config.layout, 'table');
	});

	test('a key left in `options` is not read as a column or a sort — it belongs one level up', () => {
		const config = viewToConfig(view({ options: { columns: ['title'], sort: 'due' } }));
		assert.equal(config.columns, undefined);
		assert.equal(config.sort, undefined);
	});

	test('the drawn display is compile\'s merge, not the authored block', () => {
		const v: UiViewRecord = {
			id: 'board', route: '/tasks/board', scope: 'collection', collection: 'collections/tasks',
			display: { list: { layout: 'kanban' } },
			compiled: { display: { list: { layout: 'kanban', columns: ['name', 'status'], sort: '-due' } } },
		};
		const config = viewToConfig(v);
		assert.equal(config.layout, 'kanban');
		assert.deepEqual(config.columns, ['name', 'status'], 'the collection\'s columns, carried by the merge');
		assert.equal(config.sort, '-due');
	});
});
