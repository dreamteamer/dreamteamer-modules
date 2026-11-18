// Tier 1 — the filter's wire translation. ⚠ THE BUG: the adapter adds a leading `/` to a relation
// value on the way out and strips it on the way in for record BODIES only. A filter is not a body,
// so a relation condition built in the UI sent `/contacts/ada` to a store holding
// `contacts/ada` and matched nothing — measured on the real vault as 17 rows vs 0.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilterRefs } from '../../src/lib/filter-wire';

const REL: Record<string, Record<string, string>> = {
	meetings: { attendees: 'contacts', company: 'companies' },
	contacts: { company: 'companies' },
	companies: {},
};
const targetOf = (c: string, f: string) => REL[c]?.[f];
const norm = (filter: unknown, collection = 'meetings') => normalizeFilterRefs(filter, collection, targetOf);

describe('relation values lose the wire slash', () => {
	test('the case that returned zero rows', () => {
		assert.deepEqual(norm({ attendees: { _eq: '/contacts/ada' } }), { attendees: { _eq: 'contacts/ada' } });
	});

	test('a list operand is normalized element by element', () => {
		assert.deepEqual(norm({ attendees: { _in: ['/contacts/a', '/contacts/b'] } }),
			{ attendees: { _in: ['contacts/a', 'contacts/b'] } });
	});

	test("the engine's scalar shorthand is normalized too", () => {
		assert.deepEqual(norm({ company: '/companies/acme' }), { company: 'companies/acme' });
	});

	test('an already-correct reference is left exactly as it is', () => {
		assert.deepEqual(norm({ attendees: { _eq: 'contacts/ada' } }), { attendees: { _eq: 'contacts/ada' } });
	});
});

describe('⚠ a NON-relation field is never touched', () => {
	// Blanket-stripping every leading slash would corrupt a correct filter to fix an incorrect one:
	// a plain string field may legitimately hold a path, a route, or a regex fragment.
	test('a string field keeps its leading slash', () => {
		assert.deepEqual(norm({ name: { _contains: '/weekly' } }), { name: { _contains: '/weekly' } });
	});

	test('a string field keeps a slashed list too', () => {
		assert.deepEqual(norm({ name: { _in: ['/a', '/b'] } }), { name: { _in: ['/a', '/b'] } });
	});

	test('an unknown field is left alone rather than guessed at', () => {
		assert.deepEqual(norm({ mystery: { _eq: '/x' } }), { mystery: { _eq: '/x' } });
	});
});

describe('groups and hops', () => {
	test('_and / _or branches are walked', () => {
		assert.deepEqual(
			norm({ _and: [{ attendees: { _eq: '/contacts/ada' } }, { name: { _contains: '/weekly' } }] }),
			{ _and: [{ attendees: { _eq: 'contacts/ada' } }, { name: { _contains: '/weekly' } }] },
		);
	});

	// A hop continues in the TARGET collection — `company.name` is a string there, `contacts.company`
	// is a relation there. Getting the collection wrong flips both answers.
	test('a hop resolves against the target collection', () => {
		assert.deepEqual(norm({ attendees: { company: { _eq: '/companies/acme' } } }),
			{ attendees: { company: { _eq: 'companies/acme' } } });
	});

	test('a string leaf reached through a hop keeps its slash', () => {
		assert.deepEqual(norm({ company: { name: { _contains: '/x' } } }),
			{ company: { name: { _contains: '/x' } } });
	});

	test('a two-hop path is walked all the way down', () => {
		assert.deepEqual(norm({ attendees: { company: { name: { _eq: '/lit' } } } }),
			{ attendees: { company: { name: { _eq: '/lit' } } } }, 'name is a string in companies');
	});
});

describe('degenerate input', () => {
	test('non-objects pass through untouched', () => {
		for (const junk of [null, undefined, 'x', 4, []]) assert.deepEqual(norm(junk), junk);
	});
	test('an empty filter stays empty', () => assert.deepEqual(norm({}), {}));
});
