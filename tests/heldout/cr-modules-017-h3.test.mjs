// HELD-OUT cr-modules-017-h3 (rnd/tests dreamteamer-modules/heldout-m017-m-levels-matrix-and-changes), written by the
// test stage from the record alone: every route at every level through a client token and through a capped cookie,
// a collection that becomes internal after a compile while the server runs, and a level lowered while a write is in
// flight. ROUTES is iterated from @dreamteamer/protocol/routes; each is sent with a minimal body of the right shape
// (a handler's 400/404/409 for a body or target it refuses still counts as "what the handler answers" — the gate
// is what this test judges).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_DIR, ENGINE_DIR, ROOT, call, cleanupTmps, control, fixture, machine, page, sleep, startWeb, stream } from './cr-modules-017-lib.mjs';

const { ROUTES } = await import(pathToFileURL(path.join(ROOT, 'modules', 'protocol', 'src', 'routes.js')).href);
const RANK = { read: 0, edit: 1, admin: 2 };
const WORD = { read: 'read', edit: 'edit', admin: 'admin' };

/** One concrete request per route id; `level` overrides the route's own where the target makes it admin. */
function instances(command) {
	const R = {
		info: ['GET', '/info'], schema: ['GET', '/schema'], presentation: ['GET', '/presentation'], sources: ['GET', '/sources'],
		'sources-access': ['GET', '/sources/access'], 'sources-access-members': ['GET', '/sources/access/members'], activity: ['GET', '/activity'],
		nav: ['GET', '/nav'], 'nav-put': ['PUT', '/nav', { tree: [] }], 'nav-patch': ['PATCH', '/nav', { op: 'new-folder', label: 'H3' }],
		'field-add': ['POST', '/fields/tasks', { name: 'h3_probe', type: 'string' }], 'field-edit': ['PATCH', '/fields/tasks/h3_nope', { description: 'x' }],
		'field-remove': ['DELETE', '/fields/tasks/h3_nope'], 'field-rename': ['POST', '/fields/tasks/h3_nope/rename', { to: 'h3_nope2' }],
		'field-rename-value': ['POST', '/fields/projects/status/rename-value', { from: 'zzz', to: 'yyy' }],
		folder: ['GET', '/folder/projects/northwind-launch'], values: ['GET', '/collections/projects/values/status'],
		'records-list': ['GET', '/collections/tasks/records'], 'records-create': ['POST', '/collections/tasks/records', { name: 'H3 probe' }],
		'record-read': ['GET', '/collections/tasks/records/brief-dana'], 'record-update': ['PATCH', '/collections/tasks/records/brief-dana', { done: true }],
		'record-remove': ['DELETE', '/collections/tasks/records/h3-nonexistent'], 'file-import': ['POST', '/collections/tasks/files', {}],
		position: ['PATCH', '/collections/projects/position/northwind-launch', { before: 'harbor-mutual-renewal' }],
		rename: ['POST', '/collections/lab%2Fsamples/rename', {}], revert: ['POST', '/collections/tasks/records-revert/h3-nonexistent', {}],
		commands: ['GET', '/commands/projects'], notes: ['GET', '/notes/projects'], commit: ['POST', '/commit', { message: 'h3 probe' }],
		history: ['GET', '/history/tasks/brief-dana'], 'history-diff': ['GET', '/history-diff/tasks/brief-dana'], reload: ['POST', '/reload', {}],
		host: ['GET', '/host'], 'selection-put': ['PUT', '/selection', { view: { collection: 'tasks' }, refs: [] }], 'selection-get': ['GET', '/selection'],
		'queue-post': ['POST', '/queue', { command, refs: ['projects/northwind-launch'] }], 'queue-get': ['GET', '/queue'],
	};
	const out = [];
	for (const r of ROUTES) {
		assert.ok(R[r.id], `no instance for the route ${r.id} — the held-out must cover every route`);
		const [method, p, body] = R[r.id];
		assert.equal(method, r.method, r.id);
		out.push({ id: r.id, method, path: p, body, level: r.level });
	}
	// record writes on a system (internal) collection count as admin
	out.push({ id: 'records-create (skills)', method: 'POST', path: '/collections/skills/records', body: { name: 'h3-skill', description: 'use when never' }, level: 'admin' });
	out.push({ id: 'record-update (skills)', method: 'PATCH', path: '/collections/skills/records/reviewing-projects', body: { description: 'use when h3' }, level: 'admin' });
	out.push({ id: 'record-remove (collections)', method: 'DELETE', path: '/collections/collections/records/h3-nonexistent', level: 'admin' });
	return out;
}
const DT_ROUTES = [['POST', '/_dt/pair', {}], ['POST', '/_dt/token', { name: 'x' }], ['POST', '/_dt/revoke', {}], ['POST', '/_dt/level', { level: 'read' }],
	['POST', '/_dt/push', { type: 'select', clear: true }], ['GET', '/_dt/pane'], ['POST', '/_dt/pane/delivered', { ids: [] }], ['GET', '/_dt/workspaces'], ['POST', '/_dt/handoff', { id: '0000000000000000' }]];

