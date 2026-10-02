// The manual-ordering route, against the app on a real workspace. `…/records/*id` is greedy (ids are
// paths), so the verb segment precedes the wildcard: `PATCH /collections/:name/position/*id`.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { httpWorkspace, mount, call } from './support.mjs';

const ORDERED = {
	description: 'Tasks in a manual order.',
	ids: { from: '{{ name | slug }}' },
	storage: { suffix: 'task' },
	fields: { name: { type: 'string', required: true }, position: { type: 'position' } },
};

let srv, base;

before(async () => {
	const h = await httpWorkspace({
		collections: { ordered: ORDERED },
		records: { ordered: [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }] },
	});
	const r = h.dt('reorder', 'ordered', '--init');
	assert.equal(r.code, 0, r.stderr);
	srv = await mount(h.ws);
	base = `${srv.base}/collections/ordered`;
});
after(() => srv?.close());

const ids = async () => (await call('GET', `${base}/records?sort=position`)).json.records.map((r) => r.id);
const move = (id, dest) => call('PATCH', `${base}/position/${id}`, dest);

describe('PATCH /collections/:name/position/*id', () => {
	test('the route is reachable past the greedy *id', async () => {
		const r = await move('charlie', { top: true });
		assert.equal(r.status, 200, `expected 200, got ${r.status} ${JSON.stringify(r.json)}`);
		assert.deepEqual(r.json, { id: 'charlie' });
	});

	test('top puts it first', async () => {
		await move('charlie', { top: true });
		assert.deepEqual(await ids(), ['charlie', 'alpha', 'bravo']);
	});

	test('before/after place it relative to a neighbour', async () => {
		await move('charlie', { before: 'bravo' });
		assert.deepEqual(await ids(), ['alpha', 'charlie', 'bravo']);
		await move('alpha', { after: 'charlie' });
		assert.deepEqual(await ids(), ['charlie', 'alpha', 'bravo']);
	});

	test('bottom puts it last', async () => {
		await move('charlie', { bottom: true });
		assert.equal((await ids()).at(-1), 'charlie');
	});

	test('an unknown destination is a 400 and changes nothing', async () => {
		const was = await ids();
		const r = await move('charlie', { after: 'nosuch' });
		assert.equal(r.status, 400);
		assert.match(r.json.error, /dreamteamer reorder ordered --init/);
		assert.deepEqual(await ids(), was);
	});

	test('a collection with no position field is a 400 naming it', async () => {
		const r = await call('PATCH', `${srv.base}/collections/modules/position/default`, { top: true });
		assert.equal(r.status, 400);
		assert.match(r.json.error, /declares no field of type position/);
	});
});
