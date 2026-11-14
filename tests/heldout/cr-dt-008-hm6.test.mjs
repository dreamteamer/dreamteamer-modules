// HELD-OUT cr-dt-008-hm6 (rnd/tests dreamteamer-modules/heldout-dt008-m-namespaced-collection-outside-its-namespace).
//
// A namespaced collection the operator placed outside its namespace draws once, at that place, with its full title;
// the namespace folder draws the rest; and ops address it wherever it is. buildTree over fixture descriptors (tasks,
// contacts, rnd/issues, rnd/reviews, rnd/products and rnd/lab/runs in a nested namespace rnd/lab) for five documents;
// applyNavOp on (a); then PUT /nav through the shared handler of a real workspace on the engine under test.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspace, writeCollection, simpleCollection } from '../helpers/fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROTOCOL = path.join(ROOT, 'modules', 'protocol');
const { buildTree, tailOrder } = await import(pathToFileURL(path.join(PROTOCOL, 'src', 'host', 'nav.js')).href);
const { applyNavOp } = await import(pathToFileURL(path.join(PROTOCOL, 'src', 'nav-doc.js')).href);

const TITLES = { tasks: 'Tasks', contacts: 'Contacts', 'rnd/issues': 'Issues', 'rnd/reviews': 'Reviews', 'rnd/products': 'Products', 'rnd/lab/runs': 'Runs' };
const descriptors = Object.entries(TITLES).map(([name, title]) => ({ name, title }));
const namespaces = ['rnd', 'rnd/lab'];
const titleOf = (d) => d.title;
const namespaceTitle = (ns) => (ns === 'rnd' ? 'R&D' : ns === 'rnd/lab' ? 'Lab' : ns);
const draw = (doc) => buildTree({ descriptors, doc, namespaces, titleOf, namespaceTitle });
const ctx = { collections: tailOrder(descriptors, titleOf), namespaces };

const DOCS = {
	a: () => ({ tree: [{ folder: 'Work', items: ['tasks', 'rnd/issues'] }], hidden: [] }),
	b: () => ({ tree: ['rnd/issues', { namespace: 'rnd', items: ['rnd/reviews'] }], hidden: [] }),
	c: () => ({ tree: [{ namespace: 'rnd', items: ['contacts', { namespace: 'rnd/lab' }] }], hidden: [] }),
	d: () => ({ tree: [{ folder: 'Work', items: [{ namespace: 'rnd' }] }, 'rnd/products'], hidden: [] }),
	e: () => ({ tree: [], hidden: ['rnd/issues'] }),
};

const shape = (nodes) => nodes.map((n) => (n.kind === 'collection' ? n.target.name : { [`${n.kind}:${n.label}`]: shape(n.children ?? []) }));
const rows = (nodes, out = []) => { for (const n of nodes) { if (n.kind === 'collection') out.push(n); rows(n.children ?? [], out); } return out; };
const nsFolders = (nodes, out = []) => { for (const n of nodes) { if (n.kind === 'namespace') out.push(n); nsFolders(n.children ?? [], out); } return out; };
/** The general rules every case holds to: each collection drawn at most once, its label its own title. */
function general(nodes) {
	const drawn = rows(nodes);
	const names = drawn.map((n) => n.target.name);
	assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a collection is drawn twice');
	for (const n of drawn) assert.equal(n.label, TITLES[n.target.name], `${n.target.name} is labelled ${JSON.stringify(n.label)}`);
	const ns = nsFolders(nodes).map((n) => n.target.name);
	assert.deepEqual(ns.filter((n, i) => ns.indexOf(n) !== i), [], 'a namespace folder is drawn twice');
	return names;
}

describe('step 2: the five documents drawn', () => {
	test('(a) Work holds tasks then rnd/issues; R&D after the unplaced rows holds products, reviews and Lab — not issues', () => {
		const nodes = draw(DOCS.a());
		general(nodes);
		assert.deepEqual(shape(nodes), [
			{ 'folder:Work': ['tasks', 'rnd/issues'] },
			'contacts',
			{ 'namespace:R&D': ['rnd/products', 'rnd/reviews', { 'namespace:Lab': ['rnd/lab/runs'] }] },
		]);
	});
	test('(b) rnd/issues first at top level; the namespace draws reviews, then the unplaced products, then Lab', () => {
		const nodes = draw(DOCS.b());
		general(nodes);
		assert.equal(nodes[0].target?.name, 'rnd/issues');
		const rnd = nodes.find((n) => n.kind === 'namespace');
		assert.deepEqual(shape(rnd.children), ['rnd/reviews', 'rnd/products', { 'namespace:Lab': ['rnd/lab/runs'] }]);
		assert.equal(rows(rnd.children).some((n) => n.target.name === 'rnd/issues'), false, 'rnd/issues also drawn inside R&D');
	});
	test('(c) contacts inside R&D; the nested lab entry a folder inside R&D holding runs; the other rnd rows trail inside R&D', () => {
		const nodes = draw(DOCS.c());
		general(nodes);
		const rnd = nodes.find((n) => n.kind === 'namespace');
		assert.ok(rnd, 'no R&D folder');
		assert.deepEqual(shape(rnd.children), ['contacts', { 'namespace:Lab': ['rnd/lab/runs'] }, 'rnd/issues', 'rnd/products', 'rnd/reviews']);
		assert.equal(nodes.filter((n) => n.target?.name === 'contacts').length, 0, 'contacts also drawn at top level');
	});
	test('(d) R&D inside Work with every rnd row but products; products at top level; no second R&D at the tail', () => {
		const nodes = draw(DOCS.d());
		general(nodes);
		assert.deepEqual(shape(nodes)[0], { 'folder:Work': [{ 'namespace:R&D': ['rnd/issues', 'rnd/reviews', { 'namespace:Lab': ['rnd/lab/runs'] }] }] });
		assert.equal(nodes[1].target?.name, 'rnd/products');
		assert.equal(nsFolders(nodes).filter((n) => n.target.name === 'rnd').length, 1, 'a second R&D folder');
	});
	test('(e) hidden rnd/issues with no tree: drawn nowhere; the others are', () => {
		const names = general(draw(DOCS.e()));
		assert.equal(names.includes('rnd/issues'), false);
		assert.deepEqual(names.sort(), Object.keys(TITLES).filter((n) => n !== 'rnd/issues').sort());
	});
});

