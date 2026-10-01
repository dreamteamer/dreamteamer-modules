// EACH MODULE COMPILES ALONE — with only the modules it declares as dependencies, on both channels.
//
// This is the boundary test. "It compiles beside the others" was once mistaken for "it compiles", and
// a whole extraction shipped uncompilable in a bare workspace. A module here is installed into a fresh
// `dreamteamer init` workspace together with its declared dependency closure and nothing else, from
// its packed tarball (what npm delivers) and as a copied folder (what an eject or an inline copy is).
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { moduleIds, closure, pkgOf, virginWorkspace, CHANNELS, compileAndCheck, run, installPacked, cleanup } from './helpers/workspace.mjs';

after(cleanup);
const modules = moduleIds();

for (const [channel, install] of Object.entries(CHANNELS)) {
	describe(`each module compiles alone — ${channel}`, () => {
		for (const m of modules) {
			const deps = [...closure(m)].filter((x) => x !== m);
			test(`${m} (+ ${deps.join(', ') || 'nothing'})`, () => {
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
