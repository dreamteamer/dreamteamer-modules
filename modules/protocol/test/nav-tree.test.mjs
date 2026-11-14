// THE PROTOCOL DRAWS nav.yaml (cr-dt-008, task 9; rnd/tests dreamteamer-modules/nav-build-tree).
//
// `buildTree` draws a workspace's left nav from its descriptors and its nav.yaml by the design's §3 rules: the
// document's entries in order (an empty folder still draws), what it does not name trailing its parent by title,
// an unnamed namespace as a folder after the unplaced rows, hidden names and hidden folders not drawn, a name
// listed twice drawn once, a name that resolves to nothing skipped, internal collections out. Every folder,
// namespace and collection node carries the NavTarget a host sends back, and keys never collide however a label
// is spelled. Both ways (acceptance lines 3 and 6): the same descriptors with no document draw flat rows and one
// namespace folder; with core's and rnd's fragments they draw core's six folders and the R&D namespace; the
// collection rows are the same set either way. `navModel` draws the legacy tree while old settings stand unmigrated.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { buildTree, tailOrder } from '../src/host/nav.js';
import { applyNavOp } from '../src/nav-doc.js';
import { ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'nav');
const DESC = JSON.parse(fs.readFileSync(path.join(FIX, 'descriptors.json'), 'utf8'));
const fragment = (f) => yaml.load(fs.readFileSync(path.join(FIX, f), 'utf8'));
const CORE_FRAG = fragment('core.nav.yaml');
const RND_FRAG = fragment('rnd.nav.yaml');

const descriptors = [...DESC.core, ...DESC.rnd];
const titleOf = (d) => d.title;
const namespaces = ['rnd'];
const namespaceTitle = (ns) => (ns === 'rnd' ? 'R&D' : ns);
const draw = (doc, extra = {}) => buildTree({ descriptors, doc, namespaces, titleOf, namespaceTitle, ...extra });
const EXAMPLE = () => ({
	tree: [
		{ folder: 'Work', icon: 'rocket', items: ['tasks', 'projects', { folder: 'Plans', items: ['deliverables', 'decisions', 'risks'] }, 'workflows'] },
		{ folder: 'People', items: ['users', 'teams', 'roles', 'responsibilities', 'agents'] },
		{ collection: 'contacts', icon: 'person' },
		{ namespace: 'rnd', items: ['rnd/change-requests', 'rnd/issues', { folder: 'Product', items: ['rnd/user-journeys', 'rnd/user-stories'] }] },
		{ folder: 'Old', hidden: true, items: ['metrics'] },
	],
	hidden: ['file-drives'],
});
const byTitle = (names) => names.map((n) => descriptors.find((d) => d.name === n)).sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name)).map((d) => `c/${d.name}`);
const keys = (nodes) => nodes.map((n) => n.key);
const find = (nodes, key) => { for (const n of nodes) { if (n.key === key) return n; const k = find(n.children ?? [], key); if (k) return k; } return undefined; };
const every = (nodes, out = []) => { for (const n of nodes) { out.push(n); every(n.children ?? [], out); } return out; };

describe('the design\'s example document over the fixture', () => {
	const nodes = draw(EXAMPLE());
	test('the top level: the entries in order, then the unplaced rows by title', () => {
		const placed = ['tasks', 'projects', 'deliverables', 'decisions', 'risks', 'workflows', 'users', 'teams', 'roles', 'responsibilities', 'agents', 'contacts', 'metrics', 'file-drives'];
		const unplaced = DESC.core.map((d) => d.name).filter((n) => !placed.includes(n));
		assert.deepEqual(keys(nodes), ['f/Work', 'f/People', 'c/contacts', 'n/ns%3Arnd', ...byTitle(unplaced)]);
	});
	test('nesting, folder icons, the icon override, the namespace label', () => {
		const work = nodes[0];
		assert.deepEqual([work.kind, work.label, work.icon], ['folder', 'Work', 'rocket']);
		assert.deepEqual(keys(work.children), ['c/tasks', 'c/projects', 'f/Work/Plans', 'c/workflows']);
		assert.deepEqual(keys(find(nodes, 'f/Work/Plans').children), ['c/deliverables', 'c/decisions', 'c/risks']);
		assert.equal(nodes[1].icon, 'folder-compact', 'a folder with no icon draws the plain folder glyph');
		assert.equal(find(nodes, 'c/contacts').icon, 'person', 'the entry\'s icon overrides the descriptor\'s');
		assert.equal(find(nodes, 'c/users').icon, 'person', 'otherwise the descriptor\'s icon');
		const rnd = find(nodes, 'n/ns%3Arnd');
		assert.deepEqual([rnd.kind, rnd.label], ['namespace', 'R&D']);
	});
	test('inside the namespace: its entries, then its own unplaced rows by title', () => {
		const rnd = find(nodes, 'n/ns%3Arnd');
		const placed = ['rnd/change-requests', 'rnd/issues', 'rnd/user-journeys', 'rnd/user-stories'];
		assert.deepEqual(keys(rnd.children), ['c/rnd/change-requests', 'c/rnd/issues', 'f/ns%3Arnd/Product', ...byTitle(DESC.rnd.map((d) => d.name).filter((n) => !placed.includes(n)))]);
	});
	test('hidden rows and hidden folders are not drawn; their names count as placed', () => {
		for (const k of ['c/file-drives', 'c/metrics', 'f/Old']) assert.equal(find(nodes, k), undefined, k);
	});
	test('internal collections are out; an overlaid engine kind (agents) is in', () => {
		const withInternal = draw(EXAMPLE(), { descriptors: [...descriptors, { name: 'audit-log', title: 'Audit Log', internal: true }] });
		assert.equal(find(withInternal, 'c/audit-log'), undefined);
		assert.ok(find(nodes, 'c/agents'));
	});
	test('module marks and module routes are gone from folders', () => {
		for (const n of every(nodes).filter((x) => x.kind === 'folder' || x.kind === 'namespace')) {
			assert.equal(n.marks, undefined, n.key);
			assert.equal(n.route, undefined, n.key);
		}
	});
});

