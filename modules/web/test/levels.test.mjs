// Levels enforced on the server (cr-modules-017 §3, §4; rnd/tests/dreamteamer-modules/pane-a4-levels-enforced-on-the-server):
// every /api/ request passes the protocol's gate at the pane's level — the workspace's stored level, lowered by a
// session's cap, or a client token's own; the control token opens /_dt/ only, a client token /api/ only and never the
// page's selection or queue; the page can lower the level and never raise it; GET /host answers the page's boot values
// behind the cookie and carries no workspace root.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROUTES } from '@dreamteamer/protocol/routes';
import { readModuleGrantResult } from '@dreamteamer/protocol/module-grant';
import { startWeb } from '../src/server.js';
import { workspaceKey } from '../src/state.js';
import { readWorkspaceState } from '../src/state.js';
import { fixture, call, pair, sameOrigin } from './support.mjs';

let f, web, cookie;
before(async () => {
	f = fixture();
	fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), '{ "dreamteamer.moduleApps": { "northwind": { "reads": ["projects"], "writes": ["tasks"] } } }');
	f.git(['add', '-A']);
	f.git(['commit', '-qm', 'grant']);
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state });
	cookie = await pair(web);
});
after(async () => { await web?.close(); f?.cleanupAll(); });

const JSON_TYPE = { 'content-type': 'application/json' };
const api = (p, { method = 'GET', body, headers = {}, as = cookie } = {}) => call(`${web.url}/api${p}`, {
	method,
	headers: { ...(as.startsWith('dtw_') || as.startsWith('Bearer') ? { authorization: as.startsWith('Bearer') ? as : `Bearer ${as}` } : { cookie: as, ...sameOrigin() }), ...(body !== undefined ? JSON_TYPE : {}), ...headers },
	body: body === undefined ? undefined : JSON.stringify(body),
});
const control = (p, body) => call(`${web.url}/_dt${p}`, { method: 'POST', headers: { authorization: `Bearer ${web.controlToken}`, ...JSON_TYPE }, body: JSON.stringify(body ?? {}) });
const porcelain = () => execFileSync('git', ['status', '--porcelain'], { cwd: f.root, encoding: 'utf8' });
const setLevel = async (level) => { const r = await control('/level', { level }); assert.equal(r.status, 200, r.text); };
const fill = (pattern) => pattern.replace(':collection', 'tasks').replace('*id', 'brief-dana').replace(':field', 'done');
const values = (o, out = []) => { if (o && typeof o === 'object') for (const v of Object.values(o)) values(v, out); else out.push(o); return out; };

describe('at Read', () => {
	test('every route above read is refused 403 naming the level, and nothing on disk changes', async () => {
		await setLevel('read');
		const before = porcelain();
		const above = ROUTES.filter((r) => r.level !== 'read');
		assert.ok(above.length >= 17, `${above.length} routes above read`);
		for (const r of above) {
			const body = r.method === 'DELETE' ? undefined : { name: 'Written at Read', done: true, type: 'string' };
			const res = await api(fill(r.pattern), { method: r.method, body });
			assert.equal(res.status, 403, `${r.method} ${r.pattern}: ${res.text}`);
			const need = r.level[0].toUpperCase() + r.level.slice(1);
			assert.match(res.json.error, new RegExp(`this pane is at Read: ${r.method} .* needs ${need}`), r.id);
		}
		assert.equal(porcelain(), before);
	});

	test('a read answers, and PUT /selection answers at Read', async () => {
		assert.equal((await api('/collections/tasks/records')).status, 200);
		const r = await api('/selection', { method: 'PUT', body: { view: { collection: 'tasks' }, refs: ['tasks/brief-dana'] } });
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json.place, 'tasks · List');
	});

	test('the page lowers the level and never raises it', async () => {
		await setLevel('edit');
		const lower = await call(`${web.url}/_dt/level`, { method: 'POST', headers: { cookie, ...sameOrigin(), ...JSON_TYPE }, body: JSON.stringify({ level: 'read' }) });
		assert.equal(lower.status, 200, lower.text);
		assert.equal((await api('/host')).json.level, 'read');
		const raise = await call(`${web.url}/_dt/level`, { method: 'POST', headers: { cookie, ...sameOrigin(), ...JSON_TYPE }, body: JSON.stringify({ level: 'edit' }) });
		assert.equal(raise.status, 403);
		assert.match(raise.json.error, /the page cannot raise the level — ask in the chat \(dt web open --edit\)/);
		assert.equal(readWorkspaceState(f.root, f.state).level, 'read');
		const noCookieMeta = await call(`${web.url}/_dt/level`, { method: 'POST', headers: { cookie, ...JSON_TYPE }, body: JSON.stringify({ level: 'read' }) });
		assert.equal(noCookieMeta.status, 403, 'a cookie without Fetch-Metadata');
	});
});

