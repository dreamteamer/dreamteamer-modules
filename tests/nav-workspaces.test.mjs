// BOTH WAYS IN REAL WORKSPACES (cr-dt-008, task 14; acceptance lines 3 and 6).
//
// The nav is one document, nav.yaml, that a module's fragment seeds and the workspace then owns. Two workspaces on
// the candidate engine, each installed with `dt install … --from <packed>` and drawn by the protocol's own navModel:
//   tasks and contacts   rnd/tests dreamteamer-modules/tasks-contacts-closure — two packages bring exactly their
//                        closure (tasks, contacts, users, companies, assets), no fragment, so no nav.yaml is written
//                        and every row is drawn flat, alphabetical. The collections are those five packages' own,
//                        which is six: users ships `teams` beside `users` (the decision record
//                        2026-11-14--the-tasks-and-contacts-closure-is-five-packages-and-six-collections-users-ships-teams).
//   flat and folded      rnd/tests dreamteamer-modules/nav-flat-and-folded — core (the preset) + rnd draw core's six
//                        folders and the R&D namespace; the seventeen members installed one at a time + rnd carry
//                        only rnd's fragment and draw the rest flat. The two hold the same collection rows.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ROOT, pkgOf, packedInto, virginWorkspace, run, cleanup, closure, engineMeets, ENGINE_VERSION } from './helpers/workspace.mjs';

after(cleanup);
const SRC = path.join(ROOT, 'modules', 'protocol', 'src');
const { initEngine } = await import(pathToFileURL(path.join(SRC, 'host', 'engine.js')).href);
const { navModel } = await import(pathToFileURL(path.join(SRC, 'nav-model.js')).href);

