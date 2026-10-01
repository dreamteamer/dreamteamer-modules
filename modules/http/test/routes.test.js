// The route contract a client relies on: paths, the percent-encoded namespaced collection, slashed
// ids, body shapes, status codes and response shapes — against the app on a real workspace.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { httpWorkspace, simpleCollection, mount, call } from './support.mjs';

// a namespaced collection (its name carries a slash) whose ids are paths (they carry one too)
const SAMPLES = {
	storage: { suffix: 'sample' },
	id: { generate: '{{ date }}/{{ name | slug }}' },
	schema: {
		type: 'object',
		required: ['name', 'date'],
		properties: {
			name: { type: 'string' },
			date: { type: 'string', format: 'date' },
			status: { type: 'string', enum: ['open', 'done'] },
			notes: { type: 'string', format: 'markdown', 'x-body': true },
		},
	},
};
const C = encodeURIComponent('lab/samples');

let h, srv, api;

before(async () => {
	h = await httpWorkspace({
		namespaces: ['lab'],
		collections: { 'lab/samples': SAMPLES, notes: simpleCollection({ storage: { suffix: 'note' } }) },
		records: { notes: [{ name: 'First note', notes: 'Body text.\n' }, { name: 'Second note' }] },
	});
	srv = await mount(h.ws);
	api = srv.base;
});
after(() => srv?.close());

describe('reads', () => {
	test('GET /info names the workspace and every collection, the namespaced one included', async () => {
		const { status, json } = await call('GET', `${api}/info`);
		assert.equal(status, 200);
		for (const k of ['name', 'host', 'compiled', 'modules', 'ui', 'stale', 'collections']) assert.ok(k in json, `/info carries ${k}`);
		assert.ok(json.collections.includes('lab/samples'));
		assert.ok(json.collections.includes('notes'));
		assert.ok(Array.isArray(json.ui));
	});

	test('GET /schema is every descriptor', async () => {
		const { status, json } = await call('GET', `${api}/schema`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(json));
		assert.ok(json.find((d) => d.name === 'lab/samples')?.schema?.properties?.date);
	});

	test('GET /presentation and GET /commands/:name answer with their read models', async () => {
		const p = await call('GET', `${api}/presentation`);
		assert.equal(p.status, 200);
		assert.ok(Array.isArray(p.json.collections) && p.json.fields && Array.isArray(p.json.relations));
		const c = await call('GET', `${api}/commands/${C}?ids=x`);
		assert.equal(c.status, 200);
		assert.ok(Array.isArray(c.json.commands));
	});

	test('a listing strips the body unless ?with-body=true asks for it', async () => {
		const plain = await call('GET', `${api}/collections/notes/records?sort=name`);
		assert.equal(plain.status, 200);
		assert.equal(plain.json.total, 2);
		assert.deepEqual(plain.json.records.map((r) => r.id), ['first-note', 'second-note']);
		assert.ok(!('notes' in plain.json.records[0]), 'body stripped');
		assert.ok('last-modified' in plain.json.records[0]);
		const withBody = await call('GET', `${api}/collections/notes/records?sort=name&with-body=true`);
		assert.equal(withBody.json.total, 2, 'with-body is an option, not an equality filter on a field named "with-body"');
		assert.equal(withBody.json.records[0].notes, 'Body text.\n');
	});

	test('filters: bare equality, filter[field], ?filter=<json>, ?q, limit and offset', async () => {
		const ids = async (qs) => (await call('GET', `${api}/collections/notes/records?${qs}`)).json.records.map((r) => r.id);
		assert.deepEqual(await ids('name=Second%20note'), ['second-note']);
		assert.deepEqual(await ids('filter%5Bname%5D=First%20note'), ['first-note']);
		assert.deepEqual(await ids(`filter=${encodeURIComponent(JSON.stringify({ name: { _contains: 'Second' } }))}`), ['second-note']);
		assert.deepEqual(await ids('q=first'), ['first-note']);
		const page = await call('GET', `${api}/collections/notes/records?sort=name&limit=1&offset=1`);
		assert.deepEqual(page.json.records.map((r) => r.id), ['second-note']);
		assert.equal(page.json.total, 2, 'total counts before the page');
	});

	test('GET /collections/:name/values/:field is the vocabulary in use', async () => {
		const { status, json } = await call('GET', `${api}/collections/notes/values/name`);
		assert.equal(status, 200);
		assert.ok(JSON.stringify(json).includes('First note'));
	});
});

