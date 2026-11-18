/**
 * Tier 1 — ROW DENSITY (`row_size` on the table layout): which density wins, how it reaches the
 * stylesheet, where a browse's unsaved pick is kept, and which pictures are circles.
 *
 * The precedence is the one every layout option already has — the toolbar's pick is a write into
 * the browse's scratch slice, over the ui-view's `display.list.options`, over the collection's, over
 * the default — so it is proved HERE through `listSeed` (view over collection) plus the merge the
 * density menu performs (pick over seed), not through a second resolver of its own.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listSeed, scratchKey } from '../../src/lib/list-seed';
import { DEFAULT_ROW_SIZE, ROW_SIZES, isRowSize, isSquarish, resolveRowSize, tableDensityClass } from '../../src/lib/row-size';
import { unknownOptions } from '../../src/lib/list-options';
import '../../src/registry/register-defaults';
import { lists } from '../../src/registry/index';

describe('resolveRowSize', () => {
	test('cozy is the default — a table nobody configured is the table that existed before the option', () => {
		assert.equal(DEFAULT_ROW_SIZE, 'cozy');
		assert.equal(resolveRowSize(undefined), 'cozy');
		assert.equal(resolveRowSize({}), 'cozy');
		assert.equal(resolveRowSize({ group_by: 'status' }), 'cozy');
	});

	test('each declared density resolves to itself', () => {
		assert.deepEqual(ROW_SIZES, ['compact', 'cozy', 'comfortable']);
		for (const size of ROW_SIZES) assert.equal(resolveRowSize({ row_size: size }), size);
	});

	test('a value this build does not know is the default, never an erased table', () => {
		assert.equal(resolveRowSize({ row_size: 'roomy' }), 'cozy');
		assert.equal(resolveRowSize({ row_size: 64 }), 'cozy');
		assert.equal(resolveRowSize({ row_size: null }), 'cozy');
		assert.equal(isRowSize('Comfortable'), false, 'case matters — the option is the enum, not a label');
	});

	test('the density reaches the table as one class', () => {
		assert.equal(tableDensityClass('compact'), 'dt-table--compact');
		assert.equal(tableDensityClass('cozy'), 'dt-table--cozy');
		assert.equal(tableDensityClass('comfortable'), 'dt-table--comfortable');
	});
});

describe('precedence: toolbar > authored (view over collection) > default', () => {
	const collection = { layout: 'table', options: { row_size: 'compact', page_size: 50 } };

	test('nothing authored → the default', () => {
		assert.equal(resolveRowSize(listSeed(undefined, { layout: 'table' }).listOptions['table']), 'cozy');
	});

	test('the collection authored it → the collection', () => {
		assert.equal(resolveRowSize(listSeed(undefined, collection).listOptions['table']), 'compact');
	});

	test('the view authored it → the view, over the collection', () => {
		const seed = listSeed({ listOptions: { table: { row_size: 'comfortable' } } }, collection);
		assert.equal(resolveRowSize(seed.listOptions['table']), 'comfortable');
		assert.equal(seed.listOptions['table']?.['page_size'], 50, 'the rest of the collection\'s slice survives the merge');
	});

	test('the toolbar pick is a write over the seed slice, and keeps the rest of it', () => {
		const seed = listSeed({ listOptions: { table: { row_size: 'comfortable' } } }, collection);
		const picked = { ...seed.listOptions['table'], row_size: 'cozy' };
		assert.equal(resolveRowSize(picked), 'cozy');
		assert.equal(picked['page_size'], 50);
	});

	test('an authored density on another layout does not reach the table', () => {
		const seed = listSeed(undefined, { layout: 'cards', options: { row_size: 'comfortable' } });
		assert.equal(resolveRowSize(seed.listOptions['table']), 'cozy');
	});
});

describe('the scratch key — one pad per collection and per governing view', () => {
	test('the bare collection and a named view keep separate pads', () => {
		assert.equal(scratchKey('people'), 'people::default');
		assert.equal(scratchKey('people', 'people-recent'), 'people::people-recent');
		assert.notEqual(scratchKey('people'), scratchKey('people', 'people-recent'));
	});

	test('an embedded browse of the same collection keeps its own', () => {
		assert.equal(scratchKey('people', undefined, 'embedded'), 'people::default::embedded');
		assert.notEqual(scratchKey('people', undefined, 'embedded'), scratchKey('people'));
	});

	test('two collections never share one', () => {
		assert.notEqual(scratchKey('people'), scratchKey('companies'));
	});
});

describe('the table layout declares the option, so a view carrying it is never named as unknown', () => {
	test('row_size is a declared table option with the three choices and the cozy default', () => {
		const option = lists.get('table')?.options?.find((o) => o.field === 'row_size');
		assert.ok(option, 'the table declares row_size');
		assert.equal(option.default, 'cozy');
		const choices = (option.editor_options?.['choices'] as Array<{ value: string }>).map((c) => c.value);
		assert.deepEqual(choices, ['compact', 'cozy', 'comfortable']);
		assert.deepEqual(unknownOptions({ row_size: 'comfortable' }, lists.get('table')?.options), []);
	});

	test('the cards, kanban and gantt layouts are untouched — none declares a density', () => {
		for (const id of ['cards', 'kanban', 'gantt']) {
			assert.equal(lists.get(id)?.options?.some((o) => o.field === 'row_size'), false, `${id} declares no row_size`);
		}
	});
});

describe('isSquarish — which pictures become circles', () => {
	test('a square and a near-square are', () => {
		assert.equal(isSquarish(64, 64), true);
		assert.equal(isSquarish(400, 500), true, '4:5 portrait');
		assert.equal(isSquarish(500, 400), true, '5:4 landscape');
	});
	test('a wordmark is not', () => {
		assert.equal(isSquarish(320, 80), false);
		assert.equal(isSquarish(80, 320), false);
	});
	test('an unloaded picture (no natural size) is not', () => {
		assert.equal(isSquarish(0, 0), false);
		assert.equal(isSquarish(NaN, 10), false);
	});
});
