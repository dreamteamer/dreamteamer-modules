// HELD-OUT cr-modules-017-h1 (rnd/tests dreamteamer-modules/heldout-m017-m-pairing-and-session-edges), written by the
// test stage from the record alone: one code opened twice at once, a code across a restart, another workspace's
// cookie, a session idle exactly 7 days, and a Read-capped session across a level change.
//
// AMENDED READINGS (decisions/2026-11-14--the-pane-re-pairs-after-every-server-restart-sessions-live-in-memory-only,
// and the design's 08:30 revision): sessions live in the server's memory only, in a browser-session cookie. The
// record's "the state file holds one session hash" (step 1), "renews Max-Age=604800" and "its hash leaves the store"
// (step 4) were written for the persisted 7-day store the operator overruled; each is kept below as a `todo` case (it
// runs, and its result is reported without failing the file) beside the amended reading, which must pass.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_DIR, call, cleanupTmps, control, fixture, machine, page, pair, startWeb, stateFileOf } from './cr-modules-017-lib.mjs';

const DAY7 = 604_800_000;
const REFUSED = /used or is older than a minute/;
let A, B, m;
const servers = [];
const start = async (root, o = {}) => { const w = await startWeb({ root, appDir: APP_DIR, stateDir: m.state, idleMinutes: 0, ...o }); servers.push(w); return w; };

before(() => {
	m = machine();
	A = fixture();
	B = fixture();
});
after(async () => {
	for (const w of servers) await w.close().catch(() => {});
	A?.cleanupAll(); B?.cleanupAll();
	cleanupTmps();
});

describe('step 1: one code opened twice at once', () => {
	let web, results;
	before(async () => {
		web = await start(A.root);
		const url = web.pair();
		results = await Promise.all([call(url), call(url)]);
	});
	after(() => web.close());
	test('exactly one response is 302 with Set-Cookie and the other is 401', () => {
		const statuses = results.map((r) => r.status).sort();
		assert.deepEqual(statuses, [302, 401], `statuses ${statuses}`);
		const ok = results.find((r) => r.status === 302);
		const no = results.find((r) => r.status === 401);
		assert.match(ok.headers.get('set-cookie') ?? '', new RegExp(`^dt_pane_${web.port}=`));
		assert.equal(no.headers.get('set-cookie'), null, 'the refused one sets no cookie');
	});
	test('amended: exactly one session exists — the cookie authenticates, and the state file holds no session at all', async () => {
		const cookie = results.find((r) => r.status === 302).headers.get('set-cookie').split(';')[0];
		const r = await page(web.url, cookie, 'GET', '/api/host');
		assert.equal(r.status, 200, r.text);
		const st = JSON.parse(fs.readFileSync(stateFileOf(A.root, m.state), 'utf8'));
		assert.equal(Object.hasOwn(st, 'sessions'), false, `the state file carries sessions: ${JSON.stringify(st.sessions)}`);
		assert.doesNotMatch(JSON.stringify(st), new RegExp(cookie.split('=')[1]), 'the sid is not in the state file');
	});
	test('original reading: the state file holds one session hash', { todo: 'contradicts the memory-only sessions decision — kept for the record' }, () => {
		const st = JSON.parse(fs.readFileSync(stateFileOf(A.root, m.state), 'utf8'));
		assert.equal(Array.isArray(st.sessions) ? st.sessions.length : Object.keys(st.sessions ?? {}).length, 1);
	});
});

describe('step 2: a code across a restart', () => {
	test('401 with the used-or-older-than-a-minute sentence; no session added', async () => {
		const w1 = await start(A.root);
		const url = w1.pair();
		const port = w1.port;
		await w1.close();
		const w2 = await start(A.root);
		assert.equal(w2.port, port, 'the restart takes the stored port');
		const r = await call(url);
		assert.equal(r.status, 401, r.text);
		assert.match(r.text, REFUSED);
		assert.equal(r.headers.get('set-cookie'), null, 'no session added');
		await w2.close();
	});
});

