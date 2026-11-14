// HELD-OUT cr-dt-008-hm4 (rnd/tests dreamteamer-modules/heldout-dt008-m-patch-racing-a-hand-edit).
//
// PATCH /nav racing a hand edit of nav.yaml, and twenty concurrent PATCHes, end in a parseable document with no
// interleaved bytes; each write is atomic and applies to the file as it is on disk at that moment. Through the http
// host (dt web, in-process) over a real workspace on the engine under test, ten collections row_0 … row_9.
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
const ROWS = Array.from({ length: 10 }, (_, i) => `row_${i}`);

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

describe('steps 2-3: twenty PATCHes at once', () => {
	test('every acknowledged op is in the file; the file parses, has the header and one trailing newline', async () => {
		const ops = [
			...ROWS.map((r) => ({ op: 'move', target: { name: r }, into: { folder: ['B'] } })),
			...ROWS.slice(0, 5).map((r) => ({ op: 'hide', target: { name: r } })),
			...[1, 2, 3, 4, 5].map((k) => ({ op: 'new-folder', label: `F_${k}` })),
		];
		const answers = await Promise.all(ops.map((op) => patch(op)));
		const text = fs.readFileSync(navFile, 'utf8');
		const doc = parse(text);
		assert.ok(isNavDoc(doc), `not a NavDoc:\n${text}`);
		assert.equal(text.split('\n')[0], HEADER, 'the header comment is not the first line');
		assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), 'not exactly one trailing newline');
		const refused = answers.map((a, i) => [a, ops[i]]).filter(([a]) => a.status !== 200);
		for (const [a, op] of refused) {
			assert.ok(a.status >= 400 && a.status < 500 && a.body?.error, `${JSON.stringify(op)} answered ${a.status} with no message: ${JSON.stringify(a.body)}`);
		}
		const lost = [];
		for (const [i, op] of ops.entries()) {
			if (answers[i].status !== 200) continue;
			if (op.op === 'move' && !(folder(doc, 'B')?.items ?? []).includes(op.target.name)) lost.push(op);
			if (op.op === 'hide' && !(doc.hidden ?? []).includes(op.target.name)) lost.push(op);
			if (op.op === 'new-folder' && !folder(doc, op.label)) lost.push(op);
		}
		assert.deepEqual(lost, [], `acknowledged and lost:\n${text}`);
		assert.deepEqual(refused.map(([, op]) => op), [], 'an op that applies on any order was refused');
		assert.deepEqual(folder(doc, 'B').items.slice().sort(), [...ROWS].sort());
		assert.deepEqual((doc.hidden ?? []).slice().sort(), ROWS.slice(0, 5).sort());
		assert.equal(doc.tree.filter((e) => /^F_\d$/.test(e?.folder ?? '')).length, 5);
	});
});

describe('step 4: a hand writer racing PATCH icon, 200 iterations, no sleeps', () => {
	test('no observation is empty, truncated or unparseable; every 200 doc parses; hand content survives; no temp files', async () => {
		// two hand documents, alternately: one with an extra comment line, one in a different order
		const handA = `${HEADER}\n# a hand-written comment\ntree:\n  - folder: A\n    items: [row_9]\n  - folder: B\n    items: []\n${ROWS.slice(0, 9).map((r) => `  - ${r}\n`).join('')}`;
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
