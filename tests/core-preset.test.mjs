// CORE IS A MODULE PRESET, PINNED (cr-dt-008, task 3; rnd/tests dreamteamer-modules/core-preset).
//
// From core 0.12 `@dreamteamer/core` ships no source: its manifest's `dreamteamer.preset` maps seventeen small
// modules to exact versions, and the engine (0.49) installs them as the set. The map is pinned once, here,
// to versions no later change of this candidate moves; the test holds the map to every member's own
// package.json, so a member bumped after the pin fails it. The members together still declare every env key
// and template variable core 0.11 declared, and a fresh workspace that runs `dt install @dreamteamer/core`
// compiles the very collection set core 0.11 compiled (frozen in tests/fixtures/core-0.11-collections.json).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, pkgOf, packedInto, packedFiles, virginWorkspace, run, cleanup, engineMeets, ENGINE_VERSION } from './helpers/workspace.mjs';

after(cleanup);
const MEMBERS = ['assets', 'users', 'companies', 'contacts', 'engagements', 'tasks', 'projects', 'meetings', 'recordings', 'meeting-docs', 'files', 'workflows', 'sessions', 'metrics', 'roles', 'responsibilities', 'artifacts'];
const CORE_011 = { env: ['LINKEDIN_USER_AGENT', 'TRANSCRIPTION_HOME', 'WORK_CALENDARS'], vars: ['FILES_FOLDER', 'INBOX_FOLDERS', 'SESSIONS_FOLDER'] };
const COLLECTIONS_011 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'core-0.11-collections.json'), 'utf8')).collections;
const preset = () => pkgOf('core').dreamteamer.preset ?? {};
const onCandidate = !engineMeets('core') || !/^>=0\.49\./.test(pkgOf('core').dreamteamer.engine ?? '')
	? `a module preset installs on engine 0.49.0 or later; testing ${ENGINE_VERSION}` : false;

describe('the preset map', () => {
	test('names exactly the seventeen members, each at the version its own package.json carries', () => {
		assert.deepEqual(Object.keys(preset()).sort(), MEMBERS.map((m) => `@dreamteamer/${m}`).sort());
		for (const m of MEMBERS) assert.equal(preset()[`@dreamteamer/${m}`], pkgOf(m).version, `${m}: the preset pins ${preset()[`@dreamteamer/${m}`]}, the member is ${pkgOf(m).version}`);
	});
	test('core declares no source, extension, env, vars, bin, provides or peers — and names its nav fragment', () => {
		const pkg = pkgOf('core');
		for (const k of ['extension', 'env', 'vars', 'provides', 'peer_collections', 'dependencies']) assert.ok(!(k in pkg.dreamteamer), `dreamteamer.${k} is still declared`);
		assert.ok(!('bin' in pkg), 'bin is still declared');
		assert.equal(pkg.version, '0.12.0');
		assert.equal(pkg.dreamteamer.engine, '>=0.49.0');
		assert.equal(pkg.dreamteamer.nav, 'nav.yaml');
		assert.deepEqual([...pkg.files].sort(), ['README.md', 'UPDATING.md', 'nav.yaml']);
	});
	test('the members together declare every env key and template variable core 0.11 declared', () => {
		const env = new Set(MEMBERS.flatMap((m) => pkgOf(m).dreamteamer.env ?? []));
		const vars = new Set(MEMBERS.flatMap((m) => pkgOf(m).dreamteamer.vars ?? []));
		for (const k of CORE_011.env) assert.ok(env.has(k), `no member declares env ${k}`);
		for (const k of CORE_011.vars) assert.ok(vars.has(k), `no member declares var ${k}`);
	});
	test('the tarball ships exactly README.md, UPDATING.md, nav.yaml and package.json', () => {
		assert.deepEqual(packedFiles('core').sort(), ['README.md', 'UPDATING.md', 'nav.yaml', 'package.json']);
	});
	test('nav.yaml is the design\'s six folders, in order', () => {
		const doc = fs.readFileSync(path.join(ROOT, 'modules', 'core', 'nav.yaml'), 'utf8');
		assert.deepEqual([...doc.matchAll(/^ {2}- folder: (.+)$/gm)].map((m) => m[1]), ['Work', 'People', 'CRM', 'Meetings', 'Library', 'Activity']);
	});
});

describe('dt install @dreamteamer/core on the candidate', { skip: onCandidate }, () => {
	let root;
	test('installs the set: exit 0, all eighteen pinned, core 0.11\'s collections compiled, listed as a preset', () => {
		const from = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-core-')), 'core', ...MEMBERS);
		root = virginWorkspace();
		const env = { HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-HOME-')) };
		const r = run(root, ['install', '@dreamteamer/core', '--from', from, '--no-input'], env);
		assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-800)}`);
		// --from pins each package as the tarball it came from (`file:…/dreamteamer-<id>-<version>.tgz`); from
		// the registry the pin is the bare version. Either names the version, and node_modules holds it.
		const deps = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies;
		for (const m of ['core', ...MEMBERS]) {
			const v = pkgOf(m).version;
			const spec = deps[`@dreamteamer/${m}`];
			assert.ok(spec === v || spec?.endsWith(`/dreamteamer-${m}-${v}.tgz`), `@dreamteamer/${m} is pinned as ${spec}, not ${v}`);
			const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@dreamteamer', m, 'package.json'), 'utf8')).version;
			assert.equal(installed, v, `${m}: node_modules holds ${installed}`);
		}
		const compiled = fs.readdirSync(path.join(root, '.dreamteamer', 'collections')).filter((f) => f.endsWith('.collection.yaml')).map((f) => f.replace(/\.collection\.yaml$/, '')).sort();
		assert.deepEqual(compiled, COLLECTIONS_011);
		const listed = run(root, ['list', 'modules']);
		assert.equal(listed.status, 0, listed.stderr);
		assert.match(listed.stdout, /^core\s+preset · 17 members\b/m);
	});
	test('nav.yaml is written with core\'s six folders', { skip: 'engine nav merge lands in engine task 9; re-run in modules task 16' }, () => {
		assert.ok(root, 'the install case did not run');
		const doc = fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8');
		for (const f of ['Work', 'People', 'CRM', 'Meetings', 'Library', 'Activity']) assert.match(doc, new RegExp(`folder: ${f}\\b`));
	});
});
