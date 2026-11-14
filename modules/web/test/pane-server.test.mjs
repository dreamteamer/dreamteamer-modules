// The pane state the chat reads, and the push to the page (cr-modules-017 §5; rnd/tests/dreamteamer-modules/
// pane-a5-selection-and-place-reach-the-chat and pane-a6-ask-in-chat-reaches-the-next-prompt, server half): the page's
// place, selection and queue persist in the workspace state and outlive a restart; /_dt/push moves and ticks every
// connected page; GET /_dt/pane is what `dt web selection` and the hook read — with ?hook=1 it stamps hookSeenAt,
// hands each waiting item out ONCE (the plan review's atomic take) and answers movedTo once.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startWeb } from '../src/server.js';
import { readWorkspaceState, writeWorkspaceState } from '../src/state.js';
import { fixture, call, pair, sameOrigin } from './support.mjs';

const HOUR = 3_600_000;
let f, web, cookie, t;
const clock = () => t;
const start = async () => {
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state, now: clock });
	cookie = await pair(web);
};
before(async () => {
	f = fixture();
	f.dt('add', 'tasks', '--name', 'Call the bank', '--project', 'projects/northwind-launch');
	t = Date.now();
	await start();
});
after(async () => { await web?.close(); f?.cleanupAll(); });

const JSON_TYPE = { 'content-type': 'application/json' };
const page = (p, method = 'GET', body) => call(`${web.url}${p}`, { method, headers: { cookie, ...sameOrigin(), ...(body ? JSON_TYPE : {}) }, body: body ? JSON.stringify(body) : undefined });
const control = (p, method = 'GET', body) => call(`${web.url}/_dt${p}`, { method, headers: { authorization: `Bearer ${web.controlToken}`, ...(body ? JSON_TYPE : {}) }, body: body ? JSON.stringify(body) : undefined });

/** An open /api/events stream: `next(type)` resolves the next message of that type (3 s), `close()` ends it. */
async function stream() {
	const ctrl = new AbortController();
	const res = await fetch(`${web.url}/api/events`, { headers: { cookie, ...sameOrigin() }, signal: ctrl.signal });
	const reader = res.body.getReader();
	let buf = '';
	const seen = [];
	const pump = (async () => {
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) return;
				buf += Buffer.from(value).toString();
				let i;
				while ((i = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
					const m = /^data: (.*)$/m.exec(chunk);
					if (m) seen.push(JSON.parse(m[1]));
				}
			}
		} catch { /* aborted */ }
	})();
	await new Promise((r) => setTimeout(r, 50));
	return {
		async next(type) {
			const t0 = Date.now();
			while (Date.now() - t0 < 3000) {
				const i = seen.findIndex((m) => m.type === type);
				if (i >= 0) return seen.splice(i, 1)[0];
				await new Promise((r) => setTimeout(r, 20));
			}
			throw new Error(`no ${type} within 3 s`);
		},
		async close() { ctrl.abort(); await pump; await new Promise((r) => setTimeout(r, 50)); },
	};
}

