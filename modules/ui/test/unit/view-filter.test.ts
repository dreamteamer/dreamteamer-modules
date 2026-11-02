// Tier 1 — how a view record's filter reaches the builder and gets back out again. Both directions
// were wrong at once for months, so both directions are run here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seedFilter, filterToWrite, filterFromUrl } from '../../src/lib/view-filter';
import { newRule, serializeFilterGroup, emptyFilterGroup, type FilterGroup } from '../../src/lib/filter-query';

const groupOf = (...rules: Parameters<typeof newRule>[0][]): FilterGroup =>
	({ logic: '_and', rules: rules.map((r) => newRule(r)) });

const FLAG_IN = { flag: { _in: ['high', 'low'] } };

describe('seedFilter — the record reaching the builder', () => {
	test('a flat stored filter seeds the builder AND is the baseline', () => {
		const s = seedFilter(FLAG_IN, null);
		assert.equal(s.opaque, false);
		assert.equal(s.initial.rules.length, 1);
		assert.equal(s.initial.rules[0]?.field, 'flag');
		assert.deepEqual(s.record, s.initial);
	});

	test('no stored filter at all: an empty group, and an empty baseline — not null', () => {
		const s = seedFilter(undefined, null);
		assert.equal(s.opaque, false);
		assert.deepEqual(s.initial.rules, []);
		assert.deepEqual(s.record?.rules, [], 'null would mean "opaque", which it is not');
	});

	test('a nested group is OPAQUE — the builder cannot show it, so it must not speak for it', () => {
		const s = seedFilter({ _or: [{ _and: [FLAG_IN] }, { flag: { _eq: 'positive' } }] }, null);
		assert.equal(s.opaque, true);
		assert.equal(s.record, null);
		assert.deepEqual(s.initial.rules, []);
	});

	test('the URL wins over the record — that is the operator having already edited', () => {
		const url = JSON.stringify(groupOf({ field: 'flag', operator: '_eq', value: 'high' }));
		const s = seedFilter(FLAG_IN, url);
		assert.equal(s.initial.rules[0]?.operator, '_eq', 'the URL filter is what the builder holds');
	});

	// ⚠ The regression this file exists for. Opacity read off "did we seed" instead of "did it
	// decompile", so arriving with ?filter= at a filtered view declared the record opaque — and an
	// opaque base gets ANDed under the edit, making the edit appear to do nothing.
	test('a URL filter does NOT make a representable record filter opaque', () => {
		const url = JSON.stringify(groupOf({ field: 'flag', operator: '_eq', value: 'high' }));
		assert.equal(seedFilter(FLAG_IN, url).opaque, false);
	});

	test('the baseline is still the RECORD even when the URL seeded the builder — so it reads as dirty', () => {
		const url = JSON.stringify(groupOf({ field: 'flag', operator: '_eq', value: 'high' }));
		const s = seedFilter(FLAG_IN, url);
		assert.notDeepEqual(s.record, s.initial);
	});
});

describe('filterToWrite — the builder reaching the record', () => {
	test('what the builder shows is what gets written', () => {
		const w = filterToWrite(groupOf({ field: 'flag', operator: '_eq', value: 'high' }), { opaque: false });
		assert.deepEqual(w, { flag: { _eq: 'high' } });
	});

	test('clearing every condition writes NOTHING — an absent key is how a filter is removed', () => {
		assert.equal(filterToWrite({ logic: '_and', rules: [] }, { opaque: false, stored: FLAG_IN }), undefined);
	});

	test('an opaque stored filter is preserved verbatim, never flattened', () => {
		const stored = { _or: [FLAG_IN, { flag: { _eq: 'positive' } }] };
		const w = filterToWrite(groupOf({ field: 'flag', operator: '_eq', value: 'high' }), { opaque: true, stored });
		assert.deepEqual(w, stored, 'the builder never held this — it does not get to overwrite it');
	});

	test('opaque with nothing stored writes nothing', () => {
		assert.equal(filterToWrite(groupOf({ field: 'flag', operator: '_eq', value: 'high' }), { opaque: true }), undefined);
	});
});

// operator 2026-10-29: a mounted browse read `?filter=` once, so the second layer's nav row (same path,
// another filter) left the first layer's records on screen.
describe('filterFromUrl — a filter-only navigation reaching a mounted browse', () => {
	const projectA = groupOf({ field: '$source', operator: '_eq', value: 'project-a' });
	const projectB = groupOf({ field: '$source', operator: '_eq', value: 'project-b' });

	test('another layer\'s filter replaces the one the builder holds', () => {
		assert.deepEqual(filterFromUrl(serializeFilterGroup(projectB), projectA, undefined)?.rules.map((r) => r.value), ['project-b']);
	});

	test('the builder\'s own URL write echoing back is a no-op', () => {
		assert.equal(filterFromUrl(serializeFilterGroup(projectA), projectA, undefined), null);
		assert.equal(filterFromUrl(null, emptyFilterGroup(), undefined), null);
	});

	test('a filter removed from the URL clears the builder — back to the view\'s own filter where it has one', () => {
		assert.deepEqual(filterFromUrl(null, projectA, undefined)?.rules, []);
		assert.equal(filterFromUrl(null, groupOf({ field: 'flag', operator: '_in', value: ['high', 'low'] }), FLAG_IN), null, 'the view filter it already holds');
	});
});
