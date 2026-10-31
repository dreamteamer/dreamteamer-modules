// A COMPOSED MODULE'S OWN EXTENSION ENTRY — compose.json `extension` names an entry the module authors beside an
// origin that is an extension. The entry must exist and must import the origin's entry: the module activates the
// origin itself, so an entry that forgot it would compose cleanly and ship a package whose origin verbs (rnd's
// `dt notebooklm`, core's `dt files`) are simply gone. The refusing branches are pinned here on scratch modules;
// the accepting one on the modules that use it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertOwnEntry, compose, composedModules, moduleRoot } from '../scripts/compose-core.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
/** A scratch module root holding the given files — never under modules/, so no other test sees it. */
function scratch(files) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-compose-'));
	made.push(root);
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), text);
	}
	return root;
}

describe('a module\'s own extension entry beside an origin\'s', () => {
	test('an entry that does not import the origin\'s entry is refused, naming the origin and the path it should import', () => {
		const root = scratch({ 'src/extension.js': 'export default () => ({});\n', 'lib/extension.mjs': "export default () => ({ check: () => [] });\n" });
		assert.throws(() => assertOwnEntry(root, 'northwind', './lib/extension.mjs', 'harbor', './src/extension.js'),
			/northwind's own extension \.\/lib\/extension\.mjs does not import harbor's entry \(\.\.\/src\/extension\.js\) — the origin's contributions would vanish/);
	});
	test('a missing entry is refused', () => {
		const root = scratch({ 'src/extension.js': 'export default () => ({});\n' });
		assert.throws(() => assertOwnEntry(root, 'northwind', './lib/extension.mjs', 'harbor', './src/extension.js'), /northwind names its own extension \.\/lib\/extension\.mjs, which does not exist/);
	});
	test('an entry that imports it — from lib/ or beside it in src/, either quote — is accepted, and the import path returned', () => {
		const lib = scratch({ 'src/extension.js': '', 'lib/extension.mjs': "import activate from '../src/extension.js';\n" });
		assert.equal(assertOwnEntry(lib, 'northwind', './lib/extension.mjs', 'harbor', './src/extension.js'), '../src/extension.js');
		const src = scratch({ 'src/extension.js': '', 'src/entry.js': 'import activate from "./extension.js";\n' });
		assert.equal(assertOwnEntry(src, 'northwind', './src/entry.js', 'harbor', './src/extension.js'), './extension.js');
	});
	test('compose() itself refuses it: a scratch rnd-shaped module whose own entry forgets notebooklm\'s', () => {
		const rnd = moduleRoot('rnd');
		const spec = JSON.parse(fs.readFileSync(path.join(rnd, 'compose.json'), 'utf8'));
		const root = scratch({
			'compose.json': JSON.stringify({ origins: spec.origins, extension: './lib/extension.mjs', files: {} }),
			'package.json': fs.readFileSync(path.join(rnd, 'package.json'), 'utf8'),
			'lib/extension.mjs': 'export default () => ({ check: () => [] });\n',
		});
		assert.throws(() => compose('rnd', root), /rnd's own extension \.\/lib\/extension\.mjs does not import notebooklm's entry \(\.\.\/src\/extension\.js\)/);
		fs.writeFileSync(path.join(root, 'lib/extension.mjs'), "import activate from '../src/extension.js';\nexport default activate;\n");
		assert.equal(compose('rnd', root).manifest.dreamteamer.extension, './lib/extension.mjs');
	});
	test('every composed module that names its own entry composes, and its manifest names that entry', () => {
		const owning = composedModules().filter((m) => JSON.parse(fs.readFileSync(path.join(moduleRoot(m), 'compose.json'), 'utf8')).extension);
		assert.ok(owning.includes('rnd'), 'rnd names its own entry (lib/extension.mjs, the release check)');
		for (const m of owning) {
			const { spec, manifest } = compose(m);
			assert.equal(manifest.dreamteamer.extension, spec.extension, m);
		}
	});
});
