// `?dry-run` over HTTP, against the app on a real workspace. A plan never becomes a write: every
// assertion checks the response AND that the workspace on disk, HEAD and the pending set did not move.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api as engine } from '../../../tests/helpers/fixture.mjs';
import { httpWorkspace, simpleCollection, mount, call } from './support.mjs';

const MOD = 'default';
let h, srv, api, hash, pendingId;

const ORDERED = {
	description: 'Tasks in a manual order.',
	ids: { from: '{{ name | slug }}' },
	storage: { suffix: 'task' },
	fields: { name: { type: 'string', required: true }, position: { type: 'position' } },
};

/** Every file in the workspace outside node_modules and .git, with its bytes, plus HEAD and the
 *  porcelain status — the disk and the repo, as one comparable value. */
const snapshot = () => {
	const out = new Map();
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			if (e.name === 'node_modules' || e.name === '.git') continue;
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else out.set(path.relative(h.root, p), fs.readFileSync(p, 'utf8'));
		}
	};
	walk(h.root);
	out.set('<HEAD>', h.git(['rev-parse', 'HEAD']));
	out.set('<status>', h.git(['status', '--porcelain', '--untracked-files=all']));
	return out;
};
const assertUntouched = (before, what) => {
	const after = snapshot();
	assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${what}: the set of files moved`);
	for (const [f, bytes] of before) assert.equal(after.get(f), bytes, `${what}: ${f} changed`);
};
const descriptorFile = (name) => path.join(h.root, 'modules', MOD, 'collections', `${name}.collection.yaml`);

/** Every write route in the README table that has no planner: [method, path, body]. */
const unplannable = () => [
	['POST', '/collections/gadgets/records', { name: 'Ghost' }],
	['PATCH', '/collections/gadgets/records/one', { notes: 'Rewritten.' }],
	['DELETE', '/collections/gadgets/records/one', undefined],
	['PATCH', '/collections/ordered/position/alpha', { bottom: true }],
	['POST', '/collections/gadgets/rename', { old: 'one', new: 'two' }],
	['POST', '/collections/gadgets/records-revert/one', { hash }],
	['POST', '/collections/gadgets/fields', { name: 'weight', type: 'number' }],
	['PATCH', '/collections/gadgets/fields/name', { description: 'Renamed in place.' }],
	['DELETE', '/collections/gadgets/fields/notes', undefined],
	['POST', '/reload', undefined],
	['POST', '/collections/collections/records', { name: 'sprockets', description: 'Never exists.' }],
	['PATCH', '/collections/collections/records/widgets', { description: 'Edited.' }],
	['DELETE', '/collections/collections/records/gadgets?force=true', undefined],
	['POST', '/collections/modules/records', { name: 'extra', description: 'Never exists.' }],
	['PATCH', '/collections/modules/records/spare', { description: 'Edited.' }],
	['POST', '/collections/skills/records', { name: 'nope', description: 'Never exists.' }],
];
/** The write routes that return a plan: [method, path, body]. */
const plannable = () => [
	['DELETE', '/collections/modules/records/spare?force=true', undefined],
	['PATCH', '/collections/collections/records/widgets', { module: 'spare' }],
	['PATCH', '/collections/gadgets/fields/name/name', { to: 'title' }],
	['POST', '/commit', { only: [`gadgets/${pendingId}`] }],
];
const withFlag = (p, flag) => `${api}${p}${p.includes('?') ? '&' : '?'}${flag}`;

before(async () => {
	h = await httpWorkspace({
		collections: {
			widgets: simpleCollection({ storage: { suffix: 'widget' } }),
			gadgets: simpleCollection({ storage: { suffix: 'gadget' } }),
			ordered: ORDERED,
		},
		records: { gadgets: [{ name: 'One' }], ordered: [{ name: 'Alpha' }, { name: 'Bravo' }] },
	});
	for (const args of [['reorder', 'ordered', '--init'], ['add', 'modules', '--name', 'spare', '--description', 'A second module, so a move has somewhere to go.'], ['commit']]) {
		const r = h.dt(...args);
		assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
	}
	hash = h.git(['rev-parse', 'HEAD']);
	pendingId = new engine.Store(h.ws).add('gadgets', { name: 'Pending' }).id;
	srv = await mount(h.ws);
	api = srv.base;
});
after(() => srv?.close());

describe('dry-run over HTTP', () => {
	test('every write route that has no planner refuses ?dry-run=true with 400 and writes nothing', async () => {
		for (const [method, p, body] of unplannable()) {
			const before = snapshot();
			const { status, json } = await call(method, withFlag(p, 'dry-run=true'), body);
			assert.equal(status, 400, `${method} ${p}: ${JSON.stringify(json)}`);
			assert.equal(json['dry-run'], 'unsupported', `${method} ${p}`);
			assert.match(json.error, /dry-run is not supported/);
			assert.match(json.error, /Nothing was written/);
			assertUntouched(before, `${method} ${p}`);
		}
	});

	test('every planner returns a plan and writes nothing', async () => {
		for (const [method, p, body] of plannable()) {
			const before = snapshot();
			const { status, json } = await call(method, withFlag(p, 'dry-run=true'), body);
			assert.equal(status, 200, `${method} ${p}: ${JSON.stringify(json)}`);
			if (p === '/commit') assert.ok(json.every((r) => (r.sha ?? null) === null), 'a commit plan has no sha');
			else assert.equal(json.dryRun, true, `${method} ${p}: the response says it was a plan`);
			assertUntouched(before, `${method} ${p}`);
		}
		assert.ok(fs.existsSync(path.join(h.root, 'modules', 'spare')), 'the module is still on disk');
		assert.ok(fs.existsSync(descriptorFile('widgets')), 'the descriptor is still in the module it started in');
	});

	test('a dry-run value other than true or false is a 400 on every write route, and writes nothing', async () => {
		for (const [method, p, body] of [...unplannable(), ...plannable()]) {
			for (const flag of ['dry-run', 'dry-run=', 'dry-run=yes', 'dry-run=1', 'dry-run=0', 'dry-run=TRUE', 'dry-run=true&dry-run=true']) {
				const before = snapshot();
				const { status, json } = await call(method, withFlag(p, flag), body);
				assert.equal(status, 400, `${method} ${p}?${flag}: ${JSON.stringify(json)}`);
				assert.match(json.error, /does not understand \?dry-run=/, `${method} ${p}?${flag}`);
				assertUntouched(before, `${method} ${p}?${flag}`);
			}
		}
	});

	test('the refusal names what IS supported, so a client can act on it', async () => {
		const { json } = await call('POST', `${api}/collections/skills/records?dry-run=true`, { name: 'nope', description: 'x' });
		for (const verb of ['modules:rm', 'collections:move', 'fields:rename', 'commit']) assert.ok(json.error.includes(verb), `the refusal names ${verb}`);
	});

	test('?dry-run=false performs the write', async () => {
		const add = await call('POST', `${api}/collections/collections/records?dry-run=false`, { name: 'sprockets', description: 'Created for real.' });
		assert.equal(add.status, 200, JSON.stringify(add.json));
		assert.ok(fs.existsSync(descriptorFile('sprockets')));
		const rm = await call('DELETE', `${api}/collections/collections/records/sprockets?force=true&dry-run=false`);
		assert.equal(rm.status, 200, JSON.stringify(rm.json));
		assert.ok(!fs.existsSync(descriptorFile('sprockets')));
	});

	test('without the flag a record write still happens', async () => {
		const { status, json } = await call('POST', `${api}/collections/gadgets/records`, { name: 'Real' });
		assert.equal(status, 201, JSON.stringify(json));
		assert.ok(fs.existsSync(path.join(h.root, json.path)));
	});
});
