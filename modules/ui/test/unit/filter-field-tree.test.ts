// Tier 1 — the filter field picker's tree logic. The parts worth arguing about (the depth cap, the
// cycle guard, what search matches) are tested by RUNNING them, which is why this module holds no Vue.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	MAX_DEPTH, childNodes, collectionsAlongPath, joinLabels, labelForPath, labelOfField,
	resolvePathTarget, searchNodes, visitedAlong,
	type FieldNode,
} from '../../src/lib/filter-field-tree';
import type { FieldRow } from '../../src/api/types';
import { fieldRow } from './field-rows';

const field = (name: string, title?: string): FieldRow => fieldRow(name, title ? { title } : { title: '' });

/** lab-results → person → (a person's own fields, one of which points at a doctor) */
const REL: Record<string, Record<string, string>> = {
	'family/health/lab-results': { person: 'family/people', source_document: 'family/health/documents' },
	'family/people': { gp: 'family/health/doctors' },
	'family/health/doctors': { clinic: 'family/health/clinics' },
	'family/health/clinics': { manager: 'family/people' },
};
const relationOf = (c: string, f: string) => REL[c]?.[f];

const ROOT = 'family/health/lab-results';
const rootFields = [field('flag', 'Flag'), field('person', 'Person'), field('analyte', 'Analyte')];
const personFields = [field('name', 'Name'), field('born', 'Born'), field('gp', 'GP')];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

describe('childNodes — the root level', () => {
	const roots = childNodes(rootFields, ROOT, relationOf);

	test('a plain field is depth 0 and not expandable', () => {
		const flag = roots.find((n) => n.path === 'flag')!;
		assert.equal(flag.depth, 0);
		assert.equal(flag.expandable, false);
		assert.equal(flag.target, undefined);
	});

	test('a relation field carries its target and can be expanded', () => {
		const person = roots.find((n) => n.path === 'person')!;
		assert.equal(person.target, 'family/people');
		assert.equal(person.expandable, true);
	});

	test('labels start as a one-element trail', () => {
		assert.deepEqual(roots.find((n) => n.path === 'flag')!.labels, ['Flag']);
	});
});

describe('childNodes — under a relation', () => {
	const person = childNodes(rootFields, ROOT, relationOf).find((n) => n.path === 'person')!;
	const kids = childNodes(personFields, 'family/people', relationOf, person, visitedAlong(person, ROOT));

	test('a child path is dotted, which is what a rule stores', () => {
		assert.deepEqual(kids.map((n) => n.path).sort(), ['person.born', 'person.gp', 'person.name']);
	});

	test('a child carries the whole label trail', () => {
		assert.deepEqual(kids.find((n) => n.path === 'person.name')!.labels, ['Person', 'Name']);
	});

	test('depth counts HOPS, so a one-hop child is depth 1', () => {
		assert.equal(kids.find((n) => n.path === 'person.name')!.depth, 1);
	});

	test('the child belongs to the TARGET collection, not the root', () => {
		assert.equal(kids.find((n) => n.path === 'person.name')!.collection, 'family/people');
	});
});

describe('the depth cap', () => {
	// lab-results → person → gp → clinic is depth 3; nothing under it may expand again.
	const chain = () => {
		const person = childNodes(rootFields, ROOT, relationOf)[1]!;
		const gp = childNodes(personFields, 'family/people', relationOf, person, visitedAlong(person, ROOT))
			.find((n) => n.path === 'person.gp')!;
		const clinic = childNodes([field('clinic', 'Clinic')], 'family/health/doctors', relationOf, gp, [ROOT, 'family/people'])
			.find((n) => n.path === 'person.gp.clinic')!;
		return { person, gp, clinic };
	};

	test('MAX_DEPTH is stated, not discovered', () => assert.equal(MAX_DEPTH, 3));

	test('a node at the cap is not expandable even though it points somewhere', () => {
		const { clinic } = chain();
		assert.equal(clinic.depth, 2);
		assert.equal(clinic.target, 'family/health/clinics');
		assert.equal(clinic.expandable, true, 'depth 2 is still under the cap');

		const manager = childNodes([field('manager', 'Manager')], 'family/health/clinics', relationOf, clinic,
			[ROOT, 'family/people', 'family/health/doctors'])[0]!;
		assert.equal(manager.depth, 3);
		assert.equal(manager.expandable, false, 'at MAX_DEPTH nothing expands further');
	});
});

