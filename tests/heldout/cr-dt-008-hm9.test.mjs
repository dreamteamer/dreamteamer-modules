// HELD-OUT cr-dt-008-hm9 (rnd/tests dreamteamer-modules/heldout-dt008-m-folder-label-with-slash-or-ns-prefix).
//
// A folder label containing a slash is one folder everywhere — in the file, in node keys, in targets, in ops — and a
// label starting with ns: is refused for new folders and renames. A real workspace on the engine under test
// (collections tasks, contacts, notes; namespace rnd with rnd/issues) answered through the protocol's shared handler.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { workspace, writeCollection, simpleCollection } from '../helpers/fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROTOCOL = path.join(ROOT, 'modules', 'protocol');
const HEADER = '# The left nav of this workspace. Drag and drop writes this file; so may you.';

let ws, handler, navFile;
const quietly = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const req = (m, p, b) => quietly(() => handler.handle(m, p, b));
const bytes = () => fs.readFileSync(navFile, 'utf8');
const doc = () => yaml.load(bytes());
const writeNav = (d) => fs.writeFileSync(navFile, `${HEADER}\n${yaml.dump(d)}`);
const every = (nodes, out = []) => { for (const n of nodes) { out.push(n); every(n.children ?? [], out); } return out; };
const get = async () => {
	const res = await req('GET', '/nav');
	assert.equal(res.status, 200, JSON.stringify(res.body));
	return res.body[0];
};
const folderNode = (nodes, path) => every(nodes).find((n) => n.kind === 'folder' && JSON.stringify(n.target) === JSON.stringify({ folder: path }));
const rowNames = (n) => (n?.children ?? []).filter((c) => c.kind === 'collection').map((c) => c.target.name);
const START = () => ({ tree: [
	{ folder: 'Sales', items: [{ folder: 'CRM', items: ['contacts'] }] },
	{ folder: 'Sales/CRM', items: ['tasks'] },
	{ folder: 'a b%2Fc', items: ['notes'] },
] });

before(async () => {
	ws = workspace({ pkg: { namespaces: ['rnd'] }, compile: false });
	writeCollection(ws.root, 'tasks', simpleCollection({ title: 'Tasks' }));
	writeCollection(ws.root, 'contacts', simpleCollection({ title: 'Contacts' }));
	writeCollection(ws.root, 'rnd/issues', simpleCollection({ title: 'Issues' }));
	const r = ws.dt('compile');
	assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
	assert.ok(fs.existsSync(path.join(ws.root, '.dreamteamer', 'collections', 'notes.collection.yaml')), 'the starter notes collection is missing');
	const { createHandler } = await import(pathToFileURL(path.join(PROTOCOL, 'src', 'handler.js')).href);
	handler = await createHandler({ root: ws.root });
	navFile = path.join(ws.root, 'nav.yaml');
	writeNav(START());
});

describe('step 2: GET /nav over the slash labels', () => {
	test('every key unique; "Sales/CRM" and Sales > CRM are two folders with different keys and targets; "a b%2Fc" verbatim', async () => {
		const ws0 = await get();
		const nodes = every(ws0.children);
		const keys = nodes.map((n) => n.key);
		assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'a key collision');
		const slash = folderNode(ws0.children, ['Sales/CRM']);
		const nested = folderNode(ws0.children, ['Sales', 'CRM']);
		assert.ok(slash, 'no folder targeted { folder: ["Sales/CRM"] }');
		assert.ok(nested, 'no folder targeted { folder: ["Sales", "CRM"] }');
		assert.notEqual(slash.key, nested.key);
		assert.deepEqual(rowNames(slash), ['tasks']);
		assert.deepEqual(rowNames(nested), ['contacts']);
		assert.equal(slash.label, 'Sales/CRM');
		const pct = nodes.find((n) => n.kind === 'folder' && n.label === 'a b%2Fc');
		assert.ok(pct, `the label "a b%2Fc" is not drawn verbatim: ${nodes.filter((n) => n.kind === 'folder').map((n) => n.label).join(' | ')}`);
		assert.deepEqual(pct.target, { folder: ['a b%2Fc'] }, 'the target does not carry the label verbatim');
	});
});

describe('step 3: ops on the slash label', () => {
	test('move notes into ["Sales/CRM"]: 200, in the one-element-path folder and not in Sales > CRM', async () => {
		const res = await req('PATCH', '/nav', { op: 'move', target: { name: 'notes' }, into: { folder: ['Sales/CRM'] } });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const top = await get();
		assert.deepEqual(rowNames(folderNode(top.children, ['Sales/CRM'])), ['tasks', 'notes']);
		assert.deepEqual(rowNames(folderNode(top.children, ['Sales', 'CRM'])), ['contacts']);
	});
	test('rename ["Sales/CRM"] to "Deals/2026": 200, only that folder\'s label changes, the file round-trips the slash', async () => {
		const before = doc();
		const res = await req('PATCH', '/nav', { op: 'rename', target: { folder: ['Sales/CRM'] }, label: 'Deals/2026' });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const after = doc();
		const expected = structuredClone(before);
		expected.tree[1].folder = 'Deals/2026';
		assert.deepEqual(after, expected);
		const top = await get();
		assert.deepEqual(rowNames(folderNode(top.children, ['Deals/2026'])), ['tasks', 'notes']);
		assert.equal(folderNode(top.children, ['Deals', '2026']), undefined, 'the slash label split into two folders');
	});
	test('move rnd/issues into ["Sales", "CRM"]: 200, it lands in Sales > CRM', async () => {
		const res = await req('PATCH', '/nav', { op: 'move', target: { name: 'rnd/issues' }, into: { folder: ['Sales', 'CRM'] } });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		const top = await get();
		assert.deepEqual(rowNames(folderNode(top.children, ['Sales', 'CRM'])), ['contacts', 'rnd/issues']);
	});
});