describe('place and selection', () => {
	test('a PUT /selection from the page is what /_dt/pane answers, and a restart keeps it', async () => {
		const put = await page('/api/selection', 'PUT', { view: { collection: 'tasks' }, refs: ['tasks/brief-dana', 'tasks/call-the-bank'] });
		assert.equal(put.status, 200, put.text);
		const p = (await control('/pane')).json;
		assert.equal(p.place, 'tasks · List');
		assert.deepEqual(p.refs, ['tasks/brief-dana', 'tasks/call-the-bank']);
		assert.deepEqual(p.view, { collection: 'tasks' });
		assert.equal(p.connected, false);
		await web.close();
		await start();
		const again = (await control('/pane')).json;
		assert.equal(again.place, 'tasks · List');
		assert.deepEqual(again.refs, ['tasks/brief-dana', 'tasks/call-the-bank']);
		assert.deepEqual((await page('/api/selection')).json.refs, ['tasks/brief-dana', 'tasks/call-the-bank']);
	});

	test('{ other: true } clears the place and keeps the refs', async () => {
		assert.equal((await page('/api/selection', 'PUT', { view: { other: true }, refs: ['tasks/brief-dana'] })).status, 200);
		const p = (await control('/pane')).json;
		assert.equal(p.place, null);
		assert.deepEqual(p.refs, ['tasks/brief-dana']);
	});

	test('a cookie GET /_dt/pane is 401; a client token is 401', async () => {
		assert.equal((await page('/_dt/pane')).status, 401);
		const token = (await control('/token', 'POST', { name: 'ci', level: 'edit' })).json.token;
		assert.equal((await call(`${web.url}/_dt/pane`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
		assert.equal((await call(`${web.url}/_dt/push`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...JSON_TYPE }, body: '{"type":"select","clear":true}' })).status, 401);
	});
});

describe('the push', () => {
	test('navigate resolves a collection, a ref, a namespaced ref and a ui-view, and reaches the page as dt:navigate', async () => {
		const s = await stream();
		try {
			for (const [target, route] of [
				['tasks', '/content/tasks'],
				['tasks/brief-dana', '/content/tasks/brief-dana'],
				['lab/samples', '/content/lab/samples'],
				['lab/samples/sample-one', '/content/lab/samples/sample-one'],
				['projects-board', '/projects-board'],
			]) {
				const r = await control('/push', 'POST', { type: 'navigate', target });
				assert.equal(r.status, 200, `${target}: ${r.text}`);
				assert.equal(r.json.delivered, 1);
				assert.deepEqual(await s.next('dt:navigate'), { type: 'dt:navigate', route }, target);
			}
			const nope = await control('/push', 'POST', { type: 'navigate', target: 'tasks/nope' });
			assert.equal(nope.status, 400);
			assert.match(nope.json.error, /no record, collection or ui-view tasks\/nope/);
		} finally { await s.close(); }
	});

	test('select reaches the page as dt:select; clear sends []; a missing ref, two collections or 51 refs are 400', async () => {
		const s = await stream();
		try {
			const r = await control('/push', 'POST', { type: 'select', refs: ['tasks/brief-dana', 'tasks/call-the-bank'] });
			assert.equal(r.status, 200, r.text);
			assert.deepEqual(await s.next('dt:select'), { type: 'dt:select', refs: ['tasks/brief-dana', 'tasks/call-the-bank'] });
			assert.equal((await control('/push', 'POST', { type: 'select', clear: true })).status, 200);
			assert.deepEqual(await s.next('dt:select'), { type: 'dt:select', refs: [] });
			assert.equal((await control('/push', 'POST', { type: 'select', refs: ['tasks/nope'] })).status, 400);
			const two = await control('/push', 'POST', { type: 'select', refs: ['tasks/brief-dana', 'projects/northwind-launch'] });
			assert.equal(two.status, 400);
			assert.match(two.json.error, /one collection/);
			assert.equal((await control('/push', 'POST', { type: 'select', refs: Array.from({ length: 51 }, () => 'tasks/brief-dana') })).status, 400);
			assert.equal((await control('/push', 'POST', { type: 'jump' })).status, 400);
		} finally { await s.close(); }
	});

	test('with no page connected a push delivers to 0', async () => {
		const r = await control('/push', 'POST', { type: 'navigate', target: 'tasks' });
		assert.equal(r.status, 200);
		assert.equal(r.json.delivered, 0);
	});
});

describe('the queue', () => {
	test('a queued command waits, is marked delivered with a time, and the page hears dt:queue', async () => {
		const s = await stream();
		try {
			const q = await page('/api/queue', 'POST', { command: 'commands/review-project', refs: ['projects/northwind-launch'] });
			assert.equal(q.status, 200, q.text);
			await s.next('dt:queue');
			const waiting = (await control('/pane')).json.queue;
			assert.equal(waiting.length, 1);
			assert.equal(waiting[0].state, 'waiting');
			assert.equal(waiting[0].invocation, '/review-project projects/northwind-launch');
			assert.equal(readWorkspaceState(f.root, f.state).pane.queue.length, 1, 'a queue change is written at once');
			const d = await control('/pane/delivered', 'POST', { ids: [waiting[0].id] });
			assert.equal(d.status, 200, d.text);
			await s.next('dt:queue');
			const items = (await page('/api/queue')).json.items;
			assert.equal(items[0].state, 'delivered');
			assert.ok(!Number.isNaN(Date.parse(items[0].deliveredAt)));
			assert.deepEqual((await control('/pane')).json.queue, []);
		} finally { await s.close(); }
	});

	test('?hook=1 hands a waiting item out once — a second prompt does not get it; with no page it hands out nothing', async () => {
		const q = (await page('/api/queue', 'POST', { command: 'commands/review-project', refs: ['projects/northwind-launch'] })).json.item;
		assert.deepEqual((await control('/pane?hook=1')).json.queue, [], 'no page connected: the item waits');
		assert.equal((await page('/api/queue')).json.items.find((i) => i.id === q.id).state, 'waiting');
		const s = await stream();
		try {
			const [a, b] = await Promise.all([control('/pane?hook=1'), control('/pane?hook=1')]);
			const handed = [...a.json.queue, ...b.json.queue].filter((i) => i.id === q.id);
			assert.equal(handed.length, 1, 'one delivery only');
			assert.equal((await control('/pane?hook=1')).json.queue.length, 0);
		} finally { await s.close(); }
		const item = (await page('/api/queue')).json.items.find((i) => i.id === q.id);
		assert.equal(item.state, 'delivered');
	});

	test('an hour on, a waiting item reads expired and is not handed out', async () => {
		const q = (await page('/api/queue', 'POST', { command: 'commands/review-project', refs: ['projects/northwind-launch'] })).json.item;
		t += HOUR;
		try {
			assert.equal((await page('/api/queue')).json.items.find((i) => i.id === q.id).state, 'expired');
			assert.equal((await control('/pane')).json.queue.some((i) => i.id === q.id), false);
			assert.equal((await control('/pane?hook=1')).json.queue.some((i) => i.id === q.id), false);
		} finally { t -= HOUR; }
	});

	test('a client token cannot mark an item delivered', async () => {
		const token = (await control('/token', 'POST', { name: 'ci', level: 'edit' })).json.token;
		assert.equal((await call(`${web.url}/_dt/pane/delivered`, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...JSON_TYPE }, body: '{"ids":[]}' })).status, 401);
	});
});

