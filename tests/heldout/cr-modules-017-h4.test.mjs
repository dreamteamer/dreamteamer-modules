// HELD-OUT cr-modules-017-h4 (rnd/tests dreamteamer-modules/heldout-m017-m-selection-and-queue-edges), written by the
// test stage from the record alone: 50 refs with one record deleted before the put, a place on a record from a
// git_modules layer, a queued command whose record stops being eligible, two prompts within one second, a queue of
// 25, and dt web select across two collections. The server is started the way a session starts it (the dt-web bin,
// detached), so the prompt hook finds it through its runtime file.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { call, cleanupTmps, control, dtWeb, hook, machine, page, payload, rtOf, signIn, sleep, stateOf, stopAll, stream, urlOf, workspaceNamed } from './cr-modules-017-lib.mjs';

let f, m, base, rt, cookie, es, command;
const lines = (s) => s.split('\n').filter(Boolean);
const QUEUED = /^queued by the person in the pane/;

before(async () => {
	m = machine();
	f = workspaceNamed('h4-northwind');
	// 50 tasks and 25 more active projects, written as records before the server starts
	for (let i = 1; i <= 50; i++) fs.writeFileSync(path.join(f.root, 'data', 'tasks', `h4-task-${i}.task.md`), `---\nname: H4 task ${i}\n---\n`);
	for (let i = 1; i <= 25; i++) fs.writeFileSync(path.join(f.root, 'data', 'projects', `h4-project-${i}.project.md`), `---\nname: H4 project ${i}\nstatus: active\n---\n`);
	const chk = f.dt('check');
	assert.equal(chk.status, 0, `the written records do not check: ${chk.stdout}${chk.stderr}`);
	const open = dtWeb(f.root, ['open', '--edit'], m.env);
	assert.equal(open.code, 0, open.stdout + open.stderr);
	rt = rtOf(f.root, m);
	base = `http://127.0.0.1:${rt.port}`;
	cookie = await signIn(urlOf(open.stdout));
	es = await stream(base, cookie);
	const cmds = await page(base, cookie, 'GET', '/api/commands/projects?ids=northwind-launch');
	command = cmds.json?.commands?.find((c) => c.scope === 'record')?.command;
	assert.ok(command, `no record-scoped command bound on projects: ${cmds.text}`);
});
after(() => { es?.close(); stopAll([f.root], m); f?.cleanup(); cleanupTmps(); });

describe('step 1: 50 refs, one deleted on disk before the put', () => {
	test('400 whose error names the deleted ref; the stored selection is unchanged', async () => {
		const prior = await page(base, cookie, 'PUT', '/api/selection', { view: { collection: 'tasks' }, refs: ['tasks/h4-task-1'] });
		assert.equal(prior.status, 200, prior.text);
		const before = (await page(base, cookie, 'GET', '/api/selection')).json;
		fs.rmSync(path.join(f.root, 'data', 'tasks', 'h4-task-37.task.md'));
		const refs = Array.from({ length: 50 }, (_, i) => `tasks/h4-task-${i + 1}`);
		const r = await page(base, cookie, 'PUT', '/api/selection', { view: { collection: 'tasks' }, refs });
		assert.equal(r.status, 400, r.text);
		assert.match(r.json?.error ?? '', /tasks\/h4-task-37\b/);
		const after = (await page(base, cookie, 'GET', '/api/selection')).json;
		assert.deepEqual({ view: after.view, refs: after.refs, place: after.place }, { view: before.view, refs: before.refs, place: before.place });
	});
});

describe('step 2: a place on a record from a git_modules layer', () => {
	test("200; place is 'projects/harbor-mutual-archive'; the hook line names the ref", async () => {
		const ref = 'projects/harbor-mutual-archive';
		const r = await page(base, cookie, 'PUT', '/api/selection', { view: { collection: 'projects', id: 'harbor-mutual-archive' }, refs: [ref] });
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json.place, ref);
		const h = await hook(payload(f.root), m.env);
		assert.equal(h.code, 0, h.stderr);
		assert.match(h.stdout, /showing: projects\/harbor-mutual-archive/, h.stdout);
		assert.match(h.stdout, /selected: projects\/harbor-mutual-archive/, h.stdout);
	});
});