describe('a record in a namespaced collection, with a slashed id', () => {
	let id;
	test('POST creates it: 201 {id, path}, the id generated with its slash', async () => {
		const { status, json } = await call('POST', `${api}/collections/${C}/records`, { name: 'Alpha', date: '2026-09-01', status: 'open', notes: 'Prose.\n' });
		assert.equal(status, 201, JSON.stringify(json));
		assert.equal(json.id, '2026-09-01/alpha');
		assert.equal(json.path, 'data/lab/samples/2026-09-01/alpha.sample.md');
		assert.ok(fs.existsSync(path.join(h.root, json.path)));
		id = json.id;
	});

	test('GET lists it and reads it through the percent-encoded name and the unencoded slashed id', async () => {
		const list = await call('GET', `${api}/collections/${C}/records`);
		assert.deepEqual(list.json.records.map((r) => r.id), [id]);
		const one = await call('GET', `${api}/collections/${C}/records/${id}`);
		assert.equal(one.status, 200);
		assert.equal(one.json.id, id);
		assert.equal(one.json.path, 'data/lab/samples/2026-09-01/alpha.sample.md');
		assert.equal(one.json.fields.name, 'Alpha');
		assert.equal(one.json.fields.notes, 'Prose.\n', 'a single read carries the body');
		for (const k of ['last-modified', '$last-modified-by', '$last-commit-message']) assert.ok(k in one.json.fields);
	});

	test('PATCH sets fields and never persists the synthetic keys a client echoes back', async () => {
		const { status, json } = await call('PATCH', `${api}/collections/${C}/records/${id}`, {
			status: 'done', id, path: 'x', 'last-modified': 'y', '$last-modified-by': 'z', '$last-commit-message': 'w',
		});
		assert.equal(status, 200, JSON.stringify(json));
		assert.deepEqual(json, { id });
		const text = fs.readFileSync(path.join(h.root, 'data/lab/samples/2026-09-01/alpha.sample.md'), 'utf8');
		assert.match(text, /status: done/);
		assert.doesNotMatch(text, /last-modified|\$last|^path:/m);
	});

	test('a write the schema refuses is a 400 carrying the engine sentence', async () => {
		const { status, json } = await call('PATCH', `${api}/collections/${C}/records/${id}`, { status: 'nonsense' });
		assert.equal(status, 400);
		assert.equal(typeof json.error, 'string');
		assert.ok(json.error.length > 0);
	});

	test('history lists the commit that published it', async () => {
		const r = h.dt('commit');
		assert.equal(r.code, 0, r.stderr);
		const { status, json } = await call('GET', `${api}/history/${C}/${id}`);
		assert.equal(status, 200);
		assert.ok(Array.isArray(json) && json.length >= 1, JSON.stringify(json));
		assert.ok(json[0].hash && json[0].subject);
		const one = await call('GET', `${api}/collections/${C}/records/${id}`);
		assert.equal(one.json.fields['$last-commit-message'], json[0].subject);
	});

	test('DELETE removes it; a read after is a 404', async () => {
		const del = await call('DELETE', `${api}/collections/${C}/records/${id}`);
		assert.equal(del.status, 200, JSON.stringify(del.json));
		assert.deepEqual(del.json, { id });
		const gone = await call('GET', `${api}/collections/${C}/records/${id}`);
		assert.equal(gone.status, 404);
		assert.match(gone.json.error, /no such record/);
	});
});

describe('schema routes', () => {
	test('POST /collections/:name/fields adds a field through the compile gate, and the store reloads', async () => {
		const { status, json } = await call('POST', `${api}/collections/${C}/fields`, { name: 'weight', type: 'number' });
		assert.equal(status, 200, JSON.stringify(json));
		const schema = (await call('GET', `${api}/schema`)).json.find((d) => d.name === 'lab/samples');
		assert.equal(schema.schema.properties.weight?.type, 'number');
		const add = await call('POST', `${api}/collections/${C}/records`, { name: 'Beta', date: '2026-09-02', weight: 1.5 });
		assert.equal(add.status, 201, 'the reloaded store accepts the new field');
	});

	test('a schema write the compiler refuses is a 400', async () => {
		const { status, json } = await call('POST', `${api}/collections/${C}/fields`, { name: 'bad', type: 'no-such-type' });
		assert.equal(status, 400);
		assert.match(json.error, /unknown field type/);
	});

	test('a compile made outside the server is visible to the next request, with no /reload', async () => {
		const r = h.dt('add-field', 'notes', '--name', 'rating', '--type', 'integer');
		assert.equal(r.code, 0, r.stderr + r.stdout);
		const schema = (await call('GET', `${api}/schema`)).json.find((d) => d.name === 'notes');
		assert.equal(schema.schema.properties.rating?.type, 'integer');
	});

	test('an unsupported dry-run answers exactly {error, "dry-run": "unsupported"} with 400', async () => {
		const { status, json } = await call('DELETE', `${api}/collections/notes/fields/rating?dry-run=true`);
		assert.equal(status, 400);
		assert.deepEqual(Object.keys(json).sort(), ['dry-run', 'error']);
		assert.equal(json['dry-run'], 'unsupported');
	});
});

describe('what is not served', () => {
	test('an unknown api route is a JSON 404, not an HTML page', async () => {
		const { status, json } = await call('GET', `${api}/nope`);
		assert.equal(status, 404);
		assert.match(json.error, /no route GET \/api\/nope/);
	});

	test('the studio /admin and the /ui bundle folder are gone', async () => {
		const root = api.replace(/\/api$/, '');
		assert.equal((await fetch(`${root}/admin`, { signal: AbortSignal.timeout(20_000) })).status, 404);
		assert.equal((await fetch(`${root}/ui/x/app.js`, { signal: AbortSignal.timeout(20_000) })).status, 404);
	});
});
