// cr-modules-022: the browser host's one search asks each nav collection for its matching rows and ranks the titles.
// Follow-up: a record is found by its TITLE wherever it sits in its collection (not only among the first rows the
// row-substring `q` happened to return), a key-only `q` match is dropped, each collection shows a few hits and says
// how many more it has, and a search overtaken by the next keystroke stops asking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_SHOWN_PER_COLLECTION, rankTitle, searchRecords, titleFilter, valuesHold, type SearchTarget } from '../../src/lib/search';

const target = (collection: string, title: string): SearchTarget => ({ collection, title, titleFields: ['name'], titleOf: (r) => String(r['name'] ?? '') });

/** A host over in-memory collections that answers like the protocol host: `filter` (`_or` of `_icontains`) and `q`
 *  (a substring of the row AS JSON — keys included), then `limit`; `total` counts before the limit. */
function host(data: Record<string, Array<Record<string, unknown>>>, asked: string[] = []) {
	return async (_m: string, path: string) => {
		asked.push(path);
		const [p, qs] = path.split('?');
		const name = decodeURIComponent(p!.split('/')[2]!);
		const rows = data[name];
		if (!rows) throw new Error('403');
		const params = new URLSearchParams(qs);
		let out = rows;
		const filter = params.get('filter');
		if (filter) {
			const f = JSON.parse(filter) as { _or: Array<Record<string, { _icontains: string }>> };
			out = out.filter((r) => f._or.some((c) => Object.entries(c).some(([k, v]) => String(r[k] ?? '').toLowerCase().includes(v._icontains.toLowerCase()))));
		}
		const q = params.get('q')?.toLowerCase();
		if (q) out = out.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
		return { records: out.slice(0, Number(params.get('limit') ?? 200)), total: out.length };
	};
}

test('ranks a title that starts with the term, then a word that does, then a substring, then another field', () => {
	assert.equal(rankTitle('Northwind weekly', 'north'), 0);
	assert.equal(rankTitle('Call with Northwind', 'north'), 1);
	assert.equal(rankTitle('Harbor-northwind sync', 'wind'), 2);
	assert.equal(rankTitle('Dana Oren', 'north'), 3);
});

test('asks every collection by title and by any field, skips one that refuses, and opens a hit at its record route', async () => {
	const asked: string[] = [];
	const { hits } = await searchRecords('north', [target('contacts', 'Contacts'), target('rnd/issues', 'Issues'), target('tasks', 'Tasks')], host({
		contacts: [{ id: 'dana-oren', name: 'Dana Oren', company: 'companies/northwind' }],
		'rnd/issues': [{ id: 'nav/drop', name: 'Northwind nav drop' }],
	}, asked));
	assert.deepEqual([...new Set(asked.map((p) => p.split('?')[0]))].sort(), ['/collections/contacts/records', '/collections/rnd%2Fissues/records', '/collections/tasks/records']);
	assert.ok(asked.some((p) => /\?filter=[^&]+&limit=\d+$/.test(p)), 'no title ask');
	assert.ok(asked.some((p) => /\?q=north&limit=\d+$/.test(p)), 'no any-field ask');
	assert.deepEqual(hits.map((h) => [h.title, h.route, h.rank]), [['Northwind nav drop', '/content/rnd/issues/nav/drop', 0], ['Dana Oren', '/content/contacts/dana-oren', 3]]);
	assert.deepEqual(await searchRecords('n', [target('contacts', 'Contacts')], async () => { throw new Error('asked'); }), { hits: [], more: [] }, 'one letter asks nobody');
});

test('a record is found by its title wherever it sits — not only among the first rows a key-matching q returns', async () => {
	// fifty rows; every row has a `name` key, so `q=na` matches all of them as JSON — the old search kept the first six
	const rows = Array.from({ length: 50 }, (_, i) => ({ id: `t-${String(i).padStart(2, '0')}`, name: `Task ${i}` }));
	rows[41] = { id: 't-41', name: 'Call Dana about the rollout' };
	const { hits } = await searchRecords('dana', [target('tasks', 'Tasks')], host({ tasks: rows }));
	assert.deepEqual(hits.map((h) => h.id), ['t-41']);
	const na = await searchRecords('na', [target('tasks', 'Tasks')], host({ tasks: rows }));
	assert.deepEqual(na.hits.map((h) => h.id), ['t-41'], 'a key-only q match is not a hit');
});

test('the title ask is any title field or the id, in any case; a key-only match is dropped', () => {
	assert.deepEqual(titleFilter(['first', 'last', '$path'], 'Dana'), { _or: [{ first: { _icontains: 'Dana' } }, { last: { _icontains: 'Dana' } }, { id: { _icontains: 'Dana' } }] });
	assert.equal(valuesHold({ name: 'Task 1', status: 'todo' }, 'name'), false);
	assert.equal(valuesHold({ name: 'Task 1', tags: ['northwind'] }, 'north'), true);
	assert.equal(valuesHold({ $path: 'data/tasks/north.md', name: 'x' }, 'north'), false, 'a computed $ key is not a value');
});

test('a collection shows a few hits and says how many more it has; the more line opens the list, searched', async () => {
	const rows = Array.from({ length: 12 }, (_, i) => ({ id: `m-${i}`, name: `Northwind meeting ${i}` }));
	const { hits, more } = await searchRecords('northwind', [target('meetings', 'Meetings'), target('contacts', 'Contacts')], host({ meetings: rows, contacts: [{ id: 'sam', name: 'Sam Diaz' }] }));
	assert.equal(hits.length, SEARCH_SHOWN_PER_COLLECTION);
	assert.deepEqual(more.map((m) => [m.collection, m.count, m.route]), [['meetings', 12 - SEARCH_SHOWN_PER_COLLECTION, '/content/meetings?search=northwind']]);
});

test('a search overtaken by the next keystroke stops asking', async () => {
	let stale = false;
	const asked: string[] = [];
	const many = Array.from({ length: 20 }, (_, i) => target(`c${i}`, `C${i}`));
	const data = Object.fromEntries(many.map((t) => [t.collection, [{ id: 'x', name: 'north' }]]));
	const ask = host(data, asked);
	await searchRecords('north', many, async (m, p) => { const r = await ask(m, p); stale = true; return r; }, () => stale);
	assert.ok(asked.length < many.length * 2, `kept asking after it went stale (${asked.length} asks)`);
});
