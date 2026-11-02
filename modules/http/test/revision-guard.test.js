// The two routes that hand a revision to the engine take a commit id or HEAD; a request a browser
// marks cross-site is refused; and every answer says how not to sniff it and leaks no referrer.
//
// git reads a revision that starts with a dash as an option, and some options write files, so the
// assertion that matters is "nothing was written": a refused hash leaves every file as it was.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { httpWorkspace, simpleCollection, mount } from './support.mjs';

let h, srv, port, id, first, head, tmp;

/** One request through node:http (which sends any header it is given), the answer parsed when JSON. */
function raw(method, urlPath, { headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({
			host: '127.0.0.1', port, method, path: `/api${urlPath}`, timeout: 20_000,
			headers: { ...(data !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
		}, (res) => {
			let text = '';
			res.on('data', (b) => { text += b; });
			res.on('end', () => {
				let json = null;
				try { json = text ? JSON.parse(text) : null; } catch { json = text; }
				resolve({ status: res.statusCode, headers: res.headers, json });
			});
		});
		req.on('timeout', () => req.destroy(new Error('timed out')));
		req.on('error', reject);
		req.end(data);
	});
}

/** A file outside the workspace that a refused hash must leave alone. */
function victim(name) {
	const p = path.join(tmp, name);
	fs.writeFileSync(p, 'KEEP ME\n');
	return p;
}
const untouched = (p) => {
	assert.equal(fs.readFileSync(p, 'utf8'), 'KEEP ME\n', `${p} was written`);
	assert.equal(fs.existsSync(`${p}~1`), false, `${p}~1 was created`);
};
const recordFile = () => path.join(h.root, 'data', 'notes', `${id}.note.md`);
const diffOf = (hash) => raw('GET', `/history-diff/notes/${id}?hash=${encodeURIComponent(hash)}`);
const NOT_A_COMMIT = /is not a commit id/;

before(async () => {
	tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'http-revision-guard-'));
	h = await httpWorkspace({ collections: { notes: simpleCollection({ storage: { suffix: 'note' } }) }, records: { notes: [{ name: 'One' }] } });
	id = h.ids.notes[0];
	h.git(['add', '-A']);
	h.git(['commit', '-qm', 'add one']);
	first = h.git(['rev-parse', 'HEAD']);
	fs.writeFileSync(recordFile(), `${fs.readFileSync(recordFile(), 'utf8')}\nA second line.\n`);
	h.git(['add', '-A']);
	h.git(['commit', '-qm', 'edit one']);
	head = h.git(['rev-parse', 'HEAD']);
	srv = await mount(h.ws);
	port = srv.port;
});
after(async () => {
	await srv?.close();
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe('a hash is a commit id or HEAD', () => {
	test('sec01-http-t1: history-diff refuses an option-shaped, non-commit or repeated hash and writes nothing', async () => {
		const target = victim('diff.txt');
		for (const hash of [`--output=${target}`, 'HEAD^', 'main', '']) {
			const { status, json } = await diffOf(hash);
			assert.equal(status, 400, `${JSON.stringify(hash)} → ${JSON.stringify(json)}`);
			assert.match(json.error, NOT_A_COMMIT);
		}
		const repeated = await raw('GET', `/history-diff/notes/${id}?hash=${head}&hash=HEAD`);
		assert.equal(repeated.status, 400, JSON.stringify(repeated.json));
		assert.match(repeated.json.error, NOT_A_COMMIT);
		untouched(target);
	});

	test('sec01-http-t2: records-revert refuses an option-shaped or missing hash; record, HEAD and file untouched', async () => {
		const before = fs.readFileSync(recordFile(), 'utf8');
		const target = victim('revert.txt');
		for (const body of [{ hash: `--output=${target}` }, {}, { hash: 1234 }]) {
			const { status, json } = await raw('POST', `/collections/notes/records-revert/${id}`, { body });
			assert.equal(status, 400, `${JSON.stringify(body)} → ${JSON.stringify(json)}`);
			assert.match(json.error, NOT_A_COMMIT);
		}
		assert.equal(fs.readFileSync(recordFile(), 'utf8'), before);
		assert.equal(h.git(['rev-parse', 'HEAD']), head);
		untouched(target);
	});
});

describe('a cross-site browser request', () => {
	test('sec01-http-t3: Sec-Fetch-Site cross-site is 403 on reads and writes; same-origin, none and absent are served', async () => {
		const requests = [
			['GET', '/info', undefined],
			['GET', `/history-diff/notes/${id}?hash=HEAD`, undefined],
			['POST', '/reload', {}],
		];
		for (const [method, p, body] of requests) {
			const refused = await raw(method, p, { body, headers: { 'sec-fetch-site': 'cross-site' } });
			assert.equal(refused.status, 403, `${method} ${p} cross-site → ${JSON.stringify(refused.json)}`);
			for (const site of ['same-origin', 'none', undefined]) {
				const res = await raw(method, p, { body, headers: site ? { 'sec-fetch-site': site } : {} });
				assert.equal(res.status, 200, `${method} ${p} ${site ?? 'no header'} → ${JSON.stringify(res.json)}`);
			}
		}
	});
});

describe('response headers', () => {
	test('sec01-http-t4: every answer carries nosniff and no-referrer, and none says x-powered-by', async () => {
		const answers = {
			200: await raw('GET', '/info'),
			400: await diffOf('main'),
			403: await raw('GET', '/info', { headers: { 'sec-fetch-site': 'cross-site' } }),
			404: await raw('GET', '/no-such-route'),
		};
		answers[302] = await new Promise((resolve, reject) => {
			http.get({ host: '127.0.0.1', port, path: '/', timeout: 20_000 }, (res) => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }); }).on('error', reject);
		});
		for (const [code, res] of Object.entries(answers)) {
			assert.equal(res.status, Number(code));
			assert.equal(res.headers['x-content-type-options'], 'nosniff', `${code}`);
			assert.equal(res.headers['referrer-policy'], 'no-referrer', `${code}`);
			assert.equal(res.headers['x-powered-by'], undefined, `${code}`);
		}
	});
});

describe('the happy path', () => {
	test('sec01-http-t5: a full sha, a 7-char prefix and HEAD answer the diff; a revert to a full sha reverts', async () => {
		for (const hash of [head, head.slice(0, 7), 'HEAD']) {
			const { status, json } = await diffOf(hash);
			assert.equal(status, 200, `${hash} → ${JSON.stringify(json)}`);
			assert.match(json.diff, /\+A second line\./, hash);
		}
		const { status, json } = await raw('POST', `/collections/notes/records-revert/${id}`, { body: { hash: first } });
		assert.equal(status, 200, JSON.stringify(json));
		assert.equal(json.reverted, true);
		assert.doesNotMatch(fs.readFileSync(recordFile(), 'utf8'), /A second line/);
	});
});
