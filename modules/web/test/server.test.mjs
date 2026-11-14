// dt web's ONE listener (cr-modules-017 §1, §3; rnd/tests/dreamteamer-modules/pane-a3-one-listener-one-process, first
// half): the shell without a cookie under the app policy, sign-in by a single-use code into a browser-session SameSite=Strict
// cookie, Fetch-Metadata on every cookie request, JSON-only writes, record files and frames on the same port under
// sandbox, the [::1] redirect, and a bad request that never stops the server.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { startWeb } from '../src/server.js';
import { appCsp } from '../src/headers.js';
import { fixture, call, rawGet, pair, sameOrigin } from './support.mjs';

let f, web, cookie, origin;
before(async () => {
	f = fixture();
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, stateDir: f.state });
	origin = `http://127.0.0.1:${web.port}`;
	cookie = await pair(web);
});
after(async () => { await web?.close(); f?.cleanupAll(); });

const api = (p, o = {}) => call(`${web.url}/api${p}`, { ...o, headers: { cookie, ...sameOrigin(), ...(o.headers ?? {}) } });
const files = (rel) => `${web.url}/_files/${web.filesKey}${rel}`;

describe('the shell', () => {
	test('/ is a 302 to /app/', async () => {
		const r = await call(`${web.url}/`);
		assert.equal(r.status, 302);
		assert.equal(r.headers.get('location'), '/app/');
	});

	test('the shell answers without a cookie, under the app policy for the request\'s Host, with __DT_HOST__ only', async () => {
		for (const host of [`127.0.0.1:${web.port}`, `localhost:${web.port}`]) {
			const r = await new Promise((resolve, reject) => {
				const q = http.request({ host: '127.0.0.1', port: web.port, path: '/app/', headers: { host } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: b })); });
				q.on('error', reject); q.setTimeout(10_000, () => q.destroy(new Error('timeout'))); q.end();
			});
			assert.equal(r.status, 200, host);
			const csp = r.headers['content-security-policy'];
			const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
			assert.ok(nonce, csp);
			assert.equal(csp, appCsp(nonce, host));
			assert.equal(r.headers['cache-control'], 'no-store');
			assert.equal(r.headers['set-cookie'], undefined);
			const inline = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
			assert.equal(inline.length, 1, 'one inline script: the boot');
			assert.ok(inline[0][0].startsWith(`<script nonce="${nonce}">`));
			const boot = JSON.parse(/Object\.assign\(window, (\{.*\})\);/s.exec(inline[0][1])[1]);
			assert.deepEqual(Object.keys(boot), ['__DT_HOST__']);
			assert.deepEqual(boot.__DT_HOST__, { nav: 'app', commands: false, openFile: 'tab', tabs: false, history: 'hash', moduleFrames: 'url' });
			for (const secret of ['_files', web.filesKey, web.controlToken, f.root, fs.realpathSync(f.root), f.media]) assert.equal(r.text.includes(secret), false, `the shell holds ${secret}`);
			assert.ok(r.text.indexOf('<script nonce') < r.text.indexOf('type="module"'), 'the boot globals are set before the app runs');
		}
		assert.equal((await call(`${web.url}/app/index.html`)).status, 200);
		const asset = await call(`${web.url}/app/assets/app.js`);
		assert.equal(asset.status, 200);
		assert.match(asset.headers.get('content-type'), /javascript/);
		assert.equal((await call(`${web.url}/app/assets/..%2F..%2Fpackage.json`)).status, 404);
		assert.equal((await call(`${web.url}/app/nope.js`)).status, 404);
	});

	test('the base headers on every answer', async () => {
		const r = await call(`${web.url}/app/`);
		assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
		assert.equal(r.headers.get('x-powered-by'), null);
	});

	test('the shell and sign-in accept same-site and none, and refuse cross-site', async () => {
		for (const site of ['same-origin', 'same-site', 'none']) {
			assert.equal((await call(`${web.url}/app/`, { headers: { 'sec-fetch-site': site } })).status, 200, site);
			assert.equal((await call(web.pair(), { headers: { 'sec-fetch-site': site } })).status, 302, site);
		}
		assert.equal((await call(`${web.url}/app/`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
		const code = web.pair();
		assert.equal((await call(code, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
		assert.equal((await call(`${web.url}/`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
	});

	test('a path no prefix names is 404 before anything else', async () => {
		for (const p of ['/api', '/apix/info', '/assets/app.js', '/index.html', '/%61pi/info', '//api/info']) {
			assert.equal((await call(`${web.url}${p}`, { headers: { cookie, ...sameOrigin() } })).status, 404, p);
		}
	});
});

describe('sign-in', () => {
	test('a code signs in once, into dt_pane_<port>: HttpOnly, SameSite=Strict, Path=/, no Max-Age (a browser-session cookie)', async () => {
		const url = web.pair();
		assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:${web.port}/sign-in/[\\w-]+$`));
		assert.equal(url.includes(web.controlToken), false);
		const first = await call(url);
		assert.equal(first.status, 302);
		assert.equal(first.headers.get('location'), '/app/#/');
		assert.match(first.headers.get('set-cookie'), new RegExp(`^dt_pane_${web.port}=[\\w-]+; HttpOnly; SameSite=Strict; Path=/$`));
		const again = await call(url);
		assert.equal(again.status, 401);
		assert.match(again.text, /This sign-in link was used or is older than a minute — ask the chat to show the pane again \(dt web open\)\./);
		assert.equal((await call(`${web.url}/sign-in/nope`)).status, 401);
	});

	test('a code minted with a route lands there', async () => {
		const r = await call(web.pair({ route: '/content/tasks' }));
		assert.equal(r.headers.get('location'), '/app/#/content/tasks');
	});

	test('the state file holds no session: neither the sid nor its hash', () => {
		const sid = cookie.split('=')[1];
		const sha = crypto.createHash('sha256').update(sid).digest('hex');
		const text = fs.readdirSync(f.state).filter((n) => n.endsWith('.json')).map((n) => fs.readFileSync(path.join(f.state, n), 'utf8')).join('\n');
		assert.ok(text.length > 0, 'no state was written');
		assert.equal(text.includes(sid), false);
		assert.equal(text.includes(sha), false);
		assert.doesNotMatch(text, /"sessions"/);
	});
});

describe('the cookie on /api/', () => {
	test('needs Sec-Fetch-Site: same-origin or the request\'s own Origin — never neither, never null, never cross-site', async () => {
		const at = (headers) => call(`${web.url}/api/info`, { headers: { cookie, ...headers } }).then((r) => r.status);
		assert.equal(await at({}), 403);
		assert.equal(await at({ 'sec-fetch-site': 'same-origin' }), 200);
		assert.equal(await at({ origin }), 200);
		assert.equal(await at({ origin: 'null' }), 403, 'what a sandboxed record file sends');
		assert.equal(await at({ origin: 'null', 'sec-fetch-site': 'same-origin' }), 403);
		assert.equal(await at({ 'sec-fetch-site': 'cross-site' }), 403);
		assert.equal(await at({ 'sec-fetch-site': 'same-site' }), 403);
		assert.equal(await at({ origin: `http://localhost:${web.port}` }), 403, 'an Origin that is not the request\'s own Host');
		const refused = await call(`${web.url}/api/info`, { headers: { cookie } });
		assert.match(refused.json.error, /a request with the pane's cookie must come from the pane/);
	});

	test('no cookie, a wrong cookie, or the control token is 401 on /api/', async () => {
		assert.equal((await call(`${web.url}/api/info`, { headers: sameOrigin() })).status, 401);
		assert.equal((await call(`${web.url}/api/info`, { headers: { cookie: `dt_pane_${web.port}=forged`, ...sameOrigin() } })).status, 401);
		assert.equal((await call(`${web.url}/api/info`, { headers: { authorization: `Bearer ${web.controlToken}` } })).status, 401);
	});

	test('a foreign Host or Origin is 403', async () => {
		assert.equal(await rawGet(`${web.url}/api/info`, { cookie, 'sec-fetch-site': 'same-origin', host: `evil.example:${web.port}` }), 403);
		assert.equal(await rawGet(`${web.url}/api/info`, { cookie, 'sec-fetch-site': 'same-origin', host: `localhost.evil.example:${web.port}` }), 403);
		assert.equal((await api('/info', { headers: { origin: 'http://evil.example' } })).status, 403);
		for (const h of ['127.0.0.1', 'localhost']) assert.equal(await rawGet(`${web.url}/api/info`, { cookie, 'sec-fetch-site': 'same-origin', host: `${h}:${web.port}` }), 200, h);
	});

	test('a write takes Content-Type: application/json only', async () => {
		const body = JSON.stringify({ name: 'Call Sam' });
		for (const type of ['text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', undefined]) {
			const r = await api('/collections/tasks/records', { method: 'POST', headers: type ? { 'content-type': type } : {}, body });
			assert.equal(r.status, 415, `${type}: ${r.text}`);
		}
		const ok = await api('/collections/tasks/records', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body });
		assert.equal(ok.status, 200, ok.text);
		const bad = await api('/collections/tasks/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":' });
		assert.equal(bad.status, 400);
	});

	test('a record change on disk reaches an open event stream within five seconds', async () => {
		const ctrl = new AbortController();
		const res = await fetch(`${web.url}/api/events`, { headers: { cookie, ...sameOrigin() }, signal: ctrl.signal });
		assert.equal(res.status, 200);
		const reader = res.body.getReader();
		await new Promise((r) => setTimeout(r, 50));
		assert.equal(web.clients(), 1);
		const t0 = Date.now();
		setTimeout(() => f.dt('set', 'projects/northwind-launch', 'status=paused'), 200);
		let got = '';
		while (!got.includes('dt:invalidate') && Date.now() - t0 < 5000) {
			const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined }), 5000))]);
			if (done) break;
			if (value) got += Buffer.from(value).toString();
		}
		web.broadcast({ type: 'dt:navigate', route: '/content/tasks' });
		const { value } = await reader.read();
		got += Buffer.from(value).toString();
		ctrl.abort();
		assert.match(got, /"type":"dt:invalidate","scope":"data"/);
		assert.match(got, /data: \{"type":"dt:navigate","route":"\/content\/tasks"\}/);
		assert.ok(Date.now() - t0 < 5000);
		await new Promise((r) => setTimeout(r, 100));
		assert.equal(web.clients(), 0);
	});
});

