// MODULE-OWNED SETUP, ACROSS THE REPO. The provider helpers are one file carried by each module that
// writes during setup (a module never imports another module's code), so every copy must be the same
// bytes — a fix to confinement or the stale-write check that reaches one copy and not another is a
// hole in exactly one module. And a module that ships a setup provider ships the SETUP.md that tells
// an agent how to use it — a composition included, whose root SETUP.md compose generates from its
// origins' references — and every script that reference names exists in that module.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');
const ids = fs.readdirSync(MODULES).filter((m) => fs.existsSync(path.join(MODULES, m, 'package.json')));
const kits = ids.map((m) => path.join(MODULES, m, 'lib', 'setup-kit.mjs')).filter((f) => fs.existsSync(f));

test('the setup helpers exist in more than one module (the comparison is not vacuous)', () => {
	assert.ok(kits.length >= 2, kits.join(', '));
});

test('every copy of lib/setup-kit.mjs is byte-identical', () => {
	const [first, ...rest] = kits;
	for (const f of rest) assert.ok(fs.readFileSync(f).equals(fs.readFileSync(first)), `${path.relative(ROOT, f)} differs from ${path.relative(ROOT, first)}`);
});

test('a module with a setup provider ships SETUP.md in its files — a composed one too, generated from its origins', () => {
	let seen = 0;
	for (const m of ids) {
		const lib = path.join(MODULES, m, 'lib');
		const providers = fs.existsSync(lib) ? fs.readdirSync(lib).filter((f) => /-setup\.mjs$/.test(f) && /export const SETUP_PROVIDER/.test(fs.readFileSync(path.join(lib, f), 'utf8'))) : [];
		if (!providers.length) continue;
		seen++;
		const pkg = JSON.parse(fs.readFileSync(path.join(MODULES, m, 'package.json'), 'utf8'));
		assert.ok(fs.existsSync(path.join(MODULES, m, 'SETUP.md')), `${m} has ${providers.join(', ')} but no SETUP.md`);
		assert.ok(pkg.files.includes('SETUP.md'), `${m}: SETUP.md is not in files — npm would leave it out`);
		// every script a reference tells an agent to run is a file this module ships
		for (const [, script] of fs.readFileSync(path.join(MODULES, m, 'SETUP.md'), 'utf8').matchAll(/node node_modules\/@dreamteamer\/[\w-]+\/(bin\/[\w.-]+\.mjs)/g)) {
			assert.ok(fs.existsSync(path.join(MODULES, m, script)), `${m}/SETUP.md names ${script}, which ${m} does not ship`);
		}
	}
	assert.ok(seen >= 3, `expected google-workspace, meetings and core, saw ${seen}`);
});
