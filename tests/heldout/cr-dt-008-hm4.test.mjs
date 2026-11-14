// HELD-OUT cr-dt-008-hm4 (rnd/tests dreamteamer-modules/heldout-dt008-m-patch-racing-a-hand-edit).
//
// PATCH /nav racing a hand edit of nav.yaml, and twenty concurrent PATCHes, end in a parseable document with no
// interleaved bytes; each write is atomic and applies to the file as it is on disk at that moment. Through the http
// host (dt web, in-process) over a real workspace on the engine under test, fifteen collections row_0 … row_14.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { workspace, writeCollection, simpleCollection } from '../helpers/fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { startWeb } = await import(pathToFileURL(path.join(ROOT, 'modules', 'web', 'src', 'server.js')).href);
const HEADER = '# The left nav of this workspace. Drag and drop writes this file; so may you.';
const ROWS = Array.from({ length: 15 }, (_, i) => `row_${i}`);

let ws, web, navFile, app;
const auth = () => ({ authorization: `Bearer ${web.token}` });
async function patch(op) {
	const r = await fetch(`${web.appUrl}/api/nav`, { method: 'PATCH', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify(op), signal: AbortSignal.timeout(20_000) });
	const text = await r.text();
	let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
	return { status: r.status, body: json ?? text };
}
async function getNav() {
	const r = await fetch(`${web.appUrl}/api/nav`, { headers: auth(), signal: AbortSignal.timeout(20_000) });
	return { status: r.status, body: await r.json() };
}
const initial = () => `${HEADER}\ntree:\n  - folder: A\n    items: []\n  - folder: B\n    items: []\n${ROWS.map((r) => `  - ${r}\n`).join('')}`;
const parse = (text) => yaml.load(text);
const isNavDoc = (d) => d && typeof d === 'object' && Array.isArray(d.tree) && (d.hidden === undefined || Array.isArray(d.hidden));
const folder = (doc, label) => doc.tree.find((e) => e && typeof e === 'object' && e.folder === label);
const leftovers = () => fs.readdirSync(ws.root).filter((f) => /^nav\.yaml\./.test(f));

before(async () => {
	ws = workspace({ compile: false });
	for (const r of ROWS) writeCollection(ws.root, r, simpleCollection({ ids: { from: '{{ name | slug }}' } }));
	const c = ws.dt('compile');
	assert.equal(c.code, 0, `${c.stdout}\n${c.stderr}`);
	app = fs.mkdtempSync(path.join(os.tmpdir(), 'hm4-app-'));
	fs.mkdirSync(path.join(app, 'assets'));
	fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><html><head><title>dreamteamer</title></head><body></body></html>');
	navFile = path.join(ws.root, 'nav.yaml');
	fs.writeFileSync(navFile, initial());
	web = await startWeb({ root: ws.root, appDir: app, idleMinutes: 0 });
});
after(async () => { await web?.close(); fs.rmSync(app, { recursive: true, force: true }); });

/** Every collection name the tree places, at any depth, with how often (a name twice is a failure). */
function placed(doc) {
	const out = new Map();
	const walk = (items) => {
		for (const e of items ?? []) {
			const c = typeof e === 'string' ? e : e?.collection;
			if (typeof c === 'string') out.set(c, (out.get(c) ?? 0) + 1);
			if (e && typeof e === 'object' && Array.isArray(e.items)) walk(e.items);
		}
	};
	walk(doc.tree);
	return out;
}
/** The file after a batch: parses, starts with the header, ends with exactly one newline; no temp file left. */
function readSound() {
	const text = fs.readFileSync(navFile, 'utf8');
	const doc = parse(text);
	assert.ok(isNavDoc(doc), `not a NavDoc:\n${text}`);
	assert.equal(text.split('\n')[0], HEADER, 'the header comment is not the first line');
	assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'not exactly one trailing newline');
	assert.deepEqual(leftovers(), [], 'temp files left in the workspace root');
	return { text, doc };
}
/** Every answer is 200, or a 4xx with a message; returns the ops that answered 200. */
function acknowledged(ops, answers) {
	for (const [i, a] of answers.entries()) {
		if (a.status !== 200) assert.ok(a.status >= 400 && a.status < 500 && a.body?.error, `${JSON.stringify(ops[i])} answered ${a.status} with no message: ${JSON.stringify(a.body)}`);
	}
	return ops.filter((_, i) => answers[i].status === 200);
}