describe('at the default Edit', () => {
	test('a fresh workspace is at Edit', () => {
		const fresh = readWorkspaceState(f.root, fs.mkdtempSync(path.join(f.state, 'fresh-')));
		assert.equal(fresh.level, 'edit');
	});

	test('a record edit saves; a schema change and a system record write are refused naming Admin', async () => {
		await setLevel('edit');
		const file = path.join(f.root, 'data', 'tasks', 'brief-dana.task.md');
		const was = fs.readFileSync(file, 'utf8');
		const ok = await api('/collections/tasks/records/brief-dana', { method: 'PATCH', body: { done: true } });
		assert.equal(ok.status, 200, ok.text);
		assert.notEqual(fs.readFileSync(file, 'utf8'), was);
		const field = await api('/fields/tasks', { method: 'POST', body: { name: 'effort', type: 'string' } });
		assert.equal(field.status, 403);
		assert.match(field.json.error, /this pane is at Edit: POST \/fields\/:collection needs Admin/);
		const view = await api('/collections/ui-views/records/projects-board', { method: 'PATCH', body: { route: '/elsewhere' } });
		assert.equal(view.status, 403, view.text);
		assert.match(view.json.error, /needs Admin/);
		assert.equal((await api('/collections/ui-views/records')).status, 200, 'a Read of a system collection still answers');
	});

	test('a session paired with cap read is refused an edit while the workspace is at Edit', async () => {
		const r = await call(`${web.url}/_dt/pair`, { method: 'POST', headers: { authorization: `Bearer ${web.controlToken}`, ...JSON_TYPE }, body: JSON.stringify({ cap: 'read' }) });
		assert.equal(r.status, 200, r.text);
		const signIn = await call(r.json.url);
		const capped = signIn.headers.get('set-cookie').split(';')[0];
		const res = await api('/collections/tasks/records/brief-dana', { method: 'PATCH', body: { done: false }, as: capped });
		assert.equal(res.status, 403);
		assert.match(res.json.error, /this pane is at Read/);
		assert.equal((await api('/host', { as: capped })).json.level, 'read');
		assert.equal((await api('/host')).json.level, 'edit');
	});
});

describe('the control token raises', () => {
	test('a raise stamps raisedAt and GET /host shows it; a lower clears it; a broadcast tells the page', async () => {
		const ctrl = new AbortController();
		const res = await fetch(`${web.url}/api/events`, { headers: { cookie, ...sameOrigin() }, signal: ctrl.signal });
		const reader = res.body.getReader();
		await setLevel('admin');
		let got = '';
		const t0 = Date.now();
		while (!got.includes('dt:host') && Date.now() - t0 < 3000) {
			const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({}), 3000))]);
			if (done || !value) break;
			got += Buffer.from(value).toString();
		}
		ctrl.abort();
		assert.match(got, /"type":"dt:host"/);
		const host = (await api('/host')).json;
		assert.equal(host.level, 'admin');
		assert.ok(!Number.isNaN(Date.parse(host.raisedAt)), host.raisedAt);
		assert.notEqual((await api('/fields/tasks', { method: 'POST', body: {} })).status, 403, 'Admin passes the gate');
		await setLevel('edit');
		assert.equal((await api('/host')).json.raisedAt, undefined);
		assert.equal((await control('/level', { level: 'owner' })).status, 400);
	});
});

