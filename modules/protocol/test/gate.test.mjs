// The shared gate contract (cr-modules-007 §4c): one case list per scope kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gate, OPERATORS } from '../src/gate.js';
import { reshape } from '../src/reshape.js';
import { applyWrite } from '../src/apply-write.js';
import { createFrameBridge } from '../src/frame-bridge.js';

const descriptors = [
	{ name: 'tasks', fields: { name: { type: 'string' }, status: { type: 'string' }, project: { type: 'projects' }, dependents: { type: 'tasks', many: true, mirror_of: 'depends_on' }, depends_on: { type: 'tasks', many: true } } },
	{ name: 'projects', fields: { name: { type: 'string' }, owner: { type: 'users' } } },
	{ name: 'users', fields: { name: { type: 'string' } } },
	{ name: 'notes', fields: { title: { type: 'string' } } },
];
const sentences = {
	route: (s, d) => `${s.label} cannot call ${d.method} ${d.pattern}`,
	collectionRead: (s, d) => `${s.label} cannot read ${d.collection}`,
	collectionWrite: (s, d) => `${s.label} cannot write ${d.collection}`,
	field: (s, d) => `${s.label} cannot set ${d.field} on ${d.collection}`,
	filter: (s, d) => `${s.label} filter refused: ${d.reason}`,
	query: (s, d) => `${s.label} cannot pass ${d.key} on a write`,
};
const READ_ROUTES = ['records-list', 'record-read', 'values'];
const artifact = { kind: 'artifact', label: 'artifacts/board', routes: new Set(READ_ROUTES), reads: new Set(['tasks']), writes: new Map(), sentences };
const moduleScope = {
	kind: 'module', label: 'module app northwind', home: 'northwind-layer', own: new Set(['notes']),
	routes: new Set([...READ_ROUTES, 'info', 'schema', 'presentation', 'commands', 'records-create', 'record-update', 'record-remove', 'position']),
	reads: new Set(['notes', 'users', 'ui-views']),
	writes: new Map([['notes', { ops: new Set(['create', 'update', 'delete', 'position']), fields: 'own-fields', mirroredRefs: 'refuse', commit: false }]]),
	sentences,
};
const q = (o) => new URLSearchParams(o);

// artifact kind (007 §4, §4b)
test('artifact: a declared collection reads; an undeclared one is 403', () => {
	assert.equal(gate(artifact, descriptors, 'GET', '/collections/tasks/records', q({ limit: '10' })).ok, true);
	const r = gate(artifact, descriptors, 'GET', '/collections/projects/records', q({}));
	assert.deepEqual([r.ok, r.status, r.error], [false, 403, 'artifacts/board cannot read projects']);
});
test('artifact: no relational condition at any depth', () => {
	for (const f of [{ project: { status: { _eq: 'active' } } }, { _and: [{ project: { name: { _eq: 'x' } } }] }, { status: { _eq: 'a', name: 'b' } }, { 'project.name': { _eq: 'x' } }]) {
		const r = gate(artifact, descriptors, 'GET', '/collections/tasks/records', q({ filter: JSON.stringify(f) }));
		assert.equal(r.status, 400, JSON.stringify(f));
	}
	assert.equal(gate(artifact, descriptors, 'GET', '/collections/tasks/records', q({ filter: JSON.stringify({ status: { _in: ['todo'] } }) })).ok, true);
});
test('artifact: operators are the engine set minus _regex; bounds hold', () => {
	assert.equal(OPERATORS.has('_regex'), false);
	assert.equal(OPERATORS.has('_ieq') && OPERATORS.has('_nbetween'), true);
	const g = (f, extra = {}) => gate(artifact, descriptors, 'GET', '/collections/tasks/records', q({ filter: JSON.stringify(f), ...extra }));
	assert.equal(g({ name: { _regex: '^(\\w+\\s?)*$' } }).status, 400);
	assert.equal(g({ name: { _nstarts_with: 'a' } }).status, 400);
	assert.equal(g({ name: { _ieq: 'a' } }).ok, true);
	assert.equal(g({ name: { _eq: 'x'.repeat(201) } }).status, 400);
	assert.equal(g({ name: { _in: Array(201).fill('a') } }).status, 400);
	assert.equal(g({ _and: Array(51).fill({ name: 'a' }) }).status, 400);
	assert.equal(g({}, { q: 'x'.repeat(201) }).status, 400);
	assert.equal(g({}, { limit: '2001' }).status, 400);
	assert.equal(g({}, { bogus: '1' }).status, 400);
	assert.equal(g({}, { status: 'todo' }).ok, true);
});
test('artifact: no write route, no unknown route', () => {
	assert.equal(gate(artifact, descriptors, 'POST', '/collections/tasks/records', q({}), { name: 'x' }).status, 403);
	assert.equal(gate(artifact, descriptors, 'POST', '/commit', q({}), {}).status, 403);
	assert.equal(gate(artifact, descriptors, 'GET', '/records-batch', q({})).status, 404);
});

