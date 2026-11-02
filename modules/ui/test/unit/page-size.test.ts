/**
 * Tier 1 — PAGE SIZE, and the one number that must never be -1.
 *
 * Paging here is SERVER-side: the browse sends `limit` and `page`, and both servers that answer it
 * (the engine's `server.js` and this extension's in-process `api.ts`) do the same thing with it —
 * `rows.slice(offset, offset + limit)`.
 *
 * ⚠ SO `limit: -1` IS NOT "ALL", IT IS "ALL BUT THE LAST ROW". Directus spells unlimited as -1 and
 * that convention is load-bearing in a lot of muscle memory, but `[1,2,3].slice(0, -1)` is `[1,2]`.
 * The count in `meta.filter_count` would still read 3, so the page would show two rows, claim three,
 * and never say which one it dropped. `ALL` is therefore a large sentinel, and this file is where
 * that decision is written down and defended.
 *
 * The second thing here is the grouping interaction (design 2026-09-07): a grouped view DEFAULTS to
 * All, because a band showing "12 of 40" is never a picture anyone wants — but it is a default, not
 * a prohibition. An explicit page size still wins, which is what the operator asked for.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ALL, DEFAULT_PAGE_SIZE, PAGE_SIZE_CHOICES, effectiveLimit, isAll } from '../../src/lib/page-size';

describe('the ALL sentinel', () => {
	test('is a large positive number, never -1', () => {
		assert.ok(ALL > 0, 'a negative limit means slice() silently drops rows from the END');
		assert.ok(ALL >= 100000, 'it has to clear any collection a workspace realistically holds');
	});

	test('and the reason, demonstrated on the operation both servers actually perform', () => {
		const rows = [1, 2, 3];
		assert.deepEqual(rows.slice(0, 0 + -1), [1, 2], 'THIS is why -1 is not allowed anywhere near a limit');
		assert.deepEqual(rows.slice(0, 0 + ALL), [1, 2, 3]);
	});

	test('is offered last among the choices, after the real page sizes', () => {
		assert.deepEqual(PAGE_SIZE_CHOICES, [25, 50, 100, 200, ALL]);
		assert.equal(DEFAULT_PAGE_SIZE, 25, 'unchanged from what every browse has always used');
	});

	test('isAll recognises it, and nothing else', () => {
		assert.equal(isAll(ALL), true);
		assert.equal(isAll(200), false);
		assert.equal(isAll(undefined), false);
	});
});

describe('effectiveLimit', () => {
	test('no option and no grouping is the historical default', () => {
		assert.equal(effectiveLimit(undefined, false), DEFAULT_PAGE_SIZE);
	});

	test('no option WITH a row grouping is All — a band showing 12 of 40 is never right', () => {
		assert.equal(effectiveLimit(undefined, true), ALL);
	});

	test('an explicit size wins over the grouping default — a default, not a prohibition', () => {
		assert.equal(effectiveLimit(50, true), 50);
		assert.equal(effectiveLimit(50, false), 50);
	});

	test('an explicit All is honoured without grouping too', () => {
		assert.equal(effectiveLimit(ALL, false), ALL);
	});

	test('the options form hands back strings, and those count as explicit', () => {
		assert.equal(effectiveLimit('100', false), 100);
		assert.equal(effectiveLimit(String(ALL), true), ALL);
	});

	test('a nonsense value falls back rather than sending garbage to the server', () => {
		for (const bad of [0, -1, -200, 'lots', '', null, {}, NaN, 1.5]) {
			assert.equal(effectiveLimit(bad as unknown, false), DEFAULT_PAGE_SIZE, `page_size: ${JSON.stringify(bad)}`);
		}
	});

	test('and a nonsense value on a GROUPED view falls back to All, not to 25', () => {
		// The fallback answers "what did this view ask for", and a grouped view that asked for
		// gibberish still asked for a grouped view.
		assert.equal(effectiveLimit('lots', true), ALL);
	});
});