describe('the cycle guard', () => {
	// clinics.manager points back at family/people, which is already on this path.
	test('a path may not walk back into a collection it came through', () => {
		const person = childNodes(rootFields, ROOT, relationOf)[1]!;
		const back = childNodes([field('manager', 'Manager')], 'family/health/clinics', relationOf, person,
			[ROOT, 'family/people'])[0]!;
		assert.equal(back.target, 'family/people');
		assert.equal(back.expandable, false, 'family/people is already on this path');
	});

	// ⚠ Per-PATH, not global: two sibling branches may both legitimately reach one collection.
	test('a sibling branch reaching the same collection is unaffected', () => {
		const person = childNodes(rootFields, ROOT, relationOf)[1]!;
		const doc = childNodes(rootFields.concat(field('source_document', 'Source Document')), ROOT, relationOf)
			.find((n) => n.path === 'source_document')!;
		assert.equal(person.expandable, true);
		assert.equal(doc.expandable, true, 'a second branch is not poisoned by the first');
	});
});

describe('searchNodes', () => {
	const nodes: FieldNode[] = [
		...childNodes(rootFields, ROOT, relationOf),
		...childNodes(personFields, 'family/people', relationOf,
			childNodes(rootFields, ROOT, relationOf)[1]!, [ROOT]),
	];

	test('a nested field is findable without expanding to it first', () => {
		assert.deepEqual(searchNodes(nodes, 'name').map((n) => n.path), ['person.name']);
	});

	test('every term must hit — "per nam" finds Person › Name', () => {
		assert.deepEqual(searchNodes(nodes, 'per nam').map((n) => n.path), ['person.name']);
	});

	test('matching is case-insensitive and hits the raw path too', () => {
		assert.deepEqual(searchNodes(nodes, 'PERSON.BORN').map((n) => n.path), ['person.born']);
	});

	test('an empty query returns everything, not nothing', () => {
		assert.equal(searchNodes(nodes, '   ').length, nodes.length);
	});

	// Deliberately not fuzzy: a picker that guesses filters the WRONG field, silently.
	test('a near-miss returns nothing rather than a guess', () => {
		assert.deepEqual(searchNodes(nodes, 'nmae'), []);
	});
});

describe('labels', () => {
	test('joinLabels uses › so a path reads as a route through records', () => {
		assert.equal(joinLabels(['Person', 'Name']), 'Person › Name');
	});

	test('labelOfField falls back to the raw name, never undefined', () => {
		assert.equal(labelOfField(field('ref_low')), 'ref_low');
		assert.equal(labelOfField(field('ref_low', 'Ref Low')), 'Ref Low');
	});

	test('labelForPath uses the authored root label and title-cases deeper segments', () => {
		assert.equal(labelForPath('person.name', rootFields, titleCase), 'Person › Name');
		assert.equal(labelForPath('flag', rootFields, titleCase), 'Flag');
	});

	test('labelForPath survives a field the root does not have', () => {
		assert.equal(labelForPath('mystery', rootFields, titleCase), 'Mystery');
		assert.equal(labelForPath('', rootFields, titleCase), '');
	});
});

describe('resolvePathTarget — everything downstream resolves against the LEAF', () => {
	// ⚠ Resolving `person.name` against the ROOT collection finds no such field, which degraded to
	// "every operator, no value widget" — a condition you cannot complete and cannot see is wrong.
	test('a plain field resolves to the root collection', () => {
		assert.deepEqual(resolvePathTarget('flag', ROOT, relationOf), { collection: ROOT, field: 'flag' });
	});

	test('a one-hop path resolves into the TARGET collection', () => {
		assert.deepEqual(resolvePathTarget('person.name', ROOT, relationOf), { collection: 'family/people', field: 'name' });
	});

	test('a two-hop path walks both hops', () => {
		assert.deepEqual(resolvePathTarget('person.gp.clinic', ROOT, relationOf),
			{ collection: 'family/health/doctors', field: 'clinic' });
	});

	test('a hop that points nowhere is null, not a wrong guess', () => {
		assert.equal(resolvePathTarget('flag.nope', ROOT, relationOf), null);
		assert.equal(resolvePathTarget('', ROOT, relationOf), null);
	});
});

describe('collectionsAlongPath', () => {
	test('names every collection the path traverses, root first', () => {
		assert.deepEqual(collectionsAlongPath('person.gp.clinic', ROOT, relationOf),
			[ROOT, 'family/people', 'family/health/doctors']);
	});

	test('a plain field traverses only the root', () => {
		assert.deepEqual(collectionsAlongPath('flag', ROOT, relationOf), [ROOT]);
	});

	test('it stops at a broken hop rather than throwing', () => {
		assert.deepEqual(collectionsAlongPath('flag.nope.deeper', ROOT, relationOf), [ROOT]);
	});
});
