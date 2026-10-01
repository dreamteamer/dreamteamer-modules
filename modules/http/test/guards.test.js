// The request guards: a write is JSON, a browser page on another origin and a DNS name rebound to
// this address are refused, /commit names what it publishes, and a host beyond loopback needs a token.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { api as engine } from '../../../tests/helpers/fixture.mjs';
import { httpWorkspace, simpleCollection, mount, call } from './support.mjs';
import { bind, serve } from '../src/app.js';
import { parseServeArgs } from '../src/extension.js';

let h, srv, api, pendingId;

const head = () => h.git(['rev-parse', 'HEAD']);
const records = () => fs.readdirSync(path.join(h.root, 'data', 'notes')).sort();

/** A request through node:http, which lets a test set the Host header. */
function rawGet(port, hostHeader) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port, path: '/api/info', headers: { host: hostHeader }, timeout: 20_000 }, (res) => {
			let text = '';
			res.on('data', (b) => { text += b; });
			res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text) }));
		});
		req.on('timeout', () => req.destroy(new Error('timed out')));
		req.on('error', reject);
		req.end();
	});
}

before(async () => {
	h = await httpWorkspace({ collections: { notes: simpleCollection({ storage: { suffix: 'note' } }) }, records: { notes: [{ name: 'One' }] } });
	pendingId = h.ids.notes[0];
	srv = await mount(h.ws);
	api = srv.base;
});
after(() => srv?.close());

describe('content type', () => {
	test('a cross-origin-simple text/plain POST /commit is 415 and commits nothing', async () => {
		const before = head();
		const { status, json } = await call('POST', `${api}/commit`, JSON.stringify({ only: [`notes/${pendingId}`] }), { 'content-type': 'text/plain' });
		assert.equal(status, 415, JSON.stringify(json));
		assert.match(json.error, /takes Content-Type: application\/json \(got text\/plain\)/);
		assert.equal(head(), before);
	});

	test('a form or a missing content type is 415 on a record write, and no record appears', async () => {
		const before = records();
		for (const headers of [{ 'content-type': 'application/x-www-form-urlencoded' }, { 'content-type': 'multipart/form-data; boundary=x' }]) {
			const { status } = await call('POST', `${api}/collections/notes/records`, 'name=Ghost', headers);
			assert.equal(status, 415, headers['content-type']);
		}
		const res = await fetch(`${api}/collections/notes/records`, { method: 'POST', signal: AbortSignal.timeout(20_000) });
		assert.equal(res.status, 415, 'no content type at all');
		const patch = await fetch(`${api}/collections/notes/records/${pendingId}`, { method: 'PATCH', body: 'x', headers: { 'content-type': 'text/plain' }, signal: AbortSignal.timeout(20_000) });
		assert.equal(patch.status, 415);
		assert.deepEqual(records(), before);
	});

	test('a DELETE with a non-JSON body is 415; a bodiless DELETE needs no content type', async () => {
		const typed = await call('DELETE', `${api}/collections/notes/records/${pendingId}`, 'x', { 'content-type': 'text/plain' });
		assert.equal(typed.status, 415);
		const added = await call('POST', `${api}/collections/notes/records`, { name: 'Disposable' });
		assert.equal(added.status, 201);
		const del = await fetch(`${api}/collections/notes/records/${added.json.id}`, { method: 'DELETE', signal: AbortSignal.timeout(20_000) });
		assert.equal(del.status, 200);
	});

	test('application/json with a charset is accepted', async () => {
		const { status } = await call('POST', `${api}/reload`, '{}', { 'content-type': 'application/json; charset=utf-8' });
		assert.equal(status, 200);
	});
});