describe("step 3: another workspace's cookie", () => {
	test("both requests to B are 401; B's state file is unchanged", async () => {
		const wa = await start(A.root);
		const wb = await start(B.root);
		const cookieA = await pair(wa);
		const sid = cookieA.split('=')[1];
		const bState = () => fs.readFileSync(stateFileOf(B.root, m.state), 'utf8');
		const before = bState();
		const r1 = await call(`${wb.url}/api/host`, { headers: { cookie: cookieA, 'sec-fetch-site': 'same-origin' } });
		const r2 = await call(`${wb.url}/api/host`, { headers: { cookie: `dt_pane_${wb.port}=${sid}`, 'sec-fetch-site': 'same-origin' } });
		assert.equal(r1.status, 401, `A's cookie as is: ${r1.status} ${r1.text}`);
		assert.equal(r2.status, 401, `A's sid renamed for B: ${r2.status} ${r2.text}`);
		assert.equal(bState(), before, "B's state file changed");
		await wa.close(); await wb.close();
	});
});

describe('step 4: a session idle exactly 7 days (injected clock)', () => {
	let clock, web, c1, c2, at6, at7;
	before(async () => {
		const t0 = Date.UTC(2026, 10, 1, 9, 0, 0);
		clock = t0;
		web = await start(A.root, { now: () => clock });
		c1 = await pair(web);
		c2 = await pair(web);
		clock = t0 + DAY7 - 1;
		at6 = await page(web.url, c1, 'GET', '/api/host');
		clock = t0 + DAY7;
		at7 = await page(web.url, c2, 'GET', '/api/host');
	});
	after(() => web.close());
	test('one millisecond short of 7 days answers 200 with the same sid (no new sid is set)', () => {
		assert.equal(at6.status, 200, at6.text);
		const set = at6.headers.get('set-cookie');
		if (set) assert.equal(set.split(';')[0], c1, 'a renewal keeps the same sid');
	});
	test('amended: the cookie is a browser-session cookie (no Max-Age), so there is nothing to renew', async () => {
		const r = await call(web.pair());
		assert.doesNotMatch(r.headers.get('set-cookie') ?? '', /Max-Age/i);
	});
	test('original reading: the 200 renews Max-Age=604800', { todo: 'contradicts the memory-only sessions decision (a browser-session cookie) — kept for the record' }, () => {
		assert.match(at6.headers.get('set-cookie') ?? '', /Max-Age=604800/);
	});
	test('at exactly 7 days idle the session is refused (401), and stays refused', async () => {
		assert.equal(at7.status, 401, at7.text);
		const again = await page(web.url, c2, 'GET', '/api/host');
		assert.equal(again.status, 401);
	});
	test('amended: the refused session never reaches the state file (the store is memory)', () => {
		const st = JSON.parse(fs.readFileSync(stateFileOf(A.root, m.state), 'utf8'));
		assert.equal(Object.hasOwn(st, 'sessions'), false);
	});
});

describe('step 5: a Read-capped session across a level change', () => {
	test('both writes are 403 naming Read while the workspace is at Admin; GET /api/host answers level read', async () => {
		const web = await start(A.root);
		const p = await control(web.port, web.controlToken, 'POST', '/_dt/pair', { cap: 'read' });
		assert.equal(p.status, 200, p.text);
		const r = await call(p.json.url);
		assert.equal(r.status, 302, r.text);
		const cookie = r.headers.get('set-cookie').split(';')[0];
		assert.equal((await control(web.port, web.controlToken, 'POST', '/_dt/level', { level: 'read' })).status, 200);
		assert.equal((await control(web.port, web.controlToken, 'POST', '/_dt/level', { level: 'admin' })).status, 200);
		const st = JSON.parse(fs.readFileSync(stateFileOf(A.root, m.state), 'utf8'));
		assert.equal(st.level, 'admin');
		const patch = await page(web.url, cookie, 'PATCH', '/api/collections/tasks/records/brief-dana', { done: true });
		const field = await page(web.url, cookie, 'POST', '/api/fields/tasks', { name: 'probe', type: 'string' });
		for (const [what, res] of [['PATCH', patch], ['POST /fields', field]]) {
			assert.equal(res.status, 403, `${what}: ${res.status} ${res.text}`);
			assert.match(res.json?.error ?? '', /\bRead\b/, `${what} names Read: ${res.text}`);
		}
		const host = await page(web.url, cookie, 'GET', '/api/host');
		assert.equal(host.status, 200);
		assert.equal(host.json.level, 'read');
		assert.equal(A.git(['status', '--porcelain', '--', 'data', 'modules']), '', 'nothing was written');
		await web.close();
	});
});
