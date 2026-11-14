// PATCH /nav AND PUT /nav (cr-dt-008, task 10; rnd/tests dreamteamer-modules/nav-patch-put-routes).
//
// A gesture is one NavOp sent as PATCH /nav: the handler reads nav.yaml (none is an empty document), applies the op
// with the workspace's collections in drawn tail order, writes the result and answers `200 { doc }`. PUT /nav
// replaces the whole document after a shape check and a name check. A refusal is 400 and writes nothing: a malformed
// op, a folder path that resolves to nothing, an unknown name, a nav.yaml that cannot be read (PATCH only — PUT is
// how a broken file is replaced). With no nav.yaml and an old nav setting still set, both answer 409 naming the
// migration, so the first write can never strand the settings. The write goes through the engine's writeNavDoc on
// an engine that exports it (0.49), else through the protocol's own writer — same header, same trailing newline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(PKG, rel)).href);
const { makeFixture } = await load('lib/contract/fixture.js');
const { createHandler } = await load('src/handler.js');
const { engine } = await load('src/host/engine.js');
const { meetsFloor } = await load('src/host/floor.js');
const { isWatchedChange, changeScope } = await load('src/host/changes.js');

const HEADER = '# The left nav of this workspace. Drag and drop writes this file; so may you.';
const ENGINE_VERSION = JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'package.json'), 'utf8')).version;
const CANDIDATE = meetsFloor(ENGINE_VERSION, '0.49.0');

let fixture;
let handler;
let navFile;
let settingsFile;
const quietly = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const request = (m, p, b) => quietly(() => handler.handle(m, p, b));
const bytes = () => (fs.existsSync(navFile) ? fs.readFileSync(navFile, 'utf8') : null);
const reset = () => { fs.rmSync(navFile, { force: true }); fs.rmSync(settingsFile, { force: true }); };
const top = async () => {
	const res = await request('GET', '/nav');
	assert.equal(res.status, 200, JSON.stringify(res.body));
	return res.body[0];
};

before(async () => {
	fixture = makeFixture({ engineDir: ENGINE_DIR });
	handler = await createHandler({ root: fixture.root });
	navFile = path.join(fixture.root, 'nav.yaml');
	settingsFile = path.join(fixture.root, '.vscode', 'settings.json');
});
after(() => fixture?.cleanup());

test(`initEngine picks the engine's nav members when it has them (engine ${ENGINE_VERSION})`, () => {
	for (const m of ['readNavDoc', 'validateNavDoc', 'writeNavDoc', 'applyNavFragments']) {
		assert.equal(typeof engine()[m], CANDIDATE ? 'function' : 'undefined', `${m} on engine ${ENGINE_VERSION}`);
	}
});

test('PATCH on an absent nav.yaml creates it — the header, the op applied, a trailing newline — through the engine writer when there is one', async () => {
	reset();
	const calls = [];
	const original = engine().writeNavDoc;
	if (CANDIDATE) engine().writeNavDoc = (root, doc) => { calls.push(root); return original(root, doc); };
	try {
		const res = await request('PATCH', '/nav', { op: 'move', target: { name: 'tasks' }, position: 'top' });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.deepEqual(res.body.doc.tree[0], 'tasks');
		const text = bytes();
		assert.ok(text, 'no nav.yaml written');
		assert.equal(text.split('\n')[0], HEADER);
		assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'not one trailing newline');
		assert.deepEqual(yaml.load(text).tree, res.body.doc.tree);
		assert.deepEqual(calls, CANDIDATE ? [fixture.root] : [], CANDIDATE ? 'the write did not go through engine().writeNavDoc' : 'no engine writer on 0.48');
	} finally {
		if (CANDIDATE) engine().writeNavDoc = original;
	}
	const kids = (await top()).children;
	assert.equal(kids[0].key, 'c/tasks', 'GET /nav does not draw the written document');
});

test('PATCH with a malformed op is 400 and leaves nav.yaml byte-identical', async () => {
	reset();
	await request('PATCH', '/nav', { op: 'new-folder', label: 'Work' });
	const was = bytes();
	for (const op of [{ op: 'fly', target: { name: 'tasks' } }, { op: 'move' }, { op: 'move', target: { name: 'tasks' }, into: { folder: ['Work'] }, after: { name: 'projects' } }, null, 'move']) {
		const res = await request('PATCH', '/nav', op);
		assert.equal(res.status, 400, `${JSON.stringify(op)} answered ${res.status}`);
		assert.equal(typeof res.body.error, 'string');
		assert.equal(bytes(), was, `${JSON.stringify(op)} changed nav.yaml`);
	}
});

test('PATCH naming a folder path that no longer exists is 400 naming the path', async () => {
	reset();
	await request('PATCH', '/nav', { op: 'new-folder', label: 'Work' });
	const was = bytes();
	const res = await request('PATCH', '/nav', { op: 'move', target: { name: 'tasks' }, into: { folder: ['Plans'] } });
	assert.equal(res.status, 400);
	assert.match(res.body.error, /Plans/);
	assert.equal(bytes(), was);
});

