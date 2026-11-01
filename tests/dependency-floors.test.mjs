// A MODULE'S FLOOR ON A SIBLING — one npm `peerDependencies` range, read by npm at install and by the
// engine at compile (cr-modules-003). users 0.2 and projects 0.4 moved `teams` between them and must be
// installed together; each half alone broke a workspace, one of them silently. The floor makes both
// halves refuse by name, both versions and the fix, before a record is touched.
//
// A floor on a module the declarer HARD-depends on is strict; any other floor is optional, so npm never
// installs a module nobody asked for. Strict matters: under a `file:` tarball spec npm overrides an
// optional peer and removes the conflicting package, exit 0 (measured, npm 11.7.0) — a strict one is
// refused under every spec form.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MODULES, ROOT, BIN, pkgOf, moduleIds, folderOf, packed, virginWorkspace, run, cleanup, engineReadsFloors } from './helpers/workspace.mjs';
import { serveRegistry, npmInstall, installedVersion } from './helpers/registry.mjs';
import { compose, composedModules } from '../scripts/compose-core.mjs';
import { main as linkMain } from '../modules/setup/bin/link.mjs';

after(cleanup);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-floors-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SCOPE = '@dreamteamer/';
const floorsOf = (m) => Object.entries(pkgOf(m).peerDependencies ?? {}).filter(([d]) => d.startsWith(SCOPE));
const optional = (m, dep) => pkgOf(m).peerDependenciesMeta?.[dep]?.optional === true;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
/** The last published version before the floors: a stand-in is today's folder at that version with its
 *  floors stripped, because that is all a published old version is to npm and to the floor check. */
const OLD = { users: '0.1.1', projects: '0.3.1' };
function standIn(id, version = OLD[id]) {
	const dir = path.join(tmp, `${id}-${version}`);
	if (!fs.existsSync(dir)) {
		fs.cpSync(path.join(MODULES, id), dir, { recursive: true, filter: (s) => !/node_modules|[\\/]test([\\/]|$)/.test(path.relative(MODULES, s)) });
		const f = path.join(dir, 'package.json');
		const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
		pkg.version = version; delete pkg.peerDependencies; delete pkg.peerDependenciesMeta;
		fs.writeFileSync(f, JSON.stringify(pkg, null, '\t') + '\n');
	}
	return dir;
}
/** `npm pack` a folder; returns the tarball path. */
const packDir = (dir) => {
	const dest = fs.mkdtempSync(path.join(tmp, 'pack-'));
	const out = execFileSync('npm', ['pack', dir, '--pack-destination', dest, '--json', '--silent'], { encoding: 'utf8', timeout: 60_000 });
	return path.join(dest, JSON.parse(out)[0].filename);
};

describe('the declarations', () => {
	test('projects floors users at >=0.2.0 (strict) and users floors projects at >=0.4.0 (optional) — the pair cr-modules-002 shipped', () => {
		assert.deepEqual(floorsOf('projects'), [['@dreamteamer/users', '>=0.2.0']]);
		assert.equal(optional('projects', '@dreamteamer/users'), false, 'users is a hard dependency of projects: strict, so npm refuses under every spec form');
		assert.deepEqual(floorsOf('users'), [['@dreamteamer/projects', '>=0.4.0']]);
		assert.equal(optional('users', '@dreamteamer/projects'), true, 'users does not need projects: optional, so npm never installs it unasked');
	});

	test('every floor names a module of this repo with a >=x.y.z range its sibling here meets, strict iff a hard dependency', () => {
		for (const m of moduleIds()) for (const [dep, range] of floorsOf(m)) {
			const sib = folderOf(dep);
			assert.ok(fs.existsSync(path.join(MODULES, sib, 'package.json')), `${m} floors ${dep}, which is not a module of this repo`);
			const at = /^>=(\d+\.\d+\.\d+)$/.exec(range);
			assert.ok(at, `${m} floors ${dep} at "${range}" — write the floor as >=x.y.z`);
			assert.ok(cmp(pkgOf(sib).version, at[1]) >= 0, `${m} floors ${dep} at ${range}, and this repo holds ${pkgOf(sib).version} — a clone would refuse itself`);
			const hard = (pkgOf(m).dreamteamer.dependencies ?? []).includes(dep);
			assert.equal(optional(m, dep), !hard, `${m} → ${dep}: ${hard ? 'a hard dependency is a strict floor' : 'a floor on a module it does not depend on must be optional (peerDependenciesMeta)'}`);
		}
	});

	test('a floor lives in npm\'s top-level peerDependencies, never inside the dreamteamer block', () => {
		for (const m of moduleIds()) assert.equal(pkgOf(m).dreamteamer.peerDependencies, undefined, `${m}: dreamteamer.peerDependencies is the retired spelling of peer_collections`);
	});
});