describe('the hook seen', () => {
	test('?hook=1 stamps hookSeenAt: chat is true, and false 25 hours later; the page hears dt:host when it turns', async () => {
		await web.close();
		const state = readWorkspaceState(f.root, f.state);
		state.hookSeenAt = null;
		writeWorkspaceState(f.root, state, f.state);
		await start();
		assert.equal((await page('/api/host')).json.chat, false);
		const s = await stream();
		try {
			const p = await control('/pane?hook=1');
			assert.equal(p.status, 200);
			await s.next('dt:host');
		} finally { await s.close(); }
		assert.equal((await page('/api/host')).json.chat, true);
		assert.ok(readWorkspaceState(f.root, f.state).hookSeenAt, 'the first stamp is written at once');
		t += 25 * HOUR;
		try { assert.equal((await page('/api/host')).json.chat, false); } finally { t -= 25 * HOUR; }
	});

	test('movedTo is answered once to the hook, and kept for a reader without ?hook=1', async () => {
		await web.close();
		const state = readWorkspaceState(f.root, f.state);
		state.pane.movedTo = { name: 'Harbor', at: new Date(t).toISOString() };
		writeWorkspaceState(f.root, state, f.state);
		await start();
		assert.equal((await control('/pane')).json.movedTo.name, 'Harbor');
		assert.equal((await control('/pane?hook=1')).json.movedTo.name, 'Harbor');
		assert.equal((await control('/pane?hook=1')).json.movedTo, null);
	});
});