test('PATCH moves lab/samples into { name: "lab" }: the namespace entry is placed and draws it', async () => {
	reset();
	const res = await request('PATCH', '/nav', { op: 'move', target: { name: 'lab/samples' }, into: { name: 'lab' } });
	assert.equal(res.status, 200, JSON.stringify(res.body));
	const ns = res.body.doc.tree.find((e) => e && e.namespace === 'lab');
	assert.ok(ns, `no namespace entry in ${JSON.stringify(res.body.doc)}`);
	assert.deepEqual(ns.items, ['lab/samples']);
	const lab = (await top()).children.find((n) => n.key === 'n/ns%3Alab');
	assert.ok(lab?.children?.some((n) => n.key === 'c/lab/samples'));
});

test('PUT with an unknown name is 400 naming each, and writes nothing', async () => {
	reset();
	const res = await request('PUT', '/nav', { tree: ['tasks', 'no-such-collection', { namespace: 'nowhere', items: [] }], hidden: [] });
	assert.equal(res.status, 400);
	assert.match(res.body.error, /no-such-collection/);
	assert.match(res.body.error, /nowhere/);
	assert.equal(bytes(), null);
});

test('PUT with a malformed document is 400 naming the problem', async () => {
	reset();
	for (const [doc, why] of [[{ tree: 'tasks' }, /tree/], [{ tree: [{ folder: 'Work' }] }, /items/], [{ tree: [42] }, /42/], [{ tree: [], hidden: [7] }, /hidden/], [{ tree: [{ folder: 'ns:x', items: [] }] }, /ns:/], [null, /NavDoc|tree/]]) {
		const res = await request('PUT', '/nav', doc);
		assert.equal(res.status, 400, `${JSON.stringify(doc)} answered ${res.status}`);
		assert.match(res.body.error, why);
	}
	assert.equal(bytes(), null);
});

test('PUT then GET draws the document', async () => {
	reset();
	const doc = { tree: [{ folder: 'Work', icon: 'rocket', items: ['tasks', 'projects'] }], hidden: ['lab/samples'] };
	const res = await request('PUT', '/nav', doc);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(res.body.doc, doc);
	assert.equal(bytes().split('\n')[0], HEADER);
	const kids = (await top()).children;
	assert.equal(kids[0].kind, 'folder');
	assert.deepEqual(kids[0].target, { folder: ['Work'] });
	assert.deepEqual(kids[0].children.map((n) => n.key), ['c/tasks', 'c/projects']);
	const walk = (ns) => ns.flatMap((n) => [n, ...walk(n.children ?? [])]);
	assert.ok(!walk(kids).some((n) => n.key === 'c/lab/samples'), 'a hidden row is drawn');
});

test('over a nav.yaml that cannot be read, PATCH is 400 naming the file and writes nothing; PUT replaces it', async () => {
	reset();
	const broken = 'tree: [tasks, {folder: Work\n';
	fs.writeFileSync(navFile, broken);
	const res = await request('PATCH', '/nav', { op: 'hide', target: { name: 'tasks' } });
	assert.equal(res.status, 400, JSON.stringify(res.body));
	assert.match(res.body.error, /nav\.yaml/);
	assert.equal(bytes(), broken, 'the broken file was touched');
	const put = await request('PUT', '/nav', { tree: ['projects'], hidden: [] });
	assert.equal(put.status, 200, JSON.stringify(put.body));
	assert.deepEqual(yaml.load(bytes()).tree, ['projects']);
});

test('with no nav.yaml and an old nav setting set, PATCH and PUT are 409 naming dt-nav migrate, and write nothing', async () => {
	reset();
	fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
	fs.writeFileSync(settingsFile, '{\n\t// the order the operator had\n\t"dreamteamer.navOrder": ["tasks", "projects"],\n}\n');
	try {
		for (const [m, body] of [['PATCH', { op: 'hide', target: { name: 'tasks' } }], ['PUT', { tree: ['tasks'], hidden: [] }]]) {
			const res = await request(m, '/nav', body);
			assert.equal(res.status, 409, `${m} answered ${res.status}`);
			assert.equal(res.body.error, 'your nav settings are not in nav.yaml yet — run: npx -p @dreamteamer/protocol@0.2 dt-nav migrate');
			assert.equal(bytes(), null, `${m} wrote nav.yaml`);
		}
		// empty settings count as unset
		fs.writeFileSync(settingsFile, '{ "dreamteamer.navOrder": [], "dreamteamer.navGroups": {} }\n');
		assert.equal((await request('PATCH', '/nav', { op: 'hide', target: { name: 'tasks' } })).status, 200);
	} finally {
		reset();
	}
});

test('a change to <root>/nav.yaml is watched, and is a data change', () => {
	const root = fixture.root;
	assert.equal(isWatchedChange(root, path.join(root, 'nav.yaml'), () => false), true);
	assert.equal(changeScope(root, path.join(root, 'nav.yaml')), 'data');
	assert.equal(isWatchedChange(root, path.join(root, 'modules', 'nav.yaml'), () => false), false);
});
