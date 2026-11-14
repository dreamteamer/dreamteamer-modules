// RND STANDS ALONE (cr-dt-008, task 5; rnd/tests dreamteamer-modules/rnd-alone).
//
// Through 0.10 rnd carried copies of wikis and notebooklm (compose.json, provides). From 0.11.0 it ships only
// what it authors: installed with its own closure it compiles and checks with no `notebooks` and no `wikis`
// collection, and a workspace that holds notebooks and wikis records keeps them valid by installing those two
// modules beside it (acceptance line 5's testable reading: no rnd field points at either).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHANNELS, closure, pkgOf, packedFiles, virginWorkspace, compileAndCheck, compiledDescriptor, cleanup, engineMeets, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const skip = [...closure('rnd'), 'notebooklm', 'wikis'].some((m) => !engineMeets(m)) && `rnd needs engine ${pkgOf('rnd').dreamteamer.engine}; testing ${ENGINE_VERSION}`;

/** A synthetic notebook and wiki, the records a workspace on rnd 0.10 may already hold. */
function seed(root) {
	fs.mkdirSync(path.join(root, 'data', 'notebooks'), { recursive: true });
	fs.writeFileSync(path.join(root, 'data', 'notebooks', 'northwind-research.notebook.md'), '---\nname: Northwind research\n---\nThe corpus Dana Oren reads before a Northwind call.\n');
	fs.mkdirSync(path.join(root, 'data', 'wikis'), { recursive: true });
	fs.writeFileSync(path.join(root, 'data', 'wikis', 'northwind-handbook.wiki.md'), '---\nname: Northwind handbook\nfolder: wikis/northwind-handbook\n---\n');
	fs.mkdirSync(path.join(root, 'wikis', 'northwind-handbook'), { recursive: true });
	fs.writeFileSync(path.join(root, 'wikis', 'northwind-handbook', 'index.md'), '# Northwind handbook\n');
}

describe('the package', () => {
	test('ships no compose.json, SETUP.md or src/, and declares no provides', () => {
		const files = packedFiles('rnd');
		for (const f of ['compose.json', 'SETUP.md']) assert.ok(!files.includes(f), `the tarball ships ${f}`);
		assert.deepEqual(files.filter((f) => f.startsWith('src/')), [], 'the tarball ships src/');
		assert.ok(!('provides' in pkgOf('rnd').dreamteamer), 'rnd still declares provides');
		assert.deepEqual(Object.keys(pkgOf('rnd').bin ?? {}), ['dt-prototype'], 'only rnd\'s own bin');
	});
});

for (const [channel, install] of Object.entries(CHANNELS)) {
	describe(`rnd alone — ${channel}`, { skip }, () => {
		test('its closure compiles and checks, with no notebooks and no wikis collection', () => {
			const root = virginWorkspace();
			assert.deepEqual([...closure('rnd')], ['rnd']);
			install(root, [...closure('rnd')]);
			compileAndCheck(root);
			assert.ok(compiledDescriptor(root, 'rnd/change-requests'), 'rnd did not compile into the workspace');
			for (const c of ['notebooks', 'wikis']) assert.equal(compiledDescriptor(root, c), null, `${c} compiled without its module`);
		});
		test('beside notebooklm and wikis it compiles, and a workspace\'s notebooks and wikis records check clean', () => {
			const root = virginWorkspace();
			install(root, [...new Set([...closure('rnd'), ...closure('notebooklm'), ...closure('wikis')])]);
			seed(root);
			const { checked } = compileAndCheck(root);
			assert.ok(compiledDescriptor(root, 'notebooks') && compiledDescriptor(root, 'wikis'));
			assert.doesNotMatch(checked.stdout + checked.stderr, /no collection/i);
		});
	});
}
