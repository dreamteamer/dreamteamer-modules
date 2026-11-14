// THE MIGRATION IS LOSSLESS (cr-dt-008, task 11; rnd/tests dreamteamer-modules/nav-migration-lossless).
//
// A workspace whose left nav is still arranged by the old settings — navOrder, navGroups, navHidden in
// .vscode/settings.json — draws the legacy tree until those settings are written into nav.yaml. migrateNavSettings
// writes them once: the folders the settings drew (a module folder, a namespace folder, a navGroups folder) become
// the document's folders in the same order and nesting, a hidden folder stays hidden, and the drawing after the
// migration is the drawing before it — less the module marks, module routes and module tooltips a nav.yaml folder
// never carries, and less the layers folder, which nav.yaml does not place. A second run writes nothing.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { workspace } from '../../../tests/helpers/fixture.mjs';
import { initEngine } from '../src/host/engine.js';
import { navModel } from '../src/nav-model.js';
import { legacyDoc, migrateNavSettings, NAV_HEADER } from '../src/nav-doc.js';

const SETTINGS = {
	navOrder: ['core', 'rnd', 'ws-a'],
	navGroups: { Plans: ['deliverables', 'risks'], Solo: ['solo'] },
	navHidden: ['ws-b'],
};

const collection = (name, icon) => `name: ${name}
description: A ${name.replace(/^rnd\//, '')} record of the Northwind fixture.
use_when: a ${name.replace(/^rnd\//, '')} is noted for Northwind
ids:
  from: '{{ name | slug }}'
fields:
  name:
    type: string
    required: true
display:
  nav:
    icon: ${icon}
`;

/** A workspace module under modules/<id>, with its collections. */
function module(root, id, title, collections, extra = {}) {
	const dir = path.join(root, 'modules', id);
	fs.mkdirSync(path.join(dir, 'collections'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: id, private: true, version: '0.1.0', dreamteamer: { title, description: `${title}: the ${id} part of the Northwind fixture, a synthetic module.`, ...extra } }, null, '\t') + '\n');
	for (const [name, icon] of collections) {
		const file = path.join(dir, 'collections', `${name}.collection.yaml`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, collection(name, icon));
	}
}

let root;
before(() => {
	const ws = workspace({ compile: false, pkg: { namespaces: ['rnd'] } });
	root = ws.root;
	module(root, 'core', 'Core', [['companies', 'business'], ['contacts', 'person'], ['tasks', 'task_alt']]);
	module(root, 'rnd', 'R&D', [['rnd/issues', 'bug'], ['rnd/designs', 'lightbulb']], { namespaces: ['rnd'] });
	module(root, 'deliverables', 'Deliverables', [['deliverables', 'inventory_2'], ['milestones', 'flag']]);
	module(root, 'risks', 'Risks', [['risks', 'warning']]);
	module(root, 'solo', 'Solo', [['solos', 'star']]);
	module(root, 'ws-a', 'Workspace A', [['alpha-notes', 'notes'], ['alpha-logs', 'history']]);
	module(root, 'ws-b', 'Workspace B', [['beta-notes', 'notes'], ['beta-logs', 'history']]);
	const r = ws.dt('compile');
	assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
});

/** The comparable drawing: kind, key, label, icon and children; marks, routes and tooltips out, the layers folder out. */
const comparable = (nodes) => nodes
	.filter((n) => n.kind !== 'layers')
	.map((n) => ({ kind: n.kind, key: n.key, label: n.label, icon: n.icon, ...(n.children ? { children: comparable(n.children) } : {}) }));
const drawn = () => comparable(navModel({ root, settings: SETTINGS })[0].children);

test('the drawing after the migration is the drawing before it, and the hidden module folder stays hidden', async () => {
	await initEngine(root);
	assert.equal(fs.existsSync(path.join(root, 'nav.yaml')), false);
	const legacy = drawn();
	// the fixture draws what the settings say: core, rnd and ws-a first, Plans and Solo as folders, ws-b not at all
	const top = legacy.map((n) => n.label);
	assert.deepEqual(top.slice(0, 3), ['Core', 'R&D', 'Workspace A'], top.join(' · '));
	assert.ok(top.includes('Plans') && top.includes('Solo'), top.join(' · '));
	assert.ok(!top.includes('Workspace B'), 'the hidden module folder is drawn before the migration');
	assert.deepEqual(legacy.find((n) => n.label === 'Plans').children.map((n) => n.key), ['c/deliverables', 'c/milestones', 'c/risks']);

	const result = migrateNavSettings(root, SETTINGS);
	assert.equal(result.written, true);
	const text = fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8');
	assert.equal(text.split('\n')[0], NAV_HEADER);
	const doc = yaml.load(text);
	const wsB = doc.tree.find((e) => e.folder === 'Workspace B');
	assert.ok(wsB && wsB.hidden === true, `the hidden module folder is not kept hidden: ${JSON.stringify(doc.tree)}`);
	assert.deepEqual([...wsB.items].sort(), ['beta-logs', 'beta-notes']);
	assert.ok(doc.tree.some((e) => e.namespace === 'rnd' && e.items.includes('rnd/issues')), 'the namespace folder is not a namespace entry');

	assert.deepEqual(drawn(), legacy);
});

test('a navGroups key naming a module with one collection keeps its folder', () => {
	const doc = yaml.load(fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8'));
	assert.deepEqual(doc.tree.find((e) => e.folder === 'Solo')?.items, ['solos']);
	assert.ok(drawn().some((n) => n.kind === 'folder' && n.label === 'Solo' && n.children.map((c) => c.key).join() === 'c/solos'));
});

test('a second run writes nothing', () => {
	const file = path.join(root, 'nav.yaml');
	const was = fs.readFileSync(file, 'utf8');
	assert.deepEqual(migrateNavSettings(root, SETTINGS), { written: false, fragments: false });
	assert.equal(fs.readFileSync(file, 'utf8'), was);
});

test('no settings, nothing to migrate', () => {
	assert.deepEqual(migrateNavSettings(root, {}), { written: false, fragments: false });
	assert.deepEqual(migrateNavSettings(root, { navOrder: [], navGroups: {}, navHidden: [] }), { written: false, fragments: false });
});

test('legacyDoc: a top-level hidden collection goes to hidden, the layers entry is dropped, nesting is kept', () => {
	const d = (name) => ({ name });
	const entries = [
		{ kind: 'collection', descriptor: d('notes') },
		{ kind: 'collection', descriptor: d('drafts') },
		{ kind: 'folder', folder: { key: 'ns:rnd', collections: [d('rnd/issues')], children: [{ key: 'grp:Product', collections: [d('rnd/designs')], children: [] }] } },
		{ kind: 'layers', label: 'Layers', layers: [] },
	];
	const doc = legacyDoc(entries, { navHidden: ['drafts'] }, { titleOf: new Map(), iconOf: () => undefined });
	assert.deepEqual(doc, {
		tree: ['notes', { namespace: 'rnd', items: ['rnd/issues', { folder: 'Product', items: ['rnd/designs'] }] }],
		hidden: ['drafts'],
	});
});