describe('the drawing rules at their edges', () => {
	test('an empty folder still draws', () => {
		const nodes = draw({ tree: [{ folder: 'Empty', items: [] }], hidden: [] });
		assert.deepEqual([nodes[0].key, nodes[0].children], ['f/Empty', []]);
	});
	// rows counted by the collection they draw (`target.name`), never by key: a second drawing of one name would be
	// keyed `c/<name>~2` and slip past a count by key
	const rowsOf = (nodes, name) => every(nodes).filter((n) => n.kind === 'collection' && n.target?.name === name);
	test('a name listed twice draws at its first occurrence; a name that resolves to nothing is skipped', () => {
		const nodes = draw({ tree: [{ folder: 'A', items: ['tasks', 'invoices'] }, 'tasks', 'invoices'], hidden: [] });
		assert.deepEqual(keys(nodes[0].children), ['c/tasks']);
		assert.equal(rowsOf(nodes, 'tasks').length, 1);
		assert.equal(find(nodes, 'c/invoices'), undefined);
	});
	test('a name listed twice in either form draws once, at its first place, whichever form comes first', () => {
		const docs = [
			{ tree: ['tasks', { folder: 'F', items: ['tasks'] }], at: [] },
			{ tree: [{ folder: 'F', items: ['tasks'] }, 'tasks'], at: ['f/F'] },
			{ tree: ['tasks', { folder: 'F', items: [{ collection: 'tasks' }] }], at: [] },
			{ tree: [{ collection: 'tasks' }, { folder: 'F', items: ['tasks'] }], at: [] },
			{ tree: [{ namespace: 'rnd', items: ['rnd/issues', { folder: 'P', items: ['rnd/issues'] }] }, 'rnd/issues'], at: ['n/ns%3Arnd'] },
		];
		for (const { tree, at } of docs) {
			const nodes = draw({ tree, hidden: [] });
			const name = JSON.stringify(tree).includes('rnd/issues') ? 'rnd/issues' : 'tasks';
			const rows = rowsOf(nodes, name);
			assert.equal(rows.length, 1, `${JSON.stringify(tree)} draws ${name} ${rows.length} times`);
			const parent = at.length ? find(nodes, at[0]).children : nodes;
			assert.ok(parent.includes(rows[0]), `${JSON.stringify(tree)}: ${name} draws at its first place`);
			assert.equal(rows[0].key, `c/${name}`);
		}
	});
	test('a namespaced row placed outside its namespace, a plain row placed inside it', () => {
		const nodes = draw({ tree: ['rnd/issues', { namespace: 'rnd', items: ['tasks'] }], hidden: [] });
		assert.equal(nodes[0].key, 'c/rnd/issues');
		const rnd = find(nodes, 'n/ns%3Arnd');
		assert.equal(rnd.children[0].key, 'c/tasks');
		assert.ok(!keys(rnd.children).includes('c/rnd/issues'));
	});
	test('a namespace entry with no items is wholly unplaced inside: its rows trail in it by title', () => {
		const nodes = draw({ tree: [{ namespace: 'rnd' }], hidden: [] });
		assert.deepEqual(keys(nodes[0].children), byTitle(DESC.rnd.map((d) => d.name)));
	});
	test('a hidden namespace (by name or hidden: true) is not drawn, nor are its rows', () => {
		for (const doc of [{ tree: [], hidden: ['rnd'] }, { tree: [{ namespace: 'rnd', hidden: true }], hidden: [] }]) {
			const nodes = draw(doc);
			assert.equal(every(nodes).filter((n) => n.key.startsWith('c/rnd/') || n.key.startsWith('n/')).length, 0, JSON.stringify(doc));
		}
	});
	test('keys stay unique when a label contains a slash, and the path is never joined', () => {
		const nodes = draw({ tree: [{ folder: 'Sales/CRM', items: ['contacts'] }, { folder: 'Sales', items: [{ folder: 'CRM', items: ['companies'] }] }], hidden: [] });
		assert.equal(nodes[0].key, 'f/Sales%2FCRM');
		assert.deepEqual(nodes[0].target, { folder: ['Sales/CRM'] });
		assert.equal(nodes[1].children[0].key, 'f/Sales/CRM');
		assert.deepEqual(nodes[1].children[0].target, { folder: ['Sales', 'CRM'] });
		const all = keys(every(nodes));
		assert.equal(new Set(all).size, all.length);
	});
	test('two sibling folders with one label keep distinct keys', () => {
		const all = keys(every(draw({ tree: [{ folder: 'X', items: [] }, { folder: 'X', items: [] }], hidden: [] })));
		assert.equal(new Set(all).size, all.length);
	});
	test('views draw under their collection, keyed by their id', () => {
		const views = [{ id: 'tasks-board', scope: 'collection', collection: 'collections/tasks', route: '/tasks/board', display: { nav: { title: 'Board', icon: 'project' } } }];
		const tasks = find(draw(EXAMPLE(), { views }), 'c/tasks');
		assert.deepEqual(tasks.children.map((v) => [v.kind, v.key, v.label]), [['view', 'v/tasks-board', 'Board']]);
	});
});

