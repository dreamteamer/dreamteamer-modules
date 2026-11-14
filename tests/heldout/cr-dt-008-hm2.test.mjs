// HELD-OUT (cr-dt-008, rnd/tests dreamteamer-modules/heldout-dt008-m-fragment-after-the-operator-moved-a-row).
//
// A fragment-carrying module installed or updated after the operator moved, hid or re-foldered one of its
// collections leaves every operator choice where it is: a re-install of rnd changes no byte of nav.yaml,
// knowledge's Knowledge folder lands at top level (never merged into the renamed one inside the namespace), and an
// rnd update that adds one collection adds exactly that one line inside the existing namespace entry.
// Written by the test stage from the record's steps and expected; the builder never read it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ROOT, moduleIds, packedInto, virginWorkspace, run, cleanup, engineMeets, ENGINE_VERSION } from '../helpers/workspace.mjs';

after(cleanup);
const { createHandler } = await import(pathToFileURL(path.join(ROOT, 'modules', 'protocol', 'src', 'handler.js')).href);
const skip = !engineMeets('rnd') && `rnd's nav fragment installs on engine 0.49.0 or later; testing ${ENGINE_VERSION}`;
const HOME = () => ({ HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-HOME-')) });
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const navText = (root) => fs.readFileSync(path.join(root, 'nav.yaml'), 'utf8');
/** Lines of `b` not in `a` and of `a` not in `b`, as multisets. */
function lineDiff(a, b) {
	const count = (t) => t.split('\n').reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());
	const ca = count(a), cb = count(b);
	const added = [], removed = [];
	for (const [l, n] of cb) for (let i = (ca.get(l) ?? 0); i < n; i++) added.push(l);
	for (const [l, n] of ca) for (let i = (cb.get(l) ?? 0); i < n; i++) removed.push(l);
	return { added, removed };
}
const nsEntries = (doc, ns) => {
	const out = [];
	const walk = (items) => { for (const e of items ?? []) { if (e && typeof e === 'object') { if (e.namespace === ns) out.push(e); walk(e.items); } } };
	walk(doc.tree);
	return out;
};

describe('a fragment after the operator moved a row', { skip }, () => {
	test('steps 1–5', { timeout: 900_000 }, async () => {
		const folder = packedInto(tmp('dtm-hm2-'), ...moduleIds());
		// step 1
		const root = virginWorkspace();
		const install = (...names) => {
			const r = run(root, ['install', ...names.map((n) => `@dreamteamer/${n}`), '--from', folder, '--no-input'], HOME());
			assert.equal(r.status, 0, `dt install ${names.join(' ')}: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-1200)}`);
			return r;
		};
		install('rnd');
		const shipped = yaml.load(fs.readFileSync(path.join(ROOT, 'modules', 'rnd', 'nav.yaml'), 'utf8'));
		assert.deepEqual(yaml.load(navText(root)).tree, shipped.tree, 'step 1: nav.yaml does not hold rnd\'s fragment');
		// step 2 — four gestures through PATCH /nav
		const h = await createHandler({ root, settings: () => ({}) });
		for (const op of [
			{ op: 'move', target: { name: 'rnd/issues' }, position: 'bottom' },
			{ op: 'hide', target: { name: 'rnd/releases' } },
			{ op: 'rename', target: { folder: ['ns:rnd', 'Knowledge'] }, label: 'Reading' },
			{ op: 'dissolve', target: { folder: ['ns:rnd', 'Product'] } },
		]) {
			const res = await h.handle('PATCH', '/nav', op);
			assert.equal(res.status, 200, `${JSON.stringify(op)} → ${res.status} ${JSON.stringify(res.body)}`);
		}
		const saved = navText(root);
		const s = yaml.load(saved);
		assert.ok(s.tree.includes('rnd/issues'), 'rnd/issues not at top level');
		assert.ok(s.hidden.includes('rnd/releases'));
		// step 3 — rnd again, then knowledge
		install('rnd');
		assert.equal(navText(root), saved, 'the re-install of rnd changed nav.yaml');
		install('knowledge');
		const afterKnowledge = navText(root);
		const k = yaml.load(afterKnowledge);
		const json = JSON.stringify(k);
		assert.ok(k.tree.includes('rnd/issues'), `rnd/issues left the top level: ${json}`);
		const ns = nsEntries(k, 'rnd');
		assert.equal(ns.length, 1, `${ns.length} namespace: rnd entries`);
		assert.ok(!JSON.stringify(ns[0]).includes('"rnd/issues"'), 'rnd/issues is back inside the namespace');
		assert.ok(k.hidden.includes('rnd/releases'), 'rnd/releases left hidden');
		// hide takes the row out of the tree and lists it in `hidden` (nav-doc.js; decisions/2026-11-14--hide-takes-a-row-
		// out-of-the-tree-and-lists-it-in-hidden-move-to-bottom-keeps-the-recorded-tails-first-rule): "not re-added" is no
		// new occurrence in the tree — as many as before the install, which is none
		assert.equal(JSON.stringify(k.tree).split('"rnd/releases"').length - 1, JSON.stringify(s.tree).split('"rnd/releases"').length - 1, `rnd/releases re-added to the tree: ${json}`);
		assert.equal(JSON.stringify(k.tree).includes('"rnd/releases"'), false, `rnd/releases is hidden and in the tree: ${json}`);
		const nsFolders = (ns[0].items ?? []).filter((e) => e && typeof e === 'object' && 'folder' in e).map((e) => e.folder);
		assert.ok(nsFolders.includes('Reading'), `Reading renamed back: ${nsFolders}`);
		assert.ok(!nsFolders.includes('Knowledge'), 'a Knowledge folder was created inside the rnd namespace');
		assert.ok(!nsFolders.includes('Product'), 'Product was recreated');
		const topK = k.tree.filter((e) => e && typeof e === 'object' && e.folder === 'Knowledge');
		assert.equal(topK.length, 1, `knowledge's folder is not at top level once: ${json}`);
		assert.deepEqual(topK[0].items, ['blurbs', 'briefs', 'meta-analyses']);
		assert.deepEqual(k.tree.filter((e) => !(e && typeof e === 'object' && e.folder === 'Knowledge')), s.tree, 'step 3 changed the rest of the tree');
		assert.deepEqual(k.hidden, s.hidden);
		assert.deepEqual(lineDiff(saved, afterKnowledge).removed, [], 'step 3 removed or changed a line');
		// step 4 — an rnd update that adds rnd/extras, named last in the fragment's namespace items
		const copy = path.join(tmp('dtm-hm2-rnd-'), 'rnd');
		fs.cpSync(path.join(ROOT, 'modules', 'rnd'), copy, { recursive: true, filter: (p) => !/node_modules/.test(p) });
		const pj = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
		const [maj, min, pat] = pj.version.split('.').map(Number);
		pj.version = `${maj}.${min}.${pat + 1}`;
		fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(pj, null, '\t') + '\n');
		fs.writeFileSync(path.join(copy, 'collections', 'rnd', 'extras.collection.yaml'), [
			'name: rnd/extras', 'description: An extra collection the update adds.', 'storage: {path: data/rnd/extras, format: md}',
			'ids:', '  from: "{{ name | slug }}"', 'fields:', '  name:', '    type: string', '    required: true', '',
		].join('\n'));
		const frag = yaml.load(fs.readFileSync(path.join(copy, 'nav.yaml'), 'utf8'));
		frag.tree.find((e) => e.namespace === 'rnd').items.push('rnd/extras');
		fs.writeFileSync(path.join(copy, 'nav.yaml'), yaml.dump(frag));
		execFileSync('npm', ['pack', copy, '--pack-destination', folder, '--silent'], { encoding: 'utf8' });
		const up = run(root, ['update', '@dreamteamer/rnd', '--from', folder], HOME());
		assert.equal(up.status, 0, `dt update: exit ${up.status}\n${up.stderr}\n${up.stdout.slice(-1200)}`);
		assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@dreamteamer', 'rnd', 'package.json'), 'utf8')).version, pj.version);
		// step 5
		const afterUpdate = navText(root);
		const d = lineDiff(afterKnowledge, afterUpdate);
		assert.deepEqual(d.removed, [], `the update removed or changed a line: ${JSON.stringify(d)}`);
		assert.equal(d.added.length, 1, `the update added more than one line: ${JSON.stringify(d.added)}`);
		assert.match(d.added[0], /rnd\/extras/);
		const u = yaml.load(afterUpdate);
		const ns2 = nsEntries(u, 'rnd');
		assert.equal(ns2.length, 1, 'a second namespace: rnd entry was written');
		assert.ok(JSON.stringify(ns2[0]).includes('"rnd/extras"'), 'rnd/extras is not inside the namespace entry');
		assert.equal(JSON.stringify(u).split('"rnd/extras"').length - 1, 1);
	});
});
