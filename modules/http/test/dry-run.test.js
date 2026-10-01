// `?dry-run=true` over HTTP, against the app on a real workspace.
//
// ⚠ THIS FILE EXISTS BECAUSE ASKING WHAT A VERB WOULD DO ONCE PERFORMED IT: the system-write route
// read `force` from the query string and nothing else, so a client asking for a plan of a
// destructive schema verb got the write. Every assertion checks the response AND that the disk did
// not move — the second is the one that matters.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { httpWorkspace, simpleCollection, mount, call } from './support.mjs';

const MOD = 'default';
let h, srv, api;

/** Every source file under modules/, with its bytes — the disk, as a comparable value. */
const snapshot = (root) => {
	const out = new Map();
	const walk = (d) => {
		if (!fs.existsSync(d)) return;
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else out.set(path.relative(root, p), fs.readFileSync(p, 'utf8'));
		}
	};
	walk(path.join(root, 'modules'));
	return out;
};
const assertUntouched = (before, root, what) => {
	const after = snapshot(root);
	assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `${what}: the set of source files moved`);
	for (const [f, bytes] of before) assert.equal(after.get(f), bytes, `${what}: ${f} was rewritten`);
};
const descriptorFile = (name) => path.join(h.root, 'modules', MOD, 'collections', `${name}.collection.yaml`);

before(async () => {
	h = await httpWorkspace({
		collections: {
			widgets: simpleCollection({ storage: { suffix: 'widget' } }),
			gadgets: simpleCollection({ storage: { suffix: 'gadget' } }),
		},
	});
	const r = h.dt('add', 'modules', '--name', 'spare', '--description', 'A second module, so a move has somewhere to go.');
	assert.equal(r.code, 0, r.stderr);
	srv = await mount(h.ws);
	api = srv.base;
});
after(() => srv?.close());

describe('dry-run over HTTP', () => {
	test('removing a module returns a PLAN and removes nothing', async () => {
		const before = snapshot(h.root);
		const { status, json } = await call('DELETE', `${api}/collections/modules/records/spare?force=true&dry-run=true`);
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.dryRun, true, 'the response says it was a plan');
		assert.ok(fs.existsSync(path.join(h.root, 'modules', 'spare')), 'the module is still on disk');
		assertUntouched(before, h.root, 'modules:rm');
	});

	test('moving a collection between modules returns a PLAN and moves nothing', async () => {
		const before = snapshot(h.root);
		const { status, json } = await call('PATCH', `${api}/collections/collections/records/widgets?dry-run=true`, { module: 'spare' });
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.dryRun, true);
		assert.ok(fs.existsSync(descriptorFile('widgets')), 'the descriptor is still in the module it started in');
		assertUntouched(before, h.root, 'collections:move');
	});

	test('renaming a field returns a PLAN and renames nothing', async () => {
		const before = snapshot(h.root);
		const { status, json } = await call('PATCH', `${api}/collections/widgets/fields/name/name?dry-run=true`, { to: 'title' });
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.dryRun, true);
		assertUntouched(before, h.root, 'fields:rename');
	});

	test('an op with no plan is REFUSED with 400, and still writes nothing', async () => {
		const before = snapshot(h.root);
		const { status, json } = await call('POST', `${api}/collections/collections/records?dry-run=true`, { name: 'sprockets', description: 'Should never exist.' });
		assert.equal(status, 400, 'refused, not performed');
		assert.equal(json['dry-run'], 'unsupported');
		assert.match(json.error, /dry-run is not supported/);
		assert.match(json.error, /Nothing was written/);
		assert.ok(!fs.existsSync(descriptorFile('sprockets')), 'asking what it would do did not do it');
		assertUntouched(before, h.root, 'collections:add');
	});

	test('removing a field is refused under dry-run rather than clearing every record', async () => {
		const before = snapshot(h.root);
		const { status, json } = await call('DELETE', `${api}/collections/gadgets/fields/name?dry-run=true`);
		assert.equal(status, 400);
		assert.equal(json['dry-run'], 'unsupported');
		assertUntouched(before, h.root, 'fields:rm');
	});

	test('the refusal names what IS supported, so a client can act on it', async () => {
		const { json } = await call('POST', `${api}/collections/skills/records?dry-run=true`, { name: 'nope', description: 'x' });
		for (const verb of ['modules:rm', 'collections:move', 'fields:rename']) assert.ok(json.error.includes(verb), `the refusal names ${verb}`);
	});

	test('without the flag the write still happens — the guard did not break the verb', async () => {
		const { status, json } = await call('POST', `${api}/collections/collections/records`, { name: 'sprockets', description: 'Created for real.' });
		assert.equal(status, 200, JSON.stringify(json));
		assert.ok(fs.existsSync(descriptorFile('sprockets')));
	});

	test('a falsy dry-run value is not a dry run', async () => {
		const { status, json } = await call('DELETE', `${api}/collections/collections/records/sprockets?force=true&dry-run=false`);
		assert.equal(status, 200, JSON.stringify(json));
		assert.ok(!fs.existsSync(descriptorFile('sprockets')), 'dry-run=false performed the removal');
	});
});
