// Tier 1 — the filter builder's pure logic. No Vue, no editor API: `filter-query.ts` is deliberately
// framework-free so exactly this is possible.
//
// ⚠ The bug that forced this file into existence: opening the filter panel on a SAVED VIEW showed
// "No filters yet" over a table that was visibly filtered — 90 of 429 rows. `compileFilter` had no
// inverse, so nothing could turn a `ui-view` record's stored filter back into rules to show.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	compileFilter, decompileFilter, displayValue, emptyFilterGroup, filterToProse, newRule, splitFieldPath,
	type FilterGroup,
} from '../../src/lib/filter-query';

/** Compare ignoring rule ids — they are v-for keys, explicitly not data, and are re-minted on parse. */
const shape = (g: FilterGroup | null) =>
	g && { logic: g.logic, rules: g.rules.map(({ field, operator, value }) => ({ field, operator, value })) };

const group = (logic: '_and' | '_or', ...rules: { field: string; operator: string; value?: unknown }[]): FilterGroup =>
	({ logic, rules: rules.map((r) => newRule({ field: r.field, operator: r.operator, value: r.value ?? '' })) });

describe('splitFieldPath', () => {
	test('a plain field is a one-segment path', () => assert.deepEqual(splitFieldPath('flag'), ['flag']));
	test('a nested path splits on dots', () => assert.deepEqual(splitFieldPath('person.name'), ['person', 'name']));
	test('empty segments are dropped rather than producing a blank hop', () =>
		assert.deepEqual(splitFieldPath('person..name.'), ['person', 'name']));
});

describe('compileFilter emits NESTING for a path, not a dotted key', () => {
	// ⚠ The engine's `matchesField` treats any non-operator key as a hop and recurses. A literal
	// `{"person.name":{…}}` would name a field that does not exist and match nothing — silently.
	test('a nested path compiles to nested objects', () => {
		assert.deepEqual(
			compileFilter(group('_and', { field: 'person.name', operator: '_eq', value: 'Ada Lovelace' })),
			{ person: { name: { _eq: 'Ada Lovelace' } } },
		);
	});

	test('a deeper path keeps nesting', () => {
		assert.deepEqual(
			compileFilter(group('_and', { field: 'meeting.company.name', operator: '_contains', value: 'Zem' })),
			{ meeting: { company: { name: { _contains: 'Zem' } } } },
		);
	});

	test('a plain field is unchanged', () => {
		assert.deepEqual(
			compileFilter(group('_and', { field: 'flag', operator: '_eq', value: 'high' })),
			{ flag: { _eq: 'high' } },
		);
	});
});

describe('decompileFilter — the inverse', () => {
	test('the saved view that started this: a list operator on one field', () => {
		assert.deepEqual(
			shape(decompileFilter({ flag: { _in: ['high', 'low', 'abnormal', 'positive'] } })),
			{ logic: '_and', rules: [{ field: 'flag', operator: '_in', value: ['high', 'low', 'abnormal', 'positive'] }] },
		);
	});

	test('an _and group becomes several rules', () => {
		assert.deepEqual(
			shape(decompileFilter({ _and: [{ flag: { _eq: 'high' } }, { analyte: { _eq: 'ldl' } }] })),
			{ logic: '_and', rules: [{ field: 'flag', operator: '_eq', value: 'high' }, { field: 'analyte', operator: '_eq', value: 'ldl' }] },
		);
	});

	test('_or is carried, not flattened to _and', () => {
		assert.equal(decompileFilter({ _or: [{ a: { _eq: 1 } }, { b: { _eq: 2 } }] })?.logic, '_or');
	});

	test('a nested path round-trips back to its dotted form', () => {
		assert.deepEqual(
			shape(decompileFilter({ person: { name: { _eq: 'Ada Lovelace' } } })),
			{ logic: '_and', rules: [{ field: 'person.name', operator: '_eq', value: 'Ada Lovelace' }] },
		);
	});

	test('several bare top-level fields are _and-combined, as the engine reads them', () => {
		assert.equal(decompileFilter({ flag: { _eq: 'high' }, analyte: { _eq: 'ldl' } })?.rules.length, 2);
	});

	test('two operators on ONE field become two rules — the engine ands them', () => {
		assert.deepEqual(
			shape(decompileFilter({ value: { _gte: 1, _lte: 9 } })),
			{ logic: '_and', rules: [{ field: 'value', operator: '_gte', value: 1 }, { field: 'value', operator: '_lte', value: 9 }] },
		);
	});

	test('a no-value operator carries no value into the builder', () => {
		assert.deepEqual(shape(decompileFilter({ notes: { _null: true } })),
			{ logic: '_and', rules: [{ field: 'notes', operator: '_null', value: '' }] });
	});

	test("the engine's scalar shorthand reads as _eq", () => {
		assert.deepEqual(shape(decompileFilter({ flag: 'high' })),
			{ logic: '_and', rules: [{ field: 'flag', operator: '_eq', value: 'high' }] });
	});

	test('an empty filter is an empty group, not null', () => {
		assert.deepEqual(shape(decompileFilter({})), { logic: '_and', rules: [] });
	});

	// ⚠ NULL, never a lossy approximation. A caller that gets null must show the filter read-only:
	// round-tripping something we only half-understood would silently rewrite the operator's saved
	// view, which is far worse than declining to edit it.
	test('a NESTED GROUP is refused rather than flattened', () => {
		assert.equal(decompileFilter({ _and: [{ _or: [{ a: { _eq: 1 } }, { b: { _eq: 2 } }] }] }), null);
	});

	test('a MIXED shape is refused', () => {
		assert.equal(decompileFilter({ flag: { _eq: 'high' }, _or: [{ a: { _eq: 1 } }] }), null);
	});

	test('junk is refused', () => {
		for (const junk of [null, undefined, 'nope', 42, []]) assert.equal(decompileFilter(junk), null, String(junk));
	});
});

