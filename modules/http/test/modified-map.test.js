// `last-modified` on a listing comes from ONE `git log` over the folders a collection's records can sit
// in. A collection stored under another (`storage.under`, engine 0.32+) keeps most of its files inside
// the parent collection's folders, so a map built over its own root alone answers `null` for every
// placed record — silently, since null is also what an uncommitted record reads as.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gitModifiedMap } from '../src/app.js';
import { httpWorkspace, mount, call, simpleCollection } from './support.mjs';
import { api } from '../../../tests/helpers/fixture.mjs';

const COMPANIES = {
	id: { generate: '{{ name | slug }}' },
	storage: { shape: 'folder', entry: 'company.md', suffix: 'company', codec: 'md' },
	schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, notes: { type: 'string', format: 'markdown', 'x-body': true } } },
};
const MEETINGS = {
	id: { generate: '{{ name | slug }}' },
	storage: { suffix: 'meeting', under: { field: 'company', path: 'meetings' } },
	schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, company: { type: 'string', 'x-reference': 'companies' }, notes: { type: 'string', format: 'markdown', 'x-body': true } } },
};

test('gitModifiedMap covers several folders in one call', async () => {
	const h = await httpWorkspace({ collections: { a: simpleCollection({ storage: { suffix: 'a' } }), b: simpleCollection({ storage: { suffix: 'b' } }) }, records: { a: [{ name: 'One' }], b: [{ name: 'Two' }] } });
	assert.equal(h.dt('commit', '-m', 'seed').code, 0);
	const map = gitModifiedMap(h.root, [path.join(h.root, 'data/a'), path.join(h.root, 'data/b')]);
	assert.ok(map.get('data/a/one.a.md'), 'the first folder');
	assert.ok(map.get('data/b/two.b.md'), 'and the second');
	assert.equal(gitModifiedMap(h.root, []).size, 0, 'no folders, no call');
});

test('a record stored inside its parent folder still gets its last-modified', async () => {
	const h = await httpWorkspace({ collections: { companies: COMPANIES, meetings: MEETINGS } });
	const store = new api.Store(h.ws);
	store.add('companies', { name: 'Northwind' });
	store.add('meetings', { name: 'Kickoff', company: 'companies/northwind' });
	store.add('meetings', { name: 'Offsite' });
	assert.equal(h.dt('commit', '-m', 'seed').code, 0);
	// on an engine that places records, the kickoff sits inside the company folder; on an older one it
	// does not — either way every committed record must carry its instant
	const placed = fs.existsSync(path.join(h.root, 'data/companies/northwind/meetings/kickoff.meeting.md'));
	const srv = await mount(h.ws);
	try {
		const res = await call('GET', `${srv.base}/collections/meetings/records`);
		assert.equal(res.status, 200);
		assert.equal(res.json.total, 2);
		for (const r of res.json.records) assert.ok(r['last-modified'], `${r.id} has no last-modified (placed: ${placed})`);
	} finally { await srv.close(); }
});
