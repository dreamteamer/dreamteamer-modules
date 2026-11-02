// cr-modules-008 task 6: module apps leave the app origin — the files origin serves each module frame as one
// self-contained document; the page carries the person's grant; [::1] goes to 127.0.0.1; the README says so.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { FRAME_POLICY } from '@dreamteamer/protocol/frame-document';
import { startWeb } from '../src/server.js';
import { fixture, call } from './support.mjs';

const BUNDLE = 'export const Y = "</script> Grüße";\nexport default function register(api) {}\n';
let f, web, bare, cookie, page;
const sign = async (w) => { const r = await call(w.signInUrl()); return r.headers.get('set-cookie').split(';')[0]; };
before(async () => {
	f = fixture();
	fs.mkdirSync(path.join(f.root, '.dreamteamer', 'ui', 'northwind'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.dreamteamer', 'ui', 'northwind', 'app.js'), BUNDLE);
	fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), '{ // grant\n "dreamteamer.moduleApps": { "northwind": { "reads": ["users"], "writes": ["projects"] } } }');
	fs.writeFileSync(path.join(f.root, 'hq.code-workspace'), '{"settings": {"dreamteamer.moduleApps": {"northwind": {"reads": ["contacts"]}}}}');
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, moduleGuest: { guestText: 'window.guest=1', styleText: 'body{margin:0}' } });
	bare = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, moduleGuest: null });
	cookie = await sign(web);
	page = await call(`${web.appUrl}/`, { headers: { cookie } });
});
after(async () => { await web?.close(); await bare?.close(); f?.cleanupAll(); });
const globals = () => JSON.parse(/Object\.assign\(window, (\{.*?\})\);/s.exec(page.text)[1].replace(/\\u003c/g, '<'));
const frameBase = () => `${globals().__DT_FILES__}/_dt/frame`;

test('the page carries the grant from the root .vscode/settings.json only, and frames by URL', () => {
	const g = globals();
	assert.deepEqual(g.__DT_MODULE_GRANTS__, { northwind: { reads: ['users'], writes: ['projects'] } });
	assert.equal(g.__DT_HOST__.moduleFrames, 'url');
	assert.equal(g.__DT_UI_BASE__, undefined);
});
test('/ui-modules/ is no longer served on the app origin', async () => {
	assert.equal((await call(`${web.appUrl}/ui-modules/northwind/app.js`, { headers: { cookie } })).status, 404);
});
test('the files origin serves a module frame: one document, the bundle as data, the frame policy and frame-ancestors', async () => {
	const r = await call(`${frameBase()}/northwind/list.html`, { headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'iframe' } });
	assert.equal(r.status, 200);
	assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(r.headers.get('content-security-policy'), `sandbox allow-scripts; ${FRAME_POLICY}; frame-ancestors http://127.0.0.1:${web.appPort} http://localhost:${web.appPort}`);
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
});
test('without the guest from @dreamteamer/ui the frame says so, 503', async () => {
	const c = await sign(bare);
	const p = await call(`${bare.appUrl}/`, { headers: { cookie: c } });
	const files = JSON.parse(/Object\.assign\(window, (\{.*?\})\);/s.exec(p.text)[1]).__DT_FILES__;
	const r = await call(`${files}/_dt/frame/northwind/list.html`);
	assert.equal(r.status, 503);
	assert.match(r.text, /@dreamteamer\/ui/);
});
test('a page at [::1] is redirected to 127.0.0.1 before the app boots', async () => {
	const status = await new Promise((resolve, reject) => {
		const q = http.request({ host: '127.0.0.1', port: web.appPort, path: '/some/route?x=1', headers: { host: `[::1]:${web.appPort}`, cookie } }, (res) => { res.resume(); resolve([res.statusCode, res.headers.location]); });
		q.on('error', reject); q.setTimeout(10_000, () => q.destroy(new Error('timeout'))); q.end();
	});
	assert.deepEqual(status, [302, `http://127.0.0.1:${web.appPort}/some/route?x=1`]);
});
test('the app page frames only the module frames and record files of this start', () => {
	const csp = page.headers.get('content-security-policy');
	const files = globals().__DT_FILES__;
	assert.match(csp, new RegExp(`frame-src ${files.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/_dt/frame/ ${files.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/w/;`));
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
