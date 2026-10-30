// HELD-OUT (prototype-harness-heldout-minimal-app-contract): play passes and restores a prototype that has only
// the required app members, a string snapshot and no session snapshot. Needs Chromium — when it does not resolve
// this test FAILS rather than skips: a skipped run is not a pass for this record. Written by the test stage.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from '../../lib/prototype/node/devdep.mjs';
import { serve } from '../../lib/prototype/node/serve.mjs';
import { loadConfig } from '../../lib/prototype/node/config.mjs';
import { buildHP, play } from './lib/hp-fixture.mjs';
import { cleanup } from './lib/common.mjs';

after(cleanup);

describe('held-out: the minimal app contract', () => {
	let hp;
	before(async () => {
		await chromium(); // throws, failing the suite, when no Chromium resolves
		hp = await buildHP();
	});

	test('case 1: play exits 0; both journeys pass, the token anchor and the stub card included, no page error', () => {
		const r = play(hp);
		assert.equal(r.code, 0, r.out);
		const j = Object.fromEntries(r.coverage.journeys.map((x) => [x.key, x]));
		assert.equal(j['np-grant-flow']?.ok, true, r.out); assert.equal(j['np-refusal']?.ok, true, r.out);
		assert.equal(j['np-grant-flow'].stepsOk, 3, 'np-grant-flow: steps 1 (token anchor), 2 and 3 (stub) all ok');
		assert.deepEqual(r.coverage.failures, []);
		assert.equal(r.coverage.totals.stub, 1, 'the system step lands on the stub');
	});

	test('case 2: play --only np-refusal exits 0 — the refusal is expected', () => {
		const r = play(hp, '--only', 'np-refusal');
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /PASS np-refusal/);
	});

	test('case 3: in a browser, play → next → next → stop raises no error and restores the string snapshot', async () => {
		const c = await loadConfig(hp);
		const pw = await chromium(hp);
		const srv = await serve(c);
		const browser = await pw.launch();
		try {
			const page = await browser.newPage();
			const errors = [];
			page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
			page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
			await page.goto(`${srv.base}#/`);
			await page.waitForFunction(() => !!window.__hp?.demo, null, { timeout: 15000 });
			const before = await page.evaluate(() => window.__hp.store.snapshot());
			assert.equal(typeof before, 'string');
			assert.equal(await page.evaluate(() => window.__hp.demo.play('np-grant-flow', 0)), true);
			await page.waitForFunction(() => window.__hp.current()?.screen?.key === 'np-home' && !!document.querySelector('.demo-highlight'), null, { timeout: 4000 });
			const spot = await page.evaluate(() => document.querySelector('.demo-highlight')?.getAttribute('data-demo'));
			assert.equal(spot, 'fill-the-form see-status', 'step 1 spotlights the element by TOKEN');
			const placed = await page.evaluate(() => ({ fab: document.querySelector('.demo-fab')?.parentElement === document.body, bar: document.querySelector('.demo-bar')?.parentElement === document.body, root: !!document.getElementById('demo-root') }));
			assert.deepEqual(placed, { fab: true, bar: true, root: false });
			await page.evaluate(() => window.__hp.demo.next());
			await page.waitForFunction(() => window.__hp.current()?.screen?.key === 'np-grant', null, { timeout: 4000 });
			await page.evaluate(() => window.__hp.demo.next());
			await page.waitForFunction(() => window.__hp.current()?.screen?.key === 'np-admin' && !!document.querySelector('[data-demo~="stub-np-admin"]'), null, { timeout: 4000 });
			const mid = await page.evaluate(() => window.__hp.store.snapshot());
			assert.notEqual(mid, before, 'the journey changed the world');
			await page.evaluate(() => window.__hp.demo.stop());
			await page.waitForTimeout(200);
			const after = await page.evaluate(() => window.__hp.store.snapshot());
			assert.equal(after, before, 'the snapshot after stop() is not byte-identical');
			assert.deepEqual(errors, []);
		} finally { await browser.close(); srv.stop(); }
	});
});