const MEMBERS = Object.keys(pkgOf('core').dreamteamer.preset ?? {}).map((d) => d.replace(/^@dreamteamer\//, ''));
const skip = !engineMeets('core') && `a module preset and its nav fragment install on engine 0.49.0 or later; testing ${ENGINE_VERSION}`;
const HOME = () => ({ HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-HOME-')) });

/** Every package this repo could be asked for in these workspaces, packed into one folder `--from` reads. */
let from;
const packedAll = () => (from ??= packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-navws-')), ...new Set(['core', 'rnd', ...MEMBERS, ...closure('tasks'), ...closure('contacts')])));

const install = (root, ...names) => {
	const r = run(root, ['install', ...names.map((n) => `@dreamteamer/${n}`), '--from', packedAll(), '--no-input'], HOME());
	assert.equal(r.status, 0, `dt install ${names.join(' ')}: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-800)}`);
};
const compiledNames = (root) => fs.readdirSync(path.join(root, '.dreamteamer', 'collections')).filter((f) => f.endsWith('.collection.yaml')).map((f) => f.replace(/\.collection\.yaml$/, '')).sort();
const pinned = (root) => Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies).filter((d) => d.startsWith('@dreamteamer/')).sort();
const navDoc = (root) => (fs.existsSync(path.join(root, 'nav.yaml')) ? yaml.load(fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8')) : null);

/** The workspace node navModel draws for `root`, the way a host draws it (the protocol's own model on the workspace's engine). */
async function drawn(root) {
	await initEngine(root);
	const nodes = navModel({ root, settings: {} });
	const ws = nodes.find((n) => n.kind === 'workspace') ?? nodes[0];
	assert.ok(ws?.children, `no workspace node drawn: ${JSON.stringify(nodes.map((n) => n.kind))}`);
	return ws;
}
const top = (ws) => ws.children.filter((n) => n.kind !== 'layers');
const collectionKeys = (nodes, out = new Set()) => {
	for (const n of nodes) {
		if (n.kind === 'collection') out.add(n.key);
		if (n.children) collectionKeys(n.children, out);
	}
	return out;
};
/** The collections a package authors itself — an overlay (`overlay: true`) adds fields to another's and owns nothing. */
const ownCollections = (m) => {
	const dir = path.join(ROOT, 'modules', m, 'collections');
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f) => f.endsWith('.collection.yaml'))
		.map((f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')))
		.filter((d) => !d.overlay).map((d) => d.name);
};
const alphabetical = (labels) => [...labels].sort((a, b) => a.localeCompare(b));

/** A virgin workspace's own compiled collections — the engine's kinds and init's — which no module brought. */
let base;
const baseline = () => {
	if (base) return base;
	const root = virginWorkspace();
	const r = run(root, ['compile']);
	assert.equal(r.status, 0, r.stderr);
	return (base = new Set(compiledNames(root)));
};

describe('tasks and contacts', { skip }, () => {
	test('install exactly their closure, write no nav.yaml, and draw those rows flat, alphabetical by title', { timeout: 300_000 }, async () => {
		const root = virginWorkspace();
		install(root, 'tasks', 'contacts');
		const FIVE = ['assets', 'companies', 'contacts', 'tasks', 'users'];
		assert.deepEqual([...new Set([...closure('tasks'), ...closure('contacts')])].sort(), FIVE, 'the closure this repo declares moved');
		assert.deepEqual(pinned(root), FIVE.map((m) => `@dreamteamer/${m}`));
		const owned = compiledNames(root).filter((c) => !baseline().has(c));
		assert.deepEqual(owned, [...new Set(FIVE.flatMap(ownCollections))].sort());
		assert.deepEqual(owned, ['assets', 'companies', 'contacts', 'tasks', 'teams', 'users']);
		assert.equal(navDoc(root), null, 'a nav.yaml was written though no installed module ships a fragment');
		const nodes = top(await drawn(root));
		assert.deepEqual(nodes.filter((n) => n.kind !== 'collection').map((n) => [n.kind, n.label]), [], 'a folder or namespace was drawn');
		const rows = nodes.filter((n) => owned.includes(n.target?.name));
		assert.deepEqual(rows.map((n) => n.key).sort(), owned.map((c) => `c/${c}`));
		assert.deepEqual(rows.map((n) => n.label), alphabetical(rows.map((n) => n.label)));
	});
});

describe('flat and folded', { skip }, () => {
	let a, b;
	test('A — dt install @dreamteamer/core @dreamteamer/rnd: nav.yaml carries core\'s six folders and the R&D namespace', { timeout: 600_000 }, async () => {
		const root = virginWorkspace();
		install(root, 'core', 'rnd');
		const doc = navDoc(root);
		assert.ok(doc, 'no nav.yaml written');
		const folders = doc.tree.filter((e) => e && typeof e === 'object' && 'folder' in e).map((e) => e.folder);
		assert.deepEqual(folders, ['Work', 'People', 'CRM', 'Meetings', 'Library', 'Activity']);
		const ns = doc.tree.find((e) => e && e.namespace === 'rnd');
		assert.ok(ns, `no namespace: rnd entry: ${JSON.stringify(doc.tree)}`);
		assert.deepEqual(ns.items.filter((e) => e && typeof e === 'object').map((e) => e.folder), ['Product', 'Knowledge']);
		a = await drawn(root);
	});
	test('B — the seventeen members one dt install at a time, then rnd: only rnd\'s fragment; one R&D namespace, the rest flat', { timeout: 900_000 }, async () => {
		const root = virginWorkspace();
		for (const m of MEMBERS) install(root, m);
		assert.equal(navDoc(root), null, 'a member wrote a nav.yaml — only core and rnd ship fragments');
		install(root, 'rnd');
		const shipped = yaml.load(fs.readFileSync(path.join(ROOT, 'modules', 'rnd', 'nav.yaml'), 'utf8'));
		assert.deepEqual(navDoc(root).tree, shipped.tree, 'nav.yaml carries more than rnd\'s fragment');
		b = await drawn(root);
		const nodes = top(b);
		const others = nodes.filter((n) => n.kind !== 'collection');
		assert.deepEqual(others.map((n) => [n.kind, n.label]), [['namespace', 'R&D']]);
		const rows = nodes.filter((n) => n.kind === 'collection');
		const members = new Set(MEMBERS.flatMap(ownCollections));
		const strays = rows.map((n) => n.target.name).filter((c) => !members.has(c) && !baseline().has(c));
		assert.deepEqual(strays, [], 'a row drawn flat is neither a member\'s collection nor the workspace\'s own (an rnd row outside its namespace?)');
		assert.ok(rows.filter((n) => members.has(n.target.name)).length >= 20, `only ${rows.length} member rows drawn flat`);
		assert.deepEqual(rows.map((n) => n.label), alphabetical(rows.map((n) => n.label)));
	});
	test('A and B draw the same set of collection rows', () => {
		assert.ok(a && b, 'a workspace case did not run');
		assert.deepEqual([...collectionKeys(top(a))].sort(), [...collectionKeys(top(b))].sort());
	});
});