describe('step 4: ns: labels through PATCH (labels are not trimmed: the plan states no trimming rule)', () => {
	for (const label of ['ns:rnd', 'ns:', '']) {
		test(`new-folder ${JSON.stringify(label)}: 400 naming the label, file byte-identical`, async () => {
			const before = bytes();
			const res = await req('PATCH', '/nav', { op: 'new-folder', label });
			assert.equal(res.status, 400, JSON.stringify(res.body));
			if (label) assert.ok(String(res.body.error).includes(JSON.stringify(label)), `the refusal does not name ${JSON.stringify(label)}: ${res.body.error}`);
			else assert.match(String(res.body.error), /empty/, `the refusal does not say the label is empty: ${res.body.error}`);
			assert.equal(bytes(), before, 'nav.yaml changed');
		});
	}
	test('rename folder Sales to "ns:rnd": 400 naming it, file byte-identical', async () => {
		const before = bytes();
		const res = await req('PATCH', '/nav', { op: 'rename', target: { folder: ['Sales'] }, label: 'ns:rnd' });
		assert.equal(res.status, 400, JSON.stringify(res.body));
		assert.ok(String(res.body.error).includes('"ns:rnd"'), res.body.error);
		assert.equal(bytes(), before);
	});
	test('" ns:x" (leading space) is accepted verbatim — new-folder and rename by the same rule', async () => {
		const res = await req('PATCH', '/nav', { op: 'new-folder', label: ' ns:x' });
		assert.equal(res.status, 200, `labels are not trimmed, so " ns:x" must be accepted verbatim: ${JSON.stringify(res.body)}`);
		assert.ok(doc().tree.some((e) => e.folder === ' ns:x'), 'not written verbatim');
		const r2 = await req('PATCH', '/nav', { op: 'rename', target: { folder: [' ns:x'] }, label: ' ns:y' });
		assert.equal(r2.status, 200, `rename does not follow the same rule: ${JSON.stringify(r2.body)}`);
		assert.ok(doc().tree.some((e) => e.folder === ' ns:y'));
	});
	for (const label of ['NS:rnd', 'x ns:y']) {
		test(`new-folder ${JSON.stringify(label)} is accepted`, async () => {
			const res = await req('PATCH', '/nav', { op: 'new-folder', label });
			assert.equal(res.status, 200, JSON.stringify(res.body));
			assert.ok(doc().tree.some((e) => e.folder === label));
		});
	}
});

describe('step 5: a hand-written folder labelled "ns:rnd" beside a namespace: rnd entry', () => {
	for (const order of ['folder first', 'namespace first']) {
		test(`${order}: GET 200, both drawn (or a notice); hide resolves to exactly one, and show restores that one`, async () => {
			const folder = { folder: 'ns:rnd', items: ['tasks'] };
			const nsEntry = { namespace: 'rnd', items: ['rnd/issues'] };
			writeNav({ tree: order === 'folder first' ? [folder, nsEntry] : [nsEntry, folder] });
			const before = await get();
			const drawnFolder = every(before.children).find((n) => n.kind === 'folder' && n.label === 'ns:rnd');
			const drawnNs = every(before.children).find((n) => n.kind === 'namespace' && n.target?.name === 'rnd');
			assert.ok((drawnFolder && drawnNs) || /ns:rnd|namespace/.test(String(before.notice ?? '')), 'neither both drawn nor the ambiguity reported');
			const res = await req('PATCH', '/nav', { op: 'hide', target: { folder: ['ns:rnd'] } });
			assert.equal(res.status, 200, `hide did not resolve to one of them: ${JSON.stringify(res.body)}`);
			{
				const hiddenNow = doc().tree.filter((e) => e.hidden === true);
				assert.equal(hiddenNow.length, 1, `hide hid ${hiddenNow.length}: ${JSON.stringify(doc())}`);
				const which = hiddenNow[0].folder !== undefined ? 'folder' : 'namespace';
				const mid = await get();
				const stillFolder = every(mid.children).some((n) => n.kind === 'folder' && n.label === 'ns:rnd');
				const stillNs = every(mid.children).some((n) => n.kind === 'namespace' && n.target?.name === 'rnd');
				assert.deepEqual([stillFolder, stillNs], which === 'folder' ? [false, true] : [true, false], 'the drawing does not match what was hidden');
				const s = await req('PATCH', '/nav', { op: 'show', target: { folder: ['ns:rnd'] } });
				assert.equal(s.status, 200, JSON.stringify(s.body));
				assert.equal(doc().tree.filter((e) => e.hidden === true).length, 0, `show did not restore the one hide hid: ${JSON.stringify(doc())}`);
			}
		});
	}
});

describe('step 6: PUT /nav with a folder labelled "ns:x"', () => {
	test('400 naming the label (or 200 drawn as step 5) — never a 500', async () => {
		const before = bytes();
		const res = await req('PUT', '/nav', { tree: [{ folder: 'ns:x', items: ['tasks'] }], hidden: [] });
		assert.ok(res.status < 500, JSON.stringify(res.body));
		if (res.status === 400) {
			assert.ok(String(res.body.error).includes('"ns:x"'), res.body.error);
			assert.equal(bytes(), before, 'a refused PUT changed nav.yaml');
		} else {
			assert.equal(res.status, 200);
			const top = await get();
			assert.ok(every(top.children).some((n) => n.kind === 'folder' && n.label === 'ns:x'));
		}
	});
});