describe('every node\'s target round-trips through applyNavOp', () => {
	test('icon by target, redrawn: the node with the same key carries it', () => {
		const ctx = { collections: tailOrder(descriptors, titleOf), namespaces };
		const doc = EXAMPLE();
		const targeted = every(draw(doc)).filter((n) => ['folder', 'namespace', 'collection'].includes(n.kind));
		assert.ok(targeted.length > 40);
		for (const n of targeted) {
			assert.ok(n.target, `${n.key} carries no target`);
			const next = applyNavOp(doc, { op: 'icon', target: n.target, icon: 'zap' }, ctx);
			assert.equal(find(draw(next), n.key)?.icon, 'zap', `${n.key} via ${JSON.stringify(n.target)}`);
		}
	});
	test('tailOrder is the unplaced-row order: by title, then name', () => {
		const order = [...tailOrder([{ name: 'b', title: 'Same' }, { name: 'a', title: 'Same' }, { name: 'c', title: 'Alpha' }], titleOf)];
		assert.deepEqual(order, ['c', 'a', 'b']);
	});
});

describe('both ways (acceptance lines 3 and 6)', () => {
	const flat = draw(null);
	const folded = draw({ tree: [...CORE_FRAG.tree, ...RND_FRAG.tree], hidden: [] });
	test('no document: collection rows alphabetical by title, then one rnd namespace folder, no other folder', () => {
		assert.deepEqual(keys(flat), [...byTitle(DESC.core.map((d) => d.name)), 'n/ns%3Arnd']);
		assert.equal(flat.filter((n) => n.kind === 'folder').length, 0);
		assert.deepEqual(keys(flat.at(-1).children), byTitle(DESC.rnd.map((d) => d.name)));
	});
	test('core\'s and rnd\'s fragments: core\'s six folders and the R&D namespace with Product and Knowledge', () => {
		assert.deepEqual(folded.map((n) => [n.kind, n.label]), [['folder', 'Work'], ['folder', 'People'], ['folder', 'CRM'], ['folder', 'Meetings'], ['folder', 'Library'], ['folder', 'Activity'], ['namespace', 'R&D']]);
		assert.deepEqual(folded.at(-1).children.filter((n) => n.kind === 'folder').map((n) => n.label), ['Product', 'Knowledge']);
	});
	test('the set of collection rows is the same either way', () => {
		const rows = (nodes) => keys(every(nodes)).filter((k) => k.startsWith('c/')).sort();
		assert.deepEqual(rows(folded), rows(flat));
		assert.equal(rows(flat).length, descriptors.length);
	});
	test('the fixtures are the shipped fragments, once the modules ship them (tasks 3 and 6)', (t) => {
		const MODULES = path.resolve(HERE, '..', '..');
		let checked = 0;
		for (const [m, frag] of [['core', CORE_FRAG], ['rnd', RND_FRAG]]) {
			const f = path.join(MODULES, m, 'nav.yaml');
			if (!fs.existsSync(f)) continue;
			assert.deepEqual(yaml.load(fs.readFileSync(f, 'utf8')), frag, `${m}/nav.yaml drifted from the fixture`);
			checked++;
		}
		if (!checked) t.skip('neither modules/core/nav.yaml (task 3) nor modules/rnd/nav.yaml (task 6) exists yet');
	});
});

