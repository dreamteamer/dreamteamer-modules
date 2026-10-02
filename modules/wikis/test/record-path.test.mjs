// `dt-wiki` finds a wikis or notebooks record from the workspace's COMPILED descriptors — no engine
// import, so the v2 compiled shape is read here by hand and pinned by these tests.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordPath } from '../bin/wiki.mjs';

// ── WHERE A RECORD LIVES, read from the v2 COMPILED descriptor ───────────────────────────────────
// compile records the resolved storage path under `compiled.defaults` and the parent of a
// `storage.under` as `compiled.under_collection`; the authored block carries only what the author
// wrote. A reader that looked for `storage.path` alone would miss a re-homed collection and every
// record placed in its owner's folder.
describe('recordPath — the compiled storage decides the file', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-placement-'));
	after(() => fs.rmSync(tmp, { recursive: true, force: true }));
	const compiled = (name, text) => {
		const f = path.join(tmp, '.dreamteamer', 'collections', `${name}.collection.yaml`);
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, text);
	};
	compiled('wikis', 'name: wikis\nstorage:\n  under:\n    parent: project\n    subfolder: wikis\ncompiled:\n  defaults:\n    storage: { path: data/elsewhere/wikis, format: md, shape: file, suffix: wiki }\n  runtime: false\n  under_collection: projects\n  fields: {}\n');
	compiled('projects', 'name: projects\nstorage: { shape: folder, entry: project.md }\ncompiled:\n  defaults:\n    storage: { path: data/projects, format: md, suffix: project }\n  runtime: false\n  fields: {}\n');

	test('a record nobody placed is in the re-homed own root', () => {
		assert.equal(recordPath(tmp, 'wikis', 'loose'), path.join(tmp, 'data', 'elsewhere', 'wikis', 'loose.wiki.md'));
	});
	test('a record placed under its owner is found in the owner folder', () => {
		const placed = path.join(tmp, 'data', 'projects', 'northwind', 'wikis', 'kickoff.wiki.md');
		fs.mkdirSync(path.dirname(placed), { recursive: true });
		fs.writeFileSync(placed, '---\nname: Kickoff\n---\n');
		assert.equal(recordPath(tmp, 'wikis', 'kickoff'), placed);
	});
});
