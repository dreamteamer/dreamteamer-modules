// A RECORD LAYER DRAWS BY ITS OWN nav.yaml (cr-dt-008, design §3 rule 9; review finding layer-nav-yaml-not-drawn).
//
// A layer (git_modules/<key>) whose clone holds nav.yaml draws, under its layer node, the folders, order and hidden
// names that file gives, by buildTree's rules — over the rows the layer holds and nothing else: a name it does not
// hold is skipped, and a declared namespace it holds no row of draws no folder. With no nav.yaml the layer keeps the
// legacy drawing from its own settings, as before; an unreadable one draws the layer flat with the message on the
// layer node, never a throw.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { layerTree } from '../src/host/nav.js';
import { ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESC = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'nav', 'descriptors.json'), 'utf8'));
const descriptors = [...DESC.core, ...DESC.rnd];
const row = (collection) => ({ collection, title: descriptors.find((d) => d.name === collection).title, count: 2, route: `/content/${collection}?layer` });
const ROWS = ['tasks', 'projects', 'contacts', 'companies', 'rnd/issues'].map(row);
const keys = (nodes) => nodes.map((n) => n.key);
const every = (nodes, out = []) => { for (const n of nodes) { out.push(n); every(n.children ?? [], out); } return out; };
const draw = (doc) => layerTree({ rows: ROWS, descriptors, doc, namespaces: ['rnd', 'lab'], titleOf: (d) => d.title, namespaceTitle: (ns) => (ns === 'rnd' ? 'R&D' : ns) });

describe('layerTree: buildTree\'s rules over the rows a layer holds', () => {
	test('the document\'s folders in order, a name the layer does not hold skipped, hidden names out, the unplaced rows by title, then the held namespace', () => {
		const nodes = draw({ tree: [{ folder: 'Work', items: ['tasks', 'risks', 'projects'] }], hidden: ['contacts'] });
		assert.deepEqual(keys(nodes), ['f/Work', 'c/companies', 'n/ns%3Arnd']);
		assert.deepEqual(keys(nodes[0].children), ['c/tasks', 'c/projects']);
		assert.deepEqual(keys(nodes[2].children), ['c/rnd/issues']);
		assert.equal(every(nodes).some((n) => n.key === 'n/ns%3Alab'), false, 'a namespace the layer holds no row of draws no folder');
	});
	test('every collection node carries the layer\'s row, and only held collections draw', () => {
		const rows = every(draw({ tree: [], hidden: [] })).filter((n) => n.kind === 'collection');
		assert.deepEqual(rows.map((n) => n.row.collection).sort(), ROWS.map((r) => r.collection).sort());
	});
	test('a name listed twice draws once (rule 5)', () => {
		const nodes = draw({ tree: ['tasks', { folder: 'F', items: ['tasks'] }], hidden: [] });
		assert.equal(every(nodes).filter((n) => n.kind === 'collection' && n.row.collection === 'tasks').length, 1);
	});
});

describe('navModel: the contract fixture\'s layer, git_modules/northwind-archive', () => {
	const PKG = path.resolve(HERE, '..');
	const load = (rel) => import(pathToFileURL(path.join(PKG, rel)).href);
	let fixture, navModel;
	before(async () => {
		const { makeFixture } = await load('lib/contract/fixture.js');
		fixture = makeFixture({ engineDir: ENGINE_DIR });
		const { initEngine } = await load('src/host/engine.js');
		await initEngine(fixture.root);
		({ navModel } = await load('src/nav-model.js'));
	});
	after(() => fixture?.cleanup());
	const layerNav = () => path.join(fixture.layer, 'nav.yaml');
	const layerSettings = () => path.join(fixture.layer, '.vscode', 'settings.json');
	const layerNode = () => {
		const ws = navModel({ root: fixture.root })[0];
		const layers = ws.children.find((n) => n.kind === 'layers');
		return layers.children.find((n) => n.key === 'l/northwind-archive');
	};
	const shape = (n) => ({ kind: n.kind, key: n.key, ...(n.children ? { children: n.children.map(shape) } : {}) });

	test('no nav.yaml: the legacy drawing, as before', () => {
		fs.rmSync(layerNav(), { force: true });
		assert.deepEqual(layerNode().children.map(shape), [{ kind: 'layer-collection', key: 'l/northwind-archive/c/projects' }]);
	});
	test('the layer\'s nav.yaml: its folder draws under the layer node, the row inside it; the layer\'s old settings are no longer read', () => {
		fs.mkdirSync(path.dirname(layerSettings()), { recursive: true });
		fs.writeFileSync(layerSettings(), JSON.stringify({ 'dreamteamer.navGroups': { Old: ['default'] } }));
		fs.writeFileSync(layerNav(), '# The left nav of this workspace. Drag and drop writes this file; so may you.\ntree:\n  - folder: Archive\n    icon: archive\n    items: [projects, tasks]\n');
		const node = layerNode();
		assert.deepEqual(node.children.map(shape), [{ kind: 'layer-group', key: 'l/northwind-archive/f/Archive', children: [{ kind: 'layer-collection', key: 'l/northwind-archive/c/projects' }] }]);
		const [archive] = node.children;
		assert.equal(archive.label, 'Archive');
		assert.equal(archive.icon, 'archive');
		assert.equal(archive.route, undefined, 'a nav.yaml folder is the person\'s: no module route');
		const [projects] = archive.children;
		assert.equal(projects.label, 'Projects');
		assert.equal(projects.description, '1');
		assert.match(projects.route, /^\/content\/projects\?filter=/);
		assert.match(projects.tooltip, /from northwind-archive/);
		assert.equal(node.notice, undefined);
		fs.rmSync(path.join(fixture.layer, '.vscode'), { recursive: true, force: true });
	});
	test('a hidden name in the layer\'s nav.yaml is not drawn', () => {
		fs.writeFileSync(layerNav(), 'tree: []\nhidden: [projects]\n');
		assert.deepEqual(layerNode().children, []);
	});
	test('an unreadable layer nav.yaml: the layer draws flat, the message on the layer node — never a throw', () => {
		fs.writeFileSync(layerNav(), 'tree: [\n');
		const node = layerNode();
		assert.match(String(node.notice), /nav\.yaml/);
		assert.deepEqual(node.children.map(shape), [{ kind: 'layer-collection', key: 'l/northwind-archive/c/projects' }]);
		fs.rmSync(layerNav(), { force: true });
	});
});