describe('round trip: decompile(compile(g)) preserves every operator arity', () => {
	const cases: [string, FilterGroup][] = [
		['single value', group('_and', { field: 'flag', operator: '_eq', value: 'high' })],
		['list', group('_and', { field: 'flag', operator: '_in', value: ['high', 'low'] })],
		['pair', group('_and', { field: 'value', operator: '_between', value: [1, 9] })],
		['no value', group('_and', { field: 'notes', operator: '_null', value: '' })],
		['nested path', group('_and', { field: 'person.name', operator: '_icontains', value: 'gil' })],
		['two rules, _or', group('_or', { field: 'flag', operator: '_eq', value: 'high' }, { field: 'analyte', operator: '_eq', value: 'ldl' })],
		['deep path + list', group('_and', { field: 'meeting.company.name', operator: '_in', value: ['A', 'B'] })],
	];
	for (const [name, g] of cases) {
		test(name, () => {
			const compiled = compileFilter(g);
			assert.ok(compiled, `${name} compiled to nothing`);
			assert.deepEqual(shape(decompileFilter(compiled)), shape(g));
		});
	}
});

describe('filterToProse', () => {
	const label = (p: string) => p.split('.').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' › ');

	test('the saved view, in words', () => {
		assert.equal(
			filterToProse(decompileFilter({ flag: { _in: ['high', 'low', 'abnormal', 'positive'] } })!, label),
			'Flag is any of high, low, abnormal, positive',
		);
	});

	test('a nested path reads as a path', () => {
		assert.equal(
			filterToProse(group('_and', { field: 'person.name', operator: '_eq', value: 'Ada Lovelace' }), label),
			'Person › Name is Ada Lovelace',
		);
	});

	test('a no-value operator stops after the operator', () => {
		assert.equal(filterToProse(group('_and', { field: 'notes', operator: '_nnull', value: '' }), label), 'Notes is not empty');
	});

	test('a pair reads as a range', () => {
		assert.equal(filterToProse(group('_and', { field: 'value', operator: '_between', value: [1, 9] }), label), 'Value is between 1 and 9');
	});

	test('the logic word is spelled out, never _and', () => {
		const prose = filterToProse(group('_or', { field: 'a', operator: '_eq', value: '1' }, { field: 'b', operator: '_eq', value: '2' }), label);
		assert.equal(prose, 'A is 1 or B is 2');
		assert.doesNotMatch(prose, /_and|_or/);
	});

	test('an empty group is an empty string, not "undefined"', () => {
		assert.equal(filterToProse(emptyFilterGroup(), label), '');
	});
});

describe('displayValue — the wire slash never reaches a label', () => {
	test('a relation value loses its leading slash', () => {
		assert.equal(displayValue('/contacts/ada'), 'contacts/ada');
	});

	// A plain string that merely STARTS with a slash is not a reference and keeps every character.
	test('a lone path segment is left alone', () => {
		assert.equal(displayValue('/weekly'), '/weekly');
		assert.equal(displayValue('/'), '/');
	});

	test('non-strings stringify as before', () => {
		assert.equal(displayValue(42), '42');
		assert.equal(displayValue(true), 'true');
	});
});
