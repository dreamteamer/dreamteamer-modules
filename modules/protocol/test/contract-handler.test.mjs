// The shared handler — the extension's host side, ported into this package — against the contract,
// with the same ledger the extension's own run keeps (gaps/extension.json), plus the two things only a
// handler owes: an undocumented route is "no route" by construction (the router reads ROUTES), and a
// compile-gated write re-opens the workspace first and is refused with 409 when it will not open.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENGINE_DIR } from '../../../tests/helpers/fixture.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(PKG, rel)).href);
const quietly = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

let fixture;
after(() => fixture?.cleanup());

test('the handler passes the contract except the ledger, refuses undocumented routes, and re-opens before a schema write', { timeout: 300_000 }, async () => {
	const { makeFixture } = await load('lib/contract/fixture.js');
	const { runContract, cases } = await load('lib/contract/run.js');
	const { createHandler } = await load('src/handler.js');
	fixture = makeFixture({ engineDir: ENGINE_DIR });
	const handler = await createHandler({ root: fixture.root });
	const request = (m, p, b) => quietly(() => handler.handle(m, p, b));

	const { failed } = await runContract({ request, fixture });
	console.log(`handler: ${failed.length} of ${cases.length} cases fail`);
	for (const f of failed) console.log(`  ✖ ${f.id}: ${f.why}`);
	assert.deepEqual(failed.map((f) => f.id), [], 'the shared handler answers every case');

	// the router: a route ROUTES does not name never reaches the host
	for (const [m, p] of [['GET', '/graph'], ['DELETE', '/info'], ['PATCH', '/fields/tasks/done/rename'], ['PUT', '/collections/tasks/records']]) {
		const r = await request(m, p);
		assert.equal(r.status, 404, `${m} ${p} answered ${r.status}`);
		assert.match(String(r.body?.error), /^unhandled request/);
	}

	// the reopen seat: an extension declared after the handler opened the workspace, and one that throws on
	// load — the next compile-gated write re-opens, cannot, and writes nothing
	const mod = path.join(fixture.root, 'modules', 'broken');
	fs.mkdirSync(mod, { recursive: true });
	fs.writeFileSync(path.join(mod, 'package.json'), JSON.stringify({ name: 'broken', version: '0.0.0', dreamteamer: { extension: './entry.js', title: 'Broken', description: 'An extension that throws on load.' } }));
	fs.writeFileSync(path.join(mod, 'entry.js'), "throw new Error('Northwind extension failed to load');\n");
	const before = fixture.git(['status', '--porcelain', '--', 'modules/default']);
	const r = await request('POST', '/fields/tasks', { name: 'never', type: 'string' });
	assert.equal(r.status, 409, `a write against a workspace that will not open answered ${r.status}: ${JSON.stringify(r.body)}`);
	assert.match(String(r.body?.error), /did not load, so nothing was written/);
	assert.equal(fixture.git(['status', '--porcelain', '--', 'modules/default']), before, 'a source changed');
});
