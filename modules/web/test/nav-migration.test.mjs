// dt web MIGRATES THE NAV ON ITS FIRST GET (cr-dt-008, task 12; rnd/tests dreamteamer-modules/web-nav-first-get).
//
// A workspace still arranged by the old nav settings (.vscode/settings.json) and no nav.yaml: the first GET /api/nav
// of the server's life writes nav.yaml from those settings and says so once, on that response's workspace node; the
// tree it draws is the tree the settings drew, less the module marks, routes and tooltips nav.yaml folders never
// carry. A hand edit of nav.yaml reaches an open event stream as a data change. A workspace with no settings is left
// without a nav.yaml.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { startWeb } from '../src/server.js';
import { initEngine } from '@dreamteamer/protocol/host/engine';
import { navModel, workspaceNavSettings } from '@dreamteamer/protocol/nav-model';
import { fixture, call, pair, sameOrigin } from './support.mjs';

const NOTICE = 'nav.yaml written from your nav settings — they are no longer read';
const SETTINGS = '{\n\t// arranged before nav.yaml\n\t"dreamteamer.navOrder": ["tasks", "lab"],\n\t"dreamteamer.navHidden": ["projects"],\n}\n';

const comparable = (nodes) => nodes
	.filter((n) => n.kind !== 'layers')
	.map((n) => ({ kind: n.kind, key: n.key, label: n.label, icon: n.icon, ...(n.children ? { children: comparable(n.children) } : {}) }));

const servers = [];
const fixtures = [];
after(async () => {
	for (const w of servers) await w.close();
	for (const f of fixtures) f.cleanupAll();
});
const cookies = new Map();
const signIn = async (web) => { cookies.set(web, await pair(web)); };
const auth = (web) => ({ cookie: cookies.get(web), ...sameOrigin() });

describe('a workspace with old nav settings and no nav.yaml', () => {
	let f, web, legacy;
	before(async () => {
		f = fixture();
		fixtures.push(f);
		fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
		fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), SETTINGS);
		await initEngine(f.root);
		legacy = navModel({ root: f.root, settings: workspaceNavSettings(f.root) });
		web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state });
		servers.push(web);
		await signIn(web);
	});

	test('the first GET /api/nav writes nav.yaml and says so; the second does not', async () => {
		assert.equal(fs.existsSync(path.join(f.root, 'nav.yaml')), false);
		const first = await call(`${web.url}/api/nav`, { headers: auth(web) });
		assert.equal(first.status, 200, first.text);
		assert.equal(first.json[0].notice, NOTICE);
		const doc = yaml.load(fs.readFileSync(path.join(f.root, 'nav.yaml'), 'utf8'));
		assert.equal(doc.tree[0], 'tasks');
		assert.deepEqual(doc.hidden, ['projects']);
		const second = await call(`${web.url}/api/nav`, { headers: auth(web) });
		assert.equal(second.status, 200);
		assert.equal(second.json[0].notice, undefined);
	});

	test('the tree drawn is the tree the settings drew, less marks, routes and module tooltips', async () => {
		const now = await call(`${web.url}/api/nav`, { headers: auth(web) });
		assert.deepEqual(comparable(now.json[0].children), comparable(legacy[0].children));
		assert.equal(now.json[0].children[0].key, 'c/tasks');
	});

	test('a hand edit of nav.yaml reaches an open event stream within five seconds', async () => {
		const ctrl = new AbortController();
		const res = await fetch(`${web.url}/api/events`, { headers: auth(web), signal: ctrl.signal });
		const reader = res.body.getReader();
		const t0 = Date.now();
		setTimeout(() => {
			// the way an editor saves: a temp file renamed over the old one
			const file = path.join(f.root, 'nav.yaml');
			fs.writeFileSync(`${file}.swp`, `${fs.readFileSync(file, 'utf8')}  - lab/samples\n`);
			fs.renameSync(`${file}.swp`, file);
		}, 200);
		let got = '';
		while (!got.includes('dt:invalidate') && Date.now() - t0 < 5000) {
			const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined }), 5000))]);
			if (done) break;
			if (value) got += Buffer.from(value).toString();
		}
		ctrl.abort();
		assert.match(got, /"type":"dt:invalidate","scope":"data"/);
		assert.ok(Date.now() - t0 < 5000);
	});
});

