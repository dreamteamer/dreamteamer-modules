// HELD-OUT (prototype-harness-heldout-several-portals): one product, three windows — under the portal field map
// and screenKey every exported screen and portal is the registry's, a value the map lacks fails by name, and
// check --apply addresses the RECORD id. Written by the test stage against the built code.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run as exportRun } from '../../lib/prototype/node/export.mjs';
import { run as checkRun } from '../../lib/prototype/node/check.mjs';
import { protoDir, put, js, fakeDt, quiet, exitOf, cleanup } from './lib/common.mjs';

after(cleanup);

const P = 'rnd/products/northwind-royalties';
const screen = (id, portal, route, kind = 'page', product = P) => ({ id, key: id, name: id, route, kind, product, portal });
function rows({ ledger = false } = {}) {
	const step = (s) => ({ screen: `rnd/screens/${s}`, system: true, caption: `on ${s}` });
	return {
		'rnd/products': [{ id: 'northwind-royalties', name: 'Northwind royalties' }, { id: 'legacy-royalties', name: 'Legacy royalties' }],
		'rnd/screens': [
			screen('un-catalogue', 'office', '/bo/catalogue'), screen('un-statement', 'artist', '/ap/statement'), screen('un-upload', 'producer', '/pd/upload'),
			screen('catalogue', 'office', '/bo/catalogue', 'page', 'rnd/products/legacy-royalties'),
			...(ledger ? [screen('un-ledger', 'accountant', '/bo/ledger')] : []),
		],
		'rnd/user-journeys': [
			{ id: 'royalty-run', key: 'royalty-run', name: 'A royalty run', products: [P], steps: [step('un-catalogue'), step('un-statement'), step('un-upload'), ...(ledger ? [step('un-ledger')] : [])] },
			{ id: 'artist-statement', key: 'artist-statement', name: 'An artist reads a statement', products: [P], steps: [step('un-statement')] },
		],
		'rnd/user-stories': [], 'rnd/personas': [], 'rnd/open-questions': [],
	};
}
const REGISTRY = [
	{ key: 'catalogue', portal: 'bo', route: '/bo/catalogue', kind: 'page' },
	{ key: 'statement', portal: 'ap', route: '/ap/statement', kind: 'page' },
	{ key: 'upload', portal: 'pd', route: '/pd/upload', kind: 'page' },
];
function prototype({ ledger = false } = {}) {
	const { dir } = protoDir('royalties-proto');
	put(dir, 'harness.config.mjs', `export default {
	products: { '${P}': { key: 'bo' } },
	portal: { from: 'field', field: 'portal', map: { office: 'bo', artist: 'ap', producer: 'pd' } },
	screenKey: (k) => k.replace(/^un-/, ''),
	app: '__ro',
	registry: 'public/app/screens/index.js',
	prototype: 'rnd/prototypes/northwind-royalties-proto',
};\n`);
	put(dir, 'public/app/screens/index.js', `export const screens = ${js([...REGISTRY, ...(ledger ? [{ key: 'ledger', portal: 'bo', route: '/bo/ledger', kind: 'page' }] : [])])};\n`);
	put(dir, 'public/app/demo/journeys/royalty-run.js', `export default { key: 'royalty-run', steps: [${ledger ? '{}, {}, {}, {}' : '{}, {}, {}'}] };\n`);
	put(dir, 'public/app/demo/journeys/artist-statement.js', "export default { key: 'artist-statement', steps: [{}] };\n");
	return dir;
}

describe('held-out: several portals in one product', () => {
	let dir, case1;
	test('case 1: export maps every screen and portal to the registry\'s', async () => {
		dir = prototype();
		const io = quiet(); const code = await exitOf(() => exportRun(dir, { dt: fakeDt(rows()), log: io.log, error: io.error }), io);
		assert.equal(code, 0, io.text());
		const f = path.join(dir, 'public/app/data/journeys.js'); case1 = fs.readFileSync(f);
		const J = await import(`${pathToFileURL(f).href}?case1`);
		const by = (k) => J.journeys.find((j) => j.key === k).steps.map((s) => [s.screen, s.portal]);
		assert.deepEqual(by('royalty-run'), [['catalogue', 'bo'], ['statement', 'ap'], ['upload', 'pd']]);
		assert.deepEqual(by('artist-statement'), [['statement', 'ap']]);
		const all = J.journeys.flatMap((j) => j.steps);
		assert.ok(!all.some((s) => String(s.screen).startsWith('un-')), 'a screen value starts with un-');
		assert.ok(!Object.keys(J.anchors).some((k) => k.startsWith('un-')), 'an anchors key starts with un-');
		assert.ok(!all.some((s) => ['office', 'artist', 'producer'].includes(s.portal)), 'a raw portal value leaked');
	});

	test('case 2: a portal value the map lacks fails by screen and value; journeys.js not written', async () => {
		const d = prototype({ ledger: true });
		const f = path.join(d, 'public/app/data/journeys.js');
		put(d, 'public/app/data/journeys.js', case1.toString('utf8')); // case 1's output in place
		const io = quiet(); const code = await exitOf(() => exportRun(d, { dt: fakeDt(rows({ ledger: true })), log: io.log, error: io.error }), io);
		assert.equal(code, 1, io.text());
		assert.ok(io.lines.some((l) => /un-ledger|\bledger\b/.test(l) && /accountant/.test(l)), `no line names the screen and the unmapped value:\n${io.text()}`);
		assert.ok(fs.readFileSync(f).equals(case1), 'journeys.js changed');
	});

	test('case 3: check --apply sets the record id, never verified, never a commit', async () => {
		const d = prototype();
		const dt = fakeDt(rows());
		const io = quiet(); const code = await exitOf(() => checkRun(d, { apply: true, dt, log: io.log, error: io.error }), io);
		assert.equal(code, 0, io.text());
		const sets = dt.calls.filter((a) => a[0] === 'set');
		assert.ok(sets.length > 0, `no dt set ran:\n${io.text()}`);
		const cat = sets.find((a) => a[1] === 'rnd/screens/un-catalogue');
		assert.ok(cat, `no set addresses rnd/screens/un-catalogue: ${JSON.stringify(sets)}`);
		assert.ok(cat.includes('build_status=built'), JSON.stringify(cat));
		for (const a of dt.calls) {
			assert.ok(!a.includes('rnd/screens/catalogue'), `an argv names the legacy record: ${a.join(' ')}`);
			assert.ok(!a.some((x) => /verified/.test(x)), `an argv says verified: ${a.join(' ')}`);
			assert.notEqual(a[0], 'commit', `an argv commits: ${a.join(' ')}`);
		}
		for (const a of sets) {
			assert.match(a[1], /^rnd\/screens\/un-/, `a set addresses a registry key, not a record id: ${a.join(' ')}`);
			const p = a.find((x) => x.startsWith('prototype='));
			assert.equal(p, 'prototype=rnd/prototypes/northwind-royalties-proto');
		}
	});
});