describe('navModel on a real workspace (the contract fixture, on the engine under test)', () => {
	const PKG = path.resolve(HERE, '..');
	const load = (rel) => import(pathToFileURL(path.join(PKG, rel)).href);
	let fixture, navModel, ctxOf, legacyTree, groupLabel;
	before(async () => {
		const { makeFixture } = await load('lib/contract/fixture.js');
		fixture = makeFixture({ engineDir: ENGINE_DIR });
		const { initEngine, engine } = await load('src/host/engine.js');
		await initEngine(fixture.root);
		({ navModel } = await load('src/nav-model.js'));
		({ legacyTree, groupLabel } = await load('src/host/nav.js'));
		const fsdata = await load('src/host/fsdata.js');
		ctxOf = (root) => ({
			declared: engine().namespaces,
			workspaceModule: fsdata.workspaceModule(root),
			dependsOn: fsdata.moduleDependencies(root),
			namespacesOf: fsdata.moduleNamespaces(root),
			titleOf: new Map(fsdata.loadModules(root).map((m) => [m.id, m.title])),
			descriptors: fsdata.loadDescriptors(root),
		});
	});
	after(() => fixture?.cleanup());
	const settingsFile = () => path.join(fixture.root, '.vscode', 'settings.json');
	const navFile = () => path.join(fixture.root, 'nav.yaml');
	const reset = () => { fs.rmSync(settingsFile(), { force: true }); fs.rmSync(navFile(), { force: true }); };
	const top = () => navModel({ root: fixture.root })[0];

	test('no nav.yaml and no settings: flat rows by title (init\'s notes, projects, tasks), the lab namespace folder, then the layers folder', () => {
		reset();
		const ws = top();
		assert.deepEqual(ws.children.map((n) => n.key), ['c/notes', 'c/projects', 'c/tasks', 'n/ns%3Alab', 'layers/Layers']);
		assert.deepEqual(ws.children[3].target, { name: 'lab' });
		assert.equal(ws.notice, undefined);
	});
	test('settings and no nav.yaml: the legacy tree, exactly what legacyTree orders', () => {
		reset();
		fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
		const settings = { navOrder: ['lab', 'tasks'], navHidden: [] };
		fs.writeFileSync(settingsFile(), `// a JSONC comment\n${JSON.stringify({ 'dreamteamer.navOrder': settings.navOrder })}\n`);
		const ws = top();
		const c = ctxOf(fixture.root);
		const legacy = legacyTree(c.descriptors, settings, c);
		const expected = legacy.map((e) => (e.kind === 'collection' ? `c/${e.descriptor.name}` : e.kind === 'folder' ? (e.folder.key.startsWith('ns:') ? `n/${encodeURIComponent(e.folder.key)}` : `f/${encodeURIComponent(groupLabel(e.folder.key, c.titleOf))}`) : 'layers'));
		assert.deepEqual(ws.children.filter((n) => !n.key.startsWith('layers/')).map((n) => n.key), expected.filter((k) => k !== 'layers'));
		assert.deepEqual(ws.children.map((n) => n.key).slice(0, 2), ['n/ns%3Alab', 'c/tasks'], 'navOrder still orders the legacy tree');
	});
	test('a nav.yaml: drawn by it — the settings are no longer read', () => {
		fs.writeFileSync(navFile(), '# The left nav of this workspace. Drag and drop writes this file; so may you.\ntree:\n  - folder: Work\n    items: [tasks]\nhidden: [projects]\n');
		const ws = top();
		assert.deepEqual(ws.children.map((n) => n.key), ['f/Work', 'c/notes', 'n/ns%3Alab', 'layers/Layers']);
		assert.deepEqual(ws.children[0].children.map((n) => [n.key, n.target]), [['c/tasks', { name: 'tasks' }]]);
	});
	test('an unreadable nav.yaml: the flat drawing and a notice naming the problem — never a throw', () => {
		fs.writeFileSync(navFile(), 'tree: [\n');
		const ws = top();
		assert.match(String(ws.notice), /nav\.yaml/);
		assert.deepEqual(ws.children.map((n) => n.key), ['c/notes', 'c/projects', 'c/tasks', 'n/ns%3Alab', 'layers/Layers']);
		fs.writeFileSync(navFile(), '- just\n- a list\n');
		assert.match(String(top().notice), /nav\.yaml/);
		reset();
	});
});
