// Tier 1 — what a record is called: its collection's `record_title` (descriptor v2 §3.1) through the
// one grammar, and the split that lets a reference find the collection it names.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recordTitle, splitReference } from '../../src/lib/record-titles';
import type { CollectionRow } from '../../src/api/types';

const row = (collection: string, record_title: string): CollectionRow => ({
	collection,
	title: collection,
	nav: {},
	list: { layout: 'table' },
	record: { layout: 'page' },
	form: { sections: [] },
	record_title,
	record_type: collection,
	runtime: false,
	internal: false,
});

describe('splitReference', () => {
	const names = ['health', 'health/patients', 'tasks'];

	test('splits at the LONGEST collection name, not the first slash', () => {
		assert.deepEqual(splitReference('health/patients/dana-oren', names), { collection: 'health/patients', id: 'dana-oren' });
	});

	test('an id may carry folders of its own', () => {
		assert.deepEqual(splitReference('tasks/2026/07/kickoff', names), { collection: 'tasks', id: '2026/07/kickoff' });
	});

	test('the webview\'s leading-slash form splits the same', () => {
		assert.deepEqual(splitReference('/tasks/kickoff', names), { collection: 'tasks', id: 'kickoff' });
	});

	test('a reference to no registered collection is null, never a guess', () => {
		assert.equal(splitReference('companies/northwind', names), null);
	});
});

describe('recordTitle', () => {
	const visits = row('health/visits', '{{ reason }} · {{ date | date:DD/MM }}');

	test('renders the collection\'s record_title with the grammar, filters included', () => {
		assert.equal(recordTitle(visits, { reason: 'Headache', date: '2026-03-04' }, 'v1'), 'Headache · 04/03');
	});

	test('a reference in it reads as the target\'s title', () => {
		const tasks = row('tasks', '{{ owner }}: {{ name }}');
		const resolve = (r: string) => (r === 'contacts/priya-raman' ? 'Priya Raman' : undefined);
		const isReference = (f: string) => f === 'owner';
		assert.equal(recordTitle(tasks, { owner: 'contacts/priya-raman', name: 'Ship it' }, 't1', { resolve, isReference }), 'Priya Raman: Ship it');
	});

	test('a title that renders to nothing falls back — a nameless header reads as a loading bug', () => {
		assert.equal(recordTitle(row('notes', '{{ name }}'), { body: 'x' }, 'n1'), 'n1');
	});

	test('no row or no record yet: the fallback', () => {
		assert.equal(recordTitle(null, { name: 'x' }, 'id-1'), 'id-1');
		assert.equal(recordTitle(visits, null, 'id-2'), 'id-2');
	});
});