describe('origin and host', () => {
	test('a request from another origin is 403, and a commit from one publishes nothing', async () => {
		const before = head();
		const post = await call('POST', `${api}/commit`, { only: [`notes/${pendingId}`] }, { origin: 'https://evil.example' });
		assert.equal(post.status, 403);
		assert.match(post.json.error, /Origin "https:\/\/evil\.example" may not call this api/);
		assert.equal(head(), before);
		const get = await call('GET', `${api}/info`, undefined, { origin: 'https://evil.example' });
		assert.equal(get.status, 403, 'reads are guarded too');
		const opaque = await call('GET', `${api}/info`, undefined, { origin: 'null' });
		assert.equal(opaque.status, 403, 'an opaque origin is not loopback');
		const otherPort = await call('GET', `${api}/info`, undefined, { origin: `http://127.0.0.1:${srv.port + 1}` });
		assert.equal(otherPort.status, 403, 'another loopback port is another origin');
	});

	test('the bound loopback origin, by address or by localhost, is allowed', async () => {
		for (const origin of [`http://127.0.0.1:${srv.port}`, `http://localhost:${srv.port}`]) {
			const { status } = await call('GET', `${api}/info`, undefined, { origin });
			assert.equal(status, 200, origin);
		}
	});

	test('a Host that is not this server — a rebound DNS name or another port — is 403', async () => {
		for (const host of [`evil.example:${srv.port}`, `127.0.0.1:${srv.port + 1}`, '127.0.0.1']) {
			const { status, json } = await rawGet(srv.port, host);
			assert.equal(status, 403, `${host}: ${JSON.stringify(json)}`);
		}
		for (const host of [`127.0.0.1:${srv.port}`, `localhost:${srv.port}`, `LOCALHOST:${srv.port}`]) {
			const { status } = await rawGet(srv.port, host);
			assert.equal(status, 200, host);
		}
	});
});

describe('POST /commit names what it publishes', () => {
	test('a missing, empty or blank `only` is 400 and commits nothing', async () => {
		const before = head();
		for (const body of [{}, { only: [] }, { only: [''] }, { message: 'everything' }]) {
			const { status, json } = await call('POST', `${api}/commit`, body);
			assert.equal(status, 400, JSON.stringify(body));
			assert.match(json.error, /needs "only": a non-empty array of targets/);
		}
		assert.equal(head(), before);
	});
});

describe('a token', () => {
	let tsrv;
	before(async () => { tsrv = await mount(h.ws, { token: 'correct-horse' }); });
	after(() => tsrv?.close());

	test('is required as a bearer token on every request', async () => {
		const none = await call('GET', `${tsrv.base}/info`);
		assert.equal(none.status, 401);
		const wrong = await call('GET', `${tsrv.base}/info`, undefined, { authorization: 'Bearer battery-staple' });
		assert.equal(wrong.status, 401);
		const right = await call('GET', `${tsrv.base}/info`, undefined, { authorization: 'Bearer correct-horse' });
		assert.equal(right.status, 200);
	});
});

describe('a host beyond loopback', () => {
	test('serve refuses it without a token, before anything listens', async () => {
		bind(engine);
		await assert.rejects(serve(h.ws, { host: '0.0.0.0', port: 0 }), /--host 0\.0\.0\.0 is beyond loopback and needs --token/);
	});

	test('serve accepts it with a token, and every request then carries it', async (t) => {
		bind(engine);
		// the listening line would land on the stdout the test runner reads its reports from
		const log = t.mock.method(console, 'log', () => {});
		const server = await serve(h.ws, { host: '0.0.0.0', port: 0, token: 'correct-horse' });
		try {
			const base = `http://127.0.0.1:${server.address().port}/api`;
			assert.equal((await call('GET', `${base}/info`)).status, 401);
			assert.equal((await call('GET', `${base}/info`, undefined, { authorization: 'Bearer correct-horse' })).status, 200);
			assert.match(String(log.mock.calls[0]?.arguments[0]), /dreamteamer api at http:\/\/0\.0\.0\.0:\d+\/api/);
		} finally { await new Promise((r) => server.close(r)); }
	});

	test('dt serve flags refuse it without --token and accept it with one', () => {
		assert.throws(() => parseServeArgs(['--host', '0.0.0.0']), /beyond loopback and needs --token/);
		assert.throws(() => parseServeArgs(['--host=192.0.2.10']), /beyond loopback/);
		assert.deepEqual(parseServeArgs(['--host', '0.0.0.0', '--token', 's']), { port: 8080, host: '0.0.0.0', token: 's' });
		for (const host of ['127.0.0.1', '127.0.0.2', '::1', '[::1]', 'localhost']) assert.equal(parseServeArgs(['--host', host]).host, host);
		assert.throws(() => parseServeArgs(['--token=']), /--token needs a value/);
	});

	test('the engine CLI refuses it with the reason and exit 1, printing nothing to stdout', () => {
		const r = h.dt('serve', '--host', '0.0.0.0', '--port', '0');
		assert.equal(r.code, 1);
		assert.match(r.stderr, /beyond loopback and needs --token/);
		assert.equal(r.stdout, '');
	});
});
