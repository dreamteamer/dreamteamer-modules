// THE DRIFT GATE — core is a composition, and a composition is only honest while every copy equals
// its origin under the one declared rewrite. These tests recompute the copies from the origins and
// compare them to what modules/core holds, so a descriptor edited in its small module and not
// re-composed, or edited in core by hand, fails here before it ships. The script is shared with rnd
// (which composes wikis and notebooklm into an authored module), so every call here names core.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CORE, compose, copiesOf, rewrite, destOf, filesEntry, assertOwnEntry } from '../../../scripts/compose-core.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(CORE, 'compose.json'), 'utf8'));

describe('the rewrite', () => {
	test('renames the origin package to core, and a path into its bin to the prefixed script', () => {
		assert.equal(rewrite('npm install @dreamteamer/users', 'users'), 'npm install @dreamteamer/core');
		assert.equal(rewrite('node node_modules/@dreamteamer/users/bin/check-records.mjs', 'users'), 'node node_modules/@dreamteamer/core/bin/users-check-records.mjs');
		assert.equal(rewrite('node modules/projects/bin/check-records.mjs', 'projects'), 'node modules/core/bin/projects-check-records.mjs');
	});
	test('touches nothing else — another module\'s name, or a bare word', () => {
		assert.equal(rewrite('@dreamteamer/companies and users', 'users'), '@dreamteamer/companies and users');
		assert.equal(rewrite('@dreamteamer/users-x', 'users'), '@dreamteamer/users-x');
	});
	test('a collection lands in its origin\'s folder, a bin script takes the origin as prefix, the rest keeps its path', () => {
		assert.equal(destOf('contacts', 'collections/companies.collection.yaml'), 'collections/contacts/companies.collection.yaml');
		assert.equal(destOf('users', 'bin/check-records.mjs'), 'bin/users-check-records.mjs');
		assert.equal(destOf('meetings', 'skills/fetching-meetings/SKILL.md'), 'skills/fetching-meetings/SKILL.md');
	});
});

describe('the composition', () => {
	const { copies, manifest, owned } = compose('core');
	test('every copy in core equals its origin under the rewrite, and nothing listed is stale', () => {
		const problems = [];
		for (const [dest, { from, bytes }] of copies) {
			const at = path.join(CORE, dest);
			if (!fs.existsSync(at)) problems.push(`missing ${dest} (from ${from})`);
			else if (!fs.readFileSync(at).equals(bytes)) problems.push(`drifted ${dest} (from ${from})`);
		}
		for (const dest of Object.keys(spec.files)) if (!copies.has(dest)) problems.push(`stale ${dest}`);
		assert.deepEqual(problems, [], `run node scripts/compose-core.mjs:\n  ${problems.join('\n  ')}`);
	});
	test('compose.json lists every copy with its hash, and package.json is the merged manifest', () => {
		assert.deepEqual(spec.files, filesEntry(copies));
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')), manifest);
	});
	test('every shipped file of every origin is listed — a new file in an origin reaches core', () => {
		for (const origin of spec.origins) for (const c of copiesOf(origin, 'core')) assert.ok(spec.files[c.dest], `${origin}/${c.rel} is not composed`);
	});
	test('no two origins land on one path — unless the bytes are identical, which is the shared workspace-root helper', () => {
		const seen = new Map();
		for (const origin of spec.origins) for (const c of copiesOf(origin, 'core')) {
			assert.ok(!seen.has(c.dest) || seen.get(c.dest).bytes.equals(c.bytes), `${c.dest}: ${seen.get(c.dest)?.origin} and ${origin}`);
			if (!seen.has(c.dest)) seen.set(c.dest, { origin, bytes: c.bytes });
		}
	});
	test('the manifest is the union of the origins and compose.json: env, vars, the extension, the highest engine floor; peers minus what core owns', () => {
		const dts = spec.origins.map((o) => JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', o, 'package.json'), 'utf8')).dreamteamer);
		const union = (k) => [...new Set([...(spec[k] ?? []), ...dts.flatMap((d) => d[k] ?? [])])].sort();
		assert.deepEqual(manifest.dreamteamer.env, union('env'));
		assert.deepEqual(manifest.dreamteamer.vars ?? [], union('vars'));
		assert.equal(manifest.dreamteamer.extension, spec.extension ?? dts.find((d) => d.extension).extension);
		for (const d of dts) assert.ok(d.engine.replace(/^>=/, '') <= manifest.dreamteamer.engine.replace(/^>=/, ''), `floor ${d.engine} above core's ${manifest.dreamteamer.engine}`);
		for (const p of manifest.dreamteamer.peer_collections ?? []) assert.ok(!owned.has(p), `core peers ${p}, which it owns`);
		for (const p of union('peer_collections')) assert.ok(owned.has(p) || manifest.dreamteamer.peer_collections.includes(p), `${p} is neither owned nor peered`);
		assert.deepEqual(manifest.dreamteamer.dependencies ?? [], [], 'every origin dependency is internal');
		for (const t of ['users', 'companies', 'contacts', 'engagements', 'tasks', 'projects', 'decisions', 'meetings', 'meeting-recordings', 'meeting-summaries', 'files', 'file-drives', 'assets']) assert.ok(owned.has(t), `core does not own ${t}`);
	});
	test("compose.json's own vars reach the manifest — SESSIONS_FOLDER, which no origin declares", () => {
		assert.ok(spec.vars.includes('SESSIONS_FOLDER'));
		assert.ok(manifest.dreamteamer.vars.includes('SESSIONS_FOLDER'));
		for (const o of spec.origins) assert.ok(!(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', o, 'package.json'), 'utf8')).dreamteamer.vars ?? []).includes('SESSIONS_FOLDER'), `${o} declares SESSIONS_FOLDER already`);
	});
	test("compose.json's own engine floor raises the manifest's above the origins' — core's env-pointed sessions root needs it", () => {
		assert.ok(spec.engine, 'compose.json declares an engine floor of its own');
		assert.equal(manifest.dreamteamer.engine, spec.engine);
		const dts = spec.origins.map((o) => JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', o, 'package.json'), 'utf8')).dreamteamer);
		for (const d of dts) assert.notEqual(d.engine, spec.engine, `${spec.engine} is an origin's floor already — core's own would be redundant`);
	});
	test("compose.json's own extension entry is the manifest's, it is no copy, and the origin's entry still ships beside it", () => {
		assert.equal(spec.extension, './src/entry.js');
		assert.equal(manifest.dreamteamer.extension, './src/entry.js');
		assert.ok(!copies.has('src/entry.js'), 'the own entry must not be an origin\'s copy');
		assert.ok(fs.existsSync(path.join(CORE, 'src', 'entry.js')), 'the own entry is authored in core');
		assert.ok(copies.has('src/extension.js'), "files' entry is still composed in, for the own entry to activate");
		const entry = fs.readFileSync(path.join(CORE, 'src', 'entry.js'), 'utf8');
		assert.match(entry, /from '\.\/extension\.js'/, "the own entry activates the origin's");
		// the one rule every composed module's own entry meets (scripts/compose-core.mjs assertOwnEntry)
		assert.equal(assertOwnEntry(CORE, 'core', spec.extension, 'files', './src/extension.js'), './extension.js');
	});
	test('--check exits 0 on the committed state', async () => {
		const { main } = await import('../../../scripts/compose-core.mjs');
		const log = console.log; console.log = () => {};
		try { assert.equal(main(['core', '--check']), 0); } finally { console.log = log; }
	});
});
