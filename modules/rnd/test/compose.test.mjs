// THE DRIFT GATE FOR RND — rnd is an AUTHORED module that composes `wikis` and `notebooklm` into
// itself, so a workspace installing core + rnd gets the wikis, the notebooks and the `dt notebooklm`
// verbs from one line. The composition is only honest while every copy equals its origin under the
// one declared rewrite, and while rnd's own sources (collections/rnd/, commands/rnd/, the stage
// skills, the agents) stay rnd's. These tests recompute the copies from the origins and compare them
// to what modules/rnd holds — the same gate core has, on a module that also authors.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, moduleRoot, compose, copiesOf, rewrite, filesEntry, main } from '../../../scripts/compose-core.mjs';

const RND = moduleRoot('rnd');
const spec = JSON.parse(fs.readFileSync(path.join(RND, 'compose.json'), 'utf8'));
const pkg = () => JSON.parse(fs.readFileSync(path.join(RND, 'package.json'), 'utf8'));
const originPkg = (o) => JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', o, 'package.json'), 'utf8'));
const walk = (dir, out = [], base = dir) => {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, out, base); else out.push(path.relative(base, p).split(path.sep).join('/'));
	}
	return out;
};

describe('what rnd is composed from', () => {
	test('wikis and notebooklm, in that order, and nothing else', () => {
		assert.deepEqual(spec.origins, ['wikis', 'notebooklm']);
	});
	test('the rewrite names rnd, not core: the origin package, and a path into its bin', () => {
		assert.equal(rewrite('npm install @dreamteamer/wikis', 'wikis', 'rnd'), 'npm install @dreamteamer/rnd');
		assert.equal(rewrite('node node_modules/@dreamteamer/notebooklm/bin/notebook.mjs', 'notebooklm', 'rnd'), 'node node_modules/@dreamteamer/rnd/bin/notebooklm-notebook.mjs');
		assert.equal(rewrite('node modules/wikis/bin/wiki.mjs', 'wikis', 'rnd'), 'node modules/rnd/bin/wikis-wiki.mjs');
	});
	test('and touches nothing else — a bare verb, another package, a longer name', () => {
		assert.equal(rewrite('`npx dt-wiki ask` reads @dreamteamer/companies', 'wikis', 'rnd'), '`npx dt-wiki ask` reads @dreamteamer/companies');
		assert.equal(rewrite('@dreamteamer/wikis-extra', 'wikis', 'rnd'), '@dreamteamer/wikis-extra');
	});
});

