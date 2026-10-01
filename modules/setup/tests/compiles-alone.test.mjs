// THE RECIPES GATE, as a test: each module, copied alone into a virgin `dreamteamer init` workspace
// together with the modules it DECLARES as dependencies (and nothing else), compiles and checks
// clean on the engine this package pins. "It compiles here" was once mistaken for "it compiles";
// this is the difference, run on every `npm test`.
//
// The workspace itself is `tests/helpers/virgin-workspace.mjs`, shared with the migration test —
// read the warning at the top of that file before writing any test that does not use it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES, virginWorkspace, installModules, closure, pkgOf, run } from './helpers/virgin-workspace.mjs';

const modules = fs.readdirSync(MODULES).filter((m) => fs.statSync(path.join(MODULES, m)).isDirectory()).sort();

const made = [];
after(() => { for (const r of made) fs.rmSync(r, { recursive: true, force: true }); });

describe('each module compiles alone, with only its declared dependencies', () => {
	for (const m of modules) {
		test(`${m} (+ ${[...closure(m)].filter((x) => x !== m).join(', ') || 'nothing'})`, () => {
			const root = virginWorkspace(); made.push(root);
			installModules(root, closure(m));
			const compiled = run(root, ['compile']);
			assert.equal(compiled.status, 0, `compile failed:\n${compiled.stderr}\n${compiled.stdout}`);
			const hard = compiled.stderr.split('\n').filter((l) => l.startsWith('✖') || /error/i.test(l));
			assert.deepEqual(hard, [], compiled.stderr);
			const checked = run(root, ['check']);
			assert.equal(checked.status, 0, `check failed:\n${checked.stderr}\n${checked.stdout}`);
			assert.match(checked.stdout + checked.stderr, /0 violations/);
		});
	}

	test('a module copied WITHOUT a hard dependency is refused, naming the missing module (the boundary is real, not decorative)', () => {
		const m = modules.find((x) => (pkgOf(x).dreamteamer.dependencies ?? []).length);
		assert.ok(m, 'no module declares a dependency — nothing to prove');
		const root = virginWorkspace(); made.push(root);
		installModules(root, [m]);
		const compiled = run(root, ['compile']);
		assert.notEqual(compiled.status, 0, 'compiled without its dependency');
		assert.match(compiled.stderr + compiled.stdout, new RegExp(`depends on "${pkgOf(m).dreamteamer.dependencies[0]}", which is not installed`));
	});
});
