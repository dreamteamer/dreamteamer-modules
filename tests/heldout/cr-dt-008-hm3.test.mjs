// HELD-OUT cr-dt-008-hm3 (rnd/tests dreamteamer-modules/heldout-dt008-m-nav-yaml-of-an-invalid-shape).
//
// GET /nav over a hand-edited nav.yaml of an invalid shape answers 200 with the flat tail and a message (the workspace
// node's `notice`, round-2 amendment, or a node of kind message) naming nav.yaml — never a 500, never an empty tree —
// and PATCH /nav refuses to write over it (400 naming nav.yaml, the file byte-identical); PUT with a valid document
// replaces it. Asked through the protocol's shared handler AND through the http host (dt web), on the contract
// fixture workspace (projects, tasks, lab/samples in namespace lab, a record layer), with no restart between cases.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import { apiBase, authHeaders, TIMEOUT } from './cr-dt-008-web.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = path.join(ROOT, 'modules');
const { fixture, call } = await import(pathToFileURL(path.join(MODULES, 'web', 'test', 'support.mjs')).href);
const { startWeb } = await import(pathToFileURL(path.join(MODULES, 'web', 'src', 'server.js')).href);
const { createHandler } = await import(pathToFileURL(path.join(MODULES, 'protocol', 'src', 'handler.js')).href);

const HEADER = '# The left nav of this workspace. Drag and drop writes this file; so may you.';
const CASES = {
	a: { what: 'invalid yaml', write: (f) => fs.writeFileSync(f, 'tree: [a\n hidden: {') },
	b: { what: 'a top-level list', write: (f) => fs.writeFileSync(f, '- tasks\n- projects\n') },
	c: { what: 'tree: 5', write: (f) => fs.writeFileSync(f, 'tree: 5\n') },
	d: { what: 'entries of no valid shape', write: (f) => fs.writeFileSync(f, 'tree:\n  - { folder: [1,2], items: x }\n  - null\n  - { namespace: 3 }\n') },
	e: { what: 'a 0-byte file', write: (f) => fs.writeFileSync(f, ''), emptyOk: true },
	f: { what: 'a folder containing itself by alias', write: (f) => fs.writeFileSync(f, 'tree:\n  - &a { folder: Loop, items: [*a] }\n') },
	g: { what: 'nav.yaml is a directory', write: (f) => fs.mkdirSync(f) },
};