describe('/_dt/', () => {
	test('the control token pairs; a cookie or no token does not', async () => {
		const r = await call(`${web.url}/_dt/pair`, { method: 'POST', headers: { authorization: `Bearer ${web.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ route: '/content/tasks' }) });
		assert.equal(r.status, 200, r.text);
		assert.match(r.json.url, /\/sign-in\//);
		assert.equal((await call(r.json.url)).headers.get('location'), '/app/#/content/tasks');
		assert.equal((await call(`${web.url}/_dt/pair`, { method: 'POST', headers: { cookie, ...sameOrigin(), 'content-type': 'application/json' }, body: '{}' })).status, 401);
		assert.equal((await call(`${web.url}/_dt/pair`, { method: 'POST' })).status, 401);
		assert.equal((await call(`${web.url}/_dt/pair`, { method: 'POST', headers: { authorization: 'Bearer nope' } })).status, 401);
		assert.equal((await call(`${web.url}/_dt/pair`, { method: 'POST', headers: { cookie } })).status, 403, 'a cookie without Fetch-Metadata');
	});
});

describe('record files under /_files/<key>/', () => {
	test('a declared root\'s file is served sandboxed, with no cookie read; everything else is refused', async () => {
		const img = await call(files('/v/DT_WEB_TEST_MEDIA/board.png'));
		assert.equal(img.status, 200);
		assert.equal(img.headers.get('content-security-policy'), 'sandbox');
		assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(img.headers.get('set-cookie'), null);
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/board.png'), { method: 'HEAD' })).status, 200);
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/..%2Foutside.txt'))).status, 404);
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/%2E%2E/x'))).status, 404);
		assert.equal((await call(files(`/w/${encodeURIComponent(path.join(f.root, 'report.html'))}`))).status, 404, 'an absolute path');
		fs.symlinkSync(path.join(f.root, 'outside.txt'), path.join(f.media, 'link-out.txt'));
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/link-out.txt'))).status, 404, 'a link out of the root');
		assert.equal((await call(`${web.url}/_files/wrong-key/v/DT_WEB_TEST_MEDIA/board.png`)).status, 404);
		assert.equal((await call(files('/w/outside.txt'))).status, 404, 'a workspace file that is no record file');
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/board.png'), { method: 'POST' })).status, 405);
	});

	test('HTML and SVG download unless ?frame=1; scripts and styles are octet-stream', async () => {
		const html = await call(files('/w/report.html'));
		assert.equal(html.status, 200);
		assert.equal(html.headers.get('content-disposition'), 'attachment');
		const framed = await call(files('/w/report.html?frame=1'));
		assert.equal(framed.headers.get('content-disposition'), null);
		assert.equal(framed.headers.get('content-security-policy'), 'sandbox');
		assert.match(framed.headers.get('content-type'), /^text\/html/);
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/logo.svg'))).headers.get('content-disposition'), 'attachment');
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/widget.js'))).headers.get('content-type'), 'application/octet-stream');
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/theme.css'))).headers.get('content-type'), 'application/octet-stream');
	});
});

describe('[::1]', () => {
	test('a request at [::1] is sent to 127.0.0.1, path and query kept', async () => {
		const viaHost = await new Promise((resolve, reject) => {
			const q = http.request({ host: '127.0.0.1', port: web.port, path: '/app/?x=1', headers: { host: `[::1]:${web.port}` } }, (res) => { res.resume(); resolve([res.statusCode, res.headers.location]); });
			q.on('error', reject); q.setTimeout(10_000, () => q.destroy(new Error('timeout'))); q.end();
		});
		assert.deepEqual(viaHost, [302, `http://127.0.0.1:${web.port}/app/?x=1`]);
		const v6 = await new Promise((resolve) => {
			const q = http.request({ host: '::1', port: web.port, path: '/api/info', family: 6 }, (res) => { res.resume(); resolve([res.statusCode, res.headers.location]); });
			q.on('error', () => resolve(null)); q.setTimeout(5_000, () => q.destroy()); q.end();
		});
		if (v6) assert.deepEqual(v6, [302, `http://127.0.0.1:${web.port}/api/info`]);
	});
});

describe('a bad request never stops the server', () => {
	test('a malformed percent-escape answers 400; a POST abandoned mid-body is dropped; a raw unparsable URL answers; the server still serves', { timeout: 30_000 }, async () => {
		assert.equal((await call(`${web.url}/app/assets/%E0%A4%A`)).status, 400);
		assert.equal((await api('/collections/tasks/records/%E0%A4%A')).status, 400);
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/%E0%A4%A'))).status, 400);
		await new Promise((resolve) => {
			const req = http.request(`${web.url}/api/collections/tasks/records`, { method: 'POST', headers: { cookie, ...sameOrigin(), 'content-type': 'application/json', 'content-length': '1000' } });
			req.on('error', () => resolve());
			req.write('{"name":');
			setTimeout(() => { req.destroy(); resolve(); }, 200);
		});
		const raw = await new Promise((resolve) => {
			const s = net.connect(web.port, '127.0.0.1', () => s.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${web.port}\r\nConnection: close\r\n\r\n`));
			let out = '';
			s.on('data', (b) => { out += b; });
			s.on('close', () => resolve(out));
			s.on('error', () => resolve(out));
		});
		assert.match(raw, /^HTTP\/1\.1 [45]\d\d/);
		const locked = path.join(f.media, 'locked.png');
		fs.writeFileSync(locked, 'x');
		fs.chmodSync(locked, 0o000);
		assert.ok((await call(files('/v/DT_WEB_TEST_MEDIA/locked.png'))).status >= 400);
		fs.chmodSync(locked, 0o600);
		await new Promise((r) => setTimeout(r, 200));
		assert.equal((await api('/info')).status, 200, 'the server died');
		assert.equal((await call(files('/v/DT_WEB_TEST_MEDIA/locked.png'))).status, 200);
	});
});
