// HELD-OUT (cr-dt-008, rnd/tests dreamteamer-modules/heldout-dt008-m-core-over-existing-members).
//
// Installing the core preset on a workspace that already holds two of its members (tasks, contacts — and their
// closure users, companies, assets) at the preset's versions succeeds with no refusal and no duplicate, and keeps
// where the operator placed their rows. Variant: a member hand-moved to an older version is refused by name,
// "installed at <old>, not <pinned>", pointing at dt update, and package.json is left as it was.
// Written by the test stage from the record's steps and expected; the builder never read it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ROOT, pkgOf, moduleIds, packedInto, virginWorkspace, run, cleanup, engineMeets, ENGINE_VERSION } from '../helpers/workspace.mjs';

after(cleanup);
const SRC = path.join(ROOT, 'modules', 'protocol', 'src');
const { createHandler } = await import(pathToFileURL(path.join(SRC, 'handler.js')).href);

const PRESET = pkgOf('core').dreamteamer.preset;
const MEMBERS = Object.keys(PRESET).map((d) => d.replace(/^@dreamteamer\//, ''));
const skip = !engineMeets('core') && `a module preset installs on engine 0.49.0 or later; testing ${ENGINE_VERSION}`;
const HOME = () => ({ HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-HOME-')) });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// step 1 — every module of the candidate packed into one folder
let from;
const folder = () => (from ??= packedInto(tmp('dtm-hm1-'), ...moduleIds()));

const pkgText = (root) => fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const deps = (root) => JSON.parse(pkgText(root)).dependencies;
const versionIn = (root, m) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@dreamteamer', m, 'package.json'), 'utf8')).version;
const specVersion = (spec, m) => (spec?.match(new RegExp(`dreamteamer-${m}-(\\d+\\.\\d+\\.\\d+[^/]*)\\.tgz$`))?.[1]) ?? spec;
const collectionKeys = (nodes, out = []) => {
	for (const n of nodes ?? []) {
		if (n.kind === 'collection') out.push(n.key);
		if (n.children) collectionKeys(n.children, out);
	}
	return out;
};
async function getNav(root) {
	const h = await createHandler({ root, settings: () => ({}) });
	const res = await h.handle('GET', '/nav');
	assert.equal(res.status, 200, JSON.stringify(res.body));
	const ws = res.body.find((n) => n.kind === 'workspace') ?? res.body[0];
	return { h, ws, keys: collectionKeys((ws.children ?? []).filter((n) => n.kind !== 'layers')) };
}

/** Steps 2–4: a fresh workspace with tasks + contacts installed, one record in each, tasks moved into "Mine". */
async function prepared() {
	const root = virginWorkspace();
	const r = run(root, ['install', '@dreamteamer/tasks', '@dreamteamer/contacts', '--from', folder(), '--no-input'], HOME());
	assert.equal(r.status, 0, `step 2: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-800)}`);
	const a = run(root, ['add', 'tasks', '--name', 'Call the bank']);
	assert.equal(a.status, 0, a.stderr + a.stdout);
	const c = run(root, ['add', 'contacts', '--name', 'Dana Oren']);
	assert.equal(c.status, 0, c.stderr + c.stdout);
	const records = execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'data'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
		.concat(execFileSync('git', ['ls-files', 'data'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)).sort();
	assert.equal(records.filter((f) => /^data\/(tasks|contacts)\//.test(f)).length, 2, `records: ${records.join(', ')}`);
	const before = await getNav(root);
	const moved = await before.h.handle('PATCH', '/nav', { op: 'new-folder', label: 'Mine' });
	assert.equal(moved.status, 200, JSON.stringify(moved.body));
	const into = await before.h.handle('PATCH', '/nav', { op: 'move', target: { name: 'tasks' }, into: { folder: ['Mine'] } });
	assert.equal(into.status, 200, JSON.stringify(into.body));
	const doc = yaml.load(fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8'));
	assert.deepEqual(doc.tree.find((e) => e?.folder === 'Mine')?.items, ['tasks']);
	return { root, records: records.filter((f) => /^data\/(tasks|contacts)\//.test(f)), rowsBefore: before.keys };
}

describe('core over existing members', { skip }, () => {
	test('steps 1–6: install core over tasks + contacts: no refusal, no duplicate, the operator\'s placement kept', { timeout: 900_000 }, async () => {
		const { root, records, rowsBefore } = await prepared();
		const five = ['tasks', 'contacts', 'users', 'companies', 'assets'];
		const fiveBefore = Object.fromEntries(five.map((m) => [m, versionIn(root, m)]));
		for (const m of five) assert.equal(fiveBefore[m], PRESET[`@dreamteamer/${m}`], `step 2: ${m} is ${fiveBefore[m]}, core pins ${PRESET[`@dreamteamer/${m}`]}`);
		// step 5
		const r = run(root, ['install', '@dreamteamer/core', '--from', folder(), '--input', `files_folder=${tmp('dtm-files-')}`, '--no-input'], HOME());
		const out = `${r.stdout}\n${r.stderr}`;
		assert.ok(r.status === 0 || (r.status === 3 && /input/i.test(out)), `step 5: exit ${r.status} (0, or 3 for a named missing input)\n${out.slice(-2000)}`);
		assert.doesNotMatch(out, /already provides/);
		assert.doesNotMatch(out, /installed at \S+, not /);
		// step 6 — package.json: core + seventeen members, once each, exact preset versions
		const text = pkgText(root);
		const d = deps(root);
		for (const m of ['core', ...MEMBERS]) {
			const name = `@dreamteamer/${m}`;
			assert.equal(text.split(`"${name}"`).length - 1, 1, `${name} appears ${text.split(`"${name}"`).length - 1} times in package.json`);
			const want = m === 'core' ? pkgOf('core').version : PRESET[name];
			assert.equal(specVersion(d[name], m), want, `${name} pinned as ${d[name]}, not ${want}`);
			assert.equal(versionIn(root, m), want, `${m}: node_modules holds ${versionIn(root, m)}`);
		}
		for (const m of five) assert.equal(versionIn(root, m), fiveBefore[m], `${m} moved from ${fiveBefore[m]}`);
		const listed = run(root, ['list', 'modules']);
		assert.equal(listed.status, 0, listed.stderr);
		assert.match(listed.stdout, /^core\s+preset · 17 members · 17 installed\b/m, listed.stdout);
		const checked = run(root, ['check']);
		assert.equal(checked.status, 0, `dt check: exit ${checked.status}\n${checked.stdout}\n${checked.stderr}`);
		assert.match(checked.stdout + checked.stderr, /0 violations/);
		for (const f of records) assert.ok(fs.existsSync(path.join(root, f)), `record moved: ${f}`);
		// nav.yaml
		const doc = yaml.load(fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8'));
		const all = JSON.stringify(doc.tree);
		assert.deepEqual(doc.tree.find((e) => e?.folder === 'Mine')?.items, ['tasks'], `tasks left Mine: ${all}`);
		assert.equal(all.split('"tasks"').length - 1, 1, `tasks is named more than once: ${all}`);
		const work = doc.tree.find((e) => e?.folder === 'Work');
		assert.ok(work, `no Work folder: ${all}`);
		const coreWork = yaml.load(fs.readFileSync(path.join(ROOT, 'modules', 'core', 'nav.yaml'), 'utf8')).tree.find((e) => e.folder === 'Work').items;
		assert.deepEqual(work.items, coreWork.filter((c) => c !== 'tasks'), 'Work does not hold the other Work rows');
		assert.ok(doc.tree.find((e) => e?.folder === 'CRM')?.items.includes('contacts'), `contacts not in CRM: ${all}`);
		// GET /nav — step 3's rows plus what core added, none missing, none twice
		const after = await getNav(root);
		assert.equal(new Set(after.keys).size, after.keys.length, `a row drawn twice: ${after.keys.join(', ')}`);
		for (const k of rowsBefore) assert.ok(after.keys.includes(k), `row ${k} drawn in step 3 is missing`);
		const compiled = fs.readdirSync(path.join(root, '.dreamteamer', 'collections')).filter((f) => f.endsWith('.collection.yaml')).map((f) => f.replace(/\.collection\.yaml$/, ''));
		const coreOwned = new Set(MEMBERS.flatMap((m) => {
			const dir = path.join(ROOT, 'modules', m, 'collections');
			return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.collection.yaml')).map((f) => yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((x) => !x.overlay).map((x) => x.name) : [];
		}));
		// what core added: its members' own collections, and what its fragment places (agents — an engine kind the
		// fragment draws in People, acceptance line 8)
		for (const c of JSON.stringify(yaml.load(fs.readFileSync(path.join(ROOT, 'modules', 'core', 'nav.yaml'), 'utf8')).tree).match(/"[a-z][a-z0-9/-]*"/g).map((x) => x.slice(1, -1))) if (!['folder', 'items'].includes(c)) coreOwned.add(c);
		const added = [...coreOwned].filter((c) => compiled.includes(c) && !rowsBefore.includes(`c/${c}`)).map((c) => `c/${c}`);
		assert.deepEqual([...after.keys].sort(), [...new Set([...rowsBefore, ...added])].sort());
	});

	test('step 7: a member hand-moved to an older version is refused by name, and package.json stays as it was', { timeout: 900_000 }, async () => {
		// a second, older version of tasks in the folder: the candidate's tasks repacked one version below the pin
		const pin = PRESET['@dreamteamer/tasks'];
		const [maj, min, pat] = pin.split('.').map(Number);
		const old = pat > 0 ? `${maj}.${min}.${pat - 1}` : `${maj}.${min - 1}.99`;
		const copy = path.join(tmp('dtm-hm1-old-'), 'tasks');
		fs.cpSync(path.join(ROOT, 'modules', 'tasks'), copy, { recursive: true, filter: (s) => !/node_modules/.test(s) });
		const p = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
		p.version = old;
		fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(p, null, '\t') + '\n');
		execFileSync('npm', ['pack', copy, '--pack-destination', folder(), '--silent'], { encoding: 'utf8' });
		const tarball = path.join(folder(), `dreamteamer-tasks-${old}.tgz`);
		assert.ok(fs.existsSync(tarball), 'older tasks not packed');
		try {
			const { root } = await prepared();
			// hand-move: the older bytes in node_modules and the pin in package.json
			const at = path.join(root, 'node_modules', '@dreamteamer', 'tasks');
			fs.rmSync(at, { recursive: true, force: true });
			fs.mkdirSync(at, { recursive: true });
			execFileSync('tar', ['-xzf', tarball, '-C', at, '--strip-components', '1']);
			const pj = JSON.parse(pkgText(root));
			pj.dependencies['@dreamteamer/tasks'] = old;
			fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pj, null, '\t') + '\n');
			const before = pkgText(root);
			const r = run(root, ['install', '@dreamteamer/core', '--from', folder(), '--input', `files_folder=${tmp('dtm-files-')}`, '--no-input'], HOME());
			const out = `${r.stdout}\n${r.stderr}`;
			assert.equal(r.status, 1, `exit ${r.status}, not 1\n${out.slice(-2000)}`);
			assert.match(out, /tasks/);
			assert.match(out, new RegExp(`installed at ${old.replace(/\./g, '\\.')}, not ${pin.replace(/\./g, '\\.')}`), out);
			assert.match(out, /dt update/, out);
			assert.equal(pkgText(root), before, 'package.json changed');
		} finally {
			fs.rmSync(tarball, { force: true });
		}
	});
});