/** How many times the document names `name`: every tree entry, and `hidden`. */
function timesNamed(doc, name) {
	let n = doc.hidden.filter((h) => h === name).length;
	const walk = (items) => { for (const e of items ?? []) { if (e === name || e?.collection === name) n++; if (e && typeof e === 'object') walk(e.items); } };
	walk(doc.tree);
	return n;
}

describe('step 3: ops on (a) address rnd/issues wherever it is', () => {
	let doc = DOCS.a();
	const steps = [];
	test('move rnd/issues to the bottom of the top level', () => {
		doc = applyNavOp(doc, { op: 'move', target: { name: 'rnd/issues' }, position: 'bottom' }, ctx);
		steps.push(['bottom', doc]);
		assert.equal(timesNamed(doc, 'rnd/issues'), 1, JSON.stringify(doc));
		const nodes = draw(doc);
		general(nodes);
		assert.equal(nodes.at(-1).target?.name, 'rnd/issues', 'not drawn last at the top level');
	});
	test('move it into the namespace ({ into: { name: "rnd" } })', () => {
		doc = applyNavOp(doc, { op: 'move', target: { name: 'rnd/issues' }, into: { name: 'rnd' } }, ctx);
		assert.equal(timesNamed(doc, 'rnd/issues'), 1, JSON.stringify(doc));
		const nodes = draw(doc);
		general(nodes);
		const rnd = nsFolders(nodes).find((n) => n.target.name === 'rnd');
		assert.ok(rows(rnd.children).some((n) => n.target.name === 'rnd/issues'), 'not inside R&D');
	});
	test('hide it: the document names it exactly once, and it is drawn nowhere', () => {
		doc = applyNavOp(doc, { op: 'hide', target: { name: 'rnd/issues' } }, ctx);
		const nodes = draw(doc);
		general(nodes);
		assert.equal(rows(nodes).some((n) => n.target.name === 'rnd/issues'), false, 'still drawn');
		assert.equal(timesNamed(doc, 'rnd/issues'), 1, `named ${timesNamed(doc, 'rnd/issues')} times: ${JSON.stringify(doc)}`);
	});
	test('show it: back in the tree, inside its namespace, named exactly once', () => {
		doc = applyNavOp(doc, { op: 'show', target: { name: 'rnd/issues' } }, ctx);
		assert.equal(timesNamed(doc, 'rnd/issues'), 1, JSON.stringify(doc));
		const nodes = draw(doc);
		general(nodes);
		const rnd = nsFolders(nodes).find((n) => n.target.name === 'rnd');
		assert.ok(rows(rnd.children).some((n) => n.target.name === 'rnd/issues'), 'show did not return it inside R&D');
	});
});

describe('step 4: PUT /nav with (a), and with a variant naming rnd/ghost', () => {
	let ws, handler, navFile;
	before(async () => {
		ws = workspace({ pkg: { namespaces: namespaces }, compile: false });
		for (const [name, title] of Object.entries(TITLES)) writeCollection(ws.root, name, simpleCollection({ title }));
		const r = ws.dt('compile');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
		const { createHandler } = await import(pathToFileURL(path.join(PROTOCOL, 'src', 'handler.js')).href);
		handler = await createHandler({ root: ws.root });
		navFile = path.join(ws.root, 'nav.yaml');
	});
	test('(a) answers 200 and is written', async () => {
		const res = await handler.handle('PUT', '/nav', DOCS.a());
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.ok(fs.readFileSync(navFile, 'utf8').includes('rnd/issues'));
	});
	test('the variant naming rnd/ghost answers 400 naming it, and the file is unchanged', async () => {
		const before = fs.readFileSync(navFile, 'utf8');
		const ghost = DOCS.a();
		ghost.tree[0].items.push('rnd/ghost');
		const res = await handler.handle('PUT', '/nav', ghost);
		assert.equal(res.status, 400, JSON.stringify(res.body));
		assert.match(String(res.body?.error), /rnd\/ghost/);
		assert.equal(fs.readFileSync(navFile, 'utf8'), before, 'nav.yaml changed');
	});
});