// module kind (008 §4)
test('module: create sets target to home itself; a module query on a write is refused', () => {
	const r = gate(moduleScope, descriptors, 'POST', '/collections/notes/records', q({}), { title: 'a' });
	assert.equal(r.ok, true);
	assert.deepEqual(r.call.query, { target: 'northwind-layer' });
	assert.equal(gate(moduleScope, descriptors, 'POST', '/collections/notes/records', q({ target: 'hq' }), { title: 'a' }).error, 'module app northwind cannot pass target on a write');
});
test('module: update and delete need the home source', () => {
	assert.equal(gate(moduleScope, descriptors, 'PATCH', '/collections/notes/records/n1', q({}), { title: 'b' }).needsSource, 'home');
	assert.equal(gate(moduleScope, descriptors, 'DELETE', '/collections/notes/records/n1', q({})).needsSource, 'home');
});
test('module: write body keys — stub, $ keys, id, unknown fields refused', () => {
	for (const k of ['stub', '$source', 'id', 'created', 'nope']) {
		const r = gate(moduleScope, descriptors, 'PATCH', '/collections/notes/records/n1', q({}), { [k]: 1 });
		assert.equal(r.status, 403, k);
		assert.equal(r.error, `module app northwind cannot set ${k} on notes`);
	}
});
test('module: other collections, commit, schema writes and history are refused', () => {
	assert.equal(gate(moduleScope, descriptors, 'POST', '/collections/tasks/records', q({}), { name: 'x' }).error, 'module app northwind cannot write tasks');
	assert.equal(gate(moduleScope, descriptors, 'GET', '/collections/tasks/records', q({})).error, 'module app northwind cannot read tasks');
	assert.equal(gate(moduleScope, descriptors, 'POST', '/commit', q({}), {}).status, 403);
	assert.equal(gate(moduleScope, descriptors, 'POST', '/fields/notes', q({}), {}).status, 403);
	assert.equal(gate(moduleScope, descriptors, 'GET', '/history/notes/n1', q({})).status, 403);
	assert.equal(gate(moduleScope, descriptors, 'GET', '/collections/users/records', q({ filter: JSON.stringify({ name: { _regex: 'a' } }) })).status, 400);
});
test('mirrored references: refused in a body and on delete of an owning collection', () => {
	const s = { ...moduleScope, own: new Set(['tasks']), writes: new Map([['tasks', { ops: new Set(['update', 'delete']), fields: 'own-fields', mirroredRefs: 'refuse', commit: false }]]), reads: new Set(['tasks']) };
	assert.equal(gate(s, descriptors, 'PATCH', '/collections/tasks/records/t1', q({}), { dependents: [] }).status, 403);
	assert.equal(gate(s, descriptors, 'PATCH', '/collections/tasks/records/t1', q({}), { name: 'x' }).ok, true);
	assert.equal(gate(s, descriptors, 'DELETE', '/collections/tasks/records/t1', q({})).status, 403);
});
test('an artifact write declared with commit returns the one commit by id; commit with mirroredRefs allow is 400', () => {
	const s = { ...artifact, routes: new Set([...READ_ROUTES, 'record-update']), writes: new Map([['tasks', { ops: new Set(['update']), fields: new Set(['status']), mirroredRefs: 'refuse', commit: true }]]) };
	const r = gate(s, descriptors, 'PATCH', '/collections/tasks/records/t1', q({}), { status: 'done' });
	assert.deepEqual(r.commit, { only: ['tasks/t1'], message: 'artifacts/board: update tasks/t1' });
	assert.equal(gate(s, descriptors, 'PATCH', '/collections/tasks/records/t1', q({}), { name: 'x' }).status, 403);
	const a = { ...s, writes: new Map([['tasks', { ops: new Set(['update']), fields: new Set(['status']), mirroredRefs: 'allow', commit: true }]]) };
	assert.equal(gate(a, descriptors, 'PATCH', '/collections/tasks/records/t1', q({}), { status: 'done' }).status, 400);
});