describe('tokens on the wrong prefix', () => {
	test('the control token on /api/ is 401', async () => {
		assert.equal((await api('/info', { as: `Bearer ${web.controlToken}` })).status, 401);
	});

	test('a read client token reads, is refused writes, /_dt/ and the page\'s selection', async () => {
		const minted = await control('/token', { name: 'reader', level: 'read' });
		assert.equal(minted.status, 200, minted.text);
		assert.equal(minted.json.api, `http://127.0.0.1:${web.port}/api`);
		const t = minted.json.token;
		assert.equal(JSON.stringify(readWorkspaceState(f.root, f.state)).includes(t), false, 'the token is not stored in clear');
		assert.equal((await api('/info', { as: t })).status, 200);
		const patch = await api('/collections/tasks/records/brief-dana', { method: 'PATCH', body: { done: true }, as: t });
		assert.equal(patch.status, 403);
		assert.match(patch.json.error, /is at Read/);
		assert.equal((await call(`${web.url}/_dt/pair`, { method: 'POST', headers: { authorization: `Bearer ${t}`, ...JSON_TYPE }, body: '{}' })).status, 401);
		const sel = await api('/selection', { method: 'PUT', body: { view: { collection: 'tasks' }, refs: [] }, as: t });
		assert.equal(sel.status, 403);
		assert.match(sel.json.error, /a client token cannot set the pane's selection or queue — they are the page's/);
		assert.equal((await api('/info', { as: 'dtw_forged' })).status, 401);
	});

	test('an edit client token saves a record and is still refused POST /queue; a token of the same name replaces', async () => {
		const t = (await control('/token', { name: 'ci', level: 'edit' })).json.token;
		const ok = await api('/collections/tasks/records/brief-dana', { method: 'PATCH', body: { done: false }, as: t });
		assert.equal(ok.status, 200, ok.text);
		const q = await api('/queue', { method: 'POST', body: { command: 'commands/review-project', refs: ['projects/northwind-launch'] }, as: t });
		assert.equal(q.status, 403);
		assert.equal((await api('/fields/tasks', { method: 'POST', body: { name: 'x', type: 'string' }, as: t })).status, 403);
		const again = (await control('/token', { name: 'ci', level: 'read' })).json.token;
		assert.equal((await api('/info', { as: t })).status, 401, 'the replaced token');
		assert.equal((await api('/info', { as: again })).status, 200);
		assert.equal(readWorkspaceState(f.root, f.state).clientTokens.filter((x) => x.name === 'ci').length, 1);
		assert.equal((await control('/token', { name: 'root', level: 'admin' })).status, 400, 'no admin token');
	});

	test('revoke by name ends one client token; revoke ends every session', async () => {
		const t = (await control('/token', { name: 'gone', level: 'read' })).json.token;
		const one = await control('/revoke', { token: 'gone' });
		assert.equal(one.status, 200, one.text);
		assert.equal(one.json.revoked, 1);
		assert.equal((await api('/info', { as: t })).status, 401);
		const spare = await pair(web);
		assert.equal((await api('/info', { as: spare })).status, 200);
		const all = await control('/revoke', {});
		assert.equal(all.status, 200);
		assert.ok(all.json.revoked >= 1);
		assert.equal((await api('/info', { as: spare })).status, 401);
		assert.equal((await api('/info', { as: cookie })).status, 401);
		cookie = await pair(web);
	});
});

describe('GET /host', () => {
	test('answers the boot values behind the cookie — workspace id, files and frames bases, grants — and no root path', async () => {
		const r = await api('/host');
		assert.equal(r.status, 200, r.text);
		const h = r.json;
		assert.equal(h.workspace.id, workspaceKey(f.root));
		assert.equal(typeof h.workspace.name, 'string');
		assert.equal(h.chat, false);
		assert.equal(h.filesBase, `/_files/${web.filesKey}`);
		assert.equal(h.framesBase, `/_frames/${web.filesKey}`);
		assert.deepEqual(h.moduleGrants, readModuleGrantResult(f.root).grant);
		assert.equal(h.moduleGrantProblem, null);
		assert.ok(h.varRoots.some((v) => v.name === 'DT_WEB_TEST_MEDIA' && v.uri === `/_files/${web.filesKey}/v/DT_WEB_TEST_MEDIA`));
		for (const v of values(h)) {
			if (typeof v !== 'string') continue;
			assert.notEqual(v, f.root, 'the workspace root');
			assert.notEqual(v, fs.realpathSync(f.root), 'the workspace root');
		}
		const file = await call(`${web.url}${h.filesBase}/w/report.html`);
		assert.equal(file.status, 200);
		const img = await call(`${web.url}${h.varRoots.find((v) => v.name === 'DT_WEB_TEST_MEDIA').uri}/board.png`);
		assert.equal(img.status, 200);
	});

	test('a cookie GET /host renews the cookie: the same sid, a fresh Max-Age', async () => {
		const r = await api('/host');
		assert.equal(r.headers.get('set-cookie'), `${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
		assert.equal((await api('/info')).headers.get('set-cookie'), null);
	});

	test('without a cookie GET /host is 401', async () => {
		assert.equal((await call(`${web.url}/api/host`, { headers: sameOrigin() })).status, 401);
	});
});