describe('the composition', () => {
	test('no composed module carries a floor, and every origin floors only another origin of the same composition', () => {
		for (const t of composedModules()) {
			const { spec, manifest } = compose(t);
			assert.equal(manifest.peerDependencies, undefined, `${t}'s merged manifest carries peerDependencies`);
			assert.equal(pkgOf(t).peerDependencies, undefined, `${t}/package.json carries peerDependencies`);
			for (const o of spec.origins) for (const [dep] of floorsOf(o)) {
				assert.ok(spec.origins.includes(folderOf(dep)), `${o} floors ${dep}, which ${t} does not compose — ${t} would ship without the floor`);
			}
		}
	});
});

describe('npm refuses a half-upgrade (a registry install, the way a workspace gets them)', () => {
	let registry;
	before(async () => {
		registry = await serveRegistry([packDir(standIn('users')), packDir(standIn('projects')), packed('users'), packed('projects')]);
	});
	after(() => registry?.close());
	/** A workspace on the last published pair, installed from the registry. */
	async function onOldPair() {
		const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
		fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'probe', private: true, dependencies: { '@dreamteamer/users': OLD.users, '@dreamteamer/projects': OLD.projects } }, null, '\t'));
		const r = await npmInstall(ws, [], registry.url);
		assert.equal(r.code, 0, r.out);
		return ws;
	}
	const versions = (ws) => ({ users: installedVersion(ws, '@dreamteamer/users'), projects: installedVersion(ws, '@dreamteamer/projects') });

	test(`projects 0.4 beside users 0.1: ERESOLVE naming users ${OLD.users} and >=0.2.0, nothing changed`, async () => {
		const ws = await onOldPair();
		const r = await npmInstall(ws, [`@dreamteamer/projects@${pkgOf('projects').version}`], registry.url);
		assert.notEqual(r.code, 0, `npm installed projects ${pkgOf('projects').version} beside users ${OLD.users}:\n${r.out}`);
		assert.match(r.out, /ERESOLVE/);
		assert.ok(r.out.includes(`@dreamteamer/users@${OLD.users}`) && r.out.includes('peer @dreamteamer/users@">=0.2.0"'), r.out);
		assert.deepEqual(versions(ws), OLD);
	});

	test(`users 0.2 beside projects 0.3: ERESOLVE naming projects ${OLD.projects} and >=0.4.0, nothing changed`, async () => {
		const ws = await onOldPair();
		const r = await npmInstall(ws, [`@dreamteamer/users@${pkgOf('users').version}`], registry.url);
		assert.notEqual(r.code, 0, `npm installed users ${pkgOf('users').version} beside projects ${OLD.projects}:\n${r.out}`);
		assert.match(r.out, /ERESOLVE/);
		assert.ok(r.out.includes(`@dreamteamer/projects@${OLD.projects}`) && r.out.includes('peerOptional @dreamteamer/projects@">=0.4.0"'), r.out);
		assert.deepEqual(versions(ws), OLD);
	});

	test('the documented upgrade — both at once — resolves', async () => {
		const ws = await onOldPair();
		const r = await npmInstall(ws, [`@dreamteamer/users@^${pkgOf('users').version}`, `@dreamteamer/projects@^${pkgOf('projects').version}`], registry.url);
		assert.equal(r.code, 0, r.out);
		assert.deepEqual(versions(ws), { users: pkgOf('users').version, projects: pkgOf('projects').version });
	});
});

