// EVERY workspace-root resolver in this module skips a folder sitting directly inside `git_modules/`.
//
// The rule ("walk up to package-lock.json, not package.json — a module folder carries the latter
// too") has one hole: `npm install` inside a module CLONE leaves a lockfile there, and a reader that
// stops at it resolves the clone as the workspace and writes records into a folder the next `git pull`
// destroys. It happened for real on 2026-09-08 (53 records). `vault-root.test.mjs` pins the shared
// perspective resolver behaviourally; this test pins the SHAPE across every script that carries its
// own copy — a resolver added later without the skip fails here, by name.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function* walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (/\.(mjs|js)$/.test(e.name)) yield p;
	}
}

const resolvers = [...walk(ROOT)]
	// tests are not resolvers a workspace runs: the repo's tests/ and every module's own test/ folder
	.filter((f) => !f.includes(`${path.sep}tests${path.sep}`) && !f.includes(`${path.sep}test${path.sep}`))
	// the RESOLVER shape — an existence test on the lockfile — not any mention of the filename. A CLI
	// that says "the folder with package.json and package-lock.json" in an error message is not walking
	// anywhere, and pinning prose would make this test fire on documentation.
	.filter((f) => /existsSync\([^\n]*package-lock\.json/.test(fs.readFileSync(f, 'utf8')));

test('the module has workspace-root resolvers to pin (the scan is not vacuous)', () => {
	assert.ok(resolvers.length >= 5, `expected at least the five known resolvers, found ${resolvers.length}: ${resolvers.map((f) => path.relative(ROOT, f)).join(', ')}`);
});

for (const f of resolvers) {
	test(`${path.relative(ROOT, f)} skips a candidate directly inside git_modules/`, () => {
		const src = fs.readFileSync(f, 'utf8');
		assert.match(src, /git_modules/, 'walks to package-lock.json but never mentions git_modules — a clone with a lockfile would be taken for the workspace');
	});
}
