// EVERY MODULE IS AN NPM PACKAGE WITH ONE SHAPE — the manifest is the module's public promise.
//
// Checked here rather than discovered at publish time: a package that ships without a folder it needs,
// or with a name that disagrees with its folder, fails in a stranger's install with nothing pointing
// back at this repo.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES, moduleIds, pkgOf, packedFiles, folderOf, cleanup } from './helpers/workspace.mjs';

after(cleanup);
const KINDS = ['collections', 'collection-templates', 'skills', 'commands', 'command-bindings', 'ui-views', 'agents'];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

test('the repo carries every module it is meant to', () => {
	assert.deepEqual(moduleIds(), ['assets', 'contacts', 'docker-workspaces', 'http', 'meetings', 'notebooklm', 'notebooks', 'perspective', 'projects', 'proofs', 'recordings', 'rnd', 'search', 'setup', 'tasks', 'users', 'worktrees']);
});

for (const m of moduleIds()) {
	describe(`@dreamteamer/${m}`, () => {
		const pkg = pkgOf(m);
		const dt = pkg.dreamteamer ?? {};
		test('is named for its folder, under the official scope, and publishable', () => {
			assert.equal(pkg.name, `@dreamteamer/${m}`);
			assert.ok(!pkg.private, 'private: true would stop npm publish');
			assert.match(pkg.version, SEMVER);
			assert.equal(pkg.license, 'Apache-2.0');
			assert.equal(pkg.repository?.directory, `modules/${m}`);
			assert.ok(pkg.keywords?.includes('dreamteamer-module'), 'the keyword is how a search finds a module');
		});
		test('an extension entry, when declared, is a file the tarball ships', () => {
			if (!dt.extension) return;
			assert.ok(packedFiles(m).includes(dt.extension.replace(/^\.\//, '')), `${dt.extension} is not in the tarball`);
		});
		test('says what it is twice — one npm line, one orienting paragraph', () => {
			assert.ok(pkg.description && pkg.description.length <= 160, 'npm description: one line');
			assert.ok(dt.title, 'dreamteamer.title');
			assert.ok(dt.description && dt.description.length > 80, 'dreamteamer.description orients every session — it is not optional');
		});
		test('declares the engine it is tested against', () => {
			assert.match(dt.engine ?? '', /^>=\d+\.\d+\.\d+$/);
		});
		test('spells every dependency as the full package name the engine keys modules by', () => {
			for (const d of dt.dependencies ?? []) {
				assert.match(d, /^@dreamteamer\//, `${d}: compile matches a dependency against the package NAME, so a bare id is "not installed"`);
				assert.ok(fs.existsSync(path.join(MODULES, folderOf(d), 'package.json')), `${d} is not a module in this repo`);
			}
		});
		test('`files` lists every folder the module carries, and the tarball ships them', () => {
			const present = [...KINDS, 'bin', 'src', 'lib'].filter((k) => fs.existsSync(path.join(MODULES, m, k)));
			for (const k of present) assert.ok(pkg.files.includes(k), `${k}/ exists but is not in files — npm would leave it out`);
			const shipped = new Set(packedFiles(m).map((f) => f.split('/')[0]));
			for (const k of [...present, 'README.md', 'package.json']) assert.ok(shipped.has(k), `the tarball does not ship ${k}`);
		});
		test('the tarball ships no tests, caches or virtualenvs', () => {
			const junk = packedFiles(m).filter((f) => /(^|\/)(tests?|__pycache__|\.venv|\.pytest_cache|node_modules)\//.test(f));
			assert.deepEqual(junk, []);
		});
	});
}

// The README is the npm page, and its install line is the one a stranger copies. The engine loads
// direct dependencies only, so that line must name the module AND its whole dependency closure — a
// README that drifts from the manifest installs a module that refuses to compile.
import { closure } from './helpers/workspace.mjs';
for (const m of moduleIds()) {
	test(`${m}: the README's install line names exactly the module and its dependency closure`, () => {
		const readme = fs.readFileSync(path.join(MODULES, m, 'README.md'), 'utf8');
		const line = readme.split('\n').find((l) => l.startsWith('npm install '));
		assert.ok(line, 'no `npm install` line');
		const named = line.replace('npm install ', '').trim().split(/\s+/).filter((w) => !w.startsWith('-')).sort();
		assert.deepEqual(named, [...closure(m)].map((x) => `@dreamteamer/${x}`).sort());
	});
}
