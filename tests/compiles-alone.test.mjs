// EACH MODULE COMPILES ALONE — with only the modules it declares as dependencies, on both channels.
//
// This is the boundary test. "It compiles beside the others" was once mistaken for "it compiles", and
// a whole extraction shipped uncompilable in a bare workspace. A module here is installed into a fresh
// `dreamteamer init` workspace together with its declared dependency closure and nothing else, from
// its packed tarball (what npm delivers) and as a copied folder (what an eject or an inline copy is).
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { moduleIds, closure, pkgOf, virginWorkspace, CHANNELS, compileAndCheck, run, installPacked, cleanup, engineMeets, ENGINE_VERSION } from './helpers/workspace.mjs';

after(cleanup);
const modules = moduleIds();

for (const [channel, install] of Object.entries(CHANNELS)) {
	describe(`each module compiles alone — ${channel}`, () => {
		for (const m of modules) {
			const deps = [...closure(m)].filter((x) => x !== m);
			// A module whose floor is above the engine under test is not run and not passed: the skip says
			// so, and the test below asserts the engine REFUSES it rather than loading half of it.
			const skip = [...closure(m)].some((x) => !engineMeets(x)) && `needs engine ${pkgOf(m).dreamteamer.engine}; testing ${ENGINE_VERSION}`;
			test(`${m} (+ ${deps.join(', ') || 'nothing'})`, { skip }, () => {
				const root = virginWorkspace();
				install(root, [...closure(m)]);
				compileAndCheck(root);
			});
		}
	});
}

test('a module installed WITHOUT a hard dependency is refused, naming the missing module', () => {
	const m = modules.find((x) => (pkgOf(x).dreamteamer.dependencies ?? []).length);
	assert.ok(m, 'no module declares a dependency — nothing to prove');
	const root = virginWorkspace();
	installPacked(root, [m]);
	const compiled = run(root, ['compile']);
	assert.notEqual(compiled.status, 0, 'compiled without its dependency');
	assert.match(compiled.stderr + compiled.stdout, new RegExp(`depends on "${pkgOf(m).dreamteamer.dependencies[0]}", which is not installed`));
});

test('a module whose engine floor is above the running engine is refused at compile, by its floor', (t) => {
	const m = modules.find((x) => !engineMeets(x));
	if (!m) return t.skip(`every module accepts engine ${ENGINE_VERSION}`);
	const root = virginWorkspace();
	installPacked(root, [...closure(m)]);
	const compiled = run(root, ['compile']);
	assert.notEqual(compiled.status, 0, `${m} compiled on engine ${ENGINE_VERSION} below its floor ${pkgOf(m).dreamteamer.engine}`);
	assert.match(compiled.stderr + compiled.stdout, new RegExp(pkgOf(m).dreamteamer.engine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