let f, web, handler, navFile, flat;
const quietly = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const hosts = {
	handler: async (method, p, body) => quietly(() => handler.handle(method, p, body)),
	http: async (method, p, body) => {
		let r;
		try { r = await call(`${apiBase(web)}/api${p}`, { method, headers: { ...authHeaders(web), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); } catch (e) { return { status: `no answer (${e.cause?.message ?? e.message})`, body: null }; }
		return { status: r.status, body: r.json ?? r.text };
	},
};
const clear = () => fs.rmSync(navFile, { recursive: true, force: true });
const snapshot = () => (fs.statSync(navFile).isDirectory() ? `dir:${fs.readdirSync(navFile).join(',')}` : fs.readFileSync(navFile, 'utf8'));
const shape = (nodes) => nodes.map((n) => ({ kind: n.kind, key: n.key, ...(n.children && n.kind !== 'layers' ? { children: shape(n.children) } : {}) }));
const messageOf = (top) => [top.notice, ...(top.children ?? []).filter((n) => n.kind === 'message').map((n) => n.label)].filter(Boolean).join(' | ');

before(async () => {
	f = fixture();
	handler = await createHandler({ root: f.root });
	web = await startWeb({ root: f.root, appDir: f.app, idleMinutes: 0 });
	apiBase(web); // a server that resolved no URL fails here, once, naming what it resolved
	navFile = path.join(f.root, 'nav.yaml');
	clear();
	const res = await hosts.handler('GET', '/nav');
	assert.equal(res.status, 200);
	flat = res.body[0];
	assert.ok(flat.children.length > 2, 'the no-document drawing is empty');
	// the no-document drawing: rows alphabetical by title, then the namespace folder (then the layers folder)
	const kinds = flat.children.map((n) => n.kind);
	assert.ok(kinds.indexOf('namespace') > kinds.lastIndexOf('collection'), `the namespace folder is not after the rows: ${kinds}`);
}, { timeout: TIMEOUT.hook });
after(async () => { await web?.close(); f?.cleanupAll(); }, { timeout: TIMEOUT.hook });

for (const [id, c] of Object.entries(CASES)) {
	describe(`(${id}) ${c.what}`, () => {
		for (const [hostName, host] of Object.entries(hosts)) {
			test(`${hostName}: GET 200 within a second, the flat tail, a message naming nav.yaml`, { timeout: TIMEOUT.test }, async () => {
				clear(); c.write(navFile);
				const t0 = Date.now();
				const res = await Promise.race([host('GET', '/nav'), new Promise((r) => setTimeout(() => r({ status: 'hang' }), 5_000))]);
				const ms = Date.now() - t0;
				assert.equal(res.status, 200, `GET answered ${res.status}: ${inspect(res.body, { depth: 4 })}`);
				assert.ok(ms < 1000, `GET took ${ms} ms`);
				const top = res.body[0];
				assert.equal(top.kind, 'workspace');
				const rest = { ...top, children: top.children.filter((n) => n.kind !== 'message') };
				assert.deepEqual(shape(rest.children), shape(flat.children), 'not the flat (no-document) drawing');
				const msg = messageOf(top);
				if (!(c.emptyOk && !msg)) assert.match(msg, /nav\.yaml/, `no notice or message naming nav.yaml (got ${JSON.stringify(msg)})`);
			});
			test(`${hostName}: PATCH hide answers 4xx naming nav.yaml, the file byte-identical`, { timeout: TIMEOUT.test }, async () => {
				clear(); c.write(navFile);
				const before = snapshot();
				const res = await host('PATCH', '/nav', { op: 'hide', target: { name: 'tasks' } });
				if (c.emptyOk && res.status === 200) {
					// an empty file is an empty document: a gesture on it starts from that, as on an absent file
					return;
				}
				assert.ok(res.status >= 400 && res.status < 500, `PATCH answered ${res.status}: ${inspect(res.body, { depth: 4 })}`);
				assert.match(String(res.body?.error ?? res.body), /nav\.yaml/, 'the refusal does not name nav.yaml');
				assert.equal(snapshot(), before, 'PATCH changed the broken file');
			});
			test(`${hostName}: PUT with a valid document answers 200 and replaces it`, { timeout: TIMEOUT.test }, async () => {
				clear(); c.write(navFile);
				const res = await host('PUT', '/nav', { tree: ['tasks', 'projects'], hidden: [] });
				assert.equal(res.status, 200, `PUT answered ${res.status}: ${JSON.stringify(res.body)}`);
				assert.ok(fs.statSync(navFile).isFile(), 'nav.yaml is not a file after PUT');
				assert.match(fs.readFileSync(navFile, 'utf8'), /^# The left nav[\s\S]*- tasks\n- projects|tree:\n {2}- tasks\n {2}- projects/);
			});
		}
	});
}

describe('step 4: fixed by hand, drawn with no restart', () => {
	for (const [hostName, host] of Object.entries(hosts)) {
		test(`${hostName}: a broken file then a valid one — GET draws the valid document`, { timeout: TIMEOUT.test }, async () => {
			clear(); CASES.c.write(navFile);
			assert.equal((await host('GET', '/nav')).status, 200);
			fs.writeFileSync(navFile, `${HEADER}\ntree:\n  - { folder: Fixed, items: [tasks] }\n`);
			const res = await host('GET', '/nav');
			assert.equal(res.status, 200);
			const top = res.body[0];
			assert.equal(top.notice, undefined, `a notice remains: ${top.notice}`);
			assert.equal(top.children[0].kind, 'folder');
			assert.equal(top.children[0].label, 'Fixed');
			assert.deepEqual(top.children[0].children.map((n) => n.target?.name), ['tasks']);
		});
	}
});
