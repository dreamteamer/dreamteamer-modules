// HELD-OUT (prototype-harness-heldout-cross-product-scope): a journey that crosses into a product the prototype
// does not hold exports its foreign step outOfScope with a warning, a journey wholly outside is left out, and only
// --strict turns the warning into a failure. Written by the test stage against the built code.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../../lib/prototype/node/export.mjs';
import { protoDir, put, js, fakeDt, quiet, exitOf, cleanup } from './lib/common.mjs';

after(cleanup);

const ROWS = {
	'rnd/products': [{ id: 'northwind-portal', name: 'Northwind portal' }, { id: 'northwind-admin', name: 'Northwind admin' }],
	'rnd/screens': [
		{ id: 'np-apply', key: 'np-apply', name: 'Apply', route: '/np/apply', product: 'rnd/products/northwind-portal' },
		{ id: 'np-status', key: 'np-status', name: 'Status', route: '/np/status', product: 'rnd/products/northwind-portal' },
		{ id: 'na-review', key: 'na-review', name: 'Review', route: '/na/review', product: 'rnd/products/northwind-admin' },
	],
	'rnd/user-journeys': [
		{ id: 'np-grant-review', key: 'np-grant-review', name: 'A grant through review', products: ['rnd/products/northwind-portal', 'rnd/products/northwind-admin'], steps: [
			{ screen: 'rnd/screens/np-apply', story: 'rnd/user-stories/2026-01-10--fill-the-form' },
			{ screen: 'rnd/screens/na-review', story: 'rnd/user-stories/2026-01-10--review-the-file' },
			{ screen: 'rnd/screens/np-status', system: true, caption: 'The status changes' },
		] },
		{ id: 'na-only', key: 'na-only', name: 'Admin only', products: ['rnd/products/northwind-admin'], steps: [{ screen: 'rnd/screens/na-review', story: 'rnd/user-stories/2026-01-10--review-the-file' }] },
	],
	'rnd/user-stories': [
		{ id: '2026-01-10--fill-the-form', key: 'fill-the-form', name: 'As an applicant I fill the form', screen: 'rnd/screens/np-apply', journeys: ['rnd/user-journeys/np-grant-review'] },
		{ id: '2026-01-10--review-the-file', key: 'review-the-file', name: 'As an officer I review the file', screen: 'rnd/screens/na-review', journeys: ['rnd/user-journeys/np-grant-review', 'rnd/user-journeys/na-only'] },
	],
	'rnd/personas': [],
	'rnd/open-questions': [{ id: 'review-sla', name: 'Review SLA', question: 'How fast is a review?', status: 'open', blocks: ['rnd/screens/na-review'] }],
};

function prototype() {
	const { dir } = protoDir('northwind-proto');
	put(dir, 'harness.config.mjs', `export default ${js({ products: { 'rnd/products/northwind-portal': { key: 'np' } }, app: '__np', registry: 'public/app/screens/index.js' })};\n`);
	put(dir, 'public/app/screens/index.js', `export const screens = ${js([{ key: 'np-apply', portal: 'np', route: '/np/apply' }, { key: 'np-status', portal: 'np', route: '/np/status' }])};\n`);
	put(dir, 'public/app/demo/journeys/np-grant-review.js', "export default { key: 'np-grant-review', steps: [{}, {}, {}] };\n");
	return dir;
}
async function exportWith(dir, flags = {}) { const io = quiet(); const code = await exitOf(() => run(dir, { dt: fakeDt(ROWS), ...flags, log: io.log, error: io.error }), io); return { code, text: io.text() }; }

describe('held-out: a journey crossing into another product', () => {
	test('case 1: the foreign step is exported outOfScope with a warning; the foreign-only journey is left out; no failure', async () => {
		const dir = prototype();
		const r = await exportWith(dir);
		assert.equal(r.code, 0, r.text);
		assert.ok(r.text.split('\n').some((l) => /^warn\b/.test(l) && /na-review|np-grant-review step 2/.test(l) && /outside|out of scope|outOfScope/i.test(l)), `no out-of-scope warn line:\n${r.text}`);
		assert.doesNotMatch(r.text, /^fail\b/m);
		const J = await import(`${pathToFileURL(path.join(dir, 'public/app/data/journeys.js')).href}?case1`);
		const keys = J.journeys.map((j) => j.key);
		assert.ok(keys.includes('np-grant-review')); assert.ok(!keys.includes('na-only'));
		const s = J.journeys.find((j) => j.key === 'np-grant-review').steps;
		assert.deepEqual(s.map((x) => x.n), [1, 2, 3]);
		assert.equal(s[1].outOfScope, true);
		assert.ok(s[1].portal == null, 'the out-of-scope step carries no portal');
		for (const k of [0, 2]) { assert.equal(s[k].portal, 'np'); assert.ok(!s[k].outOfScope); }
	});

	test('case 2: --strict turns the warning into exit 1 and writes nothing', async () => {
		const dir = prototype();
		const f = { j: path.join(dir, 'public/app/data/journeys.js'), m: path.join(dir, 'public/app/data/meta.js') };
		put(dir, 'public/app/data/journeys.js', '// sentinel\n'); put(dir, 'public/app/data/meta.js', '// sentinel\n');
		const before = { j: fs.readFileSync(f.j), m: fs.readFileSync(f.m) };
		const r = await exportWith(dir, { strict: true });
		assert.equal(r.code, 1, r.text);
		assert.ok(fs.readFileSync(f.j).equals(before.j)); assert.ok(fs.readFileSync(f.m).equals(before.m));
	});
});