// Amended 2026-11-14 at the test review (finding hm4-amendment-cannot-see-a-lost-hide-or-move). Since
// decisions/2026-11-14--hide-takes-a-row-out-of-the-tree-and-lists-it-in-hidden-move-to-bottom-keeps-the-recorded-tails-first-rule
// a name is placed once — in the tree or in hidden — so a move and a hide of the SAME row cannot both be seen in the
// file, and the first amendment (b1b467f) had to accept either end state for five rows, which made a lost hide or a lost
// move of those rows invisible. The twenty concurrent ops now touch fifteen rows with no overlap — ten moves of
// row_0…row_9 into B, five hides of row_10…row_14, five new folders — so every acknowledged op is checked exactly. The
// overlapping case (a move and a hide of the same row at once) is its own batch below, where the exactly-one rule is the
// whole claim.
describe('steps 2-3: twenty PATCHes at once, every op on its own row', () => {
	test('every acknowledged op is in the file, exactly; the file parses, has the header and one trailing newline', async () => {
		fs.writeFileSync(navFile, initial());
		const MOVED = ROWS.slice(0, 10);
		const HIDDEN = ROWS.slice(10);
		const ops = [
			...MOVED.map((r) => ({ op: 'move', target: { name: r }, into: { folder: ['B'] } })),
			...HIDDEN.map((r) => ({ op: 'hide', target: { name: r } })),
			...[1, 2, 3, 4, 5].map((k) => ({ op: 'new-folder', label: `F_${k}` })),
		];
		assert.equal(ops.length, 20);
		const answers = await Promise.all(ops.map((op) => patch(op)));
		const { text, doc } = readSound();
		const ok = acknowledged(ops, answers);
		const inB = (r) => (folder(doc, 'B')?.items ?? []).includes(r);
		const isHidden = (r) => (doc.hidden ?? []).includes(r);
		const where = placed(doc);
		const lost = [];
		for (const op of ok) {
			const r = op.target?.name;
			// a move is in B and nowhere else, never hidden; a hide is in hidden and nowhere in the tree
			if (op.op === 'move' && !(inB(r) && where.get(r) === 1 && !isHidden(r))) lost.push(op);
			if (op.op === 'hide' && !(isHidden(r) && !where.has(r))) lost.push(op);
			if (op.op === 'new-folder' && !folder(doc, op.label)) lost.push(op);
		}
		assert.deepEqual(lost, [], `acknowledged and lost:\n${text}`);
		assert.deepEqual(ops.filter((op) => !ok.includes(op)), [], 'an op that applies on any order was refused');
		assert.deepEqual([...(folder(doc, 'B')?.items ?? [])].sort(), [...MOVED].sort(), `B is not exactly row_0…row_9:\n${text}`);
		assert.deepEqual([...(doc.hidden ?? [])].sort(), [...HIDDEN].sort(), `hidden is not exactly row_10…row_14:\n${text}`);
		for (const [name, n] of where) assert.equal(n, 1, `${name} is placed ${n} times:\n${text}`);
		assert.equal(doc.tree.filter((e) => /^F_\d$/.test(e?.folder ?? '')).length, 5);
	});

	test('a move and a hide of the same row at once: each such row ends in exactly one of A and hidden, never neither', async () => {
		fs.writeFileSync(navFile, initial());
		const BOTH = ROWS.slice(0, 5);
		const MOVED = ROWS.slice(5, 10);
		const HIDDEN = ROWS.slice(10);
		const ops = [
			...BOTH.flatMap((r) => [{ op: 'move', target: { name: r }, into: { folder: ['A'] } }, { op: 'hide', target: { name: r } }]),
			...MOVED.map((r) => ({ op: 'move', target: { name: r }, into: { folder: ['B'] } })),
			...HIDDEN.map((r) => ({ op: 'hide', target: { name: r } })),
		];
		assert.equal(ops.length, 20);
		const answers = await Promise.all(ops.map((op) => patch(op)));
		const { text, doc } = readSound();
		const ok = acknowledged(ops, answers);
		assert.deepEqual(ops.filter((op) => !ok.includes(op)), [], 'an op that applies on any order was refused');
		const inA = (r) => (folder(doc, 'A')?.items ?? []).includes(r);
		const inB = (r) => (folder(doc, 'B')?.items ?? []).includes(r);
		const isHidden = (r) => (doc.hidden ?? []).includes(r);
		const where = placed(doc);
		for (const [name, n] of where) assert.equal(n, 1, `${name} is placed ${n} times:\n${text}`);
		// the rows touched twice: whichever op the serialised handler applied last wins, and nothing is lost
		for (const r of BOTH) {
			assert.ok(inA(r) !== isHidden(r), `${r} must be in exactly one of A and hidden:\n${text}`);
			if (!isHidden(r)) assert.equal(where.get(r), 1, `${r} is in A and elsewhere too:\n${text}`);
			else assert.ok(!where.has(r), `${r} is hidden and still in the tree:\n${text}`);
		}
		// the rows touched once are checked exactly, as above
		for (const r of MOVED) assert.ok(inB(r) && where.get(r) === 1 && !isHidden(r), `${r} must be in B only:\n${text}`);
		for (const r of HIDDEN) assert.ok(isHidden(r) && !where.has(r), `${r} must be hidden and out of the tree:\n${text}`);
		assert.deepEqual([...(doc.hidden ?? [])].filter((r) => !BOTH.includes(r)).sort(), [...HIDDEN].sort(), `only row_0…row_4 and row_10…row_14 may be hidden:\n${text}`);
	});
});