// The engine half. An engine that does not read floors (before 0.42.0) compiles these pairs, so the
// tests below probe the engine under test once and skip — saying why — when it does not refuse a floor.
// `DT_ENGINE_DIR=<an engine checkout> npm test` runs them.
const READS = engineReadsFloors();
const skip = !READS && `the engine under test (${BIN}) does not read peerDependencies floors — run with DT_ENGINE_DIR=<an engine that does>`;

/** A module folder placed under the workspace's modules/ (an inline copy). */
const copyIn = (root, id, from) => fs.cpSync(from, path.join(root, 'modules', id), { recursive: true });
const here = (id) => path.join(MODULES, id);

describe('dt compile refuses a half-upgrade npm never saw', { skip }, () => {
	test(`projects 0.4 beside users 0.1 as copies: refused by the floor, naming both versions and the copy to bring up`, () => {
		const root = virginWorkspace();
		copyIn(root, 'users', standIn('users'));
		copyIn(root, 'projects', here('projects'));
		const c = run(root, ['compile']);
		assert.equal(c.status, 1, c.stderr + c.stdout);
		assert.ok(c.stderr.includes(`module "@dreamteamer/projects" ${pkgOf('projects').version} needs "@dreamteamer/users" >=0.2.0 (its peerDependencies) — this workspace has ${OLD.users}, from modules`), c.stderr);
		assert.ok(c.stderr.includes('fix: bring modules/users to a version in >=0.2.0'), c.stderr);
	});

	test(`users 0.2 beside projects 0.3 as copies: refused by the floor, before the teams collision`, () => {
		const root = virginWorkspace();
		copyIn(root, 'users', here('users'));
		copyIn(root, 'projects', standIn('projects'));
		const c = run(root, ['compile']);
		assert.equal(c.status, 1, c.stderr + c.stdout);
		assert.ok(c.stderr.includes(`module "@dreamteamer/users" ${pkgOf('users').version} needs "@dreamteamer/projects" >=0.4.0 (its peerDependencies) — this workspace has ${OLD.projects}, from modules`), c.stderr);
		assert.doesNotMatch(c.stderr, /name collision/);
	});

	/** A clone of this repo as `dt-setup link` sees one: a bundle root and the two modules under modules/. */
	function clone(users) {
		const dir = fs.mkdtempSync(path.join(tmp, 'clone-'));
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dreamteamer-modules', private: true, dreamteamer: {} }, null, '\t'));
		fs.cpSync(users, path.join(dir, 'modules', 'users'), { recursive: true });
		fs.cpSync(here('projects'), path.join(dir, 'modules', 'projects'), { recursive: true, filter: (s) => !/node_modules/.test(s) });
		return dir;
	}
	async function linked(users) {
		const root = virginWorkspace();
		const log = console.log; console.log = () => {};
		try { assert.equal(await linkMain([clone(users)], root, 'link'), 0); } finally { console.log = log; }
		return root;
	}

	test('a linked clone whose users is behind its projects: dt-setup link, then compile refuses by the floor', async () => {
		const root = await linked(standIn('users'));
		const c = run(root, ['compile']);
		assert.equal(c.status, 1, c.stderr + c.stdout);
		assert.ok(c.stderr.includes(`this workspace has ${OLD.users}, from git_modules`), c.stderr);
		assert.ok(c.stderr.includes('fix: bring git_modules/dreamteamer-modules/modules/users to a version in >=0.2.0'), c.stderr);
	});

	test('a linked clone of this repo as it is compiles — a floor never refuses its own repo', async () => {
		const root = await linked(here('users'));
		const c = run(root, ['compile']);
		assert.equal(c.status, 0, c.stderr + c.stdout);
	});
});

describe('the house rules say so', () => {
	test('README\'s house-rules sentence and CLAUDE.md name the floor', () => {
		const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
		const rules = readme.slice(readme.indexOf('The house rules'));
		assert.match(rules, /peerDependencies/, 'README\'s house-rules sentence says nothing about floors');
		assert.match(fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8'), /\*\*A floor on a sibling is an npm `peerDependencies` range/);
	});
});
