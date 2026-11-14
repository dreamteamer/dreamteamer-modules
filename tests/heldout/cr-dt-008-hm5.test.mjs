// HELD-OUT cr-dt-008-hm5 (rnd/tests dreamteamer-modules/heldout-dt008-m-migrate-navgroups-single-collection-module).
//
// The lossless migration keeps what the legacy tree drew when dreamteamer.navGroups names a module that has one
// collection (which the legacy tree drew as a bare row, not a folder), and when it names a module that is not
// installed. Two workspaces: the candidate engine with the core preset and rnd from this repo, packed; and the
// published engine 0.48 (this repo's devDependency) with the published composed core 0.11.0 and rnd 0.10.1. Both carry
// workspace modules ws-a (three collections), ws-solo (one: solos) and ws-solo-2 (one: solo-twos) and the old settings.
// The legacy tree is drawn by protocol 0.2.0's navModel (its legacyTree path: settings, no nav.yaml); the migration is
// bin/dt-nav.mjs migrate run in the workspace; the drawing after it is navModel from the written file.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createWorkspace } from 'dreamteamer/testing';
import { ENGINE, closure, installPacked, editPkg, run, SCOPE } from '../helpers/workspace.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROTOCOL = path.join(ROOT, 'modules', 'protocol');
const DT_NAV = path.join(PROTOCOL, 'bin', 'dt-nav.mjs');
const OLD_ENGINE = fs.realpathSync(path.join(ROOT, 'node_modules', 'dreamteamer'));
const OLD_VERSION = JSON.parse(fs.readFileSync(path.join(OLD_ENGINE, 'package.json'), 'utf8')).version;

const SETTINGS = {
	'dreamteamer.navGroups': { Ops: ['ws-solo', 'ws-a'], Ghosts: ['not-installed'], One: ['ws-solo-2'] },
	'dreamteamer.navOrder': ['ops', 'core', 'solos', 'rnd'],
	'dreamteamer.navHidden': ['one'],
};

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const collection = (name, icon) => `name: ${name}\ndescription: A ${name} record of the fixture.\nuse_when: a ${name} is noted\nids:\n  from: '{{ name | slug }}'\nfields:\n  name:\n    type: string\n    required: true\ndisplay:\n  nav:\n    icon: ${icon}\n`;
function wsModule(root, id, title, collections) {
	const dir = path.join(root, 'modules', id);
	fs.mkdirSync(path.join(dir, 'collections'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: id, private: true, version: '0.1.0', dreamteamer: { title, description: `${title}: a synthetic workspace module of the fixture.` } }, null, '\t') + '\n');
	for (const [name, icon] of collections) fs.writeFileSync(path.join(dir, 'collections', `${name}.collection.yaml`), collection(name, icon));
}
function arrange(root) {
	// a workspace npm installed has a lockfile; dt-nav finds its workspace by package.json AND package-lock.json
	if (!fs.existsSync(path.join(root, 'package-lock.json'))) fs.writeFileSync(path.join(root, 'package-lock.json'), '{ "lockfileVersion": 3 }\n');
	wsModule(root, 'ws-a', 'Workspace A', [['alpha-notes', 'notes'], ['alpha-logs', 'history'], ['alpha-tasks', 'tasklist']]);
	wsModule(root, 'ws-solo', 'Solo', [['solos', 'star']]);
	wsModule(root, 'ws-solo-2', 'Solo Two', [['solo-twos', 'star']]);
	fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(root, '.vscode', 'settings.json'), JSON.stringify(SETTINGS, null, '\t') + '\n');
}

/** The candidate: this repo's core preset and rnd, packed, unpacked under node_modules and declared. */
function candidateWorkspace() {
	const { root } = createWorkspace({ engine: ENGINE }); made.push(root);
	editPkg(root, (pkg) => { pkg.dreamteamer.vars = ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER']; });
	fs.writeFileSync(path.join(root, '.env'), `FILES_FOLDER=${root}/files\nINBOX_FOLDERS=${root}/inbox\nREPOS_FOLDER=${root}\n`);
	installPacked(root, [...new Set([...closure('core'), ...closure('rnd')])]);
	arrange(root);
	return root;
}

/** The published 0.48 engine with the published composed core 0.11.0 and rnd 0.10.1, fetched with npm pack. */
function publishedWorkspace() {
	const { root } = createWorkspace({ engine: OLD_ENGINE }); made.push(root);
	editPkg(root, (pkg) => { pkg.dreamteamer.vars = ['FILES_FOLDER', 'INBOX_FOLDERS', 'REPOS_FOLDER']; });
	fs.writeFileSync(path.join(root, '.env'), `FILES_FOLDER=${root}/files\nINBOX_FOLDERS=${root}/inbox\nREPOS_FOLDER=${root}\n`);
	const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'hm5-npm-')); made.push(dl);
	const deps = {};
	for (const spec of [`${SCOPE}/core@0.11.0`, `${SCOPE}/rnd@0.10.1`]) {
		const out = JSON.parse(execFileSync('npm', ['pack', spec, '--pack-destination', dl, '--json', '--silent'], { encoding: 'utf8', timeout: 120_000 }));
		const name = out[0].name;
		const dir = path.join(root, 'node_modules', name);
		fs.mkdirSync(dir, { recursive: true });
		execFileSync('tar', ['-xzf', path.join(dl, out[0].filename), '-C', dir, '--strip-components', '1']);
		deps[name] = out[0].version;
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
		for (const d of Object.keys(pkg.dependencies ?? {})) {
			const at = path.join(root, 'node_modules', d);
			if (fs.existsSync(at)) continue;
			const from = path.join(ROOT, 'node_modules', d);
			assert.ok(fs.existsSync(from), `${name} needs ${d}, which this repo does not hold`);
			fs.mkdirSync(path.dirname(at), { recursive: true });
			fs.symlinkSync(from, at, 'dir');
		}
	}
	editPkg(root, (pkg) => { Object.assign(pkg.dependencies, deps); });
	arrange(root);
	return root;
}