describe('step 1: every route at every level', () => {
	let f, m, web, command, cases;
	const failures = [];
	const pass = async (label, L, headers, { client }) => {
		for (const c of cases) {
			const r = await call(`${web.url}/api${c.path}`, { method: c.method, headers: { ...headers, ...(c.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: c.body !== undefined ? JSON.stringify(c.body) : undefined });
			const paneOnly = client && (c.id === 'selection-put' || c.id === 'queue-post');
			const refused = RANK[c.level] > RANK[L];
			if (paneOnly) {
				if (r.status !== 403) failures.push(`${label}: ${c.method} ${c.path} (pane-only) → ${r.status}, want 403`);
			} else if (refused) {
				const err = String(r.json?.error ?? r.text);
				if (r.status !== 403) failures.push(`${label}: ${c.method} ${c.path} (${c.level}) → ${r.status}, want 403`);
				else if (!new RegExp(`\\b${WORD[L]}\\b`, 'i').test(err) || !new RegExp(`\\b${WORD[c.level]}\\b`, 'i').test(err)) failures.push(`${label}: ${c.method} ${c.path} 403 does not name ${L} and ${c.level}: ${err}`);
			} else if (r.status === 401 || r.status === 403 || r.status >= 500) {
				failures.push(`${label}: ${c.method} ${c.path} (${c.level}) → ${r.status} ${r.text.slice(0, 160)}`);
			}
		}
		if (client) {
			for (const [method, p, body] of DT_ROUTES) {
				const r = await call(`${web.url}${p}`, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
				if (r.status !== 401) failures.push(`${label}: ${method} ${p} → ${r.status}, want 401`);
			}
		}
	};
	const cookieAt = async (cap) => {
		const p = await control(web.port, web.controlToken, 'POST', '/_dt/pair', { cap });
		const r = await call(p.json.url);
		assert.equal(r.status, 302, r.text);
		return { cookie: r.headers.get('set-cookie').split(';')[0], 'sec-fetch-site': 'same-origin' };
	};
	const clientAt = async (level) => {
		const r = await control(web.port, web.controlToken, 'POST', '/_dt/token', { name: `h3-${level}`, level });
		assert.equal(r.status, 200, r.text);
		return { authorization: `Bearer ${r.json.token}` };
	};
	before(async () => {
		m = machine();
		f = fixture();
		f.git(['add', '-A']);
		f.git(['commit', '-qm', 'h3: the support fixture\'s extras']);
		web = await startWeb({ root: f.root, appDir: APP_DIR, stateDir: m.state, idleMinutes: 0 });
		assert.equal((await control(web.port, web.controlToken, 'POST', '/_dt/level', { level: 'admin' })).status, 200);
		const ck = await cookieAt('admin');
		const cmds = await call(`${web.url}/api/commands/projects?ids=northwind-launch`, { headers: ck });
		command = cmds.json?.commands?.find((c) => c.scope === 'record')?.command ?? cmds.json?.commands?.[0]?.command;
		assert.ok(command, `no bound command on projects: ${cmds.text}`);
		cases = instances(command);
	});
	after(async () => { await web?.close(); f?.cleanupAll(); cleanupTmps(); });

	test('the read passes (a client token at read, a cookie capped at read) write nothing to the workspace', async () => {
		await pass('client read', 'read', await clientAt('read'), { client: true });
		await pass('cookie read', 'read', await cookieAt('read'), { client: false });
		assert.equal(f.git(['status', '--porcelain']), '', 'git status --porcelain after the read passes');
	});
	test('the edit passes (a client token at edit, a cookie capped at edit)', async () => {
		await pass('client edit', 'edit', await clientAt('edit'), { client: true });
		await pass('cookie edit', 'edit', await cookieAt('edit'), { client: false });
	});
	test('the admin pass (a cookie at admin)', async () => {
		await pass('cookie admin', 'admin', await cookieAt('admin'), { client: false });
	});
	test('a route answers 403 exactly when its level outranks the caller\'s, naming both level words; client tokens are 403 on the pane routes and 401 on /_dt/', () => {
		assert.deepEqual(failures, []);
	});
	test('no admin client token can be minted', async () => {
		const r = await control(web.port, web.controlToken, 'POST', '/_dt/token', { name: 'h3-admin', level: 'admin' });
		assert.notEqual(r.status, 200, `an admin client token was minted: ${r.text}`);
		assert.ok(!r.json?.token);
	});
});

describe('steps 2-3: a collection that becomes internal; a level lowered mid-write', () => {
	let f, m, web, cookie, es, descriptor;
	before(async () => {
		m = machine();
		f = fixture();
		descriptor = path.join(f.root, 'modules', 'default', 'collections', 'notes-x.collection.yaml');
		fs.writeFileSync(descriptor, "name: notes-x\ndescription: A note for the held-out.\nuse_when: never\nids:\n  from: '{{ name | slug }}'\nfields:\n  name:\n    type: string\n    required: true\n  body:\n    type: string\n");
		for (const args of [['compile'], ['add', 'notes-x', '--name', 'First note']]) {
			const r = f.dt(...args);
			assert.equal(r.status, 0, `${args}: ${r.stdout}${r.stderr}`);
		}
		web = await startWeb({ root: f.root, appDir: APP_DIR, stateDir: m.state, idleMinutes: 0 });
		assert.equal((await control(web.port, web.controlToken, 'POST', '/_dt/level', { level: 'admin' })).status, 200);
		const p = await control(web.port, web.controlToken, 'POST', '/_dt/pair', { cap: 'edit' });
		const r = await call(p.json.url);
		cookie = r.headers.get('set-cookie').split(';')[0];
		es = await stream(web.url, cookie);
	});
	after(async () => { es?.close(); await web?.close(); f?.cleanupAll(); cleanupTmps(); });

	let sawSchema = null;
	test('step 2: an Edit cookie PATCHes notes-x (200); internal: true is set on its source and dt compile runs (in its own process, the server running)', async () => {
		const one = await page(web.url, cookie, 'PATCH', '/api/collections/notes-x/records/first-note', { body: 'one' });
		assert.equal(one.status, 200, one.text);
		fs.writeFileSync(descriptor, fs.readFileSync(descriptor, 'utf8').replace(/^description:/m, 'internal: true\ndescription:'));
		const c = await new Promise((resolve) => {
			const ch = spawn(process.execPath, [path.join(ENGINE_DIR, 'bin', 'dreamteamer.js'), 'compile'], { cwd: f.root, stdio: ['ignore', 'pipe', 'pipe'] });
			let out = ''; ch.stdout.on('data', (b) => { out += b; }); ch.stderr.on('data', (b) => { out += b; });
			ch.on('exit', (code) => resolve({ code, out }));
		});
		assert.equal(c.code, 0, c.out);
		assert.match(fs.readFileSync(path.join(f.root, '.dreamteamer', 'collections', 'notes-x.collection.yaml'), 'utf8'), /^internal: true/m);
		const t0 = Date.now();
		while (Date.now() - t0 < 15_000 && !es.messages.some((x) => x?.type === 'dt:invalidate' && x.scope === 'schema')) await sleep(100);
		sawSchema = es.messages.some((x) => x?.type === 'dt:invalidate' && x.scope === 'schema');
	});
	test('step 2: the schema invalidation reaches the open event stream', async () => {
		// the stream itself is alive: a push reaches it
		const push = await control(web.port, web.controlToken, 'POST', '/_dt/push', { type: 'select', clear: true });
		assert.equal(push.status, 200, push.text);
		await sleep(300);
		assert.ok(es.messages.some((x) => x?.type === 'dt:select'), `the stream is not alive: ${JSON.stringify(es.messages)}`);
		assert.ok(sawSchema, `no schema invalidation within 15 s of the compile; the stream got: ${JSON.stringify(es.messages)}`);
	});
	test('step 2: the next PATCH is 403 naming Admin, without a restart', async () => {
		const two = await page(web.url, cookie, 'PATCH', '/api/collections/notes-x/records/first-note', { body: 'two' });
		assert.equal(two.status, 403, `${two.status} ${two.text}`);
		assert.match(two.json?.error ?? '', /\badmin\b/i);
	});

	test('step 3: a level lowered between the chunks of a PATCH — saved whole or refused whole; the next PATCH is 403 naming Read; host says read with no raisedAt', async () => {
		const file = path.join(f.root, 'data', 'tasks', fs.readdirSync(path.join(f.root, 'data', 'tasks')).find((x) => x.startsWith('brief-dana')));
		const before = fs.readFileSync(file, 'utf8');
		const body = JSON.stringify({ name: 'Brief Dana — the in-flight edit' });
		const half = Math.floor(body.length / 2);
		const u = new URL(web.url);
		const inflight = new Promise((resolve, reject) => {
			const req = http.request({ host: u.hostname, port: u.port, path: '/api/collections/tasks/records/brief-dana', method: 'PATCH', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }, (res) => {
				const ch = []; res.on('data', (x) => ch.push(x)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(ch).toString() }));
			});
			req.on('error', reject);
			req.write(body.slice(0, half));
			setTimeout(async () => {
				const lower = await page(web.url, cookie, 'POST', '/_dt/level', { level: 'read' });
				assert.equal(lower.status, 200, lower.text);
				setTimeout(() => { req.write(body.slice(half)); req.end(); }, 100);
			}, 100);
		});
		const r = await inflight;
		const after1 = fs.readFileSync(file, 'utf8');
		assert.ok(r.status === 200 || r.status === 403, `in-flight PATCH: ${r.status} ${r.text}`);
		if (r.status === 200) assert.match(after1, /the in-flight edit/);
		else assert.equal(after1, before, 'refused, yet the file changed');
		assert.ok(after1 === before || /name: Brief Dana — the in-flight edit/.test(after1), 'the file is neither old nor new');
		const second = await page(web.url, cookie, 'PATCH', '/api/collections/tasks/records/brief-dana', { done: true });
		assert.equal(second.status, 403, second.text);
		assert.match(second.json?.error ?? '', /\bread\b/i);
		const host = await page(web.url, cookie, 'GET', '/api/host');
		assert.equal(host.json.level, 'read');
		assert.equal(host.json.raisedAt, undefined, `raisedAt: ${host.json.raisedAt}`);
	});
});
