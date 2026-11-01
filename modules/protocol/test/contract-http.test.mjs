// The contract suite against `dt serve` — @dreamteamer/http's createApp, listening on an ephemeral
// loopback port INSIDE the test and closed in after() (never the serving verb: it does not return).
// Writes are sent as application/json: 415 and the other transport errors are not the contract's.
// The failures must equal gaps/http.json exactly, so the gap is a reviewed number that only shrinks on
// purpose; the line printed says how far dt serve is behind the extension's host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { api, ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { makeFixture } = await import(pathToFileURL(path.join(PKG, 'lib', 'contract', 'fixture.js')).href);
const { runContract, cases } = await import(pathToFileURL(path.join(PKG, 'lib', 'contract', 'run.js')).href);
const { bind, createApp } = await import(pathToFileURL(path.join(PKG, '..', 'http', 'src', 'app.js')).href);

const REQUEST_TIMEOUT_MS = 30_000;
let server;
let fixture;
after(async () => {
	if (server) await new Promise((r) => server.close(r));
	fixture?.cleanup();
});

test('the contract on dt serve: the failures are exactly gaps/http.json', { timeout: 300_000 }, async () => {
	fixture = makeFixture({ engineDir: ENGINE_DIR });
	bind(api);
	const ws = await api.openWorkspace(fixture.root);
	const log = console.log;
	server = createApp(ws).listen(0, '127.0.0.1');
	await once(server, 'listening');
	const base = `http://127.0.0.1:${server.address().port}/api`;
	const request = async (method, p, body) => {
		const init = { method, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: {} };
		if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
		console.log = () => {};
		try {
			const res = await fetch(base + p, init);
			const text = await res.text();
			let parsed = text;
			try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON: kept as text */ }
			return { status: res.status, body: parsed };
		} finally { console.log = log; }
	};
	const { failed } = await runContract({ request, fixture });
	const ledger = JSON.parse(fs.readFileSync(path.join(PKG, 'lib', 'contract', 'gaps', 'http.json'), 'utf8'));
	console.log(`dt serve: ${failed.length} of ${cases.length} cases fail (ledger ${ledger.length})`);
	for (const f of failed) console.log(`  ✖ ${f.id}: ${f.why}`);
	const ids = failed.map((f) => f.id).sort();
	const newly = ids.filter((id) => !ledger.includes(id));
	const fixed = ledger.filter((id) => !ids.includes(id));
	assert.deepEqual(newly, [], `failing and not in gaps/http.json: ${newly.join(', ')}`);
	assert.deepEqual(fixed, [], `passing now — remove from gaps/http.json: ${fixed.join(', ')}`);
});