describe('step 4: a hand writer racing PATCH icon, 200 iterations, no sleeps', () => {
	test('no observation is empty, truncated or unparseable; every 200 doc parses; hand content survives; no temp files', async () => {
		// two hand documents, alternately: one with an extra comment line, one in a different order
		const handA = `${HEADER}\n# a hand-written comment\ntree:\n  - folder: A\n    items: [row_9]\n  - folder: B\n    items: []\n${ROWS.filter((r) => r !== 'row_9').map((r) => `  - ${r}\n`).join('')}`;
		const handB = `${HEADER}\ntree:\n${[...ROWS].reverse().map((r) => `  - ${r}\n`).join('')}  - folder: B\n    items: []\n  - folder: A\n    items: []\n`;
		const handTrees = [parse(handA).tree, parse(handB).tree];
		const writer = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hm4-writer-')), 'writer.mjs');
		fs.writeFileSync(writer, `import fs from 'node:fs';
const [file, a, b] = [process.argv[2], fs.readFileSync(process.argv[3], 'utf8'), fs.readFileSync(process.argv[4], 'utf8')];
let i = 0; let stop = false;
process.on('message', () => { stop = true; });
// to the same path, through a temp file renamed over it (the expected's "the writer uses a temp file and rename"):
// a hand writer that truncated in place would itself make the file empty for a moment, which no handler can prevent
const loop = () => { if (stop) { process.send?.({ writes: i }); return process.exit(0); } const tmp = file + '.hand-' + process.pid; fs.writeFileSync(tmp, i++ % 2 ? b : a); fs.renameSync(tmp, file); setImmediate(loop); };
process.send?.({ ready: true });
loop();
`);
		const texts = path.dirname(writer);
		fs.writeFileSync(path.join(texts, 'a.yaml'), handA);
		fs.writeFileSync(path.join(texts, 'b.yaml'), handB);
		const child = spawn(process.execPath, [writer, navFile, path.join(texts, 'a.yaml'), path.join(texts, 'b.yaml')], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
		await new Promise((r) => child.once('message', r));
		const bad = [];
		const badDocs = [];
		const notOnTop = [];
		let ok = 0;
		const stripIcons = (tree) => JSON.parse(JSON.stringify(tree, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v.collection === 'string' ? v.collection : v)));
		const known = (tree) => [parse(initial()).tree, ...handTrees].some((t) => JSON.stringify(stripIcons(tree)) === JSON.stringify(t));
		for (let i = 0; i < 200; i++) {
			const res = await patch({ op: 'icon', target: { name: 'row_1' }, icon: 'star' });
			const seen = fs.readFileSync(navFile, 'utf8');
			let parsed;
			try { parsed = parse(seen); } catch { parsed = undefined; }
			if (!isNavDoc(parsed)) bad.push(seen);
			if (res.status === 200) {
				ok++;
				let round;
				try { round = parse(yaml.dump(res.body.doc)); } catch (e) { badDocs.push(String(e)); continue; }
				if (!isNavDoc(round)) badDocs.push(JSON.stringify(res.body.doc));
				else if (!known(round.tree)) notOnTop.push(JSON.stringify(res.body.doc.tree));
			} else {
				assert.ok(res.status >= 400 && res.status < 500, `PATCH answered ${res.status}: ${JSON.stringify(res.body)}`);
			}
		}
		child.send('stop');
		await new Promise((r) => child.once('exit', r));
		console.log(`# ${ok} of 200 PATCHes answered 200`);
		assert.deepEqual(bad, [], 'an observation the handler left unparseable');
		assert.deepEqual(badDocs, [], 'a 200 whose doc does not parse');
		assert.deepEqual(notOnTop, [], 'a 200 whose doc is neither the hand-written content nor the previous one with the icon applied');
		assert.ok(ok > 0, 'no PATCH applied at all');
		assert.deepEqual(leftovers(), [], 'temp files left in the workspace root');
	});
});

describe('step 5: a hand edit between two ops, no race', () => {
	test('GET, add folder H by hand, PATCH move row_2 into H: 200 and row_2 inside H', async () => {
		fs.writeFileSync(navFile, initial());
		assert.equal((await getNav()).status, 200);
		const doc = parse(fs.readFileSync(navFile, 'utf8'));
		doc.tree.push({ folder: 'H', items: [] });
		fs.writeFileSync(navFile, `${HEADER}\n${yaml.dump(doc)}`);
		const res = await patch({ op: 'move', target: { name: 'row_2' }, into: { folder: ['H'] } });
		assert.equal(res.status, 200, JSON.stringify(res.body));
		assert.deepEqual(folder(parse(fs.readFileSync(navFile, 'utf8')), 'H').items, ['row_2']);
		assert.deepEqual(leftovers(), []);
	});
});