describe('a workspace with no nav settings', () => {
	test('GET /api/nav writes nothing and carries no notice', async () => {
		const f = fixture();
		fixtures.push(f);
		const web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state });
		servers.push(web);
		await signIn(web);
		const r = await call(`${web.url}/api/nav`, { headers: auth(web) });
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json[0].notice, undefined);
		assert.equal(fs.existsSync(path.join(f.root, 'nav.yaml')), false);
	});
});

// review round 1 (a-read-pane-s-first-get-nav-writes-nav-yaml): the migration is a write, so it waits for a caller at
// Edit or above; below Edit the legacy tree is drawn from the settings and nothing is written
describe('at Read, a workspace with old nav settings and no nav.yaml', () => {
	test('GET /api/nav from the Read page and from a read client token draws the settings\' tree and writes nothing; the first GET at Edit writes nav.yaml', async () => {
		const f = fixture();
		fixtures.push(f);
		fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
		fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), SETTINGS);
		await initEngine(f.root);
		const legacy = navModel({ root: f.root, settings: workspaceNavSettings(f.root) });
		const web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state });
		servers.push(web);
		await signIn(web);
		const control = (p, body) => call(`${web.url}/_dt${p}`, { method: 'POST', headers: { authorization: `Bearer ${web.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
		assert.equal((await control('/level', { level: 'read' })).status, 200);
		const token = (await control('/token', { name: 'watcher', level: 'read' })).json.token;
		for (const [who, headers] of [['the Read page', auth(web)], ['a read client token', { authorization: `Bearer ${token}` }]]) {
			const r = await call(`${web.url}/api/nav`, { headers });
			assert.equal(r.status, 200, `${who}: ${r.text}`);
			assert.equal(r.json[0].notice, undefined, who);
			assert.deepEqual(comparable(r.json[0].children), comparable(legacy[0].children), who);
			assert.equal(fs.existsSync(path.join(f.root, 'nav.yaml')), false, `${who} wrote nav.yaml`);
		}
		assert.equal((await control('/level', { level: 'edit' })).status, 200);
		const edit = await call(`${web.url}/api/nav`, { headers: auth(web) });
		assert.equal(edit.status, 200, edit.text);
		assert.equal(edit.json[0].notice, NOTICE);
		assert.equal(fs.existsSync(path.join(f.root, 'nav.yaml')), true);
	});
});

describe('a hand-edited nav.yaml that cannot be drawn as written', () => {
	test('a folder that contains itself by a YAML alias: GET answers 200 with a notice, PATCH answers 400 — the connection is never dropped', async () => {
		const f = fixture();
		fixtures.push(f);
		const web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state });
		servers.push(web);
		await signIn(web);
		const control = (p, body) => call(`${web.url}/_dt${p}`, { method: 'POST', headers: { authorization: `Bearer ${web.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
		assert.equal((await control('/level', { level: 'edit' })).status, 200);
		const text = 'tree:\n  - &a { folder: Loop, items: [tasks, *a] }\n';
		fs.writeFileSync(path.join(f.root, 'nav.yaml'), text);
		const r = await call(`${web.url}/api/nav`, { headers: auth(web) });
		assert.equal(r.status, 200, r.text);
		assert.match(String(r.json[0].notice), /nav\.yaml/);
		const p = await call(`${web.url}/api/nav`, { method: 'PATCH', headers: { ...auth(web), 'content-type': 'application/json' }, body: JSON.stringify({ op: 'hide', target: { name: 'tasks' } }) });
		assert.equal(p.status, 400, p.text);
		assert.match(String(p.json?.error), /nav\.yaml/);
		assert.equal(fs.readFileSync(path.join(f.root, 'nav.yaml'), 'utf8'), text);
	});
});
