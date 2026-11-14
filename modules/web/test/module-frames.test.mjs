// cr-modules-008 task 6, moved onto the one listener (cr-modules-017 task 7): /_frames/<key>/ serves each module
// frame as one self-contained document under `sandbox allow-scripts`; the shell carries no grant (GET /host answers
// it, behind the cookie — task 8); [::1] goes to 127.0.0.1; the README says so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { FRAME_POLICY } from '@dreamteamer/protocol/frame-document';
import { startWeb } from '../src/server.js';
import { fixture, call, pair } from './support.mjs';

const BUNDLE = 'export const Y = "</script> Grüße";\nexport default function register(api) {}\n';
let f, web, bare, cookie, page;
before(async () => {
	f = fixture();
	fs.mkdirSync(path.join(f.root, '.dreamteamer', 'ui', 'northwind'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.dreamteamer', 'ui', 'northwind', 'app.js'), BUNDLE);
	fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), '{ // grant\n "dreamteamer.moduleApps": { "northwind": { "reads": ["users"], "writes": ["projects"] } } }');
	fs.writeFileSync(path.join(f.root, 'hq.code-workspace'), '{"settings": {"dreamteamer.moduleApps": {"northwind": {"reads": ["contacts"]}}}}');
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state, moduleGuest: { guestText: 'window.guest=1', styleText: 'body{margin:0}' } });
	bare = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state, moduleGuest: null });
	cookie = await pair(web);
	page = await call(`${web.url}/app/`);
});
after(async () => { await web?.close(); await bare?.close(); f?.cleanupAll(); });
const globals = () => JSON.parse(/Object\.assign\(window, (\{.*?\})\);/s.exec(page.text)[1].replace(/\\u003c/g, '<'));
const frameBase = (w = web) => `${w.url}/_frames/${w.filesKey}`;

test('the shell frames by URL and carries no grant — GET /host answers it behind the cookie', () => {
	const g = globals();
	assert.equal(g.__DT_MODULE_GRANTS__, undefined);
	assert.equal(g.__DT_HOST__.moduleFrames, 'url');
	assert.equal(g.__DT_UI_BASE__, undefined);
	assert.equal(page.text.includes('northwind'), false);
});
test('/ui-modules/ is not served', async () => {
	assert.equal((await call(`${web.url}/ui-modules/northwind/app.js`, { headers: { cookie } })).status, 404);
});
test('/_frames/<key>/ serves a module frame: one document, the bundle as data, the frame policy and frame-ancestors', async () => {
	const r = await call(`${frameBase()}/northwind/list.html`, { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' } });
	assert.equal(r.status, 200);
	assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(r.headers.get('content-security-policy'), `sandbox allow-scripts; ${FRAME_POLICY}; frame-ancestors http://127.0.0.1:${web.port} http://localhost:${web.port}`);
	assert.equal(r.headers.get('cache-control'), 'no-store');
	const data = JSON.parse(/<script type="application\/json" id="dt-bundle">([\s\S]*?)<\/script>/.exec(r.text)[1]);
	assert.equal(data, BUNDLE);
	assert.ok(r.text.includes('<script>window.guest=1</script>'));
	assert.ok(!/ src=| nonce=| integrity=/.test(r.text));
});
test('unknown modules, unknown kinds and path tricks are 404', async () => {
	for (const p of ['nope/list.html', 'northwind/evil.html', 'northwind/list', '..%2Fui/list.html', 'northwind/list.html/x']) {
		assert.equal((await call(`${frameBase()}/${p}`)).status, 404, p);
	}
	assert.equal((await call(`${web.url}/_frames/wrong-key/northwind/list.html`)).status, 404, 'a wrong key');
	assert.equal((await call(`${frameBase()}/northwind/list.html`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});
test('without the guest from @dreamteamer/ui the frame says so, 503', async () => {
	const r = await call(`${frameBase(bare)}/northwind/list.html`);
	assert.equal(r.status, 503);
	assert.match(r.text, /@dreamteamer\/ui/);
});
test('a page at [::1] is redirected to 127.0.0.1 before the app boots', async () => {
	const status = await new Promise((resolve, reject) => {
		const q = http.request({ host: '127.0.0.1', port: web.port, path: '/some/route?x=1', headers: { host: `[::1]:${web.port}`, cookie } }, (res) => { res.resume(); resolve([res.statusCode, res.headers.location]); });
		q.on('error', reject); q.setTimeout(10_000, () => q.destroy(new Error('timeout'))); q.end();
	});
	assert.deepEqual(status, [302, `http://127.0.0.1:${web.port}/some/route?x=1`]);
});
test('the app page frames only /_frames/ and /_files/ of its own host', () => {
	const csp = page.headers.get('content-security-policy');
	assert.ok(csp.includes(`frame-src http://127.0.0.1:${web.port}/_frames/ http://127.0.0.1:${web.port}/_files/;`), csp);
});
test('the README says what the bridge enforces and what a module app can still do', () => {
	const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
	const table = readme.slice(readme.indexOf('| **protects against**'), readme.indexOf('Found a hole?'));
	assert.doesNotMatch(table, /runs in the page with your session/);
	assert.match(table, /a module's app — from an npm package or a workspace under `git_modules\/` — using your session/);
	assert.match(table, /grants nothing/);
	assert.match(table, /a peer connection \(WebRTC\)/);
	assert.match(readme, /\.vscode\/settings\.json` is a file git tracks/);
	assert.doesNotMatch(readme, /\/ui-modules\//);
	assert.match(readme, /`\[::1\]` is redirected to `127\.0\.0\.1`/);
});

test('a page opened at localhost frames from localhost, so its frames are same-origin', async () => {
	const r = await new Promise((resolve, reject) => {
		const q = http.request({ host: '127.0.0.1', port: web.port, path: '/app/', headers: { host: `localhost:${web.port}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ csp: res.headers['content-security-policy'], body: b })); });
		q.on('error', reject); q.setTimeout(10_000, () => q.destroy(new Error('timeout'))); q.end();
	});
	assert.ok(r.csp.includes(`frame-src http://localhost:${web.port}/_frames/ http://localhost:${web.port}/_files/;`), r.csp);
	assert.ok(r.csp.includes(`script-src 'nonce-`) && r.csp.includes(`http://localhost:${web.port}/app/`), r.csp);
});
