// HELD-OUT cr-modules-017-h2 (rnd/tests dreamteamer-modules/heldout-m017-m-listener-path-and-method-edges), written by
// the test stage from the record alone: paths that classify differently after percent-decoding, HEAD and OPTIONS on
// each prefix, a JSON content type with a non-JSON body, and a Range request on a record file. Raw node:http
// requests, so no path is normalised; signed in with a cookie and same-origin headers unless said.
//
// Reading of step 3's "HEAD on a served prefix": the prefixes that serve bytes without a session (/, /app/, /_files/,
// /_frames/) must answer HEAD with the GET's status; on /api/ and /_dt/ HEAD must carry no body and never a 5xx.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, cleanupTmps, fixture, machine, pair, raw, startWeb } from './cr-modules-017-lib.mjs';

let f, m, web, cookie, info, base, mediaFile, recordFile, recordBefore;
const H = () => ({ cookie, 'sec-fetch-site': 'same-origin' });
const ENV_SECRET = 'DT_WEB_TEST_MEDIA';
const alive = async () => {
	const r = await raw(`${base}/api/info`, { headers: H() });
	assert.equal(r.status, 200, `GET /api/info after the step: ${r.status} ${r.body}`);
};

before(async () => {
	m = machine();
	f = fixture();
	// a module app frame to serve (the compiled bundle the frame route reads)
	fs.mkdirSync(path.join(f.root, '.dreamteamer', 'ui', 'probe'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.dreamteamer', 'ui', 'probe', 'app.js'), 'export default () => {};\n');
	// a record file of 100 bytes under the declared variable's folder
	mediaFile = path.join(f.media, 'range.txt');
	fs.writeFileSync(mediaFile, '0123456789abcdefghij'.repeat(5));
	web = await startWeb({ root: f.root, appDir: APP_DIR, stateDir: m.state, idleMinutes: 0 });
	base = web.url;
	cookie = await pair(web);
	info = await raw(`${base}/api/info`, { headers: H() });
	assert.equal(info.status, 200);
	recordFile = fs.readdirSync(path.join(f.root, 'data', 'tasks')).map((x) => path.join(f.root, 'data', 'tasks', x)).find((x) => x.includes('brief-dana'));
	recordBefore = fs.readFileSync(recordFile, 'utf8');
});
after(async () => { await web?.close(); f?.cleanupAll(); cleanupTmps(); });

describe('step 1: traversal through percent-encoded segments under /_files/', () => {
	for (const p of ['..%2F.env', '%2e%2e/.env', 'data%2F..%2F..%2F.env']) {
		test(`GET /_files/<key>/w/${p} is 404 and carries no byte of .env`, async () => {
			const r = await raw(base, { path: `/_files/${web.filesKey}/w/${p}`, headers: H() });
			assert.equal(r.status, 404, `${r.status} ${r.body.slice(0, 200)}`);
			assert.ok(!r.body.includes(ENV_SECRET) && !r.body.includes(f.media), 'a byte of .env is in the response');
		});
	}
	test('the server still answers', alive);
});

describe('step 2: paths that would reach the API or the control routes only after decoding', () => {
	for (const p of ['/api%2Finfo', '/app/..%2Fapi/info', '/app/%2e%2e/api/info', '/APP/']) {
		test(`${p} is 404 (or 400) and never answers /info's body`, async () => {
			const r = await raw(base, { path: p, headers: H() });
			assert.ok(r.status === 404 || r.status === 400, `${p} answered ${r.status}: ${r.body.slice(0, 200)}`);
			assert.notEqual(r.body, info.body, `${p} answered /info's body`);
		});
	}
	test('/_dt%2Fpane with the control token is 404 (or 400) and answers no pane', async () => {
		const r = await raw(base, { path: '/_dt%2Fpane', headers: { authorization: `Bearer ${web.controlToken}` } });
		assert.ok(r.status === 404 || r.status === 400, `answered ${r.status}: ${r.body.slice(0, 200)}`);
		assert.doesNotMatch(r.body, /"connected"|"queue"/);
	});
	test('the server still answers', alive);
});

describe('step 3: HEAD and OPTIONS on each prefix', () => {
	const served = () => ['/', '/app/', `/_files/${web.filesKey}/v/${ENV_SECRET}/range.txt`, `/_frames/${web.filesKey}/probe/app.html`];
	const authed = ['/api/info', '/_dt/workspaces'];
	test('HEAD on a served prefix answers the GET\'s status with no body', async () => {
		for (const p of served()) {
			const g = await raw(base, { path: p, headers: H() });
			const h = await raw(base, { path: p, method: 'HEAD', headers: H() });
			assert.equal(h.status, g.status, `HEAD ${p}: ${h.status}, GET ${g.status}`);
			assert.equal(h.body, '', `HEAD ${p} carried a body`);
		}
	});
	test('HEAD on /api/ and /_dt/ carries no body and is never a 5xx', async () => {
		for (const p of authed) {
			const h = await raw(base, { path: p, method: 'HEAD', headers: H() });
			assert.equal(h.body, '');
			assert.ok(h.status < 500, `HEAD ${p}: ${h.status}`);
		}
	});
	test('HEAD /sign-in/<code> does not consume the code (a following GET signs in) or is 405 — never a session without a GET', async () => {
		const url = new URL(web.pair());
		const h = await raw(base, { path: url.pathname, method: 'HEAD' });
		assert.equal(h.headers['set-cookie'], undefined, 'HEAD set a cookie');
		const g = await raw(base, { path: url.pathname });
		assert.ok(h.status === 405 || g.status === 302, `HEAD ${h.status}, then GET ${g.status}`);
	});
	test('OPTIONS answers 204 or 405 with no Access-Control-Allow-* header on every prefix', async () => {
		const code = new URL(web.pair()).pathname;
		const rows = [];
		for (const p of [...served(), code, ...authed]) {
			const r = await raw(base, { path: p, method: 'OPTIONS', headers: { ...H(), origin: 'http://evil.example', 'access-control-request-method': 'PATCH' } });
			const acl = Object.keys(r.headers).filter((k) => k.startsWith('access-control-allow'));
			rows.push(`${p.replace(web.filesKey, '<key>')} → ${r.status}${acl.length ? ` ${acl}` : ''}`);
			assert.deepEqual(acl, [], `OPTIONS ${p} carried ${acl}`);
		}
		// the same requests from the pane's own origin (no foreign Origin), where a preflight would be answered
		for (const p of [...served(), code, ...authed]) {
			const r = await raw(base, { path: p, method: 'OPTIONS', headers: H() });
			const acl = Object.keys(r.headers).filter((k) => k.startsWith('access-control-allow'));
			rows.push(`${p.replace(web.filesKey, '<key>')} (same-origin) → ${r.status}${acl.length ? ` ${acl}` : ''}`);
			assert.deepEqual(acl, [], `OPTIONS ${p} carried ${acl}`);
		}
		const bad = rows.filter((r) => r.includes('(same-origin)') && !/→ (204|405)\b/.test(r));
		assert.deepEqual(bad, [], `OPTIONS answered neither 204 nor 405:\n${rows.join('\n')}`);
	});
	test('the server still answers', alive);
});

describe('step 4: a write\'s content type', () => {
	const p = '/api/collections/tasks/records/brief-dana';
	test('Content-Type: application/json with the body "not json" is 400 or 415 naming a JSON body; the file is unchanged', async () => {
		const r = await raw(base, { path: p, method: 'PATCH', headers: { ...H(), 'content-type': 'application/json' }, body: 'not json' });
		assert.ok(r.status === 400 || r.status === 415, `${r.status} ${r.body}`);
		assert.match(r.body, /JSON/);
		assert.equal(fs.readFileSync(recordFile, 'utf8'), recordBefore);
	});
	test('application/json; charset=utf-8 with a valid body saves', async () => {
		const r = await raw(base, { path: p, method: 'PATCH', headers: { ...H(), 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ done: true }) });
		assert.equal(r.status, 200, r.body);
		assert.match(fs.readFileSync(recordFile, 'utf8'), /done: true/);
	});
	test('a valid body with no Content-Type is 415, and nothing is written', async () => {
		const was = fs.readFileSync(recordFile, 'utf8');
		const r = await raw(base, { path: p, method: 'PATCH', headers: H(), body: JSON.stringify({ done: false }) });
		assert.equal(r.status, 415, `${r.status} ${r.body}`);
		assert.equal(fs.readFileSync(recordFile, 'utf8'), was);
	});
	test('the server still answers', alive);
});

describe('step 5: a Range request on a record file', () => {
	test('200 with the whole file or 206 with exactly bytes 0-9; CSP sandbox and nosniff either way', async () => {
		const r = await raw(base, { path: `/_files/${web.filesKey}/v/${ENV_SECRET}/range.txt`, headers: { ...H(), range: 'bytes=0-9' } });
		const whole = fs.readFileSync(mediaFile, 'utf8');
		if (r.status === 206) {
			assert.equal(r.body, whole.slice(0, 10));
			assert.equal(r.headers['content-range'], `bytes 0-9/${whole.length}`);
		} else {
			assert.equal(r.status, 200, `${r.status} ${r.body.slice(0, 100)}`);
			assert.equal(r.body, whole);
		}
		assert.match(r.headers['content-security-policy'] ?? '', /\bsandbox\b/);
		assert.equal(r.headers['x-content-type-options'], 'nosniff');
	});
	test('the server still answers', alive);
});
