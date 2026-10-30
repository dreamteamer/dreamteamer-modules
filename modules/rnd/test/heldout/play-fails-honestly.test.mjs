// HELD-OUT (prototype-harness-heldout-play-fails-honestly): play exits 1 naming journey, step and kind for a
// missing anchor, an unexpected refusal (with its rule) and a lossy restore, does not stop at the first failing
// journey, and marks only the failing journey failed in coverage.json. Needs Chromium — it FAILS rather than
// skips when none resolves. Written by the test stage against the built code.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from '../../lib/prototype/node/devdep.mjs';
import { buildHP, play } from './lib/hp-fixture.mjs';
import { cleanup } from './lib/common.mjs';

after(cleanup);
const result = (r, k) => r.coverage?.journeys.find((j) => j.key === k)?.ok;
const named = (out, journey, step, ...words) => out.split('\n').some((l) => l.includes(`${journey}#${step}`) && words.every((w) => (w instanceof RegExp ? w.test(l) : l.includes(w))));

describe('held-out: play fails honestly', () => {
	before(async () => { await chromium(); });

	test('HP-a: an anchor no screen draws — exit 1, journey, step 2 and the kind named', async () => {
		const r = play(await buildHP({ anchor: 'no-such-anchor' }));
		assert.equal(r.code, 1, r.out);
		assert.ok(named(r.out, 'np-grant-flow', 2, /anchor/i, 'no-such-anchor'), r.out);
		assert.equal(result(r, 'np-grant-flow'), false); assert.equal(result(r, 'np-refusal'), true);
	});

	test('HP-b: a refusal the step does not expect — exit 1, journey, step 2, the kind and the rule named', async () => {
		const r = play(await buildHP({ noExpectRefusal: true }));
		assert.equal(r.code, 1, r.out);
		assert.ok(named(r.out, 'np-refusal', 2, /refused/i, 'NW-R-001'), r.out);
		assert.equal(result(r, 'np-refusal'), false); assert.equal(result(r, 'np-grant-flow'), true);
	});

	test('HP-c: both mutations — both failures named, play does not stop at the first journey', async () => {
		const r = play(await buildHP({ anchor: 'no-such-anchor', noExpectRefusal: true }));
		assert.equal(r.code, 1, r.out);
		assert.ok(named(r.out, 'np-grant-flow', 2, /anchor/i, 'no-such-anchor'), r.out);
		assert.ok(named(r.out, 'np-refusal', 2, /refused/i, 'NW-R-001'), r.out);
		assert.equal(result(r, 'np-grant-flow'), false); assert.equal(result(r, 'np-refusal'), false);
	});

	// A restore that drops `seq` is lossy for EVERY journey (each stop() restores), so here both fail; the record's
	// "the other passed" cannot apply to this case.
	test('HP-d: a lossy restore — exit 1, the journey named with the restore that differs', async () => {
		const r = play(await buildHP({ lossyRestore: true }));
		assert.equal(r.code, 1, r.out);
		for (const k of ['np-grant-flow', 'np-refusal']) {
			assert.ok(named(r.out, k, '-', /restore/i), `${k}: no restore failure named\n${r.out}`);
			assert.equal(result(r, k), false);
		}
	});
});