describe('step 3: a queued command whose record stops being eligible', () => {
	test('the hook withholds or prints it, never errors (exit 0, at most three lines); GET /api/queue shows a final state', async () => {
		const q = await page(base, cookie, 'POST', '/api/queue', { command, refs: ['projects/northwind-launch'] });
		assert.equal(q.status, 200, q.text);
		const id = q.json.item.id;
		const s = await page(base, cookie, 'PATCH', '/api/collections/projects/records/northwind-launch', { status: 'paused' });
		assert.equal(s.status, 200, s.text);
		const h = await hook(payload(f.root), m.env);
		assert.equal(h.code, 0, h.stderr);
		assert.ok(lines(h.stdout).length <= 3, h.stdout);
		const items = (await page(base, cookie, 'GET', '/api/queue')).json.items;
		const it = items.find((x) => x.id === id);
		assert.ok(it, 'the item is gone from the queue');
		assert.ok(it.state === 'delivered' || it.state === 'expired', `the item is ${it.state}: ${JSON.stringify(it)}`);
		await page(base, cookie, 'PATCH', '/api/collections/projects/records/northwind-launch', { status: 'active' });
	});
});

describe('step 4: two prompts within one second', () => {
	test("exactly one of the two outputs carries the 'queued by the person in the pane' line; the item is delivered once", async () => {
		const q = await page(base, cookie, 'POST', '/api/queue', { command, refs: ['projects/h4-project-1'] });
		assert.equal(q.status, 200, q.text);
		const id = q.json.item.id;
		const [a, b] = await Promise.all([hook(payload(f.root, 'sess-a'), m.env), hook(payload(f.root, 'sess-b'), m.env)]);
		const carrying = [a, b].filter((h) => lines(h.stdout).some((l) => QUEUED.test(l) && l.includes('projects/h4-project-1')));
		assert.equal(carrying.length, 1, `outputs:\nA: ${a.stdout}\nB: ${b.stdout}`);
		const it = (await page(base, cookie, 'GET', '/api/queue')).json.items.find((x) => x.id === id);
		assert.equal(it.state, 'delivered');
		assert.equal(typeof it.deliveredAt, 'string');
		const stored = stateOf(f.root, m).pane.queue.filter((x) => x.id === id);
		assert.equal(stored.length, 1);
		assert.equal(typeof stored[0].deliveredAt, 'string');
	});
});

describe('step 5: a queue of 25', () => {
	test('GET /api/queue lists at most 20, newest first; the hook prints at most three lines; no item is lost from the state file', async () => {
		const ids = [];
		for (let i = 1; i <= 25; i++) {
			const q = await page(base, cookie, 'POST', '/api/queue', { command, refs: [`projects/h4-project-${i}`] });
			assert.equal(q.status, 200, `item ${i}: ${q.text}`);
			ids.push(q.json.item.id);
		}
		const items = (await page(base, cookie, 'GET', '/api/queue')).json.items;
		assert.ok(items.length <= 20, `${items.length} listed`);
		const times = items.map((x) => Date.parse(x.queuedAt));
		assert.deepEqual(times, [...times].sort((x, y) => y - x), 'newest first');
		assert.equal(items[0].id, ids[24], 'the newest is first');
		const h = await hook(payload(f.root), m.env);
		assert.equal(h.code, 0);
		assert.ok(lines(h.stdout).length <= 3, `${lines(h.stdout).length} lines:\n${h.stdout}`);
		const stored = new Set(stateOf(f.root, m).pane.queue.map((x) => x.id));
		const lost = ids.filter((x) => !stored.has(x));
		assert.deepEqual(lost, [], 'items lost from the state file before their hour');
	});
});

describe('step 6: dt web select across two collections', () => {
	test('exits non-zero with a sentence saying a selection is of one collection; no dt:select is broadcast', async () => {
		const n = es.messages.length;
		const r = dtWeb(f.root, ['select', 'tasks/brief-dana', 'projects/northwind-launch'], m.env);
		assert.notEqual(r.code, 0, r.stdout);
		assert.match(r.stdout + r.stderr, /one collection/);
		await sleep(300);
		assert.deepEqual(es.messages.slice(n).filter((x) => x?.type === 'dt:select'), []);
	});
});