/** navModel of protocol 0.2.0 in a child process, so each workspace loads its own engine. */
function navModelOf(root) {
	const script = path.join(os.tmpdir(), `hm5-draw-${process.pid}.mjs`);
	fs.writeFileSync(script, `import { initEngine } from ${JSON.stringify(path.join(PROTOCOL, 'src', 'host', 'engine.js'))};
import { navModel, workspaceNavSettings } from ${JSON.stringify(path.join(PROTOCOL, 'src', 'nav-model.js'))};
const root = process.argv[2];
const log = console.log; console.log = () => {};
await initEngine(root);
const m = navModel({ root, settings: workspaceNavSettings(root) });
process.stdout.write(JSON.stringify(m));
`);
	const r = spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 60_000 });
	fs.rmSync(script, { force: true });
	assert.equal(r.status, 0, `navModel failed:\n${r.stdout}\n${r.stderr}`);
	return JSON.parse(r.stdout)[0];
}
/** The drawing that can be compared: kind, key, label, children; marks, routes, tooltips, icons and the layers folder out. */
const comparable = (nodes) => nodes.filter((n) => n.kind !== 'layers').map((n) => ({ kind: n.kind, key: n.key, label: n.label, ...(n.children?.length && n.kind !== 'collection' ? { children: comparable(n.children) } : {}) }));
const collections = (nodes, out = []) => { for (const n of nodes) { if (n.kind === 'collection') out.push(n.key); if (n.kind !== 'collection') collections(n.children ?? [], out); } return out; };
const migrate = (root) => spawnSync(process.execPath, [DT_NAV, 'migrate'], { cwd: root, encoding: 'utf8', timeout: 60_000 });

for (const [variant, make, candidate] of [['candidate engine, core preset + rnd from this repo', candidateWorkspace, true], [`published engine ${OLD_VERSION}, composed core 0.11.0 + rnd 0.10.1`, publishedWorkspace, false]]) {
	describe(variant, () => {
		let root, legacy, legacyTop;
		test('step 1: the workspace compiles', () => {
			root = make();
			const r = spawnSync(process.execPath, [path.join(candidate ? ENGINE : OLD_ENGINE, 'bin', 'dreamteamer.js'), 'compile'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
			assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
			assert.equal(fs.existsSync(path.join(root, 'nav.yaml')), false, 'nav.yaml exists before the migration');
		});
		test('step 2: the legacy tree is recorded', () => {
			legacyTop = navModelOf(root);
			legacy = comparable(legacyTop.children);
			const names = collections(legacy);
			assert.ok(names.includes('c/solos'), `the single-collection module's row is not drawn before the migration: ${JSON.stringify(legacy.map((n) => n.label))}`);
			console.log(`# legacy top level: ${legacy.map((n) => `${n.label}${n.children ? `[${n.children.map((c) => c.label).join(', ')}]` : ''}`).join(' · ')}`);
		});
		test('step 3: dt-nav migrate writes nav.yaml from the settings', () => {
			const r = migrate(root);
			assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
			assert.match(r.stdout, /✔ nav\.yaml written from your nav settings/);
			if (!candidate) assert.doesNotMatch(r.stdout, /fragments applied/, 'engine 0.48 applied fragments');
			assert.ok(fs.existsSync(path.join(root, 'nav.yaml')));
		});
		test('step 4: the drawing from the written file equals the legacy tree (labels, nesting, row order); the hidden group is recorded', () => {
			const now = navModelOf(root);
			assert.equal(now.notice, undefined, `a notice: ${now.notice}`);
			const drawn = comparable(now.children);
			const names = collections(drawn);
			assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a collection drawn twice');
			assert.deepEqual([...names].sort(), [...collections(legacy)].sort(), 'a collection missing or added compared with the legacy tree');
			assert.deepEqual(drawn, legacy);
			const doc = yaml.load(fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8'));
			const one = doc.tree.find((e) => e && e.folder === 'One');
			const recorded = (one && one.hidden === true && JSON.stringify(one.items).includes('solo-twos')) || (doc.hidden ?? []).includes('solo-twos');
			assert.ok(recorded, `the hidden group One is not recorded for Show hidden: ${JSON.stringify(doc)}`);
			assert.equal(names.includes('c/solo-twos'), false, 'the hidden group\'s row is drawn (as a tail row?)');
			const ghosts = doc.tree.find((e) => e && e.folder === 'Ghosts');
			if (!legacy.some((n) => n.label === 'Ghosts')) assert.equal(ghosts, undefined, 'an empty Ghosts folder the legacy tree did not draw');
		});
		test('step 5: a second migrate prints nothing to migrate, exit 0, file byte-identical', () => {
			const before = fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8');
			const r = migrate(root);
			assert.equal(r.status, 0, r.stderr);
			assert.match(r.stdout, /nothing to migrate/);
			assert.equal(fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8'), before);
		});
		test('step 6: dt check gives no nav.yaml warning', () => {
			const r = spawnSync(process.execPath, [path.join(candidate ? ENGINE : OLD_ENGINE, 'bin', 'dreamteamer.js'), 'check'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
			assert.doesNotMatch(`${r.stdout}\n${r.stderr}`, /nav\.yaml/, `${r.stdout}\n${r.stderr}`);
		});
	});
}
