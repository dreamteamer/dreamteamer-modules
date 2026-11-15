// cr-modules-022: the browser host's one search asks each nav collection for its matching rows and ranks the titles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTitle, searchRecords, type SearchTarget } from '../../src/lib/search';

const target = (collection: string, title: string): SearchTarget => ({ collection, title, titleOf: (r) => String(r['name'] ?? '') });

test('ranks a title that starts with the term, then a word that does, then a substring, then another field', () => {
	assert.equal(rankTitle('Northwind weekly', 'north'), 0);
	assert.equal(rankTitle('Call with Northwind', 'north'), 1);
	assert.equal(rankTitle('Harbor-northwind sync', 'wind'), 2);
	assert.equal(rankTitle('Dana Oren', 'north'), 3);
});

test('asks every collection with q and a limit, skips one that refuses, and opens a hit at its record route', async () => {
	const asked: string[] = [];
	const hits = await searchRecords('north', [target('contacts', 'Contacts'), target('rnd/issues', 'Issues'), target('tasks', 'Tasks')], async (_m, path) => {
		asked.push(path);
		if (path.startsWith('/collections/tasks/')) throw new Error('403');
		if (path.startsWith('/collections/contacts/')) return { records: [{ id: 'dana-oren', name: 'Dana Oren' }] };
		return { records: [{ id: 'nav/drop', name: 'Northwind nav drop' }] };
	});
	assert.deepEqual(asked.map((p) => p.split('?')[0]).sort(), ['/collections/contacts/records', '/collections/rnd%2Fissues/records', '/collections/tasks/records']);
	assert.match(asked[0], /\?q=north&limit=\d+$/);
	assert.deepEqual(hits.map((h) => [h.title, h.route]), [['Northwind nav drop', '/content/rnd/issues/nav/drop'], ['Dana Oren', '/content/contacts/dana-oren']]);
	assert.deepEqual(await searchRecords('n', [target('contacts', 'Contacts')], async () => { throw new Error('asked'); }), [], 'one letter asks nobody');
});