test('reshape: lists and records keep only their allow-listed shape; module scope strips non-own commit keys; info is the module shape', () => {
	const row = { id: 'u1', name: 'Dana Oren', $source: 'hq', '$last-commit-message': 'x', '$created-by': 'y', '$last-modified-by': 'z', $repo: '.', $dirty: false, $ahead: 0 };
	const list = reshape('records-list', { records: [row], total: 1, sources: [{ name: 'hq' }] }, moduleScope);
	assert.deepEqual(Object.keys(list), ['records', 'total']);
	assert.deepEqual(list.records[0], { id: 'u1', name: 'Dana Oren', $source: 'hq' });
	const own = reshape('records-list', { records: [{ ...row, id: 'n1' }], total: 1 }, { ...moduleScope, own: new Set(['users']) }, 'users');
	assert.equal(own.records[0]['$last-commit-message'], 'x');
	assert.deepEqual(reshape('record-read', { id: 'u1', fields: { name: 'a' }, path: '/abs' }, artifact), { id: 'u1', fields: { name: 'a' } });
	assert.deepEqual(reshape('info', { name: 'hq', host: 'web', compiled: 't', ui: ['a', 'northwind'], user: 'dana', collections: ['tasks', 'notes'] }, { ...moduleScope, module: 'northwind' }),
		{ name: 'hq', host: 'web', compiled: 't', ui: ['northwind'], user: null, collections: ['notes'] });
	assert.deepEqual(reshape('schema', [{ name: 'notes' }, { name: 'tasks' }], moduleScope), [{ name: 'notes' }]);
	assert.deepEqual(reshape('presentation', { collections: [{ name: 'notes' }, { name: 'tasks' }], other: 1 }, moduleScope), { collections: [{ name: 'notes' }] });
	const views = reshape('records-list', { records: [{ id: 'v1', $module: 'northwind' }, { id: 'v2', $module: 'core' }], total: 2 }, { ...moduleScope, module: 'northwind' }, 'ui-views');
	assert.deepEqual(views.records.map((r) => r.id), ['v1']);
});

test('applyWrite: runs the call, then the one commit by id only when declared, filling a create id', async () => {
	const calls = [];
	const handle = async (m, p, b) => { calls.push([m, p, b]); return m === 'POST' && p.startsWith('/collections') ? { status: 200, body: { id: 'n9' } } : { status: 200, body: {} }; };
	const r = await applyWrite(handle, { ok: true, call: { method: 'POST', path: '/collections/notes/records', query: { target: 'home' }, body: { title: 'a' }, routeId: 'records-create', collection: 'notes' }, commit: { only: null, message: 'm' } });
	assert.equal(r.status, 200);
	assert.deepEqual(calls, [['POST', '/collections/notes/records?target=home', { title: 'a' }], ['POST', '/commit', { only: ['notes/n9'], message: 'm' }]]);
	calls.length = 0;
	await applyWrite(async (m, p, b) => { calls.push([m, p]); return { status: 400, body: { error: 'no' } }; }, { ok: true, call: { method: 'PATCH', path: '/collections/notes/records/n1', query: {}, body: {}, routeId: 'record-update', collection: 'notes' }, commit: { only: ['notes/n1'], message: 'm' } });
	assert.equal(calls.length, 1);
});

test('frame-bridge: accepts only registered sources, drops a frame on its second load, checks the envelope', () => {
	const a = { name: 'a' }, b = { name: 'b' }, evil = {};
	const bridge = createFrameBridge();
	bridge.add(a, { module: 'm1' }); bridge.add(b, { module: 'm2' });
	assert.deepEqual(bridge.accept({ source: a, data: { dt: 1, id: 1, op: 'request' } }).meta, { module: 'm1' });
	assert.equal(bridge.accept({ source: evil, data: { dt: 1, id: 1, op: 'request' } }), null);
	assert.equal(bridge.accept({ source: a, data: { id: 1, op: 'request' } }), null);
	bridge.loaded(a); assert.ok(bridge.accept({ source: a, data: { dt: 1, id: 2, op: 'x' } }));
	bridge.loaded(a); assert.equal(bridge.accept({ source: a, data: { dt: 1, id: 3, op: 'x' } }), null);
	const sent = []; const w = { postMessage: (m, t) => sent.push([m, t]) };
	bridge.add(w, {}); bridge.reply(w, 7, { ok: true }); assert.deepEqual(sent, [[{ dt: 1, id: 7, reply: { ok: true } }, '*']]);
});
