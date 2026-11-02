// dt web's two origins against the README's security contract: sign-in, the cookie, Host / Origin /
// Sec-Fetch-Site, the write rule, the headers and the CSP, the files origin's sandbox and containment, and
// live updates over server-sent events. One fixture, one server, closed in after().
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startWeb } from '../src/server.js';
import { fixture, call, rawGet } from './support.mjs';

let f, web, cookie;
before(async () => {
	f = fixture();
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0, signInTtlMs: 1500 });
});
after(async () => { await web?.close(); f?.cleanupAll(); });

describe('sign-in', () => {
	test('the bare address asks for the sign-in URL; a code signs in once, as an HttpOnly SameSite=Strict cookie', async () => {
		const bare = await call(`${web.appUrl}/`);
		assert.equal(bare.status, 401);
		assert.match(bare.text, /dt web url/);
		const url = web.signInUrl();
		assert.doesNotMatch(url, new RegExp(web.token), 'the printed URL carries the token');
		const first = await call(url);
		assert.equal(first.status, 302);
		assert.equal(first.headers.get('location'), '/');
		const set = first.headers.get('set-cookie');
		assert.match(set, /^dt_session=[^;]+; HttpOnly; SameSite=Strict; Path=\/$/);
		cookie = set.split(';')[0];
		assert.equal((await call(url)).status, 401, 'a used code signs in again');
	});

	test('an unused code expires', async () => {
		const url = web.signInUrl();
		await new Promise((r) => setTimeout(r, 1700));
		assert.equal((await call(url)).status, 401);
	});
});

describe('the app origin', () => {
	test('the page carries the boot script under an exact nonce CSP, and the base headers', async () => {
		const r = await call(`${web.appUrl}/`, { headers: { cookie } });
		assert.equal(r.status, 200);
		const csp = r.headers.get('content-security-policy');
		const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
		assert.ok(nonce, csp);
		assert.ok(r.text.includes(`<script nonce="${nonce}">`), 'the boot script lacks the nonce');
		for (const part of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "connect-src 'self'"]) assert.ok(csp.includes(part), `CSP lacks ${part}`);
		assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
		assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
		assert.equal(r.headers.get('x-powered-by'), null);
		assert.match(r.text, /"nav":"app"/);
		assert.doesNotMatch(r.text, new RegExp(web.token), 'the token is in the page');
	});

	test('a foreign Host or Origin, and any cross-site request, is 403', async () => {
		const port = new URL(web.appUrl).port;
		assert.equal(await rawGet(`${web.appUrl}/api/info`, { cookie, host: `evil.example:${port}` }), 403);
		assert.equal(await rawGet(`${web.appUrl}/api/info`, { cookie, host: `localhost.evil.example:${port}` }), 403);
		assert.equal((await call(`${web.appUrl}/api/info`, { headers: { cookie, origin: 'http://evil.example' } })).status, 403);
		assert.equal((await call(`${web.appUrl}/api/info`, { headers: { cookie, 'sec-fetch-site': 'cross-site' } })).status, 403);
		for (const h of ['127.0.0.1', 'localhost', '[::1]']) assert.equal(await rawGet(`${web.appUrl}/api/info`, { cookie, host: `${h}:${port}` }), 200, h);
	});

	test('a cookie write needs Origin or Sec-Fetch-Site: same-origin; a bearer write does not', async () => {
		const body = JSON.stringify({ name: 'Call Sam' });
		const bare = await call(`${web.appUrl}/api/collections/tasks/records`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body });
		assert.equal(bare.status, 403, bare.text);
		const origin = `http://127.0.0.1:${new URL(web.appUrl).port}`;
		const named = await call(`${web.appUrl}/api/collections/tasks/records`, { method: 'POST', headers: { cookie, origin, 'content-type': 'text/plain;charset=UTF-8' }, body });
		assert.equal(named.status, 200, named.text);
		const sfs = await call(`${web.appUrl}/api/collections/tasks/records/call-sam`, { method: 'PATCH', headers: { cookie, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ done: true }) });
		assert.equal(sfs.status, 200, sfs.text);
		const bearer = await call(`${web.appUrl}/api/collections/tasks/records/call-sam`, { method: 'PATCH', headers: { authorization: `Bearer ${web.token}` }, body: JSON.stringify({ done: false }) });
		assert.equal(bearer.status, 200, bearer.text);
		const notJson = await call(`${web.appUrl}/api/collections/tasks/records`, { method: 'POST', headers: { cookie, origin }, body: 'name=Ghost' });
		assert.equal(notJson.status, 415);
		assert.equal((await call(`${web.appUrl}/api/info`)).status, 401, 'no cookie and no token');
	});

	test('a record change on disk reaches an open event stream within five seconds', async () => {
		const ctrl = new AbortController();
		const res = await fetch(`${web.appUrl}/api/events`, { headers: { cookie }, signal: ctrl.signal });
		const reader = res.body.getReader();
		const t0 = Date.now();
		setTimeout(() => f.dt('set', 'projects/northwind-launch', 'status=paused'), 200);
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

describe('the files origin', () => {
	const base = () => `${web.filesOrigin}/${new URL(JSON.parse(/__DT_FILES__":("[^"]+")/.exec(lastPage)[1])).pathname.split('/')[1]}`;
	let lastPage = '';
	before(async () => { lastPage = (await call(`${web.appUrl}/`, { headers: { cookie } })).text; });

	test('serves a declared root\'s file sandboxed, needs no cookie, and refuses everything else', async () => {
		const img = await call(`${base()}/v/DT_WEB_TEST_MEDIA/board.png`);
		assert.equal(img.status, 200);
		assert.equal(img.headers.get('content-security-policy'), 'sandbox');
		assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(img.headers.get('set-cookie'), null);
		assert.equal((await call(`${base()}/v/DT_WEB_TEST_MEDIA/..%2Foutside.txt`)).status, 404);
		assert.equal((await call(`${base()}/v/DT_WEB_TEST_MEDIA/%2E%2E/x`)).status, 404);
		assert.equal((await call(`${web.filesOrigin}/wrong-key/v/DT_WEB_TEST_MEDIA/board.png`)).status, 404);
		assert.equal((await call(`${base()}/w/outside.txt`)).status, 404, 'a workspace file that is no record file');
		assert.equal((await call(`${base()}/v/DT_WEB_TEST_MEDIA/board.png`, { method: 'POST' })).status, 405);
		assert.equal((await call(`${web.filesOrigin}/api/info`)).status, 404, 'no API on the files origin');
	});

	test('SVG and HTML are attachments unless framed, and always sandboxed', async () => {
		const svg = await call(`${base()}/v/DT_WEB_TEST_MEDIA/logo.svg`);
		assert.equal(svg.headers.get('content-disposition'), 'attachment');
		const page = await call(`${base()}/w/report.html?frame=1`);
		assert.equal(page.status, 200);
		assert.equal(page.headers.get('content-disposition'), null);
		assert.equal(page.headers.get('content-security-policy'), 'sandbox');
	});
});
