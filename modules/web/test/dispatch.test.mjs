// The prefix dispatcher of the one listener (cr-modules-017 §1) and the app's policy: a path reaches the API only
// when it begins `/api/` exactly — no case folding, no decoding, no doubled slash — and the policy lets nothing
// under /_files/ run as app code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFIXES, classify } from '../src/dispatch.js';
import { appCsp, FILE_CSP, FRAME_CSP_PREFIX } from '../src/headers.js';

test('each prefix classifies', () => {
	assert.deepEqual(PREFIXES.map((p) => p.kind), ['sign-in', 'shell', 'root', 'api', 'dt', 'files', 'frames']);
	const cases = {
		'/sign-in/abc': 'sign-in', '/app/': 'shell', '/app/index.html': 'shell', '/app/assets/app.js': 'shell', '/': 'root',
		'/api/info': 'api', '/api/': 'api', '/api/collections/lab%2Fsamples/records/2026/11/a': 'api', '/api/events': 'api',
		'/_dt/pair': 'dt', '/_dt/pane/delivered': 'dt', '/_files/k/w/report.html': 'files', '/_frames/k/lab/app.html': 'frames',
	};
	for (const [p, kind] of Object.entries(cases)) assert.equal(classify(p), kind, p);
});

test('thirty near-misses classify as nothing', () => {
	const misses = [
		'/api', '/API/x', '/Api/info', '/apix/', '/apix', '/%2Fapi/', '/%61pi/info', '//api/x', '/./api/x', '/x/api/',
		'/app', '/APP/', '/appx/', '/%61pp/', '//app/', '/_dt', '/_DT/x', '/_dtx/', '/_files', '/_filesx/',
		'/_frames', '/_framesx/', '/sign-in', '/sign-inx/', '/assets/x.js', '/index.html', '', 'api/info', '/ ', '/\\api/',
	];
	assert.equal(misses.length, 30);
	for (const p of misses) assert.equal(classify(p), null, JSON.stringify(p));
	for (const p of [undefined, null, 7, {}]) assert.equal(classify(p), null);
});

test('only a path beginning /api/ is api', () => {
	const sample = ['/api/', '/api/x', '/api//x', '/api/../app/', '/apis/', '/ap/i/', '/_dt/api/', '/app/api/', '/%2Fapi/', '/api%2Finfo'];
	for (const p of sample) assert.equal(classify(p) === 'api', p.startsWith('/api/'), p);
});

test('the app policy, exactly, for the request\'s host', () => {
	const want = "default-src 'none'; script-src 'nonce-n' http://127.0.0.1:4870/app/; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
		+ "font-src 'self' data:; connect-src 'self'; frame-src http://127.0.0.1:4870/_frames/ http://127.0.0.1:4870/_files/; form-action 'none'; "
		+ "base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
	const csp = appCsp('n', '127.0.0.1:4870');
	assert.equal(csp, want);
	const script = csp.split('; ').find((d) => d.startsWith('script-src '));
	assert.equal(script.includes('unsafe-inline'), false);
	assert.equal(script.includes('unsafe-eval'), false);
	assert.equal(csp.includes('*'), false);
	assert.equal(appCsp('n', 'localhost:4870').includes('http://localhost:4870/app/'), true);
	assert.equal(FILE_CSP, 'sandbox');
	assert.equal(FRAME_CSP_PREFIX, 'sandbox allow-scripts');
});