describe('the composition', () => {
	const { copies, manifest, owned } = compose('rnd');
	test('every copy in rnd equals its origin under the rewrite, and nothing listed is stale', () => {
		const problems = [];
		for (const [dest, { from, bytes }] of copies) {
			const at = path.join(RND, dest);
			if (!fs.existsSync(at)) problems.push(`missing ${dest} (from ${from})`);
			else if (!fs.readFileSync(at).equals(bytes)) problems.push(`drifted ${dest} (from ${from})`);
		}
		for (const dest of Object.keys(spec.files)) if (!copies.has(dest)) problems.push(`stale ${dest}`);
		assert.deepEqual(problems, [], `run node scripts/compose-core.mjs rnd:\n  ${problems.join('\n  ')}`);
	});
	test('compose.json lists every copy with its hash, and package.json is the merged manifest', () => {
		assert.deepEqual(spec.files, filesEntry(copies));
		assert.deepEqual(pkg(), manifest);
	});
	test('every shipped file of both origins is listed — a new file in wikis or notebooklm reaches rnd', () => {
		for (const origin of spec.origins) for (const c of copiesOf(origin, 'rnd')) assert.ok(spec.files[c.dest], `${origin}/${c.rel} is not composed`);
	});
	test('a copy lands by the same rules as core: a collection under its origin, a script prefixed, the rest at its path', () => {
		assert.ok(spec.files['collections/wikis/wikis.collection.yaml'], 'the wikis base');
		assert.ok(spec.files['collections/notebooklm/notebooks.collection.yaml'], 'the notebooks base');
		assert.ok(spec.files['collections/notebooklm/wikis.collection.yaml'], 'the overlay notebooklm puts on wikis keeps its own folder');
		assert.equal(spec.files['bin/wikis-wiki.mjs'].from, 'wikis/bin/wiki.mjs');
		assert.equal(spec.files['bin/notebooklm-notebook.mjs'].from, 'notebooklm/bin/notebook.mjs');
		for (const f of ['src/extension.js', 'src/export.js', 'lib/wiki.mjs', 'skills/working-with-wikis/SKILL.md', 'skills/using-notebooklm/SKILL.md', 'commands/restore-notebook.command.md', 'command-bindings/capture-notebook-sources--notebooks.command-binding.yaml']) {
			assert.ok(spec.files[f], `${f} keeps its path`);
		}
	});
	test('the one helper both origins ship lands once, because the bytes are identical — a differing collision fails the run', () => {
		const a = fs.readFileSync(path.join(ROOT, 'modules', 'wikis', 'lib', 'workspace-root.mjs'));
		const b = fs.readFileSync(path.join(ROOT, 'modules', 'notebooklm', 'lib', 'workspace-root.mjs'));
		assert.ok(a.equals(b), 'wikis and notebooklm carry the same workspace-root.mjs — one copy per module, byte for byte');
		assert.equal(spec.files['lib/workspace-root.mjs'].from, 'wikis/lib/workspace-root.mjs', 'the first origin is the recorded source');
		assert.equal(Object.values(spec.files).filter((f) => f.from.endsWith('lib/workspace-root.mjs')).length, 1);
	});
	test('the composed notebooklm commands keep their own ids beside the /rnd:… family', () => {
		assert.ok(fs.existsSync(path.join(RND, 'commands', 'restore-notebook.command.md')));
		assert.ok(fs.existsSync(path.join(RND, 'commands', 'capture-notebook-sources.command.md')));
		assert.ok(fs.existsSync(path.join(RND, 'commands', 'rnd', 'design.command.md')), 'the authored family is untouched');
		assert.ok(!Object.keys(spec.files).some((d) => d.startsWith('commands/rnd/')), 'no copy lands in commands/rnd/');
	});
	test('rnd\'s own sources are not copies: every authored descriptor sits under collections/rnd/ and names its namespace', () => {
		const listed = new Set(Object.keys(spec.files));
		for (const dest of listed) assert.ok(!/^(collections\/rnd\/|commands\/rnd\/|skills\/rnd-|skills\/building-from-references|skills\/recording-reviews|agents\/)/.test(dest), `${dest} is authored, not composed`);
		const authored = walk(path.join(RND, 'collections')).filter((f) => f.endsWith('.collection.yaml') && !listed.has(`collections/${f}`));
		assert.ok(authored.length >= 20, `expected rnd's own descriptors, saw ${authored.length}`);
		for (const f of authored) {
			assert.ok(f.startsWith('rnd/'), `${f} is authored outside collections/rnd/`);
			assert.match(yaml.load(fs.readFileSync(path.join(RND, 'collections', f), 'utf8')).name, /^rnd\//);
		}
	});
	test('the manifest keeps what rnd authors: name, title, namespaces, the engine floor, its description under the voice limit', () => {
		assert.equal(manifest.name, '@dreamteamer/rnd');
		assert.equal(manifest.dreamteamer.title, 'R&D');
		assert.deepEqual(manifest.dreamteamer.namespaces, ['rnd']);
		// the floor is rnd's own (>=0.38.0 as committed): composition never moves it, because no origin's floor is above it
		assert.equal(manifest.dreamteamer.engine, pkg().dreamteamer.engine, 'the merged floor is the authored one');
		const at = (r) => r.replace(/^>=/, '').split('.').map(Number);
		const below = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return true; };
		for (const o of spec.origins) assert.ok(below(at(originPkg(o).dreamteamer.engine), at(manifest.dreamteamer.engine)), `${o}'s floor ${originPkg(o).dreamteamer.engine} is above rnd's ${manifest.dreamteamer.engine} — composition would raise it`);
		assert.ok(manifest.dreamteamer.description.length <= 400, `${manifest.dreamteamer.description.length} characters`);
		assert.match(manifest.dreamteamer.description, /`wikis`/);
		assert.match(manifest.dreamteamer.description, /`notebooks`/);
		assert.match(manifest.dreamteamer.description, /`products`/);
		assert.ok(manifest.description.length <= 160);
	});
	test('and adds what the origins bring: the extension and its src/, js-yaml, the two npm bins, env, vars', () => {
		// 0.6.0: rnd's own entry, outside src/, wraps the composed notebooklm entry and adds the release check
		assert.equal(manifest.dreamteamer.extension, './lib/extension.mjs');
		const origin = originPkg('notebooklm').dreamteamer.extension;
		assert.ok(origin.startsWith('./src/'), 'the origin\'s entry is the composed src/extension.js');
		assert.ok(fs.existsSync(path.join(RND, origin)), 'the origin\'s entry still lands in src/');
		assert.match(fs.readFileSync(path.join(RND, 'lib', 'extension.mjs'), 'utf8'), new RegExp(`from '\\.\\.${origin.slice(1).replace(/\./g, '\\.')}'`), 'the wrapper imports the origin\'s entry');
		assert.ok(!originPkg('wikis').dreamteamer.extension, 'exactly one origin is an extension');
		for (const k of ['bin', 'src', 'lib', 'collections', 'skills', 'commands', 'command-bindings', 'agents', 'compose.json']) assert.ok(manifest.files.includes(k), `files lacks ${k}`);
		assert.deepEqual(manifest.bin, { 'dt-wiki': 'bin/wikis-wiki.mjs', 'dt-notebook': 'bin/notebooklm-notebook.mjs', 'dt-prototype': 'bin/dt-prototype.mjs' });
		for (const target of Object.values(manifest.bin)) assert.ok(fs.existsSync(path.join(RND, target)), `${target} is not shipped`);
		assert.deepEqual(Object.keys(manifest.dependencies), ['js-yaml'], 'the one npm package both origins import');
		const dts = spec.origins.map((o) => originPkg(o).dreamteamer);
		const union = (k) => [...new Set(dts.flatMap((d) => d[k] ?? []))].sort();
		assert.deepEqual(manifest.dreamteamer.env ?? [], union('env'));
		assert.deepEqual(manifest.dreamteamer.vars ?? [], union('vars'));
		assert.deepEqual(manifest.dreamteamer.dependencies ?? [], [], 'every origin dependency is internal');
	});
	test('rnd now owns wikis and notebooks, so neither is a peer; its own peers stay, minus nothing it owns', () => {
		for (const t of ['wikis', 'notebooks', 'rnd/products', 'rnd/design-docs', 'rnd/reviews']) assert.ok(owned.has(t), `rnd does not own ${t}`);
		assert.deepEqual(manifest.dreamteamer.peer_collections, ['assets', 'companies', 'projects', 'workflows']);
		for (const p of manifest.dreamteamer.peer_collections) assert.ok(!owned.has(p), `rnd peers ${p}, which it owns`);
		for (const o of spec.origins) for (const p of originPkg(o).dreamteamer.peer_collections ?? []) {
			assert.ok(owned.has(p) || manifest.dreamteamer.peer_collections.includes(p), `${o} peers ${p}, which rnd neither owns nor peers`);
		}
	});
	test('--check exits 0 on the committed state', () => {
		const log = console.log; console.log = () => {};
		try { assert.equal(main(['rnd', '--check']), 0); } finally { console.log = log; }
	});
});
